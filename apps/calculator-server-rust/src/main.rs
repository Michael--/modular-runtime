mod proto;

use clap::Parser;
use proto::broker::v1::{
  broker_service_client::BrokerServiceClient, GetAvailableServicesRequest, RegisterServiceRequest,
  ServiceInfo, UnregisterServiceRequest,
};
use proto::calculator::v1::calculator_service_server::{
  CalculatorService, CalculatorServiceServer,
};
use proto::calculator::v1::{CalculateRequest, CalculateResponse, Operation};
use std::{error::Error, net::SocketAddr, time::Duration};
use tokio::sync::watch;
use tokio::time::sleep;
use tonic::{Request, Response, Status};
use tonic::transport::Server;
use topology_reporter_rust::{
  ServiceLanguage, ServiceType, TopologyProxyClient, TopologyProxyConfig,
};

const BROKER_ADDRESS_ENV: &str = "BROKER_ADDRESS";
const TOPOLOGY_PROXY_ENV: &str = "TOPOLOGY_PROXY_ADDRESS";
const DEFAULT_BROKER_ADDRESS: &str = "127.0.0.1:50051";
const DEFAULT_TOPOLOGY_PROXY: &str = "http://127.0.0.1:50055";
const DEFAULT_ADDRESS: &str = "127.0.0.1:5556";
const SERVICE_NAME: &str = "calculator.v1.CalculatorService";
const DEFAULT_ROLE: &str = "default";

#[derive(Parser)]
#[command(name = "calculator-server-rust")]
#[command(about = "A Rust calculator gRPC server with broker registration")]
struct Args {
  /// Bind address in the format host:port
  #[arg(long, default_value = DEFAULT_ADDRESS)]
  address: String,

  /// Broker address in the format host:port
  #[arg(long, default_value = DEFAULT_BROKER_ADDRESS)]
  broker_address: String,

  /// Topology proxy address (HTTP)
  #[arg(long, default_value = DEFAULT_TOPOLOGY_PROXY)]
  topology_proxy: String,

  /// Disable topology reporting
  #[arg(long)]
  no_topology: bool,
}

#[derive(Default)]
struct CalculatorServiceImpl;

#[tonic::async_trait]
impl CalculatorService for CalculatorServiceImpl {
  async fn calculate(
    &self,
    request: Request<CalculateRequest>,
  ) -> Result<Response<CalculateResponse>, Status> {
    let request = request.into_inner();
    let operation = Operation::try_from(request.operation).unwrap_or(Operation::Unspecified);
    let result = match operation {
      Operation::Add => request.operand1 + request.operand2,
      Operation::Subtract => request.operand1 - request.operand2,
      Operation::Multiply => request.operand1 * request.operand2,
      Operation::Divide => request.operand1 / request.operand2,
      Operation::Unspecified => {
        return Err(Status::invalid_argument("Invalid operation"));
      }
    };

    Ok(Response::new(CalculateResponse {
      result,
      error: String::new(),
    }))
  }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
  let args = Args::parse();

  let broker_address =
    std::env::var(BROKER_ADDRESS_ENV).unwrap_or_else(|_| args.broker_address.clone());
  let topology_proxy =
    std::env::var(TOPOLOGY_PROXY_ENV).unwrap_or_else(|_| args.topology_proxy.clone());
  let topology_enabled = !args.no_topology;

  let (service_host, service_port) = parse_host_port(&args.address)?;
  let bind_address: SocketAddr = args.address.parse()?;

  let (shutdown_tx, shutdown_rx) = watch::channel(false);

  let broker_task = tokio::spawn(run_broker_registration(
    broker_address,
    service_host.clone(),
    service_port,
    shutdown_rx.clone(),
  ));

  let topology_task = if topology_enabled {
    let host = hostname::get().ok().and_then(|h| h.into_string().ok());
    let mut config = TopologyProxyConfig::with_defaults(
      topology_proxy.clone(),
      "calculator-server-rust".to_string(),
      ServiceType::Server,
      ServiceLanguage::Rust,
    );
    config.version = Some(env!("CARGO_PKG_VERSION").to_string());
    config.address = Some(args.address.clone());
    config.host = host;
    config.service_interface = Some(SERVICE_NAME.to_string());
    config.service_role = Some(DEFAULT_ROLE.to_string());
    config.program_name = Some("calculator-server-rust".to_string());
    let topology_client = TopologyProxyClient::new(config);
    Some(tokio::spawn(run_topology_heartbeat(
      topology_client,
      shutdown_rx.clone(),
    )))
  } else {
    None
  };

  let server_task = tokio::spawn(async move {
    let service = CalculatorServiceImpl::default();
    Server::builder()
      .add_service(CalculatorServiceServer::new(service))
      .serve_with_shutdown(bind_address, wait_for_shutdown(shutdown_rx.clone()))
      .await
  });

  wait_for_signal().await;
  let _ = shutdown_tx.send(true);

  if let Err(error) = broker_task.await {
    eprintln!("Broker task error: {}", error);
  }
  if let Some(task) = topology_task {
    if let Err(error) = task.await {
      eprintln!("Topology task error: {}", error);
    }
  }
  match server_task.await {
    Ok(Ok(())) => {}
    Ok(Err(error)) => eprintln!("Server error: {}", error),
    Err(error) => eprintln!("Server task error: {}", error),
  }

  Ok(())
}

async fn run_topology_heartbeat(
  mut topology: TopologyProxyClient,
  mut shutdown: watch::Receiver<bool>,
) {
  let mut interval = tokio::time::interval(Duration::from_secs(2));
  loop {
    tokio::select! {
      _ = shutdown.changed() => {
        if *shutdown.borrow() {
          break;
        }
      }
      _ = interval.tick() => {
        if let Err(error) = topology.ensure_registered().await {
          eprintln!("Topology registration failed: {}", error);
        }
      }
    }
  }

  if let Err(error) = topology.unregister().await {
    eprintln!("Topology unregister failed: {}", error);
  }
}

async fn run_broker_registration(
  broker_address: String,
  service_host: String,
  service_port: i32,
  mut shutdown: watch::Receiver<bool>,
) {
  let broker_url = normalize_broker_url(&broker_address);
  let mut delay = Duration::from_secs(1);
  let mut registered = false;

  loop {
    if *shutdown.borrow() {
      break;
    }

    match BrokerServiceClient::connect(broker_url.clone()).await {
      Ok(mut client) => {
        match ensure_broker_registration(&mut client, &service_host, service_port).await {
          Ok(is_registered) => {
            registered = is_registered;
            delay = Duration::from_secs(5);
          }
          Err(error) => {
            eprintln!("Broker registration failed: {}", error);
            delay = next_backoff(delay);
          }
        }
      }
      Err(error) => {
        eprintln!("Broker connection failed: {}", error);
        delay = next_backoff(delay);
      }
    }

    tokio::select! {
      _ = shutdown.changed() => {
        if *shutdown.borrow() {
          break;
        }
      }
      _ = sleep(delay) => {}
    }
  }

  if !registered {
    return;
  }

  if let Ok(mut client) = BrokerServiceClient::connect(broker_url).await {
    let request = UnregisterServiceRequest {
      interface_name: SERVICE_NAME.to_string(),
      role: DEFAULT_ROLE.to_string(),
    };
    let _ = client.unregister_service(request).await;
  }
}

async fn ensure_broker_registration(
  client: &mut BrokerServiceClient<tonic::transport::Channel>,
  service_host: &str,
  service_port: i32,
) -> Result<bool, Status> {
  if is_registered(client, service_host, service_port).await? {
    return Ok(true);
  }

  let request = RegisterServiceRequest {
    info: Some(ServiceInfo {
      interface_name: SERVICE_NAME.to_string(),
      role: DEFAULT_ROLE.to_string(),
    }),
    url: service_host.to_string(),
    port: service_port,
  };
  client.register_service(request).await?;
  Ok(true)
}

async fn is_registered(
  client: &mut BrokerServiceClient<tonic::transport::Channel>,
  service_host: &str,
  service_port: i32,
) -> Result<bool, Status> {
  let response = client
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
    if info.role != DEFAULT_ROLE {
      continue;
    }
    if service.url == service_host && service.port == service_port {
      return Ok(true);
    }
  }

  Ok(false)
}

async fn wait_for_signal() {
  let mut sigterm =
    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
      Ok(signal) => signal,
      Err(_) => return,
    };
  let mut sigint =
    match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt()) {
      Ok(signal) => signal,
      Err(_) => return,
    };

  tokio::select! {
    _ = sigterm.recv() => {
      println!("Received SIGTERM, shutting down.");
    }
    _ = sigint.recv() => {
      println!("Received SIGINT, shutting down.");
    }
  }
}

async fn wait_for_shutdown(mut shutdown: watch::Receiver<bool>) {
  while !*shutdown.borrow() {
    if shutdown.changed().await.is_err() {
      break;
    }
  }
}

fn parse_host_port(address: &str) -> Result<(String, i32), Box<dyn Error>> {
  let (host, port) = address
    .rsplit_once(':')
    .ok_or("Address must be in host:port format")?;
  let port: i32 = port.parse()?;
  Ok((host.to_string(), port))
}

fn normalize_broker_url(address: &str) -> String {
  if address.starts_with("http://") || address.starts_with("https://") {
    address.to_string()
  } else {
    format!("http://{}", address)
  }
}

fn next_backoff(current: Duration) -> Duration {
  let next = current.as_secs().saturating_mul(2).max(1).min(15);
  Duration::from_secs(next)
}
