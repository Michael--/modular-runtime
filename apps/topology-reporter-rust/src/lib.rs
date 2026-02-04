use serde::{Deserialize, Serialize};
use std::fmt;
use tokio::time::{Duration, Instant};

/// Service type for topology registration.
#[derive(Clone, Copy, Debug)]
pub enum ServiceType {
  Client,
  Server,
  Hybrid,
}

impl ServiceType {
  fn as_str(self) -> &'static str {
    match self {
      ServiceType::Client => "SERVICE_TYPE_CLIENT",
      ServiceType::Server => "SERVICE_TYPE_SERVER",
      ServiceType::Hybrid => "SERVICE_TYPE_HYBRID",
    }
  }
}

/// Language for topology registration.
#[derive(Clone, Copy, Debug)]
pub enum ServiceLanguage {
  Rust,
  Cpp,
  Typescript,
  Unknown,
}

impl ServiceLanguage {
  fn as_str(self) -> &'static str {
    match self {
      ServiceLanguage::Rust => "SERVICE_LANGUAGE_RUST",
      ServiceLanguage::Cpp => "SERVICE_LANGUAGE_CPP",
      ServiceLanguage::Typescript => "SERVICE_LANGUAGE_TYPESCRIPT",
      ServiceLanguage::Unknown => "SERVICE_LANGUAGE_UNKNOWN",
    }
  }
}

/// Activity types supported by the topology proxy.
#[derive(Clone, Copy, Debug)]
pub enum ActivityType {
  RequestSent,
  ResponseReceived,
  Error,
}

impl ActivityType {
  fn as_str(self) -> &'static str {
    match self {
      ActivityType::RequestSent => "ACTIVITY_TYPE_REQUEST_SENT",
      ActivityType::ResponseReceived => "ACTIVITY_TYPE_RESPONSE_RECEIVED",
      ActivityType::Error => "ACTIVITY_TYPE_ERROR",
    }
  }
}

/// Configuration for the topology proxy client.
#[derive(Clone, Debug)]
pub struct TopologyProxyConfig {
  pub proxy_address: String,
  pub service_name: String,
  pub service_type: ServiceType,
  pub language: ServiceLanguage,
  pub service_interface: Option<String>,
  pub service_role: Option<String>,
  pub program_name: Option<String>,
  pub version: Option<String>,
  pub address: Option<String>,
  pub host: Option<String>,
  pub enable_activity: bool,
  pub heartbeat_interval: Duration,
}

impl TopologyProxyConfig {
  /// Creates a default config with a 5 second heartbeat interval.
  pub fn with_defaults(
    proxy_address: String,
    service_name: String,
    service_type: ServiceType,
    language: ServiceLanguage,
  ) -> Self {
    Self {
      proxy_address,
      service_name,
      service_type,
      language,
      service_interface: None,
      service_role: None,
      program_name: None,
      version: None,
      address: None,
      host: None,
      enable_activity: true,
      heartbeat_interval: Duration::from_secs(5),
    }
  }
}

/// Activity report payload.
#[derive(Clone, Debug)]
pub struct ActivityReport {
  pub target_service: String,
  pub activity_type: ActivityType,
  pub timestamp_ms: Option<i64>,
  pub latency_ms: Option<i32>,
  pub method: Option<String>,
  pub success: Option<bool>,
  pub error_message: Option<String>,
}

/// Errors emitted by the topology proxy client.
#[derive(Debug)]
pub enum TopologyProxyError {
  Http(reqwest::Error),
  InvalidResponse(String),
}

impl fmt::Display for TopologyProxyError {
  fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
    match self {
      TopologyProxyError::Http(error) => write!(formatter, "{error}"),
      TopologyProxyError::InvalidResponse(message) => write!(formatter, "{message}"),
    }
  }
}

impl std::error::Error for TopologyProxyError {}

impl From<reqwest::Error> for TopologyProxyError {
  fn from(error: reqwest::Error) -> Self {
    TopologyProxyError::Http(error)
  }
}

#[derive(Serialize)]
struct RegisterRequest {
  #[serde(rename = "serviceName")]
  service_name: String,
  #[serde(rename = "serviceType")]
  service_type: String,
  language: String,
  #[serde(rename = "serviceInterface")]
  service_interface: Option<String>,
  #[serde(rename = "serviceRole")]
  service_role: Option<String>,
  #[serde(rename = "programName")]
  program_name: Option<String>,
  version: Option<String>,
  address: Option<String>,
  host: Option<String>,
  #[serde(rename = "enableActivity")]
  enable_activity: bool,
}

#[derive(Deserialize)]
struct RegisterResponse {
  #[serde(rename = "serviceId")]
  service_id: String,
}

#[derive(Serialize)]
struct HeartbeatRequest {
  #[serde(rename = "serviceId")]
  service_id: String,
}

#[derive(Serialize)]
struct ActivityRequest {
  #[serde(rename = "serviceId")]
  service_id: String,
  #[serde(rename = "targetService")]
  target_service: String,
  #[serde(rename = "type")]
  activity_type: String,
  #[serde(rename = "timestampMs")]
  timestamp_ms: Option<i64>,
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

/// Client for the topology HTTP proxy with retry and heartbeat.
pub struct TopologyProxyClient {
  config: TopologyProxyConfig,
  client: reqwest::Client,
  service_id: Option<String>,
  next_retry_at: Instant,
  retry_delay: Duration,
  last_heartbeat_at: Option<Instant>,
}

impl TopologyProxyClient {
  /// Creates a new topology proxy client.
  pub fn new(config: TopologyProxyConfig) -> Self {
    Self {
      config,
      client: reqwest::Client::new(),
      service_id: None,
      next_retry_at: Instant::now(),
      retry_delay: Duration::from_secs(1),
      last_heartbeat_at: None,
    }
  }

  /// Returns the current service id, if registered.
  pub fn service_id(&self) -> Option<&str> {
    self.service_id.as_deref()
  }

  /// Ensures the service is registered and sends periodic heartbeats.
  pub async fn ensure_registered(&mut self) -> Result<bool, TopologyProxyError> {
    if let Some(service_id) = self.service_id.clone() {
      self.maybe_send_heartbeat(service_id).await?;
      return Ok(true);
    }

    if Instant::now() < self.next_retry_at {
      return Ok(false);
    }

    match self.register().await {
      Ok(()) => Ok(true),
      Err(error) => {
        self.schedule_retry();
        Err(error)
      }
    }
  }

  /// Reports activity to topology, registering first if needed.
  pub async fn report_activity(
    &mut self,
    report: ActivityReport,
  ) -> Result<(), TopologyProxyError> {
    if !self.ensure_registered().await? {
      return Ok(());
    }

    let service_id = match self.service_id.clone() {
      Some(service_id) => service_id,
      None => return Ok(()),
    };

    let request = ActivityRequest {
      service_id,
      target_service: report.target_service,
      activity_type: report.activity_type.as_str().to_string(),
      timestamp_ms: report.timestamp_ms,
      latency_ms: report.latency_ms,
      method: report.method,
      success: report.success,
      error_message: report.error_message,
    };

    let response = match self
      .client
      .post(format!("{}/activity", self.config.proxy_address))
      .json(&request)
      .send()
      .await
    {
      Ok(response) => response,
      Err(error) => {
        self.invalidate_registration();
        return Err(error.into());
      }
    };

    if !response.status().is_success() {
      self.invalidate_registration();
      return Err(TopologyProxyError::InvalidResponse(format!(
        "Activity report failed: {}",
        response.status()
      )));
    }

    Ok(())
  }

  /// Unregisters the service from topology.
  pub async fn unregister(&mut self) -> Result<(), TopologyProxyError> {
    let service_id = match self.service_id.take() {
      Some(service_id) => service_id,
      None => return Ok(()),
    };

    let request = UnregisterRequest { service_id };
    let response = self
      .client
      .post(format!("{}/unregister", self.config.proxy_address))
      .json(&request)
      .send()
      .await?;

    if !response.status().is_success() {
      return Err(TopologyProxyError::InvalidResponse(format!(
        "Unregister failed: {}",
        response.status()
      )));
    }

    Ok(())
  }

  async fn register(&mut self) -> Result<(), TopologyProxyError> {
    let request = RegisterRequest {
      service_name: self.config.service_name.clone(),
      service_type: self.config.service_type.as_str().to_string(),
      language: self.config.language.as_str().to_string(),
      service_interface: self.config.service_interface.clone(),
      service_role: self.config.service_role.clone(),
      program_name: self.config.program_name.clone(),
      version: self.config.version.clone(),
      address: self.config.address.clone(),
      host: self.config.host.clone(),
      enable_activity: self.config.enable_activity,
    };

    let response = self
      .client
      .post(format!("{}/register", self.config.proxy_address))
      .json(&request)
      .send()
      .await?;

    if !response.status().is_success() {
      return Err(TopologyProxyError::InvalidResponse(format!(
        "Registration failed: {}",
        response.status()
      )));
    }

    let payload = response.json::<RegisterResponse>().await?;
    if payload.service_id.is_empty() {
      return Err(TopologyProxyError::InvalidResponse(
        "Missing serviceId in response.".to_string(),
      ));
    }

    self.service_id = Some(payload.service_id);
    self.last_heartbeat_at = Some(Instant::now());
    self.reset_retry();
    Ok(())
  }

  async fn maybe_send_heartbeat(&mut self, service_id: String) -> Result<(), TopologyProxyError> {
    let heartbeat_interval = self.config.heartbeat_interval;
    if heartbeat_interval == Duration::from_secs(0) {
      return Ok(());
    }

    if let Some(last_sent) = self.last_heartbeat_at {
      if Instant::now().duration_since(last_sent) < heartbeat_interval {
        return Ok(());
      }
    }

    let request = HeartbeatRequest { service_id };
    let response = match self
      .client
      .post(format!("{}/heartbeat", self.config.proxy_address))
      .json(&request)
      .send()
      .await
    {
      Ok(response) => response,
      Err(error) => {
        self.invalidate_registration();
        return Err(error.into());
      }
    };

    if !response.status().is_success() {
      self.invalidate_registration();
      return Err(TopologyProxyError::InvalidResponse(format!(
        "Heartbeat failed: {}",
        response.status()
      )));
    }

    self.last_heartbeat_at = Some(Instant::now());
    Ok(())
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

  fn invalidate_registration(&mut self) {
    self.service_id = None;
    self.last_heartbeat_at = None;
    self.schedule_retry();
  }
}
