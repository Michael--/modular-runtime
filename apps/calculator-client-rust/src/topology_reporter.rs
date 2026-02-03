use crate::proto::runtime::v1::{
  topology_service_client::TopologyServiceClient, ActivityType, HeartbeatRequest,
  RegisterServiceRequest, ReportActivityRequest, ServiceHandle, ServiceLanguage, ServiceType,
  UnregisterServiceRequest,
};
use futures_util::stream::StreamExt;
use std::{error::Error, time::Duration};
use tokio::{sync::mpsc, time::interval};
use tonic::transport::Channel;

/// Configuration for the topology reporter.
pub struct TopologyReporterOptions {
  /// Address of the topology service (e.g., "127.0.0.1:50053").
  pub topology_address: String,
  /// Service name to report.
  pub service_name: String,
  /// Service type (server/client/hybrid).
  pub service_type: ServiceType,
  /// Implementation language.
  pub language: ServiceLanguage,
  /// Optional version string.
  pub version: Option<String>,
  /// Optional network address of the service.
  pub address: Option<String>,
  /// Optional host identifier.
  pub host: Option<String>,
  /// Whether activity reporting should be enabled.
  pub enable_activity: bool,
}

/// Activity report payload to record a service interaction.
pub struct ActivityReport {
  /// Target service name.
  pub target_service: String,
  /// Activity type.
  pub activity_type: ActivityType,
  /// Optional timestamp (milliseconds since epoch).
  pub timestamp_ms: Option<i64>,
  /// Optional latency in milliseconds.
  pub latency_ms: Option<i32>,
  /// Optional gRPC method name.
  pub method: Option<String>,
  /// Optional success flag.
  pub success: Option<bool>,
  /// Optional error message.
  pub error_message: Option<String>,
}

/// Status information for the topology reporter.
#[derive(Clone)]
pub struct TopologyReporterStatus {
  /// Service identifier assigned by the topology service.
  pub service_id: Option<String>,
  /// Heartbeat interval reported by the topology service.
  pub heartbeat_interval_ms: Option<i32>,
  /// Whether activity reporting is enabled.
  pub activity_enabled: bool,
}

/// TopologyReporter registers a service and sends heartbeats/activity updates.
pub struct TopologyReporter {
  service_id: Option<String>,
  heartbeat_interval_ms: Option<i32>,
  activity_tx: Option<mpsc::UnboundedSender<ReportActivityRequest>>,
  client: TopologyServiceClient<Channel>,
  options: TopologyReporterOptions,
}

impl TopologyReporter {
  /// Creates a new topology reporter.
  pub async fn new(options: TopologyReporterOptions) -> Result<Self, Box<dyn Error>> {
    let topology_url = if options.topology_address.starts_with("http://")
      || options.topology_address.starts_with("https://")
    {
      options.topology_address.clone()
    } else {
      format!("http://{}", options.topology_address)
    };

    let client = TopologyServiceClient::connect(topology_url).await?;

    Ok(Self {
      service_id: None,
      heartbeat_interval_ms: None,
      activity_tx: None,
      client,
      options,
    })
  }

  /// Registers the service and starts heartbeats.
  pub async fn register(&mut self) -> Result<ServiceHandle, Box<dyn Error>> {
    if let Some(ref service_id) = self.service_id {
      return Ok(ServiceHandle {
        service_id: service_id.clone(),
        heartbeat_interval_ms: self.heartbeat_interval_ms.unwrap_or(0),
        timeout_multiplier: 0,
      });
    }

    let request = RegisterServiceRequest {
      service_name: self.options.service_name.clone(),
      service_type: self.options.service_type as i32,
      language: self.options.language as i32,
      version: self.options.version.clone(),
      address: self.options.address.clone(),
      host: self.options.host.clone(),
      metadata: None,
    };

    let response = self.client.register_service(request).await?.into_inner();
    let handle = response
      .handle
      .ok_or("Topology registration failed: missing service handle.")?;

    self.service_id = Some(handle.service_id.clone());
    self.heartbeat_interval_ms = Some(handle.heartbeat_interval_ms);

    self.start_heartbeat().await;

    if self.options.enable_activity {
      self.start_activity_stream().await;
    }

    Ok(handle)
  }

  /// Reports activity for a connection.
  pub fn report_activity(&self, report: ActivityReport) {
    if let Some(ref tx) = self.activity_tx {
      if let Some(ref service_id) = self.service_id {
        let event = ReportActivityRequest {
          service_id: service_id.clone(),
          target_service: report.target_service,
          r#type: report.activity_type as i32,
          timestamp_ms: Some(
            report.timestamp_ms.unwrap_or_else(|| {
              std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis() as i64
            }),
          ),
          latency_ms: report.latency_ms,
          method: report.method,
          success: report.success,
          batch_size: None,
          error_message: report.error_message,
        };

        let _ = tx.send(event);
      }
    }
  }

  /// Returns the current reporter status.
  pub fn status(&self) -> TopologyReporterStatus {
    TopologyReporterStatus {
      service_id: self.service_id.clone(),
      heartbeat_interval_ms: self.heartbeat_interval_ms,
      activity_enabled: self.activity_tx.is_some(),
    }
  }

  /// Gracefully shuts down the reporter and unregisters the service.
  pub async fn shutdown(&mut self) -> Result<(), Box<dyn Error>> {
    if let Some(ref service_id) = self.service_id {
      let request = UnregisterServiceRequest {
        service_id: service_id.clone(),
      };
      let _ = self.client.unregister_service(request).await;
    }

    self.activity_tx = None;
    self.service_id = None;
    self.heartbeat_interval_ms = None;

    Ok(())
  }

  async fn start_heartbeat(&mut self) {
    let service_id = match &self.service_id {
      Some(id) => id.clone(),
      None => return,
    };

    let heartbeat_interval_ms = match self.heartbeat_interval_ms {
      Some(interval) => interval,
      None => return,
    };

    let mut client = self.client.clone();

    tokio::spawn(async move {
      let mut seq = 0i64;

      let (tx, rx) = mpsc::channel(128);
      let stream = tokio_stream::wrappers::ReceiverStream::new(rx);

      // Send first heartbeat immediately BEFORE starting the stream
      seq += 1;
      let request = HeartbeatRequest {
        service_id: service_id.clone(),
        sequence: seq,
        health: None,
        metrics: None,
      };
      if tx.send(request).await.is_err() {
        eprintln!("Failed to send initial heartbeat");
        return;
      }

      // Now start the bidirectional stream
      let mut response_stream = match client.heartbeat(stream).await {
        Ok(response) => response.into_inner(),
        Err(e) => {
          eprintln!("Failed to start heartbeat stream: {}", e);
          return;
        }
      };

      // Spawn a task to read responses
      tokio::spawn(async move {
        while let Some(_result) = response_stream.next().await {
          // Acknowledge received
        }
      });

      // Continue sending heartbeats at regular intervals
      let mut timer = interval(Duration::from_millis(heartbeat_interval_ms as u64));
      timer.tick().await; // First tick completes immediately, skip it

      loop {
        timer.tick().await;
        seq += 1;

        let request = HeartbeatRequest {
          service_id: service_id.clone(),
          sequence: seq,
          health: None,
          metrics: None,
        };

        if tx.send(request).await.is_err() {
          eprintln!("Failed to send heartbeat");
          break;
        }
      }
    });
  }

  async fn start_activity_stream(&mut self) {
    let (tx, rx) = mpsc::unbounded_channel::<ReportActivityRequest>();
    self.activity_tx = Some(tx);

    let mut client = self.client.clone();

    tokio::spawn(async move {
      let stream = tokio_stream::wrappers::UnboundedReceiverStream::new(rx);

      match client.report_activity(stream).await {
        Ok(_response) => {
          // Activity stream established
        }
        Err(e) => {
          eprintln!("Failed to start activity stream: {}", e);
        }
      }
    });
  }
}
