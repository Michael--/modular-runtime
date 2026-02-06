# Overview

The modular-runtime repository explores how to break a large, local monolith into multiple services without relying on Kubernetes or cloud infrastructure.

Three working areas are represented:

1. Demo pipeline scenarios
   - Location: `examples/demo-scenarios` and `apps/demo-domain`
   - Purpose: show why splitting into services matters and what the tradeoffs look like.
   - Focus: monolith vs split pipeline, batching, throughput, and correctness.

2. Runtime, supervision, and observability
   - Location: `apps/supervisor`, `packages/broker`, `apps/topology`, `apps/dashboard`
   - Purpose: manage and connect services in a local, process-based runtime and visualize live topology.
   - Focus: starting, monitoring, wiring services together, and reporting runtime health.

3. Setup and CI
   - Location: `CI_SETUP.md`, `ci.js`, `packages/proto/check-plugins.sh`
   - Purpose: ensure reproducible polyglot builds across local dev and CI.
   - Focus: protobuf plugin setup, CI pipeline, and cross-platform build readiness.

Use the Guide pages to understand the motivation, architecture, setup, and how to run the demos.
