# Performance Deep Dive

This page explains how batching works, what the performance characteristics look like, and how language choice affects throughput.

## Pipeline Flow

The split pipeline processes events through five stages:

```mermaid
flowchart LR
    A[Ingest] -->|events| O[Orchestrator]
    O -->|parse stream| B[Parse]
    O -->|rules stream| C[Rules]
    O -->|aggregate stream| D[Aggregate]
    O -->|results stream| E[Sink]

    style A stroke:#0066cc,stroke-width:3px
    style O stroke:#000000,stroke-width:3px
    style B stroke:#ff9900,stroke-width:3px
    style C stroke:#cc0066,stroke-width:3px
    style D stroke:#00cc66,stroke-width:3px
    style E stroke:#9933cc,stroke-width:3px
```

Transport details:

- Ingest -> Orchestrator uses server-streaming RPC.
- Parse/Rules/Aggregate are streaming RPCs driven by the orchestrator.
- Orchestrator -> Sink uses client-streaming RPC with a final summary response.

Without batching, every event still becomes an individual stream write on parse/rules/aggregate legs, so serialization and IPC overhead dominate.

## IPC Overhead Problem

Without batching, IPC dominates processing time:

```mermaid
pie title Time Distribution (no batching, 100k events)
    "IPC Overhead" : 85.6
    "Processing" : 14.4
```

The split pipeline spends **85.6% of time** on inter-process communication, while actual business logic takes only 14.4%. This is why the unbatched split is 2.8x slower than the monolith.

## Batching Solution

Inter-stage batching groups multiple events into one stream write on parse/rules/aggregate:

```mermaid
graph TB
    subgraph "Without Batching (batch_size=1)"
        A1[Event 1] --> B1[gRPC call]
        A2[Event 2] --> B2[gRPC call]
        A3[Event 3] --> B3[gRPC call]
        A4[Event ...] --> B4[gRPC call]
    end

    subgraph "With Batching (batch_size=100)"
        C1[Event 1] --> D1[gRPC call]
        C2[Event 2] --> D1
        C3[Event 3] --> D1
        C4[Event ...] --> D1
        C5[Event 100] --> D1
    end
```

**Impact:** At `batch_size=100`, parse/rules/aggregate writes drop from roughly `300,000` to `3,000` for 100,000 events.

## Throughput Scaling

Performance improves dramatically with batching:

| Batch Size | Throughput   | vs Monolith | IPC Overhead |
| ---------- | ------------ | ----------- | ------------ |
| 1 (none)   | 25,265/s     | 0.57x       | 85.6%        |
| 10         | 66,845/s     | 1.52x       | 87.2%        |
| 50         | 75,700/s     | 1.72x       | 84.6%        |
| **100**    | **77,042/s** | **1.75x**   | **84.3%**    |
| 1000       | 73,529/s     | 1.67x       | 84.9%        |
| Monolith   | 44,071/s     | 1.0x        | 1.21%        |

**Key insight:** The sweet spot is **batch_size=50-100**. Beyond 100, throughput drops slightly due to increased latency per batch.

```mermaid
graph LR
    A[batch=1<br/>25k/s] -->|2.6x| B[batch=10<br/>66k/s]
    B -->|1.1x| C[batch=50<br/>75k/s]
    C -->|1.02x| D[batch=100<br/>77k/s]
    D -->|0.95x| E[batch=1000<br/>73k/s]

    style D stroke:#00cc00,stroke-width:4px
```

## Per-Service Breakdown

Where does time go at optimal batching (batch_size=100)?

```mermaid
pie title Ingest Service (TypeScript)
    "IPC Send" : 89.8
    "Processing" : 10.2
```

```mermaid
pie title Parse Service (TypeScript)
    "IPC Recv" : 94
    "Processing" : 5
    "IPC Send" : 1
```

```mermaid
pie title Rules Service (TypeScript)
    "Processing" : 70
    "IPC Send" : 18
    "IPC Recv" : 12
```

```mermaid
pie title Aggregate Service (TypeScript)
    "IPC Recv" : 99.5
    "Processing" : 0.1
    "IPC Send" : 0.4
```

**Observations:**

- **Rules** is the only service where processing dominates (70%)
- **Aggregate** is almost pure IPC (99.5% receive time)
- Even with batching, IPC still significant but now amortized across 100 events

## CPU-bound vs IO-bound Workloads

### Events Workload (IO-bound)

- Lightweight processing per event
- IPC overhead dominates without batching
- **Batching has massive impact** (3x improvement)

### Work-items Workload (CPU-bound)

- Heavy CPU processing per item (vector normalization, matrix transpose, checksum computation)
- Processing dominates (87-92% of time)
- **Batching has minimal impact** - CPU work is the bottleneck

```mermaid
pie title Work-items Workload (10k items)
    "Processing" : 87.1
    "IPC" : 12.9
```

This explains why batching doesn't help for CPU-intensive tasks - you can't batch away the actual computation.

## Language Performance: TypeScript vs Rust

### Events Workload (100k, batch=100)

| Implementation | Throughput   | vs TypeScript |
| -------------- | ------------ | ------------- |
| TypeScript     | 77,042/s     | 1.0x          |
| Rust (debug)   | 76,161/s     | 0.99x         |
| Rust (release) | **79,681/s** | **1.03x**     |

**Takeaway:** With proper optimizations and release builds, **Rust outperforms Node.js** by 3% for events.

### Work-items Workload (10k)

| Implementation | Throughput | vs TypeScript |
| -------------- | ---------- | ------------- |
| TypeScript     | 10,700/s   | 1.0x          |
| Rust (debug)   | 2,725/s    | 0.25x         |
| Rust (release) | 7,716/s    | 0.72x         |

**Takeaway:** TypeScript still leads for CPU-bound work by ~40%. This is likely due to:

- V8's highly optimized JIT for numeric operations
- IPC overhead differences (tonic vs gRPC-js)
- Room for further Rust micro-optimizations

## Key Learnings

1. **Batching is critical for IO-bound workloads** - can turn a 2.8x slowdown into a 1.75x speedup
2. **Release builds matter** - debug mode can be 10-20x slower in Rust
3. **Language choice is less important than you think** - with batching, TypeScript and Rust perform similarly
4. **Profile before optimizing** - understand where time is spent before making changes
5. **Sweet spot exists** - too small batches waste IPC, too large batches increase latency

## Running Your Own Tests

To reproduce these results:

```bash
# TypeScript baseline (no batching)
pnpm demo:split:baseline

# TypeScript with batching
pnpm demo:split:batch100

# Rust/Python/Go polyglot
pnpm demo:split:polyglot

# CPU-bound workload
pnpm demo:workload:10000
```

See [Demo Scenarios](/guide/demo-scenarios) for full flag documentation.
