mod proto;

use clap::Parser;
use proto::broker::v1::{
  broker_service_client::BrokerServiceClient, GetAvailableServicesRequest, LookupServiceRequest,
};
use proto::calculator::v1::{
  calculator_service_client::CalculatorServiceClient, CalculateRequest, Operation,
};
use rand::Rng;
use std::{error::Error, time::Duration};
use tokio::time::Instant;
use tonic::transport::Channel;
use topology_reporter_rust::{
  ActivityReport, ActivityType, ServiceLanguage, ServiceType, TopologyProxyClient,
  TopologyProxyConfig,
};

const BROKER_ADDRESS_ENV: &str = "BROKER_ADDRESS";
const DEFAULT_BROKER_ADDRESS: &str = "127.0.0.1:50051";
const DEFAULT_TOPOLOGY_PROXY_ADDRESS: &str = "http://127.0.0.1:50055";
const SERVICE_NAME: &str = "calculator.v1.CalculatorService";
const DEFAULT_ROLE: &str = "default";
const CALCULATOR_SERVICE_KEY: &str = "calculator.v1.CalculatorService::default";

struct RetryState {
  next_retry_at: Instant,
  retry_delay: Duration,
}

impl RetryState {
  fn new() -> Self {
    Self {
      next_retry_at: Instant::now(),
      retry_delay: Duration::from_secs(1),
    }
  }

  fn should_retry(&self) -> bool {
    Instant::now() >= self.next_retry_at
  }

  fn schedule_retry(&mut self) {
    self.next_retry_at = Instant::now() + self.retry_delay;
    let next_delay = self.retry_delay.as_secs().saturating_mul(2).min(15);
    self.retry_delay = Duration::from_secs(next_delay.max(1));
  }

  fn reset(&mut self) {
    self.retry_delay = Duration::from_secs(1);
    self.next_retry_at = Instant::now();
  }
}

struct CalculatorConnection {
  client: CalculatorServiceClient<Channel>,
  address: String,
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
  let mut calculator: Option<CalculatorServiceClient<Channel>> = None;
  let mut broker_retry = RetryState::new();

  let topology_proxy =
    std::env::var("TOPOLOGY_PROXY_ADDRESS").unwrap_or_else(|_| args.topology_proxy.clone());
  let mut topology = if topology_enabled {
    let host = hostname::get()
      .ok()
      .and_then(|h| h.into_string().ok());
    let mut config = TopologyProxyConfig::with_defaults(
      topology_proxy.clone(),
      "calculator-client-rust".to_string(),
      ServiceType::Client,
      ServiceLanguage::Rust,
    );
    config.version = Some(env!("CARGO_PKG_VERSION").to_string());
    config.host = host;
    config.program_name = Some("calculator-client-rust".to_string());
    Some(TopologyProxyClient::new(config))
  } else {
    None
  };
  if topology_enabled {
    println!("Topology proxy: {}", topology_proxy);
    if let Some(topology) = topology.as_mut() {
      if let Err(error) = topology.ensure_registered().await {
        eprintln!("Topology registration failed: {}", error);
      }
    }
  }

  let mut interval = tokio::time::interval(Duration::from_secs(2));

  let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
  let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;

  loop {
    tokio::select! {
      _ = sigterm.recv() => {
        println!("Received SIGTERM, shutting down.");
        if let Some(topology) = topology.as_mut() {
          if let Err(error) = topology.unregister().await {
            eprintln!("Topology unregister failed: {}", error);
          }
        }
        break;
      }
      _ = sigint.recv() => {
        println!("Received SIGINT (Ctrl+C), shutting down.");
        if let Some(topology) = topology.as_mut() {
          if let Err(error) = topology.unregister().await {
            eprintln!("Topology unregister failed: {}", error);
          }
        }
        break;
      }
      _ = interval.tick() => {
        if let Some(topology) = topology.as_mut() {
          if let Err(error) = topology.ensure_registered().await {
            eprintln!("Topology registration failed: {}", error);
          }
        }

        if calculator.is_none() && broker_retry.should_retry() {
          match connect_calculator(&broker_url).await {
            Ok(connection) => {
              println!("Connecting to calculator service at {}", connection.address);
              calculator = Some(connection.client);
              broker_retry.reset();
            }
            Err(error) => {
              eprintln!("Calculator service not available: {}", error);
              broker_retry.schedule_retry();
            }
          }
        }

        let (a, b, op) = random_calculation();
        let request = CalculateRequest {
          operand1: a,
          operand2: b,
          operation: op as i32,
        };

        let started_at = Instant::now();
        let calculator_client = match calculator.as_mut() {
          Some(client) => client,
          None => continue,
        };

        match calculator_client.calculate(request).await {
          Ok(response) => {
            let latency_ms = started_at.elapsed().as_millis() as i32;
            let result = response.into_inner().result;
            println!("calculate({:.6} {} {:.6}) => {:.6}", a, operation_symbol(op), b, result);

            if let Some(topology) = topology.as_mut() {
              let report = ActivityReport {
                target_service: CALCULATOR_SERVICE_KEY.to_string(),
                activity_type: ActivityType::RequestSent,
                timestamp_ms: None,
                latency_ms: Some(latency_ms),
                method: Some("CalculatorService/Calculate".to_string()),
                success: Some(true),
                error_message: None,
              };
              if let Err(error) = topology.report_activity(report).await {
                eprintln!("Topology activity report failed: {}", error);
              }
            }
          }
          Err(error) => {
            let latency_ms = started_at.elapsed().as_millis() as i32;
            eprintln!("Calculation failed: {}", error.message());
            calculator = None;
            broker_retry.schedule_retry();

            if let Some(topology) = topology.as_mut() {
              let report = ActivityReport {
                target_service: CALCULATOR_SERVICE_KEY.to_string(),
                activity_type: ActivityType::Error,
                timestamp_ms: None,
                latency_ms: Some(latency_ms),
                method: Some("CalculatorService/Calculate".to_string()),
                success: Some(false),
                error_message: Some(error.message().to_string()),
              };
              if let Err(error) = topology.report_activity(report).await {
                eprintln!("Topology activity report failed: {}", error);
              }
            }
          }
        }
      }
    }
  }

  Ok(())
}

async fn connect_calculator(
  broker_url: &str,
) -> Result<CalculatorConnection, Box<dyn Error>> {
  let mut broker = BrokerServiceClient::connect(broker_url.to_string()).await?;
  let calculator_url = resolve_calculator_url(&mut broker).await?;
  let client = CalculatorServiceClient::connect(calculator_url.clone()).await?;
  Ok(CalculatorConnection {
    client,
    address: calculator_url,
  })
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
