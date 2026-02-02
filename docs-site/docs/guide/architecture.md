# Architecture

At a high level, the runtime consists of a supervisor that starts processes and a broker that connects them. Services communicate via gRPC and protobuf contracts.

Core components:

- Supervisor: launches and supervises processes using a config file.
- Broker / registry: service discovery, lookups, and change notifications.
- Services: small, single-purpose processes (ingest, parse, rules, aggregate, sink).
- Orchestrator: coordinates end-to-end runs for demo scenarios.
- Bridges (optional): interceptors for logging, tracing, or policy enforcement.

Demo pipeline flow:

1. Ingest reads NDJSON and streams events.
2. Parse validates and structures input data.
3. Rules filter and enrich events.
4. Aggregate computes counts and sums.
5. Sink writes final results and metrics.

This architecture keeps local deployment simple while enabling independent upgrades and language choice per service.
