mod proto;

use chrono::DateTime;
use chrono::FixedOffset;
use proto::broker::v1::ServiceInfo;
use proto::broker::v1::broker_service_client::BrokerServiceClient;
use proto::broker::v1::RegisterServiceRequest;
use proto::pipeline::v1::{Event, ParsedEvent, ParseEventsRequest, ParseEventsResponse};
use proto::pipeline::v1::parse_service_server::{ParseService, ParseServiceServer, SERVICE_NAME as PARSE_SERVICE_NAME};
use serde_json::Value;
use std::error::Error;
use std::net::SocketAddr;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tonic::transport::Server;
use tonic::{Request, Response, Status};

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

#[tonic::async_trait]
impl ParseService for ParseServiceImpl {
  type ParseEventsStream = ReceiverStream<Result<ParseEventsResponse, Status>>;

  async fn parse_events(
    &self,
    request: Request<tonic::Streaming<ParseEventsRequest>>,
  ) -> Result<Response<Self::ParseEventsStream>, Status> {
    let mut input = request.into_inner();
    let (tx, rx) = mpsc::channel(128);

    tokio::spawn(async move {
      loop {
        match input.message().await {
          Ok(Some(message)) => {
            if let Some(event) = message.event {
              if let Some(parsed) = parse_event(&event) {
                if tx
                  .send(Ok(ParseEventsResponse {
                    event: Some(parsed),
                  }))
                  .await
                  .is_err()
                {
                  break;
                }
              }
            }
          }
          Ok(None) => break,
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
