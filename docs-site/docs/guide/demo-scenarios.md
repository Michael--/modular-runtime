# Demo Scenarios

The demo scenarios compare a C++ monolith pipeline to a split service pipeline.

## Quick Runs

Monolith:

```bash
pnpm demo:monolith -- --count 100000 --no-checksum
```

Split pipeline:

```bash
pnpm demo:split -- --count 100000
```

## Scripts (root package.json)

- `pnpm demo:monolith` -> `examples/demo-scenarios/run-monolith.mjs`
- `pnpm demo:split` -> `examples/demo-scenarios/run-split-pipeline.mjs`
- `pnpm demo:split:baseline` -> split pipeline, batching disabled
- `pnpm demo:split:batch10|batch50|batch100|batch1000` -> batching presets
- `pnpm demo:split:full` -> split pipeline with batching enabled
- `pnpm demo:split:polyglot` -> Rust/Python/Go services
- `pnpm demo:workload:10000|50000|100000` -> work-items workload presets

## Split Pipeline Defaults

- Count: 100000
- Users: 10000
- Seed: 42
- Batch size: 100
- Workload: events
- Payload size: medium
- Iterations: 500

Notable flags:

- `--enable-batching` / `--batch-size`
- `--workload events|work-items|mixed`
- `--payload-size small|medium|large`
- `--iterations`
- `--impl ts|polyglot`
- `--no-build` / `--no-generate`

## Output Files

- Monolith: `examples/demo-scenarios/aggregate-results.ndjson`
- Split: `examples/demo-scenarios/aggregate-results-split.ndjson`

## Expected Output Shape (events)

```json
{"key":"purchase","count":30288,"sum":1656819,"avg":54.7022}
{"key":"click","count":30387,"sum":1672013,"avg":55.024}
```

Note: view events are filtered out by the rules stage.
