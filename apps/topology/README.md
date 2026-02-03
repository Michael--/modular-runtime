# Topology Stack

This app bundles the topology gRPC service, the SSE proxy, and the reporter HTTP proxy into a single process.

## Start

```bash
pnpm -C apps/topology build
node dist/topology.js [flags]
```

## Flags

Topology service (gRPC):

- `--address` (default: `127.0.0.1:50053`)
- `--heartbeat-interval-ms` (default: `5000`)
- `--timeout-multiplier` (default: `3`)
- `--idle-timeout-ms` (default: `30000`)
- `--activity-flush-ms` (default: `1000`)
- `--node-update-throttle-ms` (default: `5000`)
- `--sweep-interval-ms` (default: `5000`)

Topology SSE proxy:

- `--topology-proxy-grpc-address` (default: `--address`)
- `--topology-proxy-http-port` (default: `50054`)

Topology reporter proxy:

- `--topology-reporter-topology-address` (default: `--address`)
- `--topology-reporter-http-port` (default: `50055`)

## Example

```bash
node dist/topology.js \
  --address 127.0.0.1:50053 \
  --topology-proxy-http-port 50054 \
  --topology-reporter-http-port 50055
```
