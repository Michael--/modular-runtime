# Topology Reporter HTTP Proxy

HTTP proxy for language-agnostic topology reporting.

## Purpose

This proxy provides a simple HTTP/JSON API for services in any language to register with the topology service and report heartbeats/activity without needing gRPC client libraries.

## Architecture

```
┌─────────────┐
│ C++ Client  │──┐
└─────────────┘  │
                 │ HTTP POST
┌─────────────┐  │  (JSON)      ┌──────────────────┐      gRPC       ┌──────────────────┐
│ Rust Client │──┼─────────────>│ Topology Reporter│───────────────> │ Topology Service │
└─────────────┘  │               │  HTTP Proxy      │                 └──────────────────┘
                 │               └──────────────────┘
┌─────────────┐  │               (TypeScript/Node.js)
│ Go Client   │──┘
└─────────────┘
```

## API Endpoints

### POST /register

Registers a service and returns a service ID.

**Request:**

```json
{
  "serviceName": "calculator-client-cpp",
  "serviceType": "SERVICE_TYPE_CLIENT",
  "language": "SERVICE_LANGUAGE_CPP",
  "version": "1.0.0",
  "address": "127.0.0.1:8080",
  "host": "localhost",
  "enableActivity": true
}
```

**Response:**

```json
{
  "serviceId": "550e8400-e29b-41d4-a716-446655440000",
  "heartbeatIntervalMs": 5000
}
```

### POST /heartbeat

Manual heartbeat trigger (normally automatic via internal timer).

**Request:**

```json
{
  "serviceId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**

```json
{
  "status": "ok"
}
```

### POST /activity

Reports activity for a service interaction.

**Request:**

```json
{
  "serviceId": "550e8400-e29b-41d4-a716-446655440000",
  "targetService": "calculator-server",
  "type": "ACTIVITY_TYPE_REQUEST",
  "latencyMs": 42,
  "method": "Calculate",
  "success": true
}
```

**Response:**

```json
{
  "status": "ok"
}
```

### POST /unregister

Unregisters a service.

**Request:**

```json
{
  "serviceId": "550e8400-e29b-41d4-a716-446655440000"
}
```

**Response:**

```json
{
  "status": "ok"
}
```

### POST /health

Health check endpoint.

**Response:**

```json
{
  "status": "healthy",
  "services": 3
}
```

## Usage

### Start the proxy

```bash
pnpm run start

# or with custom parameters
node dist/topology-reporter-proxy.js --topology-address 127.0.0.1:50053 --http-port 50055
```

### Client Example (cURL)

```bash
# Register service
curl -X POST http://localhost:50055/register \
  -H "Content-Type: application/json" \
  -d '{
    "serviceName": "my-service",
    "serviceType": "SERVICE_TYPE_CLIENT",
    "language": "SERVICE_LANGUAGE_CPP"
  }'

# Report activity
curl -X POST http://localhost:50055/activity \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "YOUR_SERVICE_ID",
    "targetService": "calculator-server",
    "type": "ACTIVITY_TYPE_REQUEST",
    "latencyMs": 42,
    "success": true
  }'

# Unregister
curl -X POST http://localhost:50055/unregister \
  -H "Content-Type: application/json" \
  -d '{"serviceId": "YOUR_SERVICE_ID"}'
```

## Configuration

- `--topology-address`: gRPC address of the topology service (default: `127.0.0.1:50053`)
- `--http-port`: HTTP port for the proxy server (default: `50055`)

## Benefits

✅ **No gRPC dependencies** in client languages  
✅ **Simple HTTP POST** - works everywhere  
✅ **Automatic heartbeats** - managed by proxy  
✅ **Language-agnostic** - C++, Rust, Go, Python, etc.  
✅ **Reuses existing TypeScript implementation**

## Service Types

- `SERVICE_TYPE_SERVER`
- `SERVICE_TYPE_CLIENT`
- `SERVICE_TYPE_HYBRID`

## Languages

- `SERVICE_LANGUAGE_TYPESCRIPT`
- `SERVICE_LANGUAGE_RUST`
- `SERVICE_LANGUAGE_GO`
- `SERVICE_LANGUAGE_CPP`
- `SERVICE_LANGUAGE_PYTHON`
- `SERVICE_LANGUAGE_JAVA`

## Activity Types

- `ACTIVITY_TYPE_REQUEST`
- `ACTIVITY_TYPE_RESPONSE`
- `ACTIVITY_TYPE_ERROR`
