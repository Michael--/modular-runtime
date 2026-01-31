# Demo Scenarios

This folder contains scripts and reference outputs for running the monolith demo pipeline.
Generated NDJSON files are ignored by git; this README is tracked.

## Quick Run

```bash
pnpm demo:monolith -- --count 100000 --no-checksum
```

## Verify Mode (Determinism)

```bash
pnpm demo:monolith -- --count 100000 --verify
```

Verify mode runs the monolith twice and compares the SHA-256 checksums of the output files.

## Baseline Configuration

- Count: 100000
- Users: 10000
- Seed: 42
- Types: click,view,purchase
- Queue size: 10000

## Expected Output Shape

The monolith writes NDJSON aggregation results with keys per event type:

```json
{"key":"purchase","count":30288,"sum":1656819,"avg":54.7022}
{"key":"click","count":30387,"sum":1672013,"avg":55.024}
```

Note: `view` events are filtered out by the rules stage, so only `click` and `purchase` appear in the aggregation output.
