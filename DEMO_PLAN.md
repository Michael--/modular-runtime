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

### 1.0 Topology Service ⭐⭐⭐⭐⭐ **[NEU!]**

**Zweck**: Live-Visualisierung des Service-Netzwerks (wer ruft wen auf?)

**Demo-Wert**:

- 🎨 **Live Network Graph** (React Flow)
- 🔍 Zeigt aktive Connections (nicht nur registrierte Services)
- 📊 RPS/Latency pro Connection
- 💥 Chaos-Tests sichtbar: Connection bricht → Graph updated
- 🌍 Multi-Language: Rust-Client → TS-Server sichtbar

**Problem das es löst**:

- Broker kennt nur Service-Registrations
- Niemand weiß welche Services **gerade tatsächlich** verbunden sind
- Debugging: "Warum kommt mein Request nicht an?"

**Proto**: `packages/proto/runtime/v1/topology.proto`

```protobuf
service TopologyService {
  rpc ReportConnection(stream ConnectionEvent) returns (ConnectionAck);
  rpc GetTopology(TopologyQuery) returns (TopologySnapshot);
  rpc WatchTopology(TopologyQuery) returns (stream TopologyUpdate);
}

message ConnectionEvent {
  string source_service = 1;       // "calculator-client-rust"
  string target_service = 2;       // "calculator-server"
  ConnectionState state = 3;       // ESTABLISHED, ACTIVE, CLOSED
  int64 timestamp = 4;
  ConnectionMetadata metadata = 5;
}

message TopologySnapshot {
  repeated ServiceNode nodes = 1;  // Services
  repeated ServiceEdge edges = 2;  // Connections
  int64 timestamp = 3;
}

message ServiceNode {
  string service_name = 1;
  string address = 2;
  HealthState health = 3;          // Integration mit Health Service
  int32 active_connections = 4;
}

message ServiceEdge {
  string source = 1;
  string target = 2;
  int32 connection_count = 3;
  double total_rps = 4;            // Requests per second
  ConnectionState state = 5;
}
```

**Implementation**:

- TypeScript Service: `apps/topology-service/`
- In-Memory Graph (Nodes + Edges)
- Auto-Cleanup: Idle connections nach 30s entfernen
- **gRPC Interceptor Package**: `packages/interceptors/topology-interceptor.ts`

**Interceptor-Usage** (transparentes Tracking):

```typescript
// In calculator-server/client
import { topologyInterceptor } from '@modular-runtime/interceptors'

const server = new Server({
  interceptors: [
    topologyInterceptor({
      serviceName: 'calculator-server',
      topologyAddress: '127.0.0.1:50053',
    }),
  ],
})

// ← Services müssen nichts manuell tracken!
// Interceptor meldet automatisch bei jedem gRPC Call
```

**Broker-Integration**:

```typescript
// Broker meldet Lookups an Topology Service
async lookupService(request) {
  const service = this.registry.find(request.interfaceName);

  // Report: Client → Broker → Server (Discovery-Pfad)
  await topologyClient.reportConnection({
    source: request.callerService,
    target: 'broker',
    state: ACTIVE,
    metadata: { method: 'LookupService' }
  });

  return service;
}
```

**UI-Visualisierung** (React Flow):

```tsx
import ReactFlow from 'reactflow'

export function TopologyView() {
  const [topology, setTopology] = useState<TopologySnapshot>()

  useEffect(() => {
    const stream = topologyClient.watchTopology({})
    for await (const update of stream) {
      if (update.type === 'EDGE_ADDED') {
        // Neue Connection → animierte Edge hinzufügen
      }
      if (update.type === 'NODE_REMOVED') {
        // Service crashed → Node rot färben
      }
    }
  }, [])

  const nodes = topology.nodes.map((n) => ({
    id: n.serviceName,
    data: {
      label: n.serviceName,
      health: n.health, // Farbe: grün/gelb/rot
      connections: n.activeConnections,
    },
    position: calculateLayout(n), // Force-directed layout
  }))

  const edges = topology.edges.map((e) => ({
    id: `${e.source}-${e.target}`,
    source: e.source,
    target: e.target,
    label: `${e.totalRps.toFixed(0)} RPS`,
    animated: e.state === 'ACTIVE', // Animiert bei Traffic
    style: { stroke: getEdgeColor(e.state) },
  }))

  return <ReactFlow nodes={nodes} edges={edges} />
}
```

**Was zeigt die Demo?**

1. **Service Discovery sichtbar**:
   - Client startet → Node erscheint
   - Client: `LookupService("Calculator")` → Edge: Client → Broker
   - Broker antwortet → Edge: Client → Calculator-Server

2. **Multi-Client-Szenarien**:
   - 3 Clients (TS, Rust, C++) → alle verbunden mit Server
   - Graph zeigt 3 Edges zum Server

3. **Load Testing**:
   - Load-Generator startet → Edge mit "3000 RPS" Label
   - RPS-Counter updated live

4. **Chaos Engineering**:
   - "Kill Calculator-Server" → Node wird rot
   - Alle Edges zum Server verschwinden (CLOSED)
   - Supervisor startet neu → Node wird gelb (STARTING)
   - Clients reconnecten → Edges kommen zurück

5. **Idle Connections**:
   - Client connected aber sendet nichts → gestrichelte Edge
   - Nach 30s → Edge verschwindet (Cleanup)

---

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
