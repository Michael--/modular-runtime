# modular-runtime

Modular, polyglot services for breaking down large local monoliths — without Kubernetes or cloud infrastructure.  
Designed to work together inside embedded environments.

## Motivation

This project explores a pragmatic way to decompose large, long-lived monolithic applications into smaller, independent services.

The focus is **not** on cloud-native microservices, but on:

- multiple processes on a single machine
- clear service boundaries instead of shared memory
- gradual decomposition instead of big rewrites
- polyglot services where C++ is no longer required everywhere

Everything may run on one CPU, locally, but remains fully dynamic:
services can start, stop, or restart at any time without bringing down the system.

## Core ideas

- **Service-oriented, not thread-oriented**  
  Modules communicate via explicit contracts instead of shared state.

- **Local-first, distributed-capable**  
  Designed for local and embedded setups, but not limited to a single process.

- **Polyglot by design**  
  Services can be implemented in different languages as long as they speak the same protocol.

- **Dynamic by default**  
  No service is assumed to be always present or always alive.

## Architecture (high level)

The runtime is built around a small set of core components:

- **Starter / Supervisor**  
  Launches and supervises all processes (broker, services, bridges).

- **Broker / Registry**  
  Service discovery, lookup, and change notifications.

- **Bridges (optional)**  
  Interposed services (e.g. logging, tracing) that can transparently sit between clients and services.

Everything else — concrete services, clients, UIs — is optional and example-driven.

## Scope

This repository is:

- an exploration
- a reference implementation
- a collection of examples

It is **not** a replacement for Kubernetes, service meshes, or full cloud infrastructure.

## Status

Early stage.  
Structure, tooling, and examples are evolving.

## Platform Support

- Verified and supported: **macOS**, **Linux**
- Experimental and currently unverified: **Windows**

Windows instructions exist as a starting point, but they are not validated end-to-end and may require manual rework.

## Setup

### First-time Setup

Install required protobuf code generators:

```bash
./setup-protoc-plugins.sh
```

For detailed setup instructions and CI configuration, see [CI_SETUP.md](CI_SETUP.md).

### Build

```bash
pnpm install
pnpm gen      # Generate protobuf code
pnpm build    # Build all packages
```

## License

TBD
