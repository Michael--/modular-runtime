#!/usr/bin/env bash
# Check if all required protoc plugins are installed

set -e

MISSING=()
PATH="$HOME/.cargo/bin:$HOME/go/bin:$PATH"

echo "🔍 Checking protoc plugins..."

# Check TypeScript plugin (from npm)
if ! command -v protoc-gen-ts_proto &> /dev/null; then
  if [ ! -f "node_modules/.bin/protoc-gen-ts_proto" ]; then
    MISSING+=("protoc-gen-ts_proto (install via: pnpm install)")
  fi
fi

# Check Rust plugins
if ! command -v protoc-gen-prost &> /dev/null; then
  MISSING+=("protoc-gen-prost (install via: cargo install protoc-gen-prost)")
fi

if ! command -v protoc-gen-tonic &> /dev/null; then
  MISSING+=("protoc-gen-tonic (install via: cargo install protoc-gen-tonic)")
fi

# Check Go plugins
if ! command -v protoc-gen-go &> /dev/null; then
  MISSING+=("protoc-gen-go (install via: go install google.golang.org/protobuf/cmd/protoc-gen-go@latest)")
fi

if ! command -v protoc-gen-go-grpc &> /dev/null; then
  MISSING+=("protoc-gen-go-grpc (install via: go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest)")
fi

# Check Python plugins
if ! python3 -c "import grpc_tools.protoc" 2>/dev/null; then
  MISSING+=("grpc_tools (install via: pip3 install --user grpcio-tools protobuf)")
fi

if [ ${#MISSING[@]} -eq 0 ]; then
  echo "✅ All protoc plugins are installed"
  echo ""
  echo "Installed plugins:"
  echo "  protoc-gen-ts_proto: $(command -v protoc-gen-ts_proto 2>/dev/null || echo node_modules/.bin/protoc-gen-ts_proto)"
  echo "  protoc-gen-prost:    $(command -v protoc-gen-prost)"
  echo "  protoc-gen-tonic:    $(command -v protoc-gen-tonic)"
  echo "  protoc-gen-go:       $(command -v protoc-gen-go)"
  echo "  protoc-gen-go-grpc:  $(command -v protoc-gen-go-grpc)"
  echo "  grpc_tools (python): $(python3 -c 'import grpc_tools.protoc; print("installed")' 2>/dev/null || echo "not found")"
  exit 0
else
  echo "❌ Missing protoc plugins:"
  for plugin in "${MISSING[@]}"; do
    echo "  - $plugin"
  done
  echo ""
  echo "Please run the setup commands from CI_SETUP.md"
  echo ""
  echo "Quick setup for Linux/macOS:"
  echo "  cargo install protoc-gen-prost protoc-gen-tonic"
  echo "  go install google.golang.org/protobuf/cmd/protoc-gen-go@latest"
  echo "  go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest"
  echo "  pip3 install --user grpcio-tools protobuf"
  echo ""
  echo "Add to your shell profile (~/.bashrc or ~/.zshrc):"
  echo "  export PATH=\$HOME/.cargo/bin:\$HOME/go/bin:\$PATH"
  exit 1
fi
