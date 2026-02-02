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
    details: Demo scenarios and measured results show batching can beat monolith throughput.
---

# Modular Runtime

This documentation is split into two tracks:

- Practical rationale for splitting into services and how the runtime is structured.
- A concrete example implementation that shows the broker, supervisor, and pipeline services working together.

Start with the Guide overview for the overall structure and then drill into the demo scenarios and results.
