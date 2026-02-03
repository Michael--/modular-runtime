# Demo Plan: Runtime Services & UI

## ⚠️ WICHTIGER HINWEIS: Topology Service Refactoring

**Stand**: 2026-02-03

Der Topology Service wurde **komplett neu konzipiert**:

✅ **Heartbeat-basiert** statt Interceptor-Magic  
✅ **Expliziter Multi-Language-Support** (TS, Rust, C++, Go, Python)  
✅ **Keine "Leichen"** in der Live-View (Timeout-basierte Cleanup)  
✅ **Type-Safe** Proto-Definitionen  
✅ **Throttled Updates** für skalierbare Performance

📖 **Dokumentation**:

- [Detailliertes Design-Dokument](docs-site/docs/topology-refactoring.md)
- [Executive Summary](docs-site/docs/topology-summary.md)
- [Timeout & Throttling Tuning](docs-site/docs/topology-tuning.md)

---

## Vision

Eine **anschauliche Demo-Umgebung**, die zeigt wie ein polyglot Service-Runtime funktioniert:

- Services starten, crashen, sich erholen
- Service Discovery in Aktion
- Live-Monitoring und Debugging
- Chaos Engineering in Echtzeit

**Zielgruppe**: Entwickler, die verstehen wollen wie lokale Service-Architekturen ohne Kubernetes funktionieren.

---

## Architektur-Übersicht

### Core Runtime (besteht bereits)

- **Broker** (Service Registry + Discovery)
- **Supervisor** (Process Management via Ink TUI)
- **Calculator** (polyglot: TS, Rust, C++)

### Neue Runtime Services (geplant)

```
┌─────────────────────────────────────────────────────┐
│                   Supervisor UI                     │
│              (Electron oder Web-basiert)            │
│   - Live Topology Graph  - Health Dashboard         │
│   - Log Stream           - Load Testing Controls    │
└─────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┬─────────────┐
        │                 │                 │             │
    ┌───▼───┐      ┌──────▼──────┐    ┌────▼────┐  ┌─────▼─────┐
    │Broker │      │Health Service│   │Logger   │  │ Topology  │
    └───┬───┘      └──────┬──────┘    │Service  │  │  Service  │
        │                 │            └────┬────┘  └─────┬─────┘
        │                 │                 │             │
        │                 │         ┌───────┴─────────────┘
        │                 │         │ (tracks connections)
    ┌───▼──────────────────▼─────────▼──────────────┐
    │         Application Services                  │
    │  (Calculator, Pipeline, Custom Services)      │
    │    with gRPC Interceptors for auto-tracking   │
    └──────────────────────────────────────────────┘
        ▲                 ▲
        │                 │
  ┌─────┴────┐     ┌──────┴──────┐
  │Load Gen  │     │Chaos Injector│
  └──────────┘     └──────────────┘
```

---

## Phase 1: Foundation Services (Prio 1)

**Ziel**: Basis-Infrastruktur für Observability & Topology Tracking

### 1.0 Topology Service ⭐⭐⭐⭐⭐ **[KOMPLETT NEU KONZIPIERT]**

**Zweck**: Live-Visualisierung des Service-Netzwerks mit Heartbeat-basiertem Lifecycle-Tracking

**Demo-Wert**:

- 🎨 **Live Network Graph** (React Flow)
- 💓 **Heartbeat-basiert**: Automatische Erkennung von toten Services
- 🔍 Zeigt aktive Connections UND passive Verbindungen
- 📊 RPS/Latency pro Connection mit konfigurierbarem Throttling
- 💥 Chaos-Tests sichtbar: Connection bricht → Graph updated
- 🌍 **Expliziter Multi-Language-Support**: TS, Rust, C++, Go, Python

**Problem das es löst**:

- Broker kennt nur Service-Registrations
- Niemand weiß welche Services **tatsächlich alive** sind
- Keine "Leichen" in der Web-View
- Debugging: "Warum kommt mein Request nicht an?"
- Multi-Language-Support ohne Interceptor-Magic

---

#### **Architektur-Prinzipien (REFACTORED)**

##### 1. **Kein Interceptor-Zwang** ✅

**Problem mit Interceptors**:

- Nur in einigen Sprachen verfügbar (TypeScript: begrenzt, Rust/C++/Go: kompliziert)
- Implizite Magie → schwer zu debuggen
- Overhead bei jedem gRPC-Call
- Server-Side-Interceptors in @grpc/grpc-js limitiert

**Neue Lösung: Explizite Registrierung**

Services registrieren sich **explizit** mit einem **Connection-Handle**:

```protobuf
service TopologyService {
  // 1. Service registriert sich beim Start (Server + Client)
  rpc RegisterService(RegisterServiceRequest) returns (ServiceHandle);

  // 2. Heartbeat hält Service am Leben
  rpc Heartbeat(stream HeartbeatRequest) returns (stream HeartbeatResponse);

  // 3. Connection-Events (optional, nur bei aktiver Kommunikation)
  rpc ReportActivity(stream ActivityEvent) returns (ActivityAck);

  // 4. Service meldet sich ab (optional, bei graceful shutdown)
  rpc UnregisterService(ServiceHandle) returns (UnregisterResponse);

  // 5. Topology-Abfragen
  rpc GetTopology(TopologyQuery) returns (TopologySnapshot);
  rpc WatchTopology(TopologyQuery) returns (stream TopologyUpdate);
}
```

##### 2. **Heartbeat-Mechanismus** 💓

**Warum Heartbeat?**

- Echte Liveness-Detection (keine Zombie-Services)
- Passive Connections sichtbar (connected aber idle)
- Timeout-basierte Cleanup
- Funktioniert in JEDER Sprache (simpler Stream)

**Heartbeat-Fluss**:

```
Service (ANY Language)        TopologyService
       |                             |
       |--RegisterService()--------->|  ← Returns ServiceHandle + Interval
       |<--ServiceHandle(id, 5s)-----|
       |                             |
       |==Heartbeat Stream opened===>|
       |--Heartbeat(handle, seq=1)-->|  ← Every 5s
       |<--HeartbeatResponse---------|
       |                             |
       |--Heartbeat(handle, seq=2)-->|  ← Every 5s
       |<--HeartbeatResponse---------|
       |                             |
       [NO HEARTBEAT FOR 15s]        |  ← 3x Timeout
       |                             |--Auto-Unregister
       |                             |--Notify Watchers
```

**Heartbeat-Proto**:

```protobuf
message RegisterServiceRequest {
  string service_name = 1;              // "calculator-client-rust"
  ServiceType service_type = 2;         // SERVER | CLIENT | HYBRID
  ServiceLanguage language = 3;         // TYPESCRIPT | RUST | CPP | GO | PYTHON (type-safe!)
  optional string version = 4;          // "1.0.0"
  optional string address = 5;          // "127.0.0.1:50051" (für ALLE Typen, nicht nur SERVER)
  optional string host = 6;             // "my-machine" oder hostname
  optional ServiceMetadata metadata = 7; // Strukturierte Metadata (type-safe)
}

enum ServiceLanguage {
  LANGUAGE_UNKNOWN = 0;
  TYPESCRIPT = 1;
  RUST = 2;
  CPP = 3;
  GO = 4;
  PYTHON = 5;
  JAVA = 6;
  CSHARP = 7;
  // Extensible für neue Sprachen
}

message ServiceMetadata {
  optional string region = 1;           // "eu-west", "us-east"
  optional string environment = 2;      // "dev", "staging", "prod"
  optional string team = 3;             // "platform", "backend"
  optional string version_hash = 4;     // Git commit hash
  // need to extend if needed
}

message ServiceHandle {
  string service_id = 1;           // UUID
  int32 heartbeat_interval_ms = 2; // z.B. 5000 (5s)
  int32 timeout_multiplier = 3;    // z.B. 3 (15s timeout)
}

message HeartbeatRequest {
  string service_id = 1;
  int64 sequence = 2;              // Monoton steigend
  optional ServiceMetrics metrics = 3; // Optional: CPU, Memory
  optional ApplicationHealth health = 4; // Optional: Application-Level Health
}

message ApplicationHealth {
  HealthState state = 1;           // STARTING, HEALTHY, DEGRADED, UNHEALTHY
  optional string message = 2;     // Details: "High CPU", "DB connection lost"
  optional int32 error_count = 3;  // Anzahl recent errors
}

enum HealthState {
  HEALTH_UNKNOWN = 0;
  STARTING = 1;       // Service startet noch
  HEALTHY = 2;        // Alles ok
  DEGRADED = 3;       // Funktioniert, aber Performance-Probleme
  UNHEALTHY = 4;      // Kritische Probleme
}

message HeartbeatResponse {
  int64 sequence = 1;              // Echo
  bool acknowledged = 2;
}

enum ServiceType {
  SERVER = 0;   // Bietet Service an
  CLIENT = 1;   // Konsumiert Service
  HYBRID = 2;   // Beides (z.B. Pipeline-Service)
}
```

##### 3. **Activity Tracking (Optional)** 📊

**Für Services die RPS/Latency tracken wollen**:

```protobuf
message ActivityEvent {
  string service_id = 1;
  string target_service = 2;            // Wohin geht der Call?
  ActivityType type = 3;                // REQUEST_SENT, RESPONSE_RECEIVED
  optional int64 timestamp_ms = 4;      // Optional: Server kann timestamp setzen
  optional int32 latency_ms = 5;        // Nur bei RESPONSE_RECEIVED
  optional string method = 6;           // gRPC Method Name
  optional bool success = 7;            // false bei Errors
  optional int32 batch_size = 8;        // Anzahl aggregierter Events (für Throttling)
  optional string error_message = 9;    // Bei Errors
}

enum ActivityType {
  REQUEST_SENT = 0;
  RESPONSE_RECEIVED = 1;
  ERROR = 2;
}
```

**Update-Throttling im Service**:

- Services sammeln Activity-Events in lokalen Batches
- Senden nur alle X Sekunden (konfigurierbar: 1s, 5s, 10s)
- TopologyService aggregiert zu RPS/Latency-Metriken

##### 4. **Connection-States** 🔌

```protobuf
enum ConnectionState {
  UNKNOWN = 0;
  REGISTERED = 1;    // Service registriert, sendet Heartbeats
  IDLE = 2;          // Registriert, aber keine Activity-Events
  ACTIVE = 3;        // Activity-Events fließen
  STALE = 4;         // Heartbeat-Timeout (1x missed)
  DEAD = 5;          // Heartbeat-Timeout (3x missed) → Auto-Remove
}
```

---

#### **Implementation**

##### TypeScript Service: `apps/topology-service/`

**Core Features**:

```typescript
class TopologyService {
  private services = new Map<string, ServiceInfo>() // service_id → ServiceInfo
  private connections = new Map<string, ConnectionInfo>() // "src->tgt" → ConnectionInfo
  private heartbeatStreams = new Map<string, HeartbeatStream>()

  // Heartbeat-Timeout-Checker (runs every 5s)
  private timeoutChecker = setInterval(() => {
    const now = Date.now()
    for (const [id, info] of this.services) {
      const elapsed = now - info.lastHeartbeat
      const timeout = info.heartbeatInterval * info.timeoutMultiplier

      if (elapsed > timeout) {
        console.warn(`Service ${info.serviceName} DEAD (no heartbeat for ${elapsed}ms)`)
        this.removeService(id)
        this.notifyWatchers({ type: 'SERVICE_REMOVED', serviceId: id })
      } else if (elapsed > info.heartbeatInterval * 2) {
        info.state = ConnectionState.STALE
      }
    }
  }, 5000)

  // RPS-Aggregation mit Throttle
  private aggregateActivity() {
    // Aggregiert Activity-Events zu RPS/Latency pro Connection
    // Throttle: Updated nur alle 1-5s (konfigurierbar)
  }
}
```

**Timeout-Policy**:

- `heartbeat_interval = 5s`
- `timeout_multiplier = 3` → Timeout nach 15s
- State STALE nach 10s (2x interval)
- Auto-Remove nach 15s (3x interval)

**Passive Connections**:

- Service sendet Heartbeats → REGISTERED/IDLE
- Service sendet Activity-Events → ACTIVE
- Keine Activity für 30s → IDLE (aber noch alive via Heartbeat!)
- Kein Heartbeat → DEAD → Removed

---

#### **Client-Integration (Multi-Language)**

##### TypeScript

```typescript
import { TopologyClient } from '@modular-runtime/proto/generated/ts/runtime/v1/topology'

class TopologyReporter {
  private client: TopologyClient
  private serviceId: string
  private heartbeatInterval: number
  private heartbeatSeq = 0

  async register(serviceName: string, serviceType: ServiceType) {
    const handle = await this.client.registerService({
      serviceName,
      serviceType,
      language: ServiceLanguage.TYPESCRIPT, // ← Type-safe Enum!
      version: process.env.npm_package_version,
      metadata: {
        environment: 'dev',
        team: 'platform',
      },
    })

    this.serviceId = handle.serviceId
    this.heartbeatInterval = handle.heartbeatIntervalMs

    this.startHeartbeat()
  }

  private startHeartbeat() {
    const stream = this.client.heartbeat()

    setInterval(() => {
      stream.write({
        serviceId: this.serviceId,
        sequence: ++this.heartbeatSeq,
      })
    }, this.heartbeatInterval)

    stream.on('data', (response) => {
      // ACK received
    })
  }

  reportActivity(targetService: string, method: string, latencyMs: number) {
    // Optional: Batch und throttle
    this.client.reportActivity({
      serviceId: this.serviceId,
      targetService,
      type: ActivityType.RESPONSE_RECEIVED,
      timestampMs: Date.now(),
      latencyMs,
      method,
    })
  }
}

// Usage
const topology = new TopologyReporter('127.0.0.1', 50053)
await topology.register('calculator-client', ServiceType.CLIENT)

// Optional: Report activity
topology.reportActivity('calculator-server', 'Add', 12)
```

##### Rust

```rust
use tonic::{Request, Response, Status};
use tokio::time::{interval, Duration};

pub struct TopologyReporter {
    client: TopologyServiceClient<Channel>,
    service_id: String,
    heartbeat_interval: Duration,
}

impl TopologyReporter {
    pub async fn register(addr: &str, service_name: &str) -> Result<Self, Box<dyn std::error::Error>> {
        let mut client = TopologyServiceClient::connect(addr).await?;

        let request = RegisterServiceRequest {
            service_name: service_name.to_string(),
            service_type: ServiceType::Client as i32,
            language: ServiceLanguage::Rust as i32,  // ← Type-safe Enum!
            version: env!("CARGO_PKG_VERSION").to_string(),
            ..Default::default()
        };

        let response = client.register_service(request).await?;
        let handle = response.into_inner();

        let service_id = handle.service_id.clone();
        let heartbeat_interval = Duration::from_millis(handle.heartbeat_interval_ms as u64);

        let mut reporter = Self {
            client,
            service_id: service_id.clone(),
            heartbeat_interval,
        };

        reporter.start_heartbeat().await;

        Ok(reporter)
    }

    async fn start_heartbeat(&mut self) {
        let service_id = self.service_id.clone();
        let mut client = self.client.clone();
        let interval_duration = self.heartbeat_interval;

        tokio::spawn(async move {
            let mut ticker = interval(interval_duration);
            let mut seq = 0u64;

            let outbound = async_stream::stream! {
                loop {
                    ticker.tick().await;
                    seq += 1;
                    yield HeartbeatRequest {
                        service_id: service_id.clone(),
                        sequence: seq as i64,
                        metrics: None,
                    };
                }
            };

            let response = client.heartbeat(Request::new(outbound)).await;
            // Handle stream...
        });
    }
}
```

##### C++ (simplified)

```cpp
class TopologyReporter {
  std::unique_ptr<TopologyService::Stub> stub_;
  std::string service_id_;
  int heartbeat_interval_ms_;

public:
  void Register(const std::string& service_name) {
    RegisterServiceRequest request;
    request.set_service_name(service_name);
    request.set_service_type(ServiceType::CLIENT);
    request.set_language(ServiceLanguage::CPP);  // ← Type-safe Enum!

    ServiceHandle handle;
    ClientContext context;
    stub_->RegisterService(&context, request, &handle);

    service_id_ = handle.service_id();
    heartbeat_interval_ms_ = handle.heartbeat_interval_ms();

    StartHeartbeat();
  }

  void StartHeartbeat() {
    std::thread([this]() {
      ClientContext context;
      auto stream = stub_->Heartbeat(&context);

      int64_t seq = 0;
      while (true) {
        HeartbeatRequest request;
        request.set_service_id(service_id_);
        request.set_sequence(++seq);

        stream->Write(request);

        HeartbeatResponse response;
        stream->Read(&response);

        std::this_thread::sleep_for(std::chrono::milliseconds(heartbeat_interval_ms_));
      }
    }).detach();
  }
};
```

---

#### **UI-Visualisierung** (React Flow)

**Keine Änderungen nötig** – gleiche API wie vorher, nur Backend-Logik anders:

```tsx
export function TopologyView() {
  const { data: topology } = useTopologyStream()

  const nodes = topology.nodes.map((n) => ({
    id: n.serviceName,
    data: {
      label: n.serviceName,
      state: n.state, // REGISTERED, IDLE, ACTIVE, STALE, DEAD
      language: n.language, // 🦀 Rust, 📘 TS, ⚙️ C++
      lastHeartbeat: n.lastHeartbeat,
    },
    style: {
      background: getStateColor(n.state),
      borderColor: n.state === 'STALE' ? '#fbbf24' : undefined,
    },
  }))

  const edges = topology.edges.map((e) => ({
    id: `${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    label: e.state === 'ACTIVE' ? `${e.totalRps.toFixed(0)} RPS` : '',
    animated: e.state === 'ACTIVE',
    style: {
      stroke: e.state === 'IDLE' ? 'dashed' : 'solid',
    },
  }))

  return <ReactFlow nodes={nodes} edges={edges} />
}
```

---

#### **Was zeigt die Demo?**

1. **Service Lifecycle**:
   - Client startet → RegisterService → Node erscheint (REGISTERED)
   - Heartbeats starten → Node bleibt grün
   - Client sendet Requests → Node wird ACTIVE (animiert)
   - Keine Requests für 30s → Node wird IDLE (grau)
   - Kein Heartbeat für 15s → Node wird rot (STALE → DEAD) → verschwindet

2. **Multi-Language**:
   - 3 Clients (🦀 Rust, 📘 TS, ⚙️ C++) registrieren sich
   - Alle senden Heartbeats → 3 Nodes im Graph
   - Nodes zeigen Language-Icon

3. **Chaos Engineering**:
   - "Kill Calculator-Server" → Heartbeats stoppen
   - Nach 15s → Node wird DEAD → verschwindet aus Graph
   - Supervisor startet neu → RegisterService → Node kommt zurück

4. **Passive Connections**:
   - Client connected (sendet Heartbeats) aber idle → gestrichelte Edge
   - Kein Auto-Remove (solange Heartbeats kommen!)

5. **Throttled Updates**:
   - 1000 RPS Load-Test → Activity-Events gebatched
   - TopologyService updated RPS-Counter nur alle 1s
   - Web-View bekommt throttled Updates (keine Überlastung)

---

## 🔀 Varianten-Vergleich: Topology Service

### Variante 1: Heartbeat-basiert ⭐ **EMPFOHLEN**

**Architektur**:

- Services registrieren sich **explizit** beim Start
- Bidirektionale Heartbeat-Streams (alle 5s)
- Optional: Activity-Reporting für RPS/Latency
- Timeout-basierte Cleanup (3x missed = DEAD)

**Pros**:

- ✅ **Multi-Language ohne Einschränkungen** (funktioniert in JEDER Sprache)
- ✅ **Echte Liveness-Detection** (Heartbeat = alive)
- ✅ **Keine Zombie-Services** (Timeout → Auto-Remove)
- ✅ **Explizit und debuggbar** (kein verstecktes Verhalten)
- ✅ **Passive Connections sichtbar** (IDLE State)
- ✅ **Type-Safe** Proto-Definitionen
- ✅ **Throttled Updates** (skalierbar)

**Cons**:

- ⚠️ Zusätzlicher Heartbeat-Traffic (gering: 1 msg/5s pro Service)
- ⚠️ Services müssen Code ändern (explizite Registration)

**Aufwand**: 4-5 Tage (Proto + Service + Client-Libs)

**Code-Beispiel** (TypeScript):

```typescript
const topology = new TopologyReporter({
  topologyAddress: '127.0.0.1:50053',
  serviceName: 'calculator-client',
  serviceType: ServiceType.CLIENT,
  enableActivityReporting: true,
})

await topology.register() // ← Explizit

// Optional: Activity Tracking
topology.reportActivity('calculator-server', 'Add', latencyMs)

await topology.unregister() // Graceful Shutdown
```

---

### Variante 2: Interceptor-basiert ❌ **NICHT EMPFOHLEN**

**Architektur**:

- gRPC-Interceptors in jedem Service
- Automatisches Tracking bei jedem gRPC-Call
- Kein expliziter Code in Services

**Pros**:

- ✅ Transparent (Services müssen nichts ändern)
- ✅ Automatisch bei jedem Call

**Cons**:

- ❌ **Language-Lock-in**: Nicht alle Sprachen unterstützen Interceptors
  - TypeScript: Client-Interceptors OK, Server sehr limitiert
  - Rust: API komplex
  - C++: Keine standardisierten Interceptors
  - Go: Unterschiedliche API
- ❌ **Implizite Magie**: Schwer zu debuggen
- ❌ **Overhead**: Bei JEDEM gRPC-Call zusätzliche Logik
- ❌ **Keine Liveness-Detection**: Erkennt nicht ob Service tot ist
- ❌ **Zombie-Services**: Registrierte Services bleiben im Graph

**Aufwand**: 3-4 Tage (aber nur für TypeScript zuverlässig)

**Code-Beispiel** (TypeScript):

```typescript
const server = new Server({
  interceptors: [
    topologyInterceptor({
      // ← Implizit
      serviceName: 'calculator-server',
      topologyAddress: '127.0.0.1:50053',
    }),
  ],
})
// ← Keine weiteren Änderungen nötig, aber auch keine Kontrolle
```

---

### Variante 3: Hybrid (Optional)

**Architektur**:

- **Heartbeat für Liveness** (Pflicht)
- **Interceptor für Activity** (Optional, nur wo verfügbar)

**Pros**:

- ✅ Beste aus beiden Welten
- ✅ Fallback für Sprachen ohne Interceptor-Support
- ✅ Liveness-Detection gesichert

**Cons**:

- ⚠️ Komplexere Implementierung
- ⚠️ Inkonsistente APIs zwischen Sprachen
- ⚠️ Debugging schwieriger (zwei Mechanismen)

**Aufwand**: +2 Tage zusätzlich zu Variante 1

**Empfehlung**: Nur wenn Interceptor-Transparenz **wirklich wichtig** ist

---

### Entscheidungsmatrix

| Kriterium                  | Heartbeat ⭐ | Interceptor ❌ | Hybrid 🤔 |
| -------------------------- | ------------ | -------------- | --------- |
| Multi-Language-Support     | ✅ Ja        | ⚠️ Limitiert   | ✅ Ja     |
| Liveness-Detection         | ✅ Ja        | ❌ Nein        | ✅ Ja     |
| Zombie-Services verhindern | ✅ Ja        | ❌ Nein        | ✅ Ja     |
| Explizit/Debuggbar         | ✅ Ja        | ❌ Nein        | ⚠️ Mixed  |
| Transparent                | ❌ Nein      | ✅ Ja          | ⚠️ Mixed  |
| Type-Safety                | ✅ Ja        | ⚠️ Teilweise   | ✅ Ja     |
| Aufwand                    | 4-5 Tage     | 3-4 Tage       | 6-7 Tage  |
| Production-Ready           | ✅ Ja        | ⚠️ Risiko      | ✅ Ja     |

---

### Priorisierung & Roadmap

#### **Sprint 1: Heartbeat-Implementierung** (Woche 1)

**P0 - Kritisch**:

1. Proto-Definition (`runtime/v1/topology.proto`)
   - RegisterService, Heartbeat, ReportActivity
   - ServiceHandle, ConnectionState, HealthState Enums
   - ApplicationHealth in HeartbeatRequest (integriert!)
2. Topology Service (TypeScript)
   - Service Registry (Map)
   - Heartbeat-Timeout-Checker (5s Interval)
   - Activity-Aggregation (1s Throttle)
   - Health-State-Tracking (via Heartbeat)
3. TypeScript Client-Library
   - TopologyReporter-Klasse
   - Auto-Heartbeat mit Health-Reporting
   - Activity-Batching

**Deliverables**: Core-Funktionalität für TS-Services

---

#### **Sprint 2: Multi-Language-Support** (Woche 2)

**P1 - Wichtig**: 4. Rust Client-Library

- async_stream für Heartbeat
- tonic-Integration

5. C++ Client-Library
   - Thread-basierter Heartbeat
   - grpc++-Integration
6. Calculator-Integration (alle Sprachen)
   - TS-Client, Rust-Client, C++-Client
   - TS-Server

**Deliverables**: Alle Calculator-Services integriert

---

#### **Sprint 3: Dashboard & Demo** (Woche 3)

**P1 - Wichtig**: 7. Dashboard React Flow Integration

- WatchTopology() Stream
- Node/Edge-Visualisierung
- State-basierte Styling

8. Demo-Szenarien
   - Multi-Client-Szenario
   - Chaos Engineering (Kill Service)
   - Load Testing
9. Documentation
   - Architecture-Doc (✅ bereits erstellt)
   - API-Docs
   - Integration-Guide

**Deliverables**: Vollständige Demo-Umgebung

---

#### **Backlog: Optional/Later**

**P2 - Nice-to-Have**:

- Go Client-Library
- Python Client-Library
- Hybrid Interceptor-Support (falls gewünscht)
- Dedizierter Health Service (falls Topology-Integration nicht ausreicht)
- Metrics (Prometheus Export)

---

### 🎯 Umsetzungsempfehlung

**Start mit Variante 1 (Heartbeat-basiert)**

**Begründung**:

1. ✅ Deckt alle Requirements ab (Multi-Language, Liveness, No-Zombies)
2. ✅ Production-Ready und robust
3. ✅ Explizit und wartbar
4. ✅ Funktioniert in ALLEN Sprachen gleich gut
5. ⚠️ Interceptor-Variante kann SPÄTER als Add-On implementiert werden (backward-compatible)

**Migrationsplan** (falls später Interceptors gewünscht):

- Heartbeat bleibt Basis (Liveness)
- Interceptor als optionales Add-On (Activity-Tracking)
- Services können wählen: Manual-Reporting oder Interceptor

---

### 1.1 Health Service ⭐ **[OPTIONAL - Bereits in Topology integriert!]**

**Status**: **NICHT MEHR NÖTIG** - Health-Tracking via Topology Service Heartbeat!

**Warum optional?**

- Topology Service Heartbeat enthält bereits `ApplicationHealth`
- Liveness via Connection State (REGISTERED, STALE, DEAD)
- Application Health via `HealthState` im Heartbeat
- Vermeidet Redundanz und zusätzliche Komplexität

**Falls doch gewünscht** (für dedizierte Health-Checks ohne Topology):

**Proto**: `packages/proto/runtime/v1/health.proto`

```protobuf
service HealthService {
  rpc ReportHealth(stream HealthStatus) returns (HealthAck);
  rpc CheckHealth(ServiceKey) returns (HealthStatus);
  rpc WatchHealth(Empty) returns (stream HealthEvent);
}

message HealthStatus {
  string service_name = 1;
  HealthState state = 2; // STARTING, HEALTHY, DEGRADED, UNHEALTHY
  string message = 3;
  int64 timestamp = 4;
}

enum HealthState {
  UNKNOWN = 0;
  STARTING = 1;
  HEALTHY = 2;
  DEGRADED = 3;
  UNHEALTHY = 4;
}
```

**Implementation**:

- TypeScript Service: `apps/health-service/`
- Clients: Calculator-Server/Client reportieren Health
- Broker-Integration: Unhealthy Services aus Registry entfernen

**Was zeigt die Demo?**

- Service startet → STARTING
- Service ready → HEALTHY
- Service crashed → UNHEALTHY
- Supervisor restarts → STARTING → HEALTHY

---

### 1.2 Logger Service ⭐⭐⭐⭐⭐

**Zweck**: Zentrale Log-Aggregation mit Struktur

**Demo-Wert**:

- Live-Log-Stream in UI
- Filter nach Service/Level
- Search-Funktion
- Correlation IDs für Request-Tracing

**Proto**: `packages/proto/runtime/v1/logger.proto`

```protobuf
service LoggerService {
  rpc StreamLogs(stream LogEntry) returns (LogAck);
  rpc QueryLogs(LogQuery) returns (stream LogEntry);
  rpc SubscribeLogs(LogFilter) returns (stream LogEntry);
}

message LogEntry {
  string service_name = 1;
  LogLevel level = 2;
  string message = 3;
  int64 timestamp = 4;
  string correlation_id = 5;
}

enum LogLevel {
  TRACE = 0;
  DEBUG = 1;
  INFO = 2;
  WARN = 3;
  ERROR = 4;
  FATAL = 5;
}

message LogQuery {
  repeated string service_names = 1;
  LogLevel min_level = 2;
  int64 start_time = 3;
  int64 end_time = 4;
  string search_text = 5;
}
```

**Implementation**:

- TypeScript Service: `apps/logger-service/`
- In-Memory-Buffer (circular buffer, 10k entries)
- Optional: Persist to SQLite/NDJSON

**Was zeigt die Demo?**

- Services loggen strukturiert statt stdout
- Correlation ID verfolgt Request durch Services
- Filter "nur Errors von calculator-server"
- Live-Logs während Load-Test

---

## Phase 2: Testing & Chaos Tools (Prio 2)

**Ziel**: Robustness & Performance sichtbar machen

### 2.1 Load Generator Service ⭐⭐⭐⭐⭐

**Zweck**: Reproduzierbare Last gegen Services

**Demo-Wert**:

- Live RPS-Graph
- Latency-Distribution (P50/P95/P99)
- Success/Failure-Rate
- Broker-Discovery unter Last testen

**Proto**: `packages/proto/runtime/v1/load.proto`

```protobuf
service LoadGeneratorService {
  rpc StartLoad(LoadConfig) returns (stream LoadMetrics);
  rpc StopLoad(Empty) returns (LoadSummary);
  rpc GetActiveTests(Empty) returns (ActiveLoadTests);
}

message LoadConfig {
  string target_service = 1;      // z.B. "CalculatorService"
  string target_role = 2;          // optional, für Broker-Lookup
  int32 requests_per_second = 3;
  int32 duration_seconds = 4;
  int32 concurrent_clients = 5;
  bytes payload = 6;               // Service-spezifisches Payload
}

message LoadMetrics {
  int64 requests_sent = 1;
  int64 requests_succeeded = 2;
  int64 requests_failed = 3;
  double latency_p50_ms = 4;
  double latency_p95_ms = 5;
  double latency_p99_ms = 6;
  double current_rps = 7;
  int64 timestamp = 8;
}

message LoadSummary {
  int64 total_requests = 1;
  int64 total_succeeded = 2;
  int64 total_failed = 3;
  double avg_latency_ms = 4;
  double min_latency_ms = 5;
  double max_latency_ms = 6;
  map<string, int64> error_counts = 7;
}
```

**Implementation**:

- TypeScript/Go Service: `apps/load-generator/`
- Worker-Pool-Pattern für Concurrency
- Histogram für Latencies (HDR Histogram)

**Was zeigt die Demo?**

- "1000 RPS gegen Calculator-Server"
- Graph zeigt Live-Latency
- Service unter Last → DEGRADED im Health Service
- Broker-Discovery: Multiple Instances Load-Balancing

---

### 2.2 Chaos Injector Service ⭐⭐⭐⭐⭐

**Zweck**: Gezielte Fehler-Injektion für Testing

**Demo-Wert**:

- "Kill Calculator-Server" → Supervisor restart
- "500ms Latency" → Timeout-Handling
- "Random Packet Loss" → Retry-Logic
- CPU-Hog → Degraded Health

**Proto**: `packages/proto/runtime/v1/chaos.proto`

```protobuf
service ChaosService {
  rpc InjectFault(FaultConfig) returns (FaultStatus);
  rpc ListActiveFaults(Empty) returns (FaultList);
  rpc ClearFault(FaultId) returns (ClearFaultResponse);
  rpc ClearAllFaults(Empty) returns (ClearAllFaultsResponse);
}

message FaultConfig {
  string target_service = 1;
  FaultType type = 2;
  int32 duration_seconds = 3;  // 0 = indefinite
  FaultParams params = 4;
}

enum FaultType {
  CRASH = 0;           // Kill process
  DELAY = 1;           // Add latency
  PACKET_LOSS = 2;     // Drop X% of packets
  CPU_HOG = 3;         // Consume CPU
  MEMORY_LEAK = 4;     // Allocate memory
  ERROR_INJECT = 5;    // Return errors
}

message FaultParams {
  int32 delay_ms = 1;          // for DELAY
  float packet_loss_pct = 2;   // for PACKET_LOSS (0-100)
  int32 cpu_threads = 3;       // for CPU_HOG
  int64 memory_mb = 4;         // for MEMORY_LEAK
  float error_rate = 5;        // for ERROR_INJECT (0-1.0)
}

message FaultStatus {
  string fault_id = 1;
  bool active = 2;
  string message = 3;
}
```

**Implementation**:

- TypeScript Service: `apps/chaos-injector/`
- CRASH: `child_process.kill()`
- DELAY: Proxy-Pattern (intercept calls)
- CPU_HOG: Busy-Loop in Worker-Threads

**Was zeigt die Demo?**

- Button: "Crash Calculator-Server"
- Supervisor erkennt Exit
- Restart nach `restartDelay`
- Health Service: UNHEALTHY → STARTING → HEALTHY
- Logs zeigen kompletten Lifecycle

---

## Phase 3: Stateful Services (Prio 3)

**Ziel**: Dynamische Konfiguration & Koordination

### 3.1 Config Service ⭐⭐⭐

**Zweck**: Runtime-Konfiguration ohne Restart

**Proto**: `packages/proto/runtime/v1/config.proto`

```protobuf
service ConfigService {
  rpc GetConfig(ConfigKey) returns (ConfigValue);
  rpc SetConfig(ConfigEntry) returns (ConfigAck);
  rpc WatchConfig(ConfigKey) returns (stream ConfigValue);
  rpc ListConfigs(ConfigNamespace) returns (ConfigList);
}

message ConfigKey {
  string namespace = 1;  // z.B. "calculator-server"
  string key = 2;        // z.B. "max_connections"
}

message ConfigValue {
  string value = 1;
  string value_type = 2;  // "string", "int", "bool", "json"
  int64 version = 3;
}
```

**Was zeigt die Demo?**

- Calculator-Server liest `max_connections` aus Config
- UI: Config-Editor mit Live-Update
- Service reagiert ohne Restart

---

### 3.2 State Manager Service ⭐⭐

**Zweck**: Geteilter State für Koordination

**Proto**: `packages/proto/runtime/v1/state.proto`

```protobuf
service StateService {
  rpc Get(StateKey) returns (StateValue);
  rpc Set(StateEntry) returns (StateAck);
  rpc CompareAndSwap(CASRequest) returns (CASResponse);
  rpc AcquireLock(LockRequest) returns (LockResponse);
  rpc ReleaseLock(LockId) returns (LockAck);
  rpc Watch(StateKey) returns (stream StateValue);
}
```

**Use Cases**:

- Distributed Locks
- Leader Election
- Shared Counters

---

## UI-Konzepte: Zwei verschiedene Anwendungsfälle

### Use Case 1: Supervisor Desktop App (Electron)

**Zweck**: Production-Tool für Entwickler, ersetzt/erweitert den Terminal-Supervisor

**Zielgruppe**: Entwickler die Services lokal entwickeln und debuggen

**Features**:

- Process Management (Start/Stop/Restart Services)
- Detaillierte Logs (stdout/stderr) mit xterm.js
- Service Config Editor (config.yaml bearbeiten)
- File System Integration
- Schnelle Performance (natives gRPC)

**Tech Stack**:

- Electron + React + TypeScript
- xterm.js für Terminal-Output
- Native Node.js APIs (child_process, fs)
- Direktes gRPC (kein Adapter)

**Verwendung**:

- Läuft als Desktop-App auf Entwickler-Maschinen
- Ersetzt `supervisor` CLI-Tool
- Volle Kontrolle über lokale Prozesse

**Priorität**: **Optional** (Terminal-Supervisor funktioniert bereits)

---

### Use Case 2: Monitoring Dashboard (Web)

**Zweck**: Demo/Monitoring-Tool für Präsentationen und Live-Visualisierung

**Zielgruppe**: Demos, Präsentationen, externe Betrachter

**Features**:

- **Live Topology Graph** (React Flow) ← **Killer-Feature**
- Health Status Dashboard
- Load Testing Controls
- Chaos Engineering Buttons
- Log Viewer (read-only)
- Metrics Graphs

**Tech Stack**:

- React + TypeScript + Vite
- React Flow (Topology Graph)
- Recharts (Metrics)
- Tailwind CSS
- Connect (gRPC-Web)

**Verwendung**:

- Läuft im Browser
- URL-teilbar (für Remote-Demos)
- Kein Installation nötig
- Screenshot/Recording-freundlich

**Priorität**: **Hoch** (für Demo-Zwecke essentiell)

---

## Browser & gRPC: Ja, mit Einschränkungen! 🌐

### Problem

Browser unterstützen **kein natives HTTP/2 gRPC** (binary protocol).

### Lösungen

#### 1. **gRPC-Web** (Standard-Approach)

**Wie es funktioniert**:

- Browser spricht gRPC-Web (HTTP/1.1 oder HTTP/2 mit Text-Encoding)
- Envoy Proxy übersetzt gRPC-Web ↔ gRPC
- Services bleiben unverändert (natives gRPC)

**Setup**:

```bash
# Envoy als Proxy vor deine Services
envoy -c envoy-config.yaml
```

**Proto-Generation**:

```bash
protoc --js_out=import_style=commonjs:. \
       --grpc-web_out=import_style=typescript,mode=grpcwebtext:. \
       runtime/v1/*.proto
```

**Client-Code**:

```typescript
import { HealthServiceClient } from './generated/health_grpc_web_pb'

const client = new HealthServiceClient('http://localhost:8080')
client.watchHealth(request, {}, (error, response) => {
  // Handle streaming response
})
```

**Für dein Projekt**:

- Envoy-Config zu `apps/supervisor/` hinzufügen
- Envoy als zusätzlichen Service in `config.yaml`

---

#### 2. **Connect (buf.build)** (Moderner, empfohlen!)

**Vorteile**:

- Kein Proxy nötig!
- Services können HTTP/1.1 + gRPC gleichzeitig sprechen
- TypeScript-Client out-of-the-box

**Setup**:

```bash
pnpm add @connectrpc/connect @connectrpc/connect-web
```

**Proto-Generation**:

```bash
buf generate  # mit buf.gen.yaml
```

**Server-Side** (ändert deine Services):

```typescript
import { createConnectTransport } from '@connectrpc/connect-node'

// Health Service bekommt zusätzlich HTTP/1.1-Handler
app.use(connectMiddleware({ routes }))
```

**Client-Code** (Browser):

```typescript
import { createPromiseClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

const transport = createConnectTransport({
  baseUrl: 'http://localhost:50052',
})

const client = createPromiseClient(HealthService, transport)
const health = await client.checkHealth({ serviceName: 'broker' })
```

**Für dein Projekt**:

- Neue Connect-basierte Services in Phase 1
- Bestehende gRPC-Services behalten (backward-compatible)

---

#### 3. **REST-Gateway** (Fallback)

**Wie es funktioniert**:

- gRPC-Gateway generiert REST-Endpunkte aus Proto
- Browser spricht JSON/REST
- Gateway übersetzt zu gRPC

**Setup**:

```protobuf
// In deinen .proto-Files:
import "google/api/annotations.proto";

rpc CheckHealth(ServiceKey) returns (HealthStatus) {
  option (google.api.http) = {
    get: "/v1/health/{service_name}"
  };
}
```

---

### Empfehlung für dein Projekt

**Für kleine Browser-Demos (Logger, Status)**:

1. **Connect** → Einfachste Integration
2. Services bekommen HTTP/1.1-Handler zusätzlich zu gRPC
3. Browser kann direkt mit Services sprechen

**Für Production-Grade UI**:

1. **Electron App** → Natives gRPC, keine Adapter
2. Supervisor-TSX-Logik wiederverwenden

**Hybrid-Ansatz**:

```yaml
# config.yaml
services:
  - name: broker
    # Natives gRPC für Service-zu-Service
  - name: health-service
    # Connect (gRPC + HTTP/1.1)
  - name: logger-service
    # Connect (gRPC + HTTP/1.1)
  - name: gateway
    # Envoy für Legacy-Services
```

---

## Demo-Features: Was zeigen?

### 1. Service Lifecycle ♻️

- Start → Health: STARTING
- Ready → Health: HEALTHY
- Crash → Supervisor erkennt Exit
- Restart → Health: STARTING → HEALTHY

### 2. Service Discovery 🔍

- Client startet ohne Server-Adresse
- Broker-Lookup: `LookupService("CalculatorService")`
- **Topology Graph**: Edge erscheint Client → Broker
- Server registriert sich → Broker notified Clients
- **Topology Graph**: Edge erscheint Client → Server
- Server crashed → Broker entfernt aus Registry
- **Topology Graph**: Server-Node wird rot, Edges verschwinden

### 3. Live Network Topology 🕸️ **[NEU - Killer-Feature!]**

- **Visual Graph**: Alle Services als Nodes (React Flow)
- **Animated Edges**: Aktive Connections mit RPS-Counter
- **Color-Coded**: Health-Status pro Node (grün/gelb/rot)
- **Real-time Updates**: Neue Connections erscheinen sofort
- **Connection Details**: Click auf Edge → Latency, Request Count, Protocol
- **Discovery Path**: Client → Broker → Server-Lookup sichtbar
- **Multi-Client**: 3 Clients gleichzeitig am Server → 3 Edges sichtbar

### 4. Load Testing 📊

- Start Load-Generator: 1000 RPS
- **Topology Graph**: Dicke Edge Load-Gen → Server mit "1000 RPS"
- Latency-Graph zeigt Live-Werte
- Health Service: HEALTHY → DEGRADED (high latency)
- **Topology Graph**: Server-Node wird gelb
- Stop Load → DEGRADED → HEALTHY
- **Topology Graph**: Edge-Label "1000 RPS" → "0 RPS" → verschwindet

### 5. Chaos Engineering 💥

- Button: "Inject 500ms Latency"
- **Topology Graph**: Edge wird orange (slow connection)
- Latency-Graph zeigt Spike
- Services loggen Timeouts
- Clear Fault → Latency normal
- **Topology Graph**: Edge wieder normal (grün)

- Button: "Kill Calculator-Server"
- **Topology Graph**: Server-Node rot, alle Edges verschwinden
- Supervisor: Restart detected
- **Topology Graph**: Node gelb (STARTING)
- Server ready
- **Topology Graph**: Node grün, Clients reconnecten (Edges kommen zurück)

### 6. Multi-Language 🌍

- Calculator-Server (TypeScript)
- Calculator-Client (Rust, C++, TypeScript)
- **Topology Graph**: 3 Nodes (Rust, C++, TS) alle connected zu Server
- **Node Labels**: Zeigen Language-Icon (🦀 Rust, ⚙️ C++, 📘 TS)
- Logs zeigen: "Rust client called TS server"
- Alle Clients nutzen gleichen Broker

### 7. Log Correlation 🔗

- Request-ID: `req-123`
- Logs:
  - `[calculator-client-rust] req-123 Calling Add(2,3)`
  - `[broker] req-123 Lookup CalculatorService`
  - `[calculator-server] req-123 Add(2,3) = 5`
  - `[calculator-client-rust] req-123 Result: 5`
- UI filtert nach `req-123` → kompletter Request-Flow
- **Topology Graph**: Click auf Edge → zeigt letzten Request mit ID

---

## Monitoring Dashboard (Web) - Detaillierte Spezifikation

**Name**: `modular-runtime-dashboard` (Arbeitstitel)

**Deployment**:

```yaml
# config.yaml
services:
  - name: dashboard
    command: pnpm
    args: ['-C', 'apps/dashboard', 'dev']
    env:
      PORT: '3000'
```

**Tech Stack**:

```json
{
  "framework": "React + TypeScript + Vite",
  "gRPC": "@connectrpc/connect-web (buf.build)",
  "topology-graph": "reactflow",
  "charts": "recharts",
  "styling": "tailwindcss",
  "state": "zustand"
}
```

**Warum Web für Demos**:

- ✅ Browser-basiert (überall lauffähig)
- ✅ URL-teilbar (Remote-Demos möglich)
- ✅ Screenshots/Recordings einfacher
- ✅ Keine Installation nötig
- ✅ Connect (gRPC-Web) funktioniert einwandfrei

**Topology Graph mit React Flow**:

```tsx
import ReactFlow, { Node, Edge, Background, Controls } from 'reactflow'
import 'reactflow/dist/style.css'

export function TopologyGraph() {
  const { data: topology } = useTopologyStream()

  const nodes: Node[] = topology.nodes.map((n) => ({
    id: n.serviceName,
    type: 'custom',
    data: {
      label: n.serviceName,
      health: n.health,
      icon: getLanguageIcon(n.serviceName),
      activeConnections: n.activeConnections,
    },
    position: calculateForceDirectedLayout(n),
    style: {
      background: getHealthColor(n.health),
      borderWidth: 2,
      borderColor: n.activeConnections > 0 ? '#3b82f6' : '#94a3b8',
    },
  }))

  const edges: Edge[] = topology.edges.map((e) => ({
    id: `${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    label: e.totalRps > 0 ? `${e.totalRps.toFixed(0)} RPS` : '',
    animated: e.state === 'ACTIVE',
    style: {
      stroke: getEdgeStateColor(e.state),
      strokeWidth: Math.min(2 + Math.log10(e.totalRps + 1), 8),
    },
    markerEnd: { type: 'arrowclosed' },
  }))

  return (
    <div style={{ width: '100%', height: '600px' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodeClick={(_, node) => showNodeDetails(node)}
        onEdgeClick={(_, edge) => showConnectionDetails(edge)}
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}

function getHealthColor(health: HealthState): string {
  switch (health) {
    case 'HEALTHY':
      return '#10b981' // green
    case 'DEGRADED':
      return '#f59e0b' // yellow
    case 'UNHEALTHY':
      return '#ef4444' // red
    case 'STARTING':
      return '#6366f1' // indigo
    default:
      return '#94a3b8' // gray
  }
}

function getEdgeStateColor(state: ConnectionState): string {
  switch (state) {
    case 'ACTIVE':
      return '#3b82f6' // blue (animated)
    case 'IDLE':
      return '#94a3b8' // gray
    case 'ESTABLISHING':
      return '#6366f1' // indigo
    case 'FAILED':
      return '#ef4444' // red
    default:
      return '#d1d5db'
  }
}
```

**gRPC Streaming (Connect)**:

````tsx
import { createPromiseClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'
import { TopologyService } from './gen/runtime/v1/topology_connect'

const transport = createConnectTransport({
  baseUrl: 'http://localhost:50053',
})

const client = createPromiseClient(TopologyService, transport)

export function useTopologyStream() {
  const [topology, setTopology] = useState<TopologySnapshot>()

  useEffect(() => {
    const stream = client.watchTopology({})

    ;(async () => {
      for await (const update of stream) {
        setTopology((prev) => applyTopologyUpdate(prev, update))
      }
    })()

    return () => stream.cancel()
  }, [])

  return { data: topology }     | Aufwand      | Status              |
| ----- | -------------------------------- | ------------ | ------------------- |
| **1** | **Topology Service** ⭐          | **5-6 Tage** | 🔲 **Höchste Prio** |
| **1** | gRPC Interceptor Package         | 2-3 Tage     | 🔲 Geplant          |
| **1** | Health Service                   | 3-4 Tage     | 🔲 Geplant          |
| **1** | Logger Service                   | 3-4 Tage     | 🔲 Geplant          |
| **1** | Proto Definitions (all)          | 2 Tage       | 🔲 Geplant          |
| **1** | Client-Integration (Calc)        | 2 Tage       | 🔲 Geplant          |
| **2** | Load Generator                   | 4-5 Tage     | 🔲 Geplant          |
| **2** | Chaos Injector                   | 4-5 Tage     | 🔲 Geplant          |
| **3** | Monitoring Dashboard (Web)       | 1-2 Wochen   | 🔲 Geplant          |
| **3** | Topology Graph (React Flow)      | 4-5 Tage     | 🔲 **Critical**     |
| **3** | Connect Integration              | 2-3 Tage     | 🔲 Geplant          |
| **3** | Config Service                   | 3-4 Tage     | 🔲 Optional         |
| **3** | State Manager                    | 5-7 Tage     | 🔲 Optional         |
| **4** | Supervisor Desktop App (Electron)| 1-2 Wochen   | 🔲 Geplant          |
| **1** | Logger Service              | 3-4 Tage     | 🔲 Geplant          |
| **1** | Proto Definitions (all)     | 2 Tage       | 🔲 Geplant          |
| **1** | Client-Integration (Calc)   | 2 Tage       | 🔲 Geplant          |
| **2** | Load Generator              | 4-5 Tage     | 🔲 Geplant          |
| **2** | Chaos Injector              | 4-5 Tage     | 🔲 Geplant          |
| **3** | Web UI (React + Vite)       | 1-2 Wochen   | 🔲 Geplant          |
| **3** | Topology Graph (React Flow) | 4-5 Tage     | 🔲 **Critical**     |
| **3** | Connect Integration         | 2-3 Tage     | 🔲 Geplant          |
| **3** | Config Service              | 3-4 Tage     | 🔲 Optional         |
| **3** | State Manager               | 5-7 Tage     | 🔲 Optional         |

**Gesamt**: 4-5 Wochen für vollständige Demo-Umgebung

**Kritischer Pfad**:

1. Topology Service (Backend für Live-Graph)
2. **Monitoring Dashboard** (Web) + React Flow ← **Killer-Feature für Demos**
4. Load + Chaos (Demo-Szenarien verstärken)

**Optional/Später**:
- Supervisor Desktop App (Electron) für Production-Entwickler-Workflow*Killer-Feature**
4. Load + Chaos (Demo-Szenarien verstärken)

---

### Sprint-Plan

#### **Sprint 1: Topology Foundation** (Week 1)

1. Proto erstellen (`runtime/v1/topology.proto`)
2. Topology Service implementieren (TypeScript)
   - In-Memory Graph (Nodes + Edges)
   - Stream-API für Live-Updates
   - Auto-Cleanup (idle connections nach 30s)
3. Interceptor Package erstellen
   - `packages/interceptors/topology-interceptor.ts`
   - Client + Server Interceptors
   - Auto-Reporting bei jedem gRPC Call

#### **Sprint 2: Integration** (Week 2)

4. Calculator-Services erweitern
   - Interceptor hinzufügen (transparent)
   - Testen: 3 Clients gleichzeitig
5. Broker-Integration
   - Lookup-EventMonitoring Dashboard** (Week 3-4)

7. Dashboard Setup (Vite + React + TypeScript)
   - Projekt: `apps/dashboard/`
   - Dev-Server auf Port 3000
8. Connect Integration (gRPC-Web ohne Proxy)
   - Client-Code generieren mit buf
9. Topology Graph Component (React Flow)
   - Live-Updates via Streaming
   - Node Styling (Health-based colors)
   - Edge Animation (RPS-based thickness)
10. Dashboard Views
    - Topology Page (Hauptfeature)
    - Health Status Panel
    - Live Logs Panel
    - Chaos Controls (Load/Fault Injection
   - Live-Updates via Streaming
   - Node Styling (Health-based colors)
   - Edge Animation (RPS-based thickness)
10. Dashboard (Health, Logs, Chaos Controls)

#### **Sprint 4: Demo-Szenarien** (Week 4-5)

11. Load Generator implementieren
12. Chaos Injector implementieren
13. Demo-Script schreiben
14. Documentation + Screenshots

---

## Technische Entscheidungen

### Browser + gRPC: Connect (buf.build)

**Entscheidung**: `@connectrpc/connect-web` statt gRPC-Web + Envoy

**Begründung**:

- ✅ Kein Proxy nötig (Services sprechen gRPC + HTTP/1.1 gleichzeitig)
- ✅ TypeScript-Client auto-generiert
- ✅ Streaming via Server-Sent Events
- ✅ Rückwärtskompatibel (bestehende gRPC-Clients unverändert)

**Implementation**:

```typescript
// Service-Side (z.B. Topology Service)
import { ConnectRouter } from '@connectrpc/connect'

export default (router: ConnectRouter) => {
  router.rpc(TopologyService, TopologyService.methods.watchTopology, async function* (req) {
    for await (const update of topologyUpdates) {
      yield update
    }
  })
}
````

````typescript
// Browser-Client
import { createPromiseClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

const client = createPromiseClient(
  TopologyServics: Zwei Tools für zwei Zwecke

#### 1. Monitoring Dashboard (Web) - Fokus: Demos & Visualisierung

**Warum Web**:
- Browser-basiert (keine Installation)
- URL-teilbar (Remote-Demos)
- Screenshot/Recording-freundlich
- Focus auf Visualisierung (Topology Graph)

**Tech Stack**:
```json
{
  "framework": "React + TypeScript + Vite",
  "gRPC": "@connectrpc/connect-web",
  "topology-graph": "reactflow",
  "charts": "recharts",
  "styling": "tailwindcss",
  "state": "zustand"
}
````

**Deployment**: Als Service in `config.yaml` (Port 3000)

---

#### 2. Supervisor Desktop App (Electron) - Fokus: Development Workflow

**Warum Electron**:

- Desktop-native (bessere Performance)
- Direkte Node.js-Integration (Supervisor-Logik wiederverwenden)
- File System Access (config.yaml bearbeiten)
- Process Management (Start/Stop/Restart)

**Tech Stack**:

```json
{
  "framework": "Electron + React + TypeScript",
  "terminal": "xterm.js",
  "gRPC": "native @grpc/grpc-js",
  "styling": "tailwindcss"
}
```

**Use Case**: Ersetzt/erweitert Terminal-Supervisor für bessere UX

**Status**: Optional (niedrigere Priorität als Web-Dashboard)

```json
{
  "framework": "React + TypeScript + Vite",
  "gRPC": "@connectrpc/connect-web",
  "topology-graph": "reactflow",
  "charts": "recharts",
  "styling": "tailwindcss",
  "state": "zustand"
}
```
