# Architecture

At a high level, the runtime consists of a supervisor that starts processes and a broker that connects them. Services communicate via gRPC and protobuf contracts.

## Two Different Architectures

The repository demonstrates two separate approaches:

### 1. Calculator Example (with Supervisor/Broker)

```mermaid
graph TB
    SUP[Supervisor<br/>Process Manager]
    BRK[Broker<br/>Service Registry]
    CALC_S[Calculator Server]
    CALC_C1[Calculator Client<br/>typescript, Rust, C++]

    SUP -->|starts| BRK
    SUP -->|starts| CALC_S
    SUP -->|starts| CALC_C1

    CALC_S -.->|registers| BRK
    CALC_C1 -.->|discovers| BRK
    CALC_C1 -->|gRPC calls| CALC_S

    style SUP stroke:#0066cc,stroke-width:3px
    style BRK stroke:#ff9900,stroke-width:3px
```

**Components:**

- **Supervisor:** launches and manages processes from `config.yaml`
- **Broker:** service registry for discovery
- **Services:** register with broker, discover each other dynamically

### 2. Demo Pipeline (without Supervisor/Broker)

```mermaid
flowchart LR
    ORC[Orchestrator<br/>Demo Runner]
    ING[Ingest]
    PRS[Parse]
    RUL[Rules]
    AGG[Aggregate]
    SNK[Sink]

    ORC -->|starts manually| ING
    ORC -->|starts manually| PRS
    ORC -->|starts manually| RUL
    ORC -->|starts manually| AGG
    ORC -->|starts manually| SNK

    ORC -->|gRPC| ING
    ING -->|gRPC| PRS
    PRS -->|gRPC| RUL
    RUL -->|gRPC| AGG
    AGG -->|gRPC| SNK

    style ORC stroke:#9933cc,stroke-width:3px
```

**Components:**

- **Orchestrator:** demo script that starts services and coordinates the pipeline
- **Services:** hardcoded ports, no service discovery
- **No Supervisor/Broker:** services are started by the demo script directly

::: info Why Two Approaches?

- **Calculator example** demonstrates the supervisor/broker pattern for dynamic service management
- **Demo pipeline** focuses on performance measurements without the overhead of service discovery

The demo pipeline scripts (`run-split-pipeline.mjs`) spawn services as child processes with fixed ports.
:::

## Supervisor Scope and Limitations

The supervisor is a practical option for running processes in a concrete project and for integrating this test system on a single platform. It is also an example of how process management can look, not a universal solution.

In distributed deployments across multiple machines, a single supervisor instance is not sufficient. A higher-level mechanism is required to ensure supervisors are themselves reliable and coordinated.

Operating systems and platform tooling (for example Linux service managers or cluster orchestration stacks) often provide stronger primitives for long-term supervision and distribution. This project does not replace those layers. At that level, project integrators are responsible for selecting and operating the appropriate infrastructure.

These constraints are known and intentional. The goal here is a clear, local-first runtime for experiments and demos, not a full platform replacement.

## Demo Pipeline Flow

The split pipeline processes events through five stages:

```mermaid
flowchart LR
    A[Ingest<br/>Read NDJSON] -->|gRPC stream| B[Parse<br/>Validate & Structure]
    B -->|gRPC stream| C[Rules<br/>Filter & Enrich]
    C -->|gRPC stream| D[Aggregate<br/>Compute Stats]
    D -->|gRPC stream| E[Sink<br/>Write Results]

    style A stroke:#0066cc,stroke-width:3px
    style B stroke:#ff9900,stroke-width:3px
    style C stroke:#cc0066,stroke-width:3px
    style D stroke:#00cc66,stroke-width:3px
    style E stroke:#9933cc,stroke-width:3px
```

**Stage responsibilities:**

1. **Ingest** - reads NDJSON and streams events to Parse
2. **Parse** - validates JSON, structures data, handles WorkItems
3. **Rules** - filters events (e.g., removes 'view' events), enriches data
4. **Aggregate** - computes counts, sums, and averages per event type
5. **Sink** - writes final results and prints metrics

Each arrow represents a **bidirectional gRPC streaming connection**. Services can be implemented in any language with gRPC support.

::: tip Performance Impact
Without batching, each event triggers a separate gRPC call, leading to 85% IPC overhead. With batching (size=100), overhead is amortized and throughput increases 3x.

See [Performance Deep Dive](/guide/performance) for detailed analysis.
:::

This architecture keeps local deployment simple while enabling independent upgrades and language choice per service.
