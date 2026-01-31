#!/usr/bin/env bash
set -euo pipefail

PROTO_ROOT="$(cd "$(dirname "$0")/../../packages/proto" && pwd)"
OUTPUT_DIR="$(cd "$(dirname "$0")/../src" && pwd)"

python -m grpc_tools.protoc \
  -I"${PROTO_ROOT}" \
  --python_out="${OUTPUT_DIR}" \
  --grpc_python_out="${OUTPUT_DIR}" \
  "${PROTO_ROOT}/pipeline/v1/pipeline.proto" \
  "${PROTO_ROOT}/broker/v1/broker.proto"
