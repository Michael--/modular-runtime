---
layout: home
hero:
  name: Modular Runtime
  text: Split local monoliths into services without Kubernetes.
  tagline: A pragmatic, local-first runtime with polyglot services and clear contracts.
  actions:
    - theme: brand
      text: Get Started
      link: /guide/overview
    - theme: alt
      text: Demo Scenarios
      link: /guide/demo-scenarios
features:
  - title: Local-first Architecture
    details: Multiple processes on one machine, designed to be restartable and dynamic.
  - title: Polyglot by Design
    details: Mix TypeScript, Rust, Python, Go, and C++ behind stable gRPC contracts.
  - title: Evidence-driven
    details: Measured results show split pipeline with batching reaches 1.75x monolith throughput.
  - title: Performance Proven
    details: Rust optimizations demonstrate 14x parse speedup. Detailed benchmarks and per-service metrics included.
---

# Modular Runtime

This documentation is split into two tracks:

- Runtime track: supervisor, broker, topology stack, and dashboard.
- Demo track: monolith vs split pipeline benchmarks driven by a dedicated orchestrator.

Start with the Guide overview for the overall structure, then drill into demo scenarios and results. For environment setup and CI details, see [Setup & CI](/guide/ci-setup).
