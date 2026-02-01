# Demo Plan: Monolith vs. Split-Architektur

**Ziel:** Zeigen, dass IPC kein Bottleneck ist und Split-Architekturen Vorteile bei Komplexität, Robustheit und Polyglot-Fähigkeit bieten.

## Use Case: NDJSON Event Pipeline

Viele Events verarbeiten → Parse → Regeln → Aggregation → Output

**Warum dieser Use Case:**

- Realistische "viele Daten" Situation
- Streaming-friendly
- Interne Kommunikation ist dominant (wie in Monolithen)
- IPC-Overhead ist messbar aber nicht dominant
- Recovery/Restart-Szenarien sind überzeugend

---

## Architektur-Vergleich

### Monolith (C++ mit std::thread)

```
Main Thread (Orchestrator)
  ├─ Reader Thread (NDJSON laden, std::ifstream)
  ├─ Parser Threads (parse + validate, rapidjson/simdjson)
  ├─ Rules Thread (filter/enrich, custom logic)
  ├─ Aggregator Thread (counts/windows, std::unordered_map)
  └─ Writer Thread (output, std::ofstream)

Kommunikation: std::queue + std::mutex, std::condition_variable
Problem: Locks überall, komplexe Synchronisation, shared state, manuelle Memory-Management

**Warum C++?**
- Repräsentiert typischen Legacy-Monolith ("C++ ist nötig")
- Performance-Baseline: beste mögliche Single-Process Performance
- Zeigt reale Komplexität: Locks, RAII, Thread-Safety, Memory-Leaks
- Macht Vergleich überzeugend: "Selbst gegen C++ ist Split kompetitiv"
```

### Split (Services + Broker)

```
Broker
  ├─ ingest-service (TypeScript) - liest NDJSON, chunked streaming, Node.js streams
  ├─ parse-service (Rust) - parse + validate, serde_json, maximale Performance
  ├─ rules-service (Python) - filter/enrich, dynamische Regeln, schnelle Iteration
  ├─ aggregate-service (Go) - counts/windows, goroutines, efficient concurrency
  └─ sink-service (TypeScript) - write results, metrics reporting

Kommunikation: gRPC/Protobuf
Vorteile: Prozessgrenzen, klare Contracts, polyglot (4 Sprachen!), restartable

Polyglot-Strategie:
- TypeScript: Orchestrierung, I/O-heavy, schnelle Entwicklung
- Rust: CPU-intensive parsing, memory safety, C++-Alternative
- Python: Flexible Businesslogik, schnelle Iteration, große Libs
- Go: Concurrency-heavy aggregation, deployment-friendly
```

---

## Implementierungsplan

### Phase 1: Foundation (Proto + Shared Types)

**1.1 Proto Definitions**

```protobuf
// packages/proto/pipeline/v1/pipeline.proto

service Ingest {
  rpc StreamEvents(StreamEventsRequest) returns (stream Event);
  rpc GetStatus(GetStatusRequest) returns (IngestStatus);
}

service Parse {
  rpc ParseEvents(stream Event) returns (stream ParsedEvent);
}

service Rules {
  rpc ApplyRules(stream ParsedEvent) returns (stream EnrichedEvent);
}

service Aggregate {
  rpc Aggregate(stream EnrichedEvent) returns (stream AggregateResult);
}

message Event {
  string raw_json = 1;
  int64 sequence = 2;
}

message ParsedEvent {
  string type = 1;
  string user = 2;
  int64 value = 3;
  int64 timestamp = 4;
  int64 sequence = 5;
}

message EnrichedEvent {
  ParsedEvent event = 1;
  map<string, string> metadata = 2;
  bool passed_rules = 3;
}

message AggregateResult {
  string key = 1;
  int64 count = 2;
  int64 sum = 3;
  double avg = 4;
}
```

**1.2 Shared Package**

```typescript
// packages/pipeline-common/src/types.ts

export interface EventRecord {
  ts: string
  type: 'click' | 'view' | 'purchase'
  user: string
  value: number
  metadata?: Record<string, unknown>
}

export interface PipelineMetrics {
  processedEvents: number
  invalidEvents: number
  throughputPerSec: number
  latencyP50Ms: number
  latencyP95Ms: number
  latencyP99Ms: number
  cpuPercent: number
  memoryMB: number
}

export interface PipelineConfig {
  mode: 'monolith' | 'split'
  inputFile: string
  outputFile: string
  batchSize: number
  workerCount?: number // monolith only
}
```

**1.3 Contract Semantics (übergreifend)**

- Ordering: garantiert pro `sequence`/`key` oder nur best-effort?
- Delivery: at-least-once vs exactly-once (und was ist im Demo-Context akzeptabel)
- Idempotenz/Dedup: wie werden Retries gehandhabt, welche IDs sind stabil
- Ack/Retry Regeln: max retries, backoff, retry budget

**1.4 Schema Evolution**

- Proto-Versionierung (v1/v2) + Kompatibilitätsregeln
- CI-Check für breaking changes (Protos)
- Beispiel für additive Änderungen + Deprecation-Policy

---

### Phase 2: Test Data Generator

**2.1 Generator Tool**

```typescript
// apps/event-generator/src/generator.ts

export interface GeneratorConfig {
  eventCount: number
  outputFile: string
  userCount: number
  eventTypes: string[]
  seed?: number
}

// Generiert z.B. 5M, 10M, 50M Events
// Reproduzierbar mit seed
// Verschiedene Verteilungen (uniform, zipf, burst)
```

**Beispiel Output:**

```json
{"ts":"2026-01-30T10:00:00Z","type":"click","user":"u1234","value":42}
{"ts":"2026-01-30T10:00:01Z","type":"view","user":"u5678","value":1}
...
```

---

### Phase 3: Monolith Implementation (C++)

**3.1 Structure**

```
apps/event-pipeline-monolith/
  CMakeLists.txt
  src/
    main.cpp              # CLI entry, orchestration
    threads/
      reader.cpp/.hpp     # Read NDJSON file (std::ifstream)
      parser.cpp/.hpp     # Parse + validate (rapidjson/simdjson)
      rules.cpp/.hpp      # Filter/enrich
      aggregator.cpp/.hpp # Count/sum/avg (std::unordered_map + mutex)
      writer.cpp/.hpp     # Output results
    coordinator.cpp/.hpp  # Thread management + queues
    metrics.cpp/.hpp      # Collect metrics (atomics)
    queue.hpp             # Thread-safe queue (std::queue + mutex/cv)
```

**3.2 Thread Communication**

- `std::queue<T>` + `std::mutex` + `std::condition_variable` für Event-Passing
- `std::atomic` für Metrics (lock-free counters)
- Backpressure via queue size limits + cv.wait()
- RAII guards (`std::lock_guard`, `std::unique_lock`) überall

**3.3 Key Implementation Points**

- Locks für shared state (aggregation maps): `std::shared_mutex` (reader/writer lock)
- Komplexe Shutdown-Logik: `std::atomic<bool> shutdown_flag`, join() alle threads
- Error handling: try/catch + error queues, keine exceptions über Thread-Grenzen
- Memory management: smart pointers (`std::unique_ptr`, `std::shared_ptr`), aber auch manuelle Cleanup-Logik
- **Typische C++ Probleme zeigen:** Race conditions, Deadlocks, Memory leaks (falls vorhanden), komplexe Debugging

**3.4 Build & Dependencies**

- CMake + vcpkg/conan für Dependencies (rapidjson, CLI11, fmt)
- Compiler: clang++ oder g++ mit C++17/20
- Sanitizers: -fsanitize=thread für Tests (zeigt Race conditions)
- Profiling: perf, Instruments (zeigt Lock-Contention)

---

### Phase 4: Split Implementation

**4.1 Services**

**apps/ingest-service/** (TypeScript)

- Liest NDJSON file, streamt in Chunks
- Implementiert `Ingest` gRPC service
- Rate limiting / backpressure
- Health checks

**apps/parse-service/** (Rust)

- Empfängt Event stream
- Parse JSON → structured data (serde_json)
- Validierung (type-safe)
- Schnell + memory-efficient
- **Sprach-Rationale:** Rust zeigt maximale Performance bei JSON-Parsing (serde), memory safety ohne GC, und ist ein starkes Gegenargument zu "nur C++ ist schnell"

**apps/rules-service/** (Python)

- Empfängt ParsedEvent stream
- Wendet Regeln an (z.B. filter by type, enrich with geo data)
- Dynamische Regel-Engine (eval/AST oder rule DSL)
- Demonstriert: "Businesslogik muss nicht C++"
- **Sprach-Rationale:** Python zeigt Flexibilität + schnelle Iteration bei Regeln/Heuristiken, große Lib-Ecosystem (pandas, numpy falls benötigt), und dass Performance-kritische Teile isoliert sein können

**apps/aggregate-service/** (Go)

- Empfängt EnrichedEvent stream
- Aggregiert (count by type/user, sum, avg)
- Windowing (z.B. pro 1M events)
- Schreibt Zwischenergebnisse
- **Sprach-Rationale:** Go zeigt exzellente Concurrency (goroutines für parallele aggregation), niedrigen Memory-Footprint, schnelles Compile+Deploy, und ist ein guter Mittelweg zwischen TS und Rust

**apps/sink-service/** (TypeScript)

- Empfängt AggregateResult stream
- Schreibt finale Outputs
- Metrics reporting

**4.2 Orchestration**

- Supervisor startet alle Services
- Broker verbindet Services (klar definieren: gRPC-Pipeline vs Message-Broker)
- Health monitoring per service
- Restart policy

**4.3 Flow Control & Delivery**

- Backpressure-Regeln (queue limits, max in-flight)
- Drop/Slow-Policy bei Overload
- Fairness: gleiche Batch-Size und windowing wie im Monolith

---

### Phase 5: Metrics & Benchmarking

**5.1 Metrics Collector**

```typescript
// packages/pipeline-metrics/src/collector.ts

export class MetricsCollector {
  // Latenz pro Event/Batch (histogram)
  recordLatency(durationMs: number): void

  // Throughput tracking
  recordProcessed(count: number): void

  // Resource usage (via process.cpuUsage(), process.memoryUsage())
  recordResources(): void

  // Export
  getSnapshot(): PipelineMetrics
  exportPrometheus(): string
}
```

**5.2 Benchmark Harness**

```typescript
// apps/benchmark/src/runner.ts

export interface BenchmarkResult {
  mode: 'monolith' | 'split'
  config: PipelineConfig
  duration: BenchmarkDuration
  metrics: PipelineMetrics
  stability: StabilityMetrics
}

export interface StabilityMetrics {
  restartCount: number
  failureRecoveryTimeMs: number
  dataLoss: number
}

// Läuft beide Modi mit gleichen Inputs
// Vergleicht side-by-side
// Generiert Report (Markdown + JSON)
```

**5.3 Messungen**

- **p50/p95/p99 Latenz** pro Event oder Batch
- **Durchsatz** (events/sec, MB/sec)
- **CPU-Auslastung** (gesamt + per process/worker)
- **Memory** (RSS peak, heap)
- **Recovery time**: kill random service → Zeit bis wieder grün

**5.4 Methodik**

- Warmup-Phase + mehrere Läufe (median + Varianz)
- CPU-Pinning / gleiches Load-Profil
- I/O-Cache-Reset oder definierter Zustand
- Identische Configs (batch size, workers/services)

**5.5 Timing & Tracing**

- Monotonic clock für Latenz
- E2E-Latenzdefinition (ingest → sink)
- Trace-ID pro Event für Debug/Replay

---

### Phase 6: Recovery/Restart Demos

**6.1 Chaos Testing**

```typescript
// apps/chaos-monkey/src/chaos.ts

export class ChaosMonkey {
  // Kill random service
  async killRandomService(): Promise<void>

  // Introduce latency
  async addNetworkLatency(ms: number): Promise<void>

  // Stress CPU
  async stressCPU(percent: number): Promise<void>
}
```

**6.2 Demo-Szenarien**

1. **Service Crash:** Parse-Service stirbt → Broker queued events → parse restarts → continues
2. **Network Blip:** Temporäre Latenz → backpressure → recovery
3. **Resource Exhaustion:** Aggregate-Service OOM → restart → catch up from checkpoint
4. **Rolling Update:** Parse-Service neue Version → alte requests laufen aus → neue übernehmen

**6.3 Checkpointing & Replay**

- Checkpoints für Aggregation (interne State-Snapshots)
- Replay-Strategie (offsets/sequence + dedup)
- Datenverlust-Definition (0? maximal toleriert?)

**Monolith Vergleich:**

- Worker Thread crash → oft ganzer Prozess stirbt
- Keine automatische Recovery
- State geht verloren

---

### Phase 7: UI/Visualisierung

**7.1 Supervisor UI Extension**

```
apps/supervisor/src/components/
  PipelineView.tsx       # Overview
  ServiceHealth.tsx      # Health cards pro service
  MetricsChart.tsx       # Real-time throughput/latency
  EventFlow.tsx          # Pipeline flow diagram
  ComparisonView.tsx     # Side-by-side monolith vs split
```

**7.2 Features**

- Real-time metrics (WebSocket)
- Start/Stop services individual
- Chaos actions (kill service button)
- Logs streaming
- Comparison charts (latency, throughput)

---

### Phase 8: Dokumentation

**8.1 README**

- Projekt-Übersicht
- Quick Start (beide Modi)
- Architektur-Diagramme
- Benchmark-Ergebnisse

**8.2 Comparison Report**

```markdown
## Benchmark Results

### Test Setup

- Input: 10M NDJSON events (1.2 GB)
- Machine: MacBook Pro M2, 16GB RAM
- Config: 4 workers/services

### Latency

|       | p50   | p95   | p99   |
| ----- | ----- | ----- | ----- |
| Mono  | 0.8ms | 2.1ms | 5.3ms |
| Split | 1.2ms | 2.8ms | 6.1ms |

**Interpretation:** Split ist 40% langsamer bei p50, aber immer noch < 2ms → für 99% Use Cases irrelevant

### Throughput

- Monolith: 420k events/sec
- Split: 380k events/sec

**Interpretation:** 10% weniger Durchsatz, aber...

### Stability/Recovery

|                    | Monolith | Split   |
| ------------------ | -------- | ------- |
| Service crash      | 💥 total | ✅ 1.2s |
| Worker crash       | 💥 total | n/a     |
| Recovery time      | manual   | auto    |
| Data loss on crash | ~50k     | 0       |

**Interpretation:** Split ist massiv robuster

### Complexity (LoC, Modules)

- Monolith: 850 LoC, 1 package, komplexe Locks
- Split: 1200 LoC, 5 services, simple contracts

**Interpretation:** 40% mehr Code, aber jeder Service ist simpler
```

**8.3 Argument Guide**

```markdown
## Argumente für Architekten

### "IPC ist doch langsam!"

→ Zeige Latenz-Zahlen: < 2ms für 95% der Fälle
→ Zeige dass Parsing/Aggregation dominiert, nicht IPC
→ Control plane vs data plane: große Daten können per file/fd gehen

### "C++ muss bleiben!"

→ Zeige Monolith IN C++ vs Split mit Rust/Go/Python/TS
→ Rust Parse-Service ist schneller/sicherer als C++ (serde vs rapidjson)
→ Go Aggregate ist einfacher als C++ std::thread Chaos
→ Python Rules ist produktiver als C++ für Businesslogik
→ C++ kann für echte Hot Paths bleiben (SIMD, Echtzeit), aber nicht für alles
→ **Kern-Argument:** C++ Monolith verliert gegen moderne Split-Architektur in Robustheit, Wartbarkeit, Produktivität - und ist kaum schneller

### "Threads sind einfacher!"

→ Zeige Lock-Komplexität im Monolith
→ Zeige Debuggability im Split (logs per service)
→ Zeige Recovery-Demo (kill service → auto restart)

### "Zu viele Sprachen!"

→ Zeige dass jede Sprache Vorteile hat (Go fast, Python flexibel, TS produktiv)
→ Zeige dass Contracts (Proto) Typsicherheit geben
→ Zeige dass Teams parallel arbeiten können
```

---

### Phase 9: Testing & Validation

**9.1 Testplan**

- Unit-Tests für Parser/Rules/Aggregation
- Integration-Tests für Pipeline-Ende-zu-Ende
- Golden Outputs + Checksums
- Property-based Tests für Parser (optional)

---

## Repo Structure (neu)

```
apps/
  event-generator/           # NDJSON generator
  event-pipeline-monolith/   # Worker threads variant
  ingest-service/            # Split: read + stream
  parse-service/             # Split: parse (Go/Rust)
  rules-service/             # Split: filter/enrich
  aggregate-service/         # Split: aggregation
  sink-service/              # Split: output
  benchmark/                 # Benchmark runner
  chaos-monkey/              # Chaos testing
  supervisor/                # (erweitert) UI

packages/
  pipeline-common/           # Shared types
  pipeline-metrics/          # Metrics collector
  proto/
    pipeline/
      v1/
        pipeline.proto       # Pipeline services

examples/
  demo-scenarios/            # Recovery demos + scripts
```

---

## Implementation Order

### Sprint 1: Foundation (1-2 Tage)

1. [x] Proto definitions
2. [x] Shared types package
3. [x] Event generator (basic)

### Sprint 2: Monolith (2-3 Tage)

4. [x] Monolith implementation
5. [x] Basic metrics
6. [x] CLI + config

### Sprint 3: Split Services (3-4 Tage)

7. [x] Ingest service (TypeScript)
8. [x] Parse service (Rust + TypeScript fallback)
9. [x] Rules + aggregate + sink (Python + Go + TypeScript fallback)
10. [x] Integration mit Broker (pipeline wiring complete, orchestrator created)

### Sprint 4: Benchmarking (2 Tage)

11. [x] Metrics collector
12. [x] Benchmark harness
13. [x] First results

### Sprint 5: Batching Optimization (1-2 Tage, optional)

Details in section "Sprint 5: Batching Optimization" below.

### Sprint 6: UI + Demos (2-3 Tage)

14. Supervisor UI extension
15. Chaos testing
16. Recovery demos

### Sprint 7: Documentation (1-2 Tage)

17. README + comparison report
18. Argument guide
19. Diagrams

### Sprint 8: Testing & Validation (1-2 Tage)

20. Unit + integration tests
21. Golden outputs + checksums

### Sprint 9: Compute-Heavy Workloads (Optional Extension)

Details in section "Sprint 9: Compute-Heavy Workloads (Optional Extension)" below.

---

## Success Metrics

✅ **Technisch:**

- Beide Modi laufen mit gleichem Input
- Outputs sind identisch (checksum)
- Messungen sind reproduzierbar
- Recovery-Demo funktioniert zuverlässig

✅ **Kommunikation:**

- Latenz-Unterschied ist < 2x
- Durchsatz-Unterschied ist < 20%
- Recovery-Zeit ist < 5s
- Architekt versteht: IPC ist nicht das Problem

✅ **Codebase:**

- Proto breaking change check funktioniert
- Linting + typecheck clean
- Tests vorhanden (basic)
- Dokumentation vollständig

---

## Optional: Erweiterungen

- **Data Plane Optimization:** Zeige shared memory für sehr große Payloads
- **Distributed:** Zeige dass Services auf verschiedenen Maschinen laufen können
- **Language Comparison Benchmark:** Parse-Service in allen 3 Sprachen (TS vs Go vs Rust) implementieren und vergleichen → zeigt dass man optimal wählen kann
- **C++ Service Integration:** Zeige einen hypothetischen C++ Service für SIMD-Operationen (z.B. fast checksum/hash) → zeigt dass C++ seinen Platz behält
- **Real-world Input:** Log files von echten Systemen
- **Grafana/Prometheus:** Richtige Observability stack

---

## Polyglot-Strategie (Zusammenfassung)

### Sprach-Matrix

| Service      | Sprache    | Warum                                         | Zeigt                               |
| ------------ | ---------- | --------------------------------------------- | ----------------------------------- |
| **Monolith** | **C++**    | **Legacy-Realität, max Performance, Threads** | **"C++ ist nötig" entkräften**      |
| Ingest       | TypeScript | I/O-Streams, Node ecosystem, schnell          | Orchestrierung muss nicht C++       |
| Parse        | Rust       | CPU-intensive, serde_json, memory-safe        | C++-Alternative, schneller/sicherer |
| Rules        | Python     | Flexible Logik, große Libs, iteration         | Businesslogik Produktivität         |
| Aggregate    | Go         | Concurrency (goroutines), low footprint       | Moderne System-Sprache              |
| Sink         | TypeScript | I/O, Metrics, UI-Integration                  | Consistency mit Ingest              |
| Generator    | TypeScript | CLI-Tool, reproduzierbar                      | Tooling-Produktivität               |
| Benchmark    | TypeScript | Orchestrierung, Report-Gen                    | Cross-language Orchestrierung       |

### Key Messages

1. **C++ Monolith als Baseline** → "Beste" Single-Process Performance, aber komplex/fragil
2. **Split ist kompetitiv trotz IPC** → Latenz-Overhead < 2x, aber massiv robuster
3. **Rust statt C++** → Memory safety + Performance ohne C++ Komplexität, oft schneller als C++ in Praxis
4. **Python für Logik** → Nicht alles braucht maximale Speed, Produktivität > Mikrooptimierung
5. **Go für Concurrency** → Goroutines vs std::thread - einfacher, sicherer, weniger Boilerplate
6. **TypeScript als Glue** → Produktiv, type-safe, großes Ecosystem - Orchestrierung muss nicht C++ sein
7. **Polyglot ist kein Chaos** → Proto/gRPC gibt uns Contracts, CI prüft, Services sind fokussiert

### Gegen-Argumente entkräften

**"Zu viele Sprachen = Chaos"**
→ Proto gibt uns Contracts, CI prüft Kompatibilität, jeder Service ist klein + fokussiert

**"Wir haben keine Rust/Go Entwickler"**
→ Services sind klein (200-400 LoC), gut dokumentiert, onboarding-friendly  
→ Alternative: alle TS/Go, aber dann fehlt das "C++-Alternative" Argument

**"Build-System wird komplex"**
→ Monorepo mit pnpm, cargo, go mod läuft parallel, ist in CI bereits etabliert

**"Debugging wird schwer"**
→ Distributed Tracing (Trace-IDs), strukturierte Logs, bessere Isolation als Monolith  
→ C++ Monolith debugging ist auch schwer: Race conditions, Deadlocks, Memory corruption

**"C++ ist am schnellsten"**
→ Zeige: Rust Parse ist schneller/sicherer als C++ rapidjson  
→ Go Concurrency ist einfacher als C++ std::thread ohne Performance-Verlust  
→ C++ Overhead durch Locks/Contention kann höher sein als IPC-Overhead

---

## Sprint 5: Batching Optimization

**Status:** In Progress  
**Goal:** Reduce IPC overhead from 85-94% to <30% through batching

### Motivation

Current metrics show high IPC overhead:

- **Ingest:** 89% IPC Send (one-at-a-time streaming)
- **Parse:** 94% IPC Recv (waiting for individual events)
- **Aggregate:** 99% IPC Recv (waiting)

**Root cause:** Streaming one event at a time → 100k round trips for 100k events

**Solution:** Batch events to reduce round trips → 1k batches of 100 events = 1k round trips

### Expected Impact

With batch_size=100:

- **Round trips:** 100,000 → 1,000 (100x reduction)
- **IPC overhead:** 85-94% → 25-30% (3x reduction)
- **Throughput:** 30k events/sec → 70-100k events/sec (2-3x improvement)
- **Latency:** Bounded by batch timeout (e.g., 10ms max)

### Implementation Plan

#### 5.1 Proto Changes

```protobuf
// packages/proto/pipeline/v1/pipeline.proto

// Add batch wrapper
message EventBatch {
  repeated RawData events = 1;
  int32 batch_size = 2;
}

message ParsedEventBatch {
  repeated ParsedEvent events = 1;
}

message EnrichedEventBatch {
  repeated EnrichedEvent events = 1;
}

// Update services to use batches
service Parse {
  rpc ParseEvents(stream EventBatch) returns (stream ParsedEventBatch);
}

service Rules {
  rpc ApplyRules(stream ParsedEventBatch) returns (stream EnrichedEventBatch);
}

service Aggregate {
  rpc Aggregate(stream EnrichedEventBatch) returns (stream AggregateResult);
}
```

#### 5.2 Ingest Service (TypeScript)

```typescript
// apps/ingest-service/src/ingest-service.ts

async function* batchEvents(
  events: AsyncIterable<RawData>,
  batchSize: number,
  maxWaitMs: number = 10
): AsyncGenerator<EventBatch> {
  let batch: RawData[] = []
  let batchStart = Date.now()

  for await (const event of events) {
    batch.push(event)

    // Flush if batch full or timeout
    const shouldFlush = batch.length >= batchSize || Date.now() - batchStart > maxWaitMs

    if (shouldFlush) {
      yield { events: batch, batch_size: batch.length }
      batch = []
      batchStart = Date.now()
    }
  }

  // Flush remaining
  if (batch.length > 0) {
    yield { events: batch, batch_size: batch.length }
  }
}

// In StreamEvents RPC
for await (const batch of batchEvents(readEvents(file), 100)) {
  yield batch
}
```

#### 5.3 Parse Service (Rust)

```rust
// apps/parse-service-rust/src/main.rs

async fn parse_events(
    &self,
    request: Request<tonic::Streaming<EventBatch>>,
) -> Result<Response<Self::ParseEventsStream>, Status> {
    let mut stream = request.into_inner();

    let output = async_stream::stream! {
        while let Some(batch) = stream.next().await {
            let batch = batch?;
            let process_start = Instant::now();

            // Process all events in batch
            let parsed: Vec<ParsedEvent> = batch.events
                .par_iter() // Parallel processing with rayon
                .filter_map(|raw| parse_event(&raw.event))
                .collect();

            metrics.record_processing(process_start.elapsed());

            yield Ok(ParsedEventBatch { events: parsed });
        }
    };

    Ok(Response::new(Box::pin(output)))
}
```

#### 5.4 Rules Service (Python)

```python
# apps/rules-service-python/src/rules_service.py

def ApplyRules(self, request_iterator, context):
    for batch in request_iterator:
        process_start = time.perf_counter()

        # Process batch
        enriched = []
        for event in batch.events:
            if event.type == "view":
                continue  # Filter
            enriched.append(enrich_event(event))

        self.metrics.record_processing((time.perf_counter() - process_start) * 1000)

        yield EnrichedEventBatch(events=enriched)
```

#### 5.5 Aggregate Service (Go)

```go
// apps/aggregate-service-go/main.go

func (s *aggregateServer) Aggregate(stream pb.Aggregate_AggregateServer) error {
    for {
        batch, err := stream.Recv()
        if err == io.EOF {
            return s.sendResults(stream)
        }
        if err != nil {
            return err
        }

        processStart := time.Now()

        // Process batch
        for _, event := range batch.Events {
            s.aggregateBatch[event.Type].Count++
            s.aggregateBatch[event.Type].Sum += event.Value
        }

        metrics.recordProcessing(time.Since(processStart).Seconds() * 1000)
    }
}
```

### Testing Strategy

```bash
# Test with different batch sizes
pnpm test:pipeline --batch-size=1    # Baseline (current)
pnpm test:pipeline --batch-size=10   # Small batches
pnpm test:pipeline --batch-size=100  # Optimal
pnpm test:pipeline --batch-size=1000 # Large batches

# Measure throughput
node run-split-pipeline.mjs 100000 --batch-size=100
# Expected: 70-100k events/sec (vs 30k baseline)
```

### Success Metrics

- ✅ IPC overhead reduces from 85-94% to 25-30%
- ✅ Throughput increases from 30k to 70-100k events/sec
- ✅ Latency stays bounded (<50ms p99)
- ✅ All services handle batches correctly
- ✅ Metrics still accurate

### Rollout Plan

1. Implement proto changes + regenerate
2. Update services one-by-one (TS → Rust → Python → Go)
3. Add batch_size CLI flag (default=100)
4. Test with 100k events
5. Compare metrics before/after
6. Document results in RESULTS.md

**Estimate:** 8-12 hours total

---

## Sprint 9: Compute-Heavy Workloads (Optional Extension)

**Status:** Planning (not yet started)  
**Goal:** Add CPU-intensive workload mode to shift focus from IPC to processing

### Current State Analysis

Event pipeline is **I/O-bound** (real measurements from 1k events):

- **Ingest (TS):** 89% IPC Send, 10% processing (0.2μs/event)
- **Parse (Rust):** 94% IPC Recv (waiting!), 5% processing (3.5μs/event)
- **Rules (Python):** 70% processing, 30% IPC (3.3μs/event) ← Best ratio!
- **Aggregate (Go):** 99% IPC Recv (waiting!), 0.1% processing (0.1μs/event)
- **Sink (TS):** 83% IPC Send, 11% processing

**Problem:** Language performance comparison is limited when most time is spent waiting/transferring.

**Solution:** Add compute-heavy workload mode where processing dominates over IPC.

### Design Principles

1. **Non-breaking:** Existing event pipeline remains default
2. **Opt-in:** Activated via CLI flags
3. **Same infrastructure:** Reuses metrics, orchestrator, services
4. **Dual-path:** Services handle both events and work-items

### Workload Design

**Example WorkItem payload:**

```json
{
  "type": "work-item",
  "id": "w-000123",
  "payload": {
    "vectors": [
      [0.12, 0.44, 0.93, 0.21],
      [0.51, 0.09, 0.33, 0.77]
    ],
    "matrix": [
      [1.1, 0.2],
      [0.4, 0.9]
    ],
    "text": "Lorem ipsum dolor sit amet...",
    "iterations": 500
  }
}
```

**Per-service compute tasks:**

- **Parse (Rust):** Vector validation, matrix transpose, preprocessing
- **Rules (Python):** Feature engineering (normalization, thresholding, filtering)
- **Aggregate (Go):** Numeric aggregation (dot products, matrix multiply, reduce/map)
- **Sink (TS):** Result checksumming, JSON formatting

### Implementation Tasks

#### 9.1 Proto Extensions

Add to `packages/proto/pipeline/v1/pipeline.proto`:

```protobuf
message StreamEventsRequest {
  string input_file = 1;
  int32 batch_size = 2;
  string max_events = 3;

  // NEW: Workload mode
  WorkloadMode mode = 4;
  WorkloadConfig config = 5;
}

enum WorkloadMode {
  EVENTS = 0;       // Default: existing event pipeline
  WORK_ITEMS = 1;   // Compute-heavy workloads
  MIXED = 2;        // Mix of both
}

message WorkloadConfig {
  float work_ratio = 1;        // 0.0-1.0: ratio of work-items vs events
  PayloadSize payload_size = 2;
  int32 compute_iterations = 3;
}

enum PayloadSize {
  SMALL = 0;   // 1KB
  MEDIUM = 1;  // 10KB
  LARGE = 2;   // 100KB
}

message WorkItem {
  string id = 1;
  repeated Vector vectors = 2;
  Matrix matrix = 3;
  string text = 4;
  int32 iterations = 5;
}

message Vector {
  repeated double values = 1;
}

message Matrix {
  repeated Vector rows = 1;
}

// Extend RawData
message RawData {
  oneof payload {
    Event event = 1;          // Existing
    WorkItem work_item = 2;   // NEW
  }
}
```

#### 9.2 Service Updates (Dual-Path Pattern)

**TypeScript (Ingest):** Add work item generator

```typescript
function generateWorkItem(id: string, config: WorkloadConfig): WorkItem {
  const size = config.payload_size === 'LARGE' ? 1000 : config.payload_size === 'MEDIUM' ? 100 : 10

  return {
    id,
    vectors: Array.from({ length: 2 }, () => Array.from({ length: size }, () => Math.random())),
    matrix: {
      rows: Array.from({ length: size }, () => Array.from({ length: size }, () => Math.random())),
    },
    text: 'Lorem ipsum '.repeat(config.payload_size === 'LARGE' ? 1000 : 10),
    iterations: config.compute_iterations || 500,
  }
}
```

**Rust (Parse):** Add vector/matrix operations

```rust
fn process_work_item(item: &WorkItem) -> ProcessedWorkItem {
  let process_start = Instant::now();

  // Vector normalization
  let normalized: Vec<Vec<f64>> = item.vectors.iter()
    .map(|v| normalize_vector(&v.values))
    .collect();

  // Matrix transpose
  let transposed = transpose_matrix(&item.matrix);

  // CPU work
  let mut result = 0.0;
  for _ in 0..item.iterations {
    result += compute_hash(&normalized);
  }

  metrics.record_processing(process_start.elapsed().as_secs_f64() * 1000.0);

  ProcessedWorkItem { id: item.id.clone(), vectors: normalized, checksum: result }
}
```

**Python (Rules):** Add numpy/sklearn operations

```python
import numpy as np
from sklearn.preprocessing import StandardScaler

def process_work_item(item: WorkItem) -> EnrichedWorkItem:
    start = time.perf_counter()

    # Feature engineering
    vectors = np.array([v.values for v in item.vectors])
    scaler = StandardScaler()
    normalized = scaler.fit_transform(vectors)

    # Matrix eigenvalues
    matrix = np.array([[c for c in r.values] for r in item.matrix.rows])
    eigenvalues = np.linalg.eigvals(matrix)

    # CPU iterations
    result = sum(np.sum(eigenvalues) for _ in range(item.iterations))

    self.metrics.record_processing((time.perf_counter() - start) * 1000)

    return EnrichedWorkItem(id=item.id, eigenvalues=eigenvalues.tolist(), score=float(result))
```

**Go (Aggregate):** Add numeric operations

```go
func processWorkItem(item *WorkItem, metrics *ServiceMetrics) *AggregateResult {
  start := time.Now()

  // Dot products
  var dotProducts []float64
  for i := 0; i < len(item.Vectors)-1; i++ {
    dp := dotProduct(item.Vectors[i].Values, item.Vectors[i+1].Values)
    dotProducts = append(dotProducts, dp)
  }

  // Matrix sum
  var sum float64
  for _, row := range item.Matrix.Rows {
    for _, val := range row.Values {
      sum += val
    }
  }

  // CPU work
  result := 0.0
  for i := 0; i < int(item.Iterations); i++ {
    result += sum * float64(i)
  }

  metrics.recordProcessing(time.Since(start).Seconds() * 1000)

  return &AggregateResult{Key: item.Id, Sum: int64(result), Avg: result}
}
```

#### 9.3 CLI Extensions

```bash
# Work items only
node run-split-pipeline.mjs 10000 --workload=work-items --payload-size=medium

# Mixed mode: 30% work items, 70% events
node run-split-pipeline.mjs 100000 --workload=mixed --work-ratio=0.3

# CPU-intensive
node run-split-pipeline.mjs 1000 --workload=work-items --iterations=10000
```

#### 9.4 Expected Metrics

Separate output for events vs work-items:

```
=== Pipeline Metrics (Events) ===
Processed: 70,000 events
IPC overhead: 85% (current baseline)

=== Pipeline Metrics (Work Items) ===
Processed: 30,000 work-items
IPC overhead: 25% ← Much lower!
Processing time: 70% ← Language matters here!

=== Language Performance ===
Rust Parse:     3.2ms/item (vector ops)
Python Rules:   8.5ms/item (numpy/sklearn)
Go Aggregate:   1.1ms/item (concurrency)
TS Ingest/Sink: 0.5ms/item (I/O bound)
```

### Decision Point

**Do we implement this?**

**Arguments FOR:**

- Makes language comparison more meaningful
- Shows polyglot advantages in real compute scenarios
- Demonstrates mixed workload capability

**Arguments AGAINST:**

- Current metrics already show Python is fast (70% processing)
- Adds complexity to demo
- Event pipeline is realistic use case
- Could be separate demo

**Recommendation:** Defer to Sprint 9 or create as extension demo.

### Implementation Estimate

- Proto changes: 2h
- Ingest service: 2h
- Parse (Rust): 4h
- Rules (Python + numpy): 4h
- Aggregate (Go): 3h
- Sink: 1h
- Generator: 2h
- Testing: 4h

**Total:** ~22 hours

---

## Commit Message

```
feat(demo): add C++ monolith vs polyglot split pipeline comparison

- Add pipeline proto definitions (ingest/parse/rules/aggregate)
- Implement C++ monolith with std::thread, locks, manual memory management
- Implement split variant: TS (ingest/sink), Rust (parse), Python (rules), Go (aggregate)
- Add benchmarking harness with p95/throughput/recovery/complexity metrics
- Extend supervisor UI for pipeline visualization
- Add chaos testing and recovery demos
- Document comparison showing IPC is not a bottleneck

Shows that C++ monolith loses to modern polyglot split architecture
in robustness, maintainability, and developer productivity - while
being barely faster. Rust provides memory safety + performance,
Python enables rapid iteration, Go simplifies concurrency, TypeScript
boosts orchestration productivity.
```
