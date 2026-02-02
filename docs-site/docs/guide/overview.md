# Overview

The modular-runtime repository explores how to break a large, local monolith into multiple services without relying on Kubernetes or cloud infrastructure.

Two working areas are represented:

1. Demo pipeline scenarios
   - Location: `examples/demo-scenarios` and `apps/demo-domain`
   - Purpose: show why splitting into services matters and what the tradeoffs look like.
   - Focus: monolith vs split pipeline, batching, throughput, and correctness.

2. Runtime and supervision
   - Location: `apps/supervisor` and `packages/broker`
   - Purpose: manage and connect services in a local, process-based runtime.
   - Focus: starting, monitoring, and wiring services together.

Use the Guide pages to understand the motivation, architecture, and how to run the demos.
