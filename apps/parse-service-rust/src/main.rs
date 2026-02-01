mod proto;
mod workitem;

use chrono::DateTime;
use chrono::FixedOffset;
use proto::broker::v1::ServiceInfo;
use proto::broker::v1::broker_service_client::BrokerServiceClient;
use proto::broker::v1::RegisterServiceRequest;
use proto::pipeline::v1::{
  Event,
  ParseEventsBatchRequest,
  ParseEventsBatchResponse,
  ParsedEvent,
  ParseEventsRequest,
  ParseEventsResponse,
};
use proto::pipeline::v1::parse_service_server::{ParseService, ParseServiceServer, SERVICE_NAME as PARSE_SERVICE_NAME};
use serde_json::Value;
use std::error::Error;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::Mutex;
use std::time::Instant;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Server;
use tonic::{Request, Response, Status};
use workitem::{WorkItem, process_work_item};

const DEFAULT_HOST: &str = "127.0.0.1";
const DEFAULT_PORT: u16 = 6002;
const DEFAULT_BROKER_ADDRESS: &str = "127.0.0.1:50051";
const DEFAULT_ROLE: &str = "default";

#[derive(Clone, Debug)]
struct ParseConfig {
  host: String,
  port: u16,
  broker_address: String,
  register_with_broker: bool,
}

#[derive(Default)]
struct ParseServiceImpl;

#[derive(Default, Clone)]
struct ServiceMetrics {
  events_processed: Arc<Mutex<u64>>,
  processing_time_ms: Arc<Mutex<f64>>,
  ipc_send_time_ms: Arc<Mutex<f64>>,
  ipc_recv_time_ms: Arc<Mutex<f64>>,
}

impl ServiceMetrics {
  fn record_recv(&self, duration_ms: f64) {
    *self.ipc_recv_time_ms.lock().unwrap() += duration_ms;
  }

  fn record_processing(&self, duration_ms: f64) {
    self.record_processing_count(duration_ms, 1);
  }

  fn record_processing_count(&self, duration_ms: f64, count: u64) {
    *self.processing_time_ms.lock().unwrap() += duration_ms;
    *self.events_processed.lock().unwrap() += count;
  }

  fn record_send(&self, duration_ms: f64) {
    *self.ipc_send_time_ms.lock().unwrap() += duration_ms;
  }

  fn print_summary(&self, service_name: &str) {
    let events = *self.events_processed.lock().unwrap();
    let processing = *self.processing_time_ms.lock().unwrap();
    let send = *self.ipc_send_time_ms.lock().unwrap();
    let recv = *self.ipc_recv_time_ms.lock().unwrap();
    let total = processing + send + recv;

    println!("\n=== {} Metrics ===", service_name);
    println!("Events processed: {}", events);
    println!("Processing time: {:.2}ms ({:.1}%)", processing, (processing / total) * 100.0);
    println!("IPC Send time: {:.2}ms ({:.1}%)", send, (send / total) * 100.0);
    println!("IPC Recv time: {:.2}ms ({:.1}%)", recv, (recv / total) * 100.0);
    println!("Avg per event:");
    println!("  Processing: {:.4}ms", processing / events as f64);
    println!("  IPC Send: {:.4}ms", send / events as f64);
    println!("  IPC Recv: {:.4}ms", recv / events as f64);
  }
}

#[tonic::async_trait]
impl ParseService for ParseServiceImpl {
  type ParseEventsStream = ReceiverStream<Result<ParseEventsResponse, Status>>;
  type ParseEventsBatchStream = ReceiverStream<Result<ParseEventsBatchResponse, Status>>;

  async fn parse_events(
    &self,
    request: Request<tonic::Streaming<ParseEventsRequest>>,
  ) -> Result<Response<Self::ParseEventsStream>, Status> {
    let mut input = request.into_inner();
    let (tx, rx) = mpsc::channel(128);
    let metrics = ServiceMetrics::default();

    tokio::spawn(async move {
      loop {
        let recv_start = Instant::now();
        match input.message().await {
          Ok(Some(message)) => {
            metrics.record_recv(recv_start.elapsed().as_secs_f64() * 1000.0);

            if let Some(event) = message.event {
              let process_start = Instant::now();
              let parsed = parse_event(&event);
              metrics.record_processing(process_start.elapsed().as_secs_f64() * 1000.0);

              if let Some(parsed) = parsed {
                let send_start = Instant::now();
                let send_result = tx
                  .send(Ok(ParseEventsResponse {
                    event: Some(parsed),
                  }))
                  .await;
                metrics.record_send(send_start.elapsed().as_secs_f64() * 1000.0);

                if send_result.is_err() {
                  break;
                }
              }
            }
          }
          Ok(None) => {
            metrics.print_summary("parse-service");
            break;
          }
          Err(error) => {
            let _ = tx.send(Err(Status::internal(error.to_string()))).await;
            break;
          }
        }
      }
    });

    Ok(Response::new(ReceiverStream::new(rx)))
  }

  async fn parse_events_batch(
    &self,
    request: Request<tonic::Streaming<ParseEventsBatchRequest>>,
  ) -> Result<Response<Self::ParseEventsBatchStream>, Status> {
    let mut input = request.into_inner();
    let (tx, rx) = mpsc::channel(128);
    let metrics = ServiceMetrics::default();

    tokio::spawn(async move {
      loop {
        let recv_start = Instant::now();
        match input.message().await {
          Ok(Some(message)) => {
            metrics.record_recv(recv_start.elapsed().as_secs_f64() * 1000.0);

            if message.events.is_empty() {
              continue;
            }

            let process_start = Instant::now();
            let parsed: Vec<ParsedEvent> = message
              .events
              .iter()
              .filter_map(parse_event)
              .collect();
            metrics.record_processing_count(
              process_start.elapsed().as_secs_f64() * 1000.0,
              message.events.len() as u64,
            );

            if !parsed.is_empty() {
              let send_start = Instant::now();
              let send_result = tx
                .send(Ok(ParseEventsBatchResponse { events: parsed }))
                .await;
              metrics.record_send(send_start.elapsed().as_secs_f64() * 1000.0);

              if send_result.is_err() {
                break;
              }
            }
          }
          Ok(None) => {
            metrics.print_summary("parse-service");
            break;
          }
          Err(error) => {
            let _ = tx.send(Err(Status::internal(error.to_string()))).await;
            break;
          }
        }
      }
    });

    Ok(Response::new(ReceiverStream::new(rx)))
  }
}

fn parse_event(event: &Event) -> Option<ParsedEvent> {
  if event.raw_json.trim().is_empty() {
    return None;
  }

  let parsed: Value = serde_json::from_str(&event.raw_json).ok()?;
  let object = parsed.as_object()?;

  // Check if this is a WorkItem
  if object.contains_key("id") && object.contains_key("vectors") && object.contains_key("matrix") {
    if let Ok(work_item) = serde_json::from_value::<WorkItem>(parsed.clone()) {
      let processed = process_work_item(&work_item);
      let processed_json = serde_json::to_string(&processed).ok()?;
      return Some(ParsedEvent {
        r#type: String::from("work-item"),
        user: processed_json, // Store processed WorkItem JSON in user field (hack for demo)
        value: 0,
        timestamp: 0,
        sequence: event.sequence.clone(),
      });
    }
  }

  // Normal event parsing
  let ts = object.get("ts")?.as_str()?;
  let event_type = object.get("type")?.as_str()?;
  let user = object.get("user")?.as_str()?;
  let value = object.get("value")?;

  if !matches!(event_type, "click" | "view" | "purchase") {
    return None;
  }

  let value_num = if let Some(number) = value.as_i64() {
    number
  } else if let Some(number) = value.as_f64() {
    number.trunc() as i64
  } else {
    return None;
  };

  let timestamp = DateTime::parse_from_rfc3339(ts)
    .map(|dt: DateTime<FixedOffset>| dt.timestamp_millis())
    .unwrap_or(0);

  Some(ParsedEvent {
    r#type: event_type.to_string(),
    user: user.to_string(),
    value: value_num,
    timestamp,
    sequence: event.sequence,
  })
}

fn normalize_broker_url(address: &str) -> String {
  if address.starts_with("http://") || address.starts_with("https://") {
    address.to_string()
  } else {
    format!("http://{}", address)
  }
}

async fn register_with_broker(config: &ParseConfig) -> Result<(), Box<dyn Error>> {
  let broker_url = normalize_broker_url(&config.broker_address);
  let mut broker = BrokerServiceClient::connect(broker_url).await?;
  let request = RegisterServiceRequest {
    info: Some(ServiceInfo {
      interface_name: PARSE_SERVICE_NAME.to_string(),
      role: DEFAULT_ROLE.to_string(),
    }),
    url: config.host.clone(),
    port: config.port as i32,
  };
  broker.register_service(request).await?;
  Ok(())
}

fn parse_args() -> Result<ParseConfig, Box<dyn Error>> {
  let mut config = ParseConfig {
    host: DEFAULT_HOST.to_string(),
    port: DEFAULT_PORT,
    broker_address: DEFAULT_BROKER_ADDRESS.to_string(),
    register_with_broker: true,
  };

  let mut args = std::env::args().skip(1).peekable();
  while let Some(arg) = args.next() {
    match arg.as_str() {
      "--host" => {
        config.host = args.next().ok_or("Missing value for --host")?;
      }
      "--port" => {
        let value = args.next().ok_or("Missing value for --port")?;
        config.port = value.parse()?;
      }
      "--broker" => {
        config.broker_address = args.next().ok_or("Missing value for --broker")?;
      }
      "--no-broker" => {
        config.register_with_broker = false;
      }
      "-h" | "--help" => {
        println!(
          "Usage: parse-service-rust [options]\n\nOptions:\n  --host <host>       Bind host (default: {})\n  --port <port>       Bind port (default: {})\n  --broker <address>  Broker address (default: {})\n  --no-broker         Disable broker registration\n  -h, --help          Show this help message",
          DEFAULT_HOST, DEFAULT_PORT, DEFAULT_BROKER_ADDRESS
        );
        std::process::exit(0);
      }
      _ => return Err(format!("Unknown argument: {}", arg).into()),
    }
  }

  Ok(config)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
  let config = parse_args()?;
  let addr: SocketAddr = format!("{}:{}", config.host, config.port).parse()?;

  if config.register_with_broker {
    let config_clone = config.clone();
    tokio::spawn(async move {
      if let Err(error) = register_with_broker(&config_clone).await {
        eprintln!("Failed to register service with broker: {}", error);
      }
    });
  }

  let parse_service = ParseServiceImpl::default();
  let server = Server::builder().add_service(ParseServiceServer::new(parse_service));

  println!("Parse service listening on {}", addr);

  server
    .serve_with_shutdown(addr, async {
      if tokio::signal::ctrl_c().await.is_ok() {
        println!("Shutdown signal received");
      }
    })
    .await?;

  Ok(())
}
