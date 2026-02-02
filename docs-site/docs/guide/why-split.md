# Why Split a Monolith

Large monoliths often hide complexity behind shared state, thread coordination, and manual memory management. The demo pipeline uses a C++ monolith baseline to show what changes when the same work is split into services.

Key motivations:

- Clear boundaries: explicit contracts instead of shared memory and lock-heavy coordination.
- Restartability: services can fail and recover without taking the whole system down.
- Polyglot freedom: use the best language for each stage (Rust for parsing, Python for rules, Go for aggregation, TypeScript for orchestration).
- Gradual migration: split one stage at a time instead of a full rewrite.
- Local-first: multiple processes on a single machine, still dynamic and observable.

The goal is not cloud-native microservices. It is a pragmatic way to decompose a local system while keeping performance competitive.

## Migration Path from a Legacy C++ Monolith

Splitting is not just about picking between two greenfield approaches. It provides a path away from a historical, oversized C++ monolith without losing performance or control.

Practical reasons this matters:

- Step-by-step extraction: carve out one stage at a time and keep the rest of the system intact.
- Coexistence: C++ can remain for hot paths while new services evolve in safer or faster-to-iterate languages.
- Risk reduction: smaller services are easier to test, deploy, and roll back.
- Confidence building: measured results show the split pipeline can match or exceed monolith throughput when batching is enabled.

This is a modernization strategy, not a replacement story. It reduces fear of losing C++ performance while enabling a gradual transition to a more maintainable architecture.
