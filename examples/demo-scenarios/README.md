# Demo Scenarios

This folder contains scripts and reference outputs for running the monolith and split pipeline demos.
Generated NDJSON files are ignored by git; this README is tracked.

## Quick Runs

Monolith (single binary):

```bash
pnpm demo:monolith -- --count 100000 --no-checksum
```

Split pipeline (multiple services + orchestrator):

```bash
pnpm demo:split -- --count 100000
```

## Root Scripts

Defined in the repo root `package.json`:

- `pnpm demo:monolith` → `examples/demo-scenarios/run-monolith.mjs`
- `pnpm demo:split` → `examples/demo-scenarios/run-split-pipeline.mjs`
- `pnpm demo:split:baseline` → split pipeline, batching disabled, reuses artifacts
- `pnpm demo:split:batch10|batch50|batch100|batch1000` → batching presets
- `pnpm demo:split:full` → split pipeline with batching enabled
- `pnpm demo:workload:10000|50000|100000` → work-items workload presets

## Monolith Script

Script: `examples/demo-scenarios/run-monolith.mjs`

Defaults:

- Count: 100000
- Users: 10000
- Seed: 42
- Types: click,view,purchase
- Queue size: 10000

Notable flags:

- `--no-build` / `--no-generate`
- `--no-checksum` / `--verify`
- `--workers` / `--queue-size`
- `--input` / `--output`

Verify mode runs the monolith twice and compares the SHA-256 checksums of the output files.

## Split Pipeline Script

Script: `examples/demo-scenarios/run-split-pipeline.mjs`

Defaults:

- Count: 100000
- Users: 10000
- Seed: 42
- Types: click,view,purchase
- Batch size: 100
- Workload: events
- Payload size: medium
- Iterations: 500

Notable flags:

- `--enable-batching` / `--batch-size`
- `--workload events|work-items|mixed`
- `--payload-size small|medium|large`
- `--iterations`
- `--no-build` / `--no-generate`
- `--input` / `--output`

The split script builds and starts the services plus the pipeline orchestrator by default.
The demo script uses the TypeScript/Node.js service implementations; polyglot variants are not used here.
All stdout/stderr is prefixed by origin (runner, generator, orchestrator, services); multiline output is split into prefixed lines.

## Output Files

Default output paths:

- Monolith: `examples/demo-scenarios/aggregate-results.ndjson`
- Split: `examples/demo-scenarios/aggregate-results-split.ndjson`

## Expected Output Shape

Events workload produces NDJSON aggregation results with keys per event type:

```json
{"key":"purchase","count":30288,"sum":1656819,"avg":54.7022}
{"key":"click","count":30387,"sum":1672013,"avg":55.024}
```

Note: `view` events are filtered out by the rules stage, so only `click` and `purchase` appear in the aggregation output.

Work-items workload writes NDJSON entries with a different shape:

```json
{ "workItemId": "w-000123", "vectorChecksum": "12345", "finalScore": 0.42, "timestamp": 1700000000 }
```
