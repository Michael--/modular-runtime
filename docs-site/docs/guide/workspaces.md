# Workspaces

The repo contains three main working areas with different goals.

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

The supervisor config in `apps/supervisor/config.yaml` defines the process set in **manual start mode** (`ui.mode: manual`). It includes:

- Broker: `packages/broker`
- Calculator servers: `apps/calculator-server`, `apps/calculator-server-rust`
- Calculator clients: `apps/calculator-client`, `apps/calculator-client-rust`, `apps/calculator-client-cpp`
- Topology + dashboard: `apps/topology`, `apps/dashboard`

This area is the practical runtime for starting and managing services. The demo domain focuses on the pipeline example.

The observability stack adds a topology service and a UI dashboard:

- Topology stack: `apps/topology` (gRPC topology service, SSE proxy, reporter proxy)
- Dashboard: `apps/dashboard` (live graph, services, connections, and stream status)
- Reporter client (TypeScript): `packages/topology-reporter`
- Reporter client (Rust): `apps/topology-reporter-rust`

## Shared Packages and Contracts

Location: `packages/*`

Purpose: shared contracts and reusable runtime libraries used by both runtime and demo-domain apps.

Key packages:

- `packages/proto`: protobuf contracts and generated code toolchain
- `packages/pipeline-common`: shared metrics helpers for pipeline services
- `packages/common`: shared runtime primitives
- `packages/broker`: service registry implementation
- `packages/topology-reporter`: reusable topology reporter library
