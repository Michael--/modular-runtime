# Workspaces

The repo contains two main working areas with different goals.

## Demo Domain

Location: `apps/demo-domain` and `examples/demo-scenarios`

Purpose: provide a concrete, performance-focused example of monolith vs split pipeline.

Key pieces:

- Monolith pipeline: `apps/demo-domain/event-pipeline-monolith`
- Split services: `apps/demo-domain/ingest-service`, `parse-service`, `rules-service`, `aggregate-service`, `sink-service`
- Polyglot variants: Rust, Python, and Go implementations in their respective folders
- Orchestrator: `apps/demo-domain/pipeline-orchestrator`
- Scenario scripts and results: `examples/demo-scenarios`

## Runtime, Supervision, and Observability

Location: `apps/supervisor`, `packages/broker`, `apps/topology`, `apps/dashboard`

Purpose: run and connect services locally as separate processes.

The supervisor config in `apps/supervisor/config.yaml` shows the active process set. It includes the broker and sample calculator clients and server:

- Broker: `packages/broker`
- Calculator server: `apps/calculator-server`
- Calculator clients: `apps/calculator-client`, `apps/calculator-client-rust`, `apps/calculator-client-cpp`

This area is the practical runtime for starting and managing services. The demo domain focuses on the pipeline example.

The observability stack adds a topology service and a UI dashboard:

- Topology stack: `apps/topology` (gRPC topology service, SSE proxy, reporter proxy)
- Dashboard: `apps/dashboard` (live graph, services, connections, and stream status)
- Reporter client: `apps/topology-reporter-rust` (Rust helper for topology reporting)
