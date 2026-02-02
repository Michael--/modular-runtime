# Why Split a Monolith

Large monoliths often hide complexity behind shared state, thread coordination, and manual memory management. The demo pipeline uses a C++ monolith baseline to show what changes when the same work is split into services.

Key motivations:

- Clear boundaries: explicit contracts instead of shared memory and lock-heavy coordination.
- Restartability: services can fail and recover without taking the whole system down.
- Polyglot freedom: use the best language for each stage (Rust for parsing, Python for rules, Go for aggregation, TypeScript for orchestration).
- Gradual migration: split one stage at a time instead of a full rewrite.
- Local-first: multiple processes on a single machine, still dynamic and observable.

The goal is not cloud-native microservices. It is a pragmatic way to decompose a local system while keeping performance competitive.
