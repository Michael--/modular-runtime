mod proto;

use proto::broker::v1::{
  broker_service_client::BrokerServiceClient, GetAvailableServicesRequest, LookupServiceRequest,
};
use proto::calculator::v1::{
  calculator_service_client::CalculatorServiceClient, CalculationRequest, Operation,
};
use rand::Rng;
use std::{error::Error, time::Duration};
use tonic::transport::Channel;

const BROKER_ADDRESS_ENV: &str = "BROKER_ADDRESS";
const DEFAULT_BROKER_ADDRESS: &str = "127.0.0.1:50051";
const SERVICE_NAME: &str = "calculator.v1.CalculatorService";
const DEFAULT_ROLE: &str = "default";

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
  println!("Starting Rust calculator client...");

  let broker_address = std::env::var(BROKER_ADDRESS_ENV).unwrap_or_else(|_| {
    println!(
      "Using default broker address: {} (set {} to override)",
      DEFAULT_BROKER_ADDRESS, BROKER_ADDRESS_ENV
    );
    DEFAULT_BROKER_ADDRESS.to_string()
  });

  let broker_url = normalize_broker_url(&broker_address);
  let mut broker = BrokerServiceClient::connect(broker_url).await?;
  let calculator_url = resolve_calculator_url(&mut broker).await?;

  println!("Connecting to calculator service at {}", calculator_url);
  let mut calculator = CalculatorServiceClient::connect(calculator_url).await?;

  let mut interval = tokio::time::interval(Duration::from_secs(2));
  loop {
    tokio::select! {
      _ = tokio::signal::ctrl_c() => {
        println!("Received Ctrl+C, shutting down.");
        break;
      }
      _ = interval.tick() => {
        let (a, b, op) = random_calculation();
        let request = CalculationRequest {
          operand1: a,
          operand2: b,
          operation: op as i32,
        };

        match calculator.calculate(request).await {
          Ok(response) => {
            let result = response.into_inner().result;
            println!("calculate({} {} {}) => {}", a, operation_symbol(op), b, result);
          }
          Err(error) => {
            eprintln!("Calculation failed: {}", error.message());
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
  let op = match rng.gen_range(0..=3) {
    0 => Operation::Add,
    1 => Operation::Subtract,
    2 => Operation::Multiply,
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
  }
}
