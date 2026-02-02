# Demo Plan: Runtime Services & UI

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
└─────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┼─────────────────┐
        │                 │                 │
    ┌───▼───┐      ┌──────▼──────┐    ┌────▼────┐
    │Broker │      │Health Service│   │Logger   │
    └───┬───┘      └──────┬──────┘    │Service  │
        │                 │            └────┬────┘
        │                 │                 │
    ┌───▼──────────────────▼─────────────────▼────┐
    │         Application Services                │
    │  (Calculator, Pipeline, Custom Services)    │
    └──────────────────────────────────────────────┘
        ▲                 ▲
        │                 │
  ┌─────┴────┐     ┌──────┴──────┐
  │Load Gen  │     │Chaos Injector│
  └──────────┘     └──────────────┘
```

---

## Phase 1: Foundation Services (Prio 1)

**Ziel**: Basis-Infrastruktur für Observability

### 1.1 Health Service ⭐⭐⭐⭐⭐

**Zweck**: Liveness/Readiness-Checks für alle Services

**Demo-Wert**:

- Status-Dashboard (grün/gelb/rot)
- Service-Status-History-Timeline
- Automatic Unhealthy Service Detection

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
  map<string, string> metadata = 5;
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
  map<string, string> metadata = 6;
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

## UI-Konzept: Electron vs. Web

### Option A: Electron App (empfohlen)

**Pro**:

- Desktop-native
- Direkte Node.js-Integration (Supervisor-Logik wiederverwenden)
- File System Access

**Con**:

- Extra Build-Prozess
- Platform-spezifische Builds

**Tech Stack**:

- Electron + React + TypeScript
- Recharts für Graphs
- xterm.js für Log-Terminal
- Tailwind CSS

---

### Option B: Web-UI (einfacher für Demos)

**Pro**:

- Browser-basiert (überall lauffähig)
- Einfacher zu hosten
- Screenshot/Recording einfacher

**Con**:

- gRPC braucht Adapter (siehe unten)

**Tech Stack**:

- React + TypeScript + Vite
- gRPC-Web oder Connect (buf.build)
- TanStack Query für Data Fetching

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
- Server registriert sich → Broker notified Clients
- Server crashed → Broker entfernt aus Registry

### 3. Load Testing 📊

- Start Load-Generator: 1000 RPS
- Graph zeigt Live-Latency
- Health Service: HEALTHY → DEGRADED (high latency)
- Stop Load → DEGRADED → HEALTHY

### 4. Chaos Engineering 💥

- Button: "Inject 500ms Latency"
- Graph zeigt Latency-Spike
- Services loggen Timeouts
- Clear Fault → Latency normal

### 5. Multi-Language 🌍

- Calculator-Server (TypeScript)
- Calculator-Client (Rust, C++, TypeScript)
- Logs zeigen: "Rust client called TS server"
- Alle Clients nutzen gleichen Broker

### 6. Log Correlation 🔗

- Request-ID: `req-123`
- Logs:
  - `[calculator-client-rust] req-123 Calling Add(2,3)`
  - `[broker] req-123 Lookup CalculatorService`
  - `[calculator-server] req-123 Add(2,3) = 5`
  - `[calculator-client-rust] req-123 Result: 5`
- UI filtert nach `req-123` → kompletter Request-Flow

---

## Roadmap mit Zeitschätzung

| Phase | Service                   | Aufwand    | Status      |
| ----- | ------------------------- | ---------- | ----------- |
| **1** | Health Service            | 3-4 Tage   | 🔲 Geplant  |
| **1** | Logger Service            | 3-4 Tage   | 🔲 Geplant  |
| **1** | Proto Definitions         | 1 Tag      | 🔲 Geplant  |
| **1** | Client-Integration (Calc) | 2 Tage     | 🔲 Geplant  |
| **2** | Load Generator            | 4-5 Tage   | 🔲 Geplant  |
| **2** | Chaos Injector            | 4-5 Tage   | 🔲 Geplant  |
| **3** | UI (Electron/Web)         | 1-2 Wochen | 🔲 Geplant  |
| **3** | Config Service            | 3-4 Tage   | 🔲 Optional |
| **3** | State Manager             | 5-7 Tage   | 🔲 Optional |

**Gesamt**: 3-4 Wochen für vollständige Demo-Umgebung

---

## Nächste Schritte

1. ✅ Proto-Definitionen erstellen (`runtime/v1/health.proto`, `logger.proto`)
2. ✅ Health Service implementieren (TypeScript)
3. ✅ Calculator-Services erweitern (Health Reporting)
4. ✅ Logger Service implementieren
5. ✅ Supervisor-Integration (Health + Logs)
6. ⏸️ Load Generator implementieren
7. ⏸️ Chaos Injector implementieren
8. ⏸️ UI-Entscheidung: Electron vs. Web (Connect)
9. ⏸️ UI-Prototyp mit Live-Graphs

---

## Technische Entscheidungen

### gRPC in Browser

**Entscheidung**: **Connect** (buf.build)

**Begründung**:

- ✅ Kein Proxy (Envoy) nötig
- ✅ Services sprechen gRPC + HTTP/1.1
- ✅ TypeScript-Client automatisch generiert
- ✅ Streaming funktioniert (Server-Sent Events)
- ✅ Rückwärtskompatibel (bestehende gRPC-Clients unverändert)

**Implementierung**:

```typescript
// Health Service Server
import { ConnectRouter } from '@connectrpc/connect'

export default (router: ConnectRouter) => {
  router.rpc(HealthService, HealthService.methods.checkHealth, async (req) => {
    return { state: HealthState.HEALTHY, message: 'OK' }
  })
}
```

```typescript
// Browser Client
import { createPromiseClient } from '@connectrpc/connect'
import { createConnectTransport } from '@connectrpc/connect-web'

const client = createPromiseClient(
  HealthService,
  createConnectTransport({ baseUrl: 'http://localhost:50052' })
)

const status = await client.checkHealth({ serviceName: 'broker' })
console.log(status.state) // HEALTHY
```

---

## Commit Message

```
feat(demo): add runtime services roadmap and architecture plan

- Define Phase 1 (Health + Logger services)
- Define Phase 2 (Load Generator + Chaos Injector)
- Evaluate Browser+gRPC options (Connect recommended)
- Add UI concepts (Electron vs Web-based)
- Document demo features and observability goals
```
