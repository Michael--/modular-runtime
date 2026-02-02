# Pipeline Results (Demo Scenarios)

This document summarizes measured results for the monolith and split pipelines.
Numbers come from repeated demo runs and were cleaned up for readability.

## Scope and Setup

- Event types: click, view, purchase
- Filter rule: view events are filtered out
- Users: 10,000
- Seed: 42
- Hardware: macOS (M-series or Intel)
- Split pipeline: TypeScript -> Rust -> Python -> Go -> TypeScript

## Summary

- Correctness: monolith and split outputs match for event workloads.
- Events (100k): split without batching is ~0.56-0.57x monolith throughput; with end-to-end batching (50-100) it is ~1.7-1.75x faster.
- Optimal batch size for events: 50-100.
- Work-items (CPU-bound): processing dominates (87-92%); throughput is stable at ~10-12k items/s; batching impact is minimal.

## Events Workload (100k)

### Baseline (no batching)

| Metric          | Monolith (C++) | Split (no batch) | Ratio |
| --------------- | -------------- | ---------------- | ----- |
| Processing time | 1.4s           | 3.95s            | 2.8x  |
| Throughput      | 44,0/s         | 24,7/s           | 0.56x |
| Latency/event   | 0.023ms        | 0.040ms          | 1.7x  |
| IPC overhead    | 1.21%          | 85.6%            | 71x   |
| Results         | correct        | correct          | match |

### End-to-end batching

| Batch Size | Processing Time | Throughput | vs Baseline | vs Monolith | IPC Overhead |
| ---------- | --------------- | ---------- | ----------- | ----------- | ------------ |
| 1 (none)   | 3.96s           | 25,265/s   | 1.0x        | 0.57x       | 85.6%        |
| 10         | 1.50s           | 66,845/s   | 2.6x        | 1.52x       | 87.2%        |
| 50         | 1.32s           | 75,700/s   | 3.0x        | 1.72x       | 84.6%        |
| 100        | 1.30s           | 77,042/s   | 3.0x        | 1.75x       | 84.3%        |
| 1000       | 1.36s           | 73,529/s   | 2.9x        | 1.67x       | 84.9%        |
| Monolith   | 1.38s           | 44,071/s   | -           | 1.0x        | 1.21%        |

Key points:

- End-to-end batching reduces gRPC call count by ~100x at batch_size=100.
- Throughput improves ~3x vs baseline and exceeds monolith at 50-100.
- IPC still dominates overall time, but batching amortizes it effectively.

### Per-service metrics (100k events, batch_size=100)

- Ingest (TS): 10.2% processing, 89.8% IPC send
- Parse (Rust): ~5% processing, ~94% IPC recv
- Rules (Python): ~70% processing, ~18% IPC send, ~12% IPC recv
- Aggregate (Go): ~0.1% processing, ~99.5% IPC recv
- Sink (TS): 7.4% processing, 89.8% IPC send

## Work-items Workload (CPU-bound)

| Work Items | Time  | Throughput | Processing | IPC   |
| ---------- | ----- | ---------- | ---------- | ----- |
| 10,000     | 0.94s | 10.7k/s    | 87.1%      | 12.9% |
| 50,000     | 4.21s | 11.9k/s    | 91.4%      | 8.6%  |
| 100,000    | 9.66s | 10.4k/s    | 92.4%      | 7.6%  |

Key points:

- Processing dominates; IPC overhead is minor.
- Throughput is stable and scales linearly with item count.
- Batching has minimal impact because CPU work dominates.
- No monolith comparison for work-items (monolith does not implement this workload).

## Historical Context (1M events, no batching)

| Metric          | Monolith (C++) | Split (no batch) | Ratio |
| --------------- | -------------- | ---------------- | ----- |
| Processing time | 14.19s         | 52.55s           | 3.7x  |
| Throughput      | 42,710/s       | 19,030/s         | 0.45x |
| Results         | correct        | correct          | match |

Note: This data predates end-to-end batching and is included only for historical reference.

## Output Correctness (events)

All event workloads produce identical aggregates:

- Purchase count: 30,288
- Purchase sum: 1,656,819
- Purchase avg: 54.7022
- Click count: 30,387
- Click sum: 1,672,013
- Click avg: 55.024
- View filtered: 39,325

## How to Reproduce (root scripts)

- Monolith: `pnpm demo:monolith` (see `examples/demo-scenarios/run-monolith.mjs`)
- Split pipeline: `pnpm demo:split` (see `examples/demo-scenarios/run-split-pipeline.mjs`)
- Batching presets: `pnpm demo:split:batch10|batch50|batch100|batch1000`
- Work-items: `pnpm demo:workload:10000|50000|100000`

## Run-to-Run Variance

Small deviations between runs are expected (system load, scheduling, I/O jitter).
The ranges shown above capture observed variation and are considered normal.
