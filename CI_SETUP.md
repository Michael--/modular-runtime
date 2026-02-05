# CI Setup Guide

## Overview

Protocol buffer code generation uses a **hybrid approach**:

- **TypeScript**: Remote plugin (no CI installation needed)
- **Rust/Go**: Local plugins (require installation on CI)

## Required CI Dependencies

### Linux (Ubuntu/Debian)

```bash
# Install protoc compiler
sudo apt-get update
sudo apt-get install -y protobuf-compiler

# Install Rust plugins
cargo install protoc-gen-prost protoc-gen-tonic

# Install Go plugins
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Ensure Go bin is in PATH
export PATH=$PATH:$HOME/go/bin
```

### macOS

```bash
# Install protoc
brew install protobuf

# Install Rust plugins
cargo install protoc-gen-prost protoc-gen-tonic

# Install Go plugins
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Ensure Go bin is in PATH
export PATH=$PATH:$HOME/go/bin
```

### Windows

```powershell
# Install protoc via chocolatey
choco install protoc

# Install Rust plugins
cargo install protoc-gen-prost protoc-gen-tonic

# Install Go plugins
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Add Go bin to PATH
$env:PATH += ";$env:USERPROFILE\go\bin"
```

## CI Pipeline Example (GitHub Actions)

```yaml
name: Build

on: [push, pull_request]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - uses: actions/setup-go@v5
        with:
          go-version: '1.21'

      - uses: dtolnay/rust-toolchain@stable

      - name: Install buf CLI
        run: |
          curl -sSL https://github.com/bufbuild/buf/releases/download/v1.28.1/buf-Linux-x86_64 -o /usr/local/bin/buf
          chmod +x /usr/local/bin/buf

      - name: Install protoc plugins
        run: |
          cargo install protoc-gen-prost protoc-gen-tonic
          go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
          go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest
          echo "$HOME/go/bin" >> $GITHUB_PATH

      - name: Install pnpm
        run: npm install -g pnpm

      - name: Install dependencies
        run: pnpm install

      - name: Generate protobuf code
        run: pnpm -C packages/proto gen

      - name: Build all packages
        run: pnpm build
```

## Dockerfile Example

```dockerfile
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    protobuf-compiler \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install Rust
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

# Install Go
RUN curl -OL https://go.dev/dl/go1.21.0.linux-amd64.tar.gz \
    && tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz \
    && rm go1.21.0.linux-amd64.tar.gz
ENV PATH="/usr/local/go/bin:/root/go/bin:${PATH}"

# Install buf
RUN curl -sSL https://github.com/bufbuild/buf/releases/download/v1.28.1/buf-Linux-x86_64 -o /usr/local/bin/buf \
    && chmod +x /usr/local/bin/buf

# Install protoc plugins
RUN cargo install protoc-gen-prost protoc-gen-tonic && \
    go install google.golang.org/protobuf/cmd/protoc-gen-go@latest && \
    go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app
COPY . .

RUN pnpm install && pnpm -C packages/proto gen && pnpm build
```

## Alternative: Docker-Based Code Generation

To avoid CI dependency installation completely, use a Docker container for proto generation:

```bash
# Run code generation in Docker
docker run --rm -v $(pwd):/workspace -w /workspace \
  bufbuild/buf:latest generate
```

This requires adjusting `buf.gen.yaml` to use only remote plugins (TypeScript only currently compatible).
