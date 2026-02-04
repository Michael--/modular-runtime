mod proto;

use clap::Parser;
use proto::broker::v1::{
  broker_service_client::BrokerServiceClient, GetAvailableServicesRequest, LookupServiceRequest,
};
use proto::calculator::v1::{
  calculator_service_client::CalculatorServiceClient, CalculateRequest, Operation,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::{error::Error, time::Duration};
use tokio::time::Instant;
use tonic::transport::Channel;

const BROKER_ADDRESS_ENV: &str = "BROKER_ADDRESS";
const DEFAULT_BROKER_ADDRESS: &str = "127.0.0.1:50051";
const DEFAULT_TOPOLOGY_PROXY_ADDRESS: &str = "http://127.0.0.1:50055";
const SERVICE_NAME: &str = "calculator.v1.CalculatorService";
const DEFAULT_ROLE: &str = "default";

#[derive(Serialize)]
struct RegisterRequest {
  #[serde(rename = "serviceName")]
  service_name: String,
  #[serde(rename = "serviceType")]
  service_type: String,
  language: String,
  version: Option<String>,
  #[serde(rename = "enableActivity")]
  enable_activity: bool,
}

#[derive(Deserialize)]
struct RegisterResponse {
  #[serde(rename = "serviceId")]
  service_id: String,
  #[serde(rename = "heartbeatIntervalMs")]
  heartbeat_interval_ms: i32,
}

#[derive(Serialize)]
struct ActivityRequest {
  #[serde(rename = "serviceId")]
  service_id: String,
  #[serde(rename = "targetService")]
  target_service: String,
  #[serde(rename = "type")]
  activity_type: String,
  #[serde(rename = "latencyMs")]
  latency_ms: Option<i32>,
  method: Option<String>,
  success: Option<bool>,
  #[serde(rename = "errorMessage")]
  error_message: Option<String>,
}

#[derive(Serialize)]
struct UnregisterRequest {
  #[serde(rename = "serviceId")]
  service_id: String,
}

struct TopologyState {
  service_id: Option<String>,
  next_retry_at: Instant,
  retry_delay: Duration,
}

impl TopologyState {
  fn new() -> Self {
    Self {
      service_id: None,
      next_retry_at: Instant::now(),
      retry_delay: Duration::from_secs(1),
    }
  }

  fn schedule_retry(&mut self) {
    self.next_retry_at = Instant::now() + self.retry_delay;
    let next_delay = self.retry_delay.as_secs().saturating_mul(2).min(15);
    self.retry_delay = Duration::from_secs(next_delay.max(1));
  }

  fn reset_retry(&mut self) {
    self.retry_delay = Duration::from_secs(1);
    self.next_retry_at = Instant::now();
  }

  fn service_id(&self) -> Option<&str> {
    self.service_id.as_deref()
  }

  async fn ensure_registered(
    &mut self,
    client: &reqwest::Client,
    topology_proxy: &str,
  ) {
    if self.service_id.is_some() {
      return;
    }

    if Instant::now() < self.next_retry_at {
      return;
    }

    let register_req = RegisterRequest {
      service_name: "calculator-client-rust".to_string(),
      service_type: "SERVICE_TYPE_CLIENT".to_string(),
      language: "SERVICE_LANGUAGE_RUST".to_string(),
      version: Some(env!("CARGO_PKG_VERSION").to_string()),
      enable_activity: true,
    };

    match client
      .post(format!("{}/register", topology_proxy))
      .json(&register_req)
      .send()
      .await
    {
      Ok(response) => {
        if response.status().is_success() {
          match response.json::<RegisterResponse>().await {
            Ok(register_resp) => {
              println!(
                "Registered with topology service: serviceId={}, heartbeat={}ms",
                register_resp.service_id, register_resp.heartbeat_interval_ms
              );
              self.service_id = Some(register_resp.service_id);
              self.reset_retry();
            }
            Err(error) => {
              eprintln!("Failed to parse registration response: {}", error);
              self.schedule_retry();
            }
          }
        } else {
          eprintln!(
            "Failed to register with topology service: {}",
            response.status()
          );
          self.schedule_retry();
        }
      }
      Err(error) => {
        eprintln!("Failed to connect to topology proxy: {}", error);
        self.schedule_retry();
      }
    }
  }

  async fn report_activity(
    &mut self,
    client: &reqwest::Client,
    topology_proxy: &str,
    request: ActivityRequest,
  ) {
    if self.service_id.is_none() {
      return;
    }

    match client
      .post(format!("{}/activity", topology_proxy))
      .json(&request)
      .send()
      .await
    {
      Ok(response) => {
        if !response.status().is_success() {
          eprintln!("Topology activity report failed: {}", response.status());
          self.service_id = None;
          self.schedule_retry();
        }
      }
      Err(error) => {
        eprintln!("Topology activity report failed: {}", error);
        self.service_id = None;
        self.schedule_retry();
      }
    }
  }

  async fn unregister(&mut self, client: &reqwest::Client, topology_proxy: &str) {
    let service_id = match self.service_id.take() {
      Some(service_id) => service_id,
      None => return,
    };

    let unregister_req = UnregisterRequest { service_id };
    let _ = client
      .post(format!("{}/unregister", topology_proxy))
      .json(&unregister_req)
      .send()
      .await;
  }
}

#[derive(Parser)]
#[command(name = "calculator-client-rust")]
#[command(about = "A Rust calculator client that connects to a broker")]
struct Args {
    /// Broker address in the format host:port
    #[arg(long, default_value = DEFAULT_BROKER_ADDRESS)]
    broker_address: String,

    /// Topology proxy address (HTTP)
    #[arg(long, default_value = DEFAULT_TOPOLOGY_PROXY_ADDRESS)]
    topology_proxy: String,

    /// Disable topology reporting
    #[arg(long)]
    no_topology: bool,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
  let args = Args::parse();

  println!("Starting Rust calculator client...");

  let broker_address = std::env::var(BROKER_ADDRESS_ENV).unwrap_or(args.broker_address);
  let topology_enabled = !args.no_topology;

  let broker_url = normalize_broker_url(&broker_address);
  let mut broker = BrokerServiceClient::connect(broker_url).await?;
  let calculator_url = resolve_calculator_url(&mut broker).await?;

  println!("Connecting to calculator service at {}", calculator_url);
  let mut calculator = CalculatorServiceClient::connect(calculator_url).await?;

  let mut topology_state = TopologyState::new();
  let http_client = reqwest::Client::new();
  let topology_proxy = std::env::var("TOPOLOGY_PROXY_ADDRESS").unwrap_or_else(|_| args.topology_proxy.clone());

  if topology_enabled {
    println!("Topology proxy: {}", topology_proxy);
    topology_state
      .ensure_registered(&http_client, &topology_proxy)
      .await;
  }

  let mut interval = tokio::time::interval(Duration::from_secs(2));

  let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
  let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;

  loop {
    tokio::select! {
      _ = sigterm.recv() => {
        println!("Received SIGTERM, shutting down.");
        if topology_enabled {
          topology_state.unregister(&http_client, &topology_proxy).await;
        }
        break;
      }
      _ = sigint.recv() => {
        println!("Received SIGINT (Ctrl+C), shutting down.");
        if topology_enabled {
          topology_state.unregister(&http_client, &topology_proxy).await;
        }
        break;
      }
      _ = interval.tick() => {
        if topology_enabled {
          topology_state
            .ensure_registered(&http_client, &topology_proxy)
            .await;
        }

        let (a, b, op) = random_calculation();
        let request = CalculateRequest {
          operand1: a,
          operand2: b,
          operation: op as i32,
        };

        let started_at = Instant::now();
        match calculator.calculate(request).await {
          Ok(response) => {
            let latency_ms = started_at.elapsed().as_millis() as i32;
            let result = response.into_inner().result;
            println!("calculate({:.6} {} {:.6}) => {:.6}", a, operation_symbol(op), b, result);

            if topology_enabled {
              let Some(service_id) = topology_state.service_id() else {
                continue;
              };
              let activity_req = ActivityRequest {
                service_id: service_id.to_string(),
                target_service: "calculator-server".to_string(),
                activity_type: "ACTIVITY_TYPE_REQUEST_SENT".to_string(),
                latency_ms: Some(latency_ms),
                method: Some("CalculatorService/Calculate".to_string()),
                success: Some(true),
                error_message: None,
              };
              topology_state
                .report_activity(&http_client, &topology_proxy, activity_req)
                .await;
            }
          }
          Err(error) => {
            let latency_ms = started_at.elapsed().as_millis() as i32;
            eprintln!("Calculation failed: {}", error.message());

            if topology_enabled {
              let Some(service_id) = topology_state.service_id() else {
                continue;
              };
              let activity_req = ActivityRequest {
                service_id: service_id.to_string(),
                target_service: "calculator-server".to_string(),
                activity_type: "ACTIVITY_TYPE_ERROR".to_string(),
                latency_ms: Some(latency_ms),
                method: Some("CalculatorService/Calculate".to_string()),
                success: Some(false),
                error_message: Some(error.message().to_string()),
              };
              topology_state
                .report_activity(&http_client, &topology_proxy, activity_req)
                .await;
            }
          }
        }
      }
    }
  }

  Ok(())
}

fn normalize_broker_url(address: &str) -> String {
  if address.starts_with("http://") || address.starts_with("https://") {
    address.to_string()
  } else {
    format!("http://{}", address)
  }
}

async fn resolve_calculator_url(
  broker: &mut BrokerServiceClient<Channel>,
) -> Result<String, Box<dyn Error>> {
  if let Some((url, port)) = lookup_service_via_list(broker).await? {
    return Ok(format!("http://{}:{}", url, port));
  }

  let response = broker
    .lookup_service(LookupServiceRequest {
      interface_name: SERVICE_NAME.to_string(),
      role: DEFAULT_ROLE.to_string(),
    })
    .await?
    .into_inner();

  if response.error.is_empty() && response.port > 0 && !response.url.is_empty() {
    return Ok(format!("http://{}:{}", response.url, response.port));
  }

  Err(format!("Calculator service not found: {}", response.error).into())
}

async fn lookup_service_via_list(
  broker: &mut BrokerServiceClient<Channel>,
) -> Result<Option<(String, i32)>, Box<dyn Error>> {
  let response = broker
    .get_available_services(GetAvailableServicesRequest {})
    .await?
    .into_inner();

  for service in response.services {
    let info = match service.info {
      Some(info) => info,
      None => continue,
    };

    if info.interface_name != SERVICE_NAME {
      continue;
    }

    if !role_matches(&info.role) {
      continue;
    }

    return Ok(Some((service.url, service.port)));
  }

  Ok(None)
}

fn role_matches(role: &str) -> bool {
  role.is_empty() || role == DEFAULT_ROLE
}

fn random_calculation() -> (f64, f64, Operation) {
  let mut rng = rand::thread_rng();
  let operand1 = rng.gen_range(0.0..=10.0);
  let operand2 = rng.gen_range(0.0..=10.0);
  let op = match rng.gen_range(1..=4) {
    1 => Operation::Add,
    2 => Operation::Subtract,
    3 => Operation::Multiply,
    _ => Operation::Divide,
  };
  (operand1, operand2, op)
}

fn operation_symbol(operation: Operation) -> &'static str {
  match operation {
    Operation::Add => "+",
    Operation::Subtract => "-",
    Operation::Multiply => "*",
    Operation::Divide => "/",
    Operation::Unspecified => "?",
  }
}
