# Pipeline Orchestrator

Client that wires together the entire split pipeline by connecting all services via gRPC streaming.

## Architecture

The orchestrator connects:

1. **Ingest Service** (port 6001) - Streams raw events from NDJSON file
2. **Parse Service** (port 6002) - Parses and validates events
3. **Rules Service** (port 6003) - Applies filtering and enrichment rules
4. **Aggregate Service** (port 6004) - Aggregates events by key
5. **Sink Service** (port 6005) - Writes results to output file

## Data Flow

```
events.ndjson
    ↓
Ingest → Parse → Rules → Aggregate → Sink
    ↓        ↓       ↓         ↓        ↓
  gRPC    gRPC    gRPC      gRPC     NDJSON output
```

## Usage

Start all services first, then run the orchestrator:

```bash
# Via run-split-pipeline.mjs (recommended)
pnpm demo:run-split -- --count 100000

# Or manually
node dist/pipeline-orchestrator.js \
  --input events.ndjson \
  --output results.ndjson
```

## Options

- `--input <file>` - Input NDJSON file (default: `examples/demo-scenarios/events.ndjson`)
- `--output <file>` - Output NDJSON file (default: `examples/demo-scenarios/aggregate-results-split.ndjson`)
- `--max-events <number>` - Maximum events to process (default: all)

## Implementation

The orchestrator creates bidirectional gRPC streams and pipes data through each service:

1. Request events from ingest service
2. For each event, send to parse service
3. For each parsed event, send to rules service
4. For each enriched event (that passed rules), send to aggregate service
5. For each aggregate result, send to sink service

Progress is displayed in real-time showing event counts at each stage.
