# CI Setup Guide

## Overview

Protocol buffer code generation uses **local plugins only** to avoid rate-limits and ensure consistent behavior across all environments.

**Required languages:** TypeScript, Rust, Go  
**Optional:** Python (only if you build Python services)

## One-Command Setup (Linux/macOS)

```bash
# From project root
./setup-protoc-plugins.sh
```

This script will:

- Install all required Rust and Go plugins
- Configure your PATH automatically
- Verify the installation

## Quick Setup Check

Before running builds, verify all plugins are installed:

```bash
cd packages/proto
pnpm run check-plugins
```

This will tell you exactly which plugins are missing.

## Required CI Dependencies

### Linux (Ubuntu/Debian)

```bash
# Install protoc compiler (not strictly required for buf, but good to have)
sudo apt-get update
sudo apt-get install -y protobuf-compiler

# Install Python pip (required for Python services only)
sudo apt-get install -y python3-pip

# Install Rust plugins (installs to ~/.cargo/bin)
cargo install protoc-gen-prost protoc-gen-tonic

# Install Go plugins (installs to ~/go/bin)
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Install Python plugins (OPTIONAL - only needed for Python services)
# Use system packages to avoid externally-managed-environment error
sudo apt-get install -y python3-grpc-tools python3-protobuf

# Optional: For Python type stubs (.pyi files), also install:
# sudo apt-get install -y python3-mypy-protobuf
# (or use pip in a venv if not available as package)

# Add to ~/.bashrc for persistent PATH (REQUIRED for SSH sessions)
echo 'export PATH=$HOME/.cargo/bin:$HOME/go/bin:$PATH' >> ~/.bashrc
source ~/.bashrc

# Verify installation
cd packages/proto && pnpm run check-plugins

# TypeScript plugin is installed via npm (ts-proto in package.json)
```

**Important for CI/SSH:** The PATH must be set in `~/.bashrc` (or `~/.profile`) to work in non-interactive SSH sessions.

### macOS

```bash
# Install protoc
brew install protobuf

# Install Rust plugins (installs to ~/.cargo/bin)
cargo install protoc-gen-prost protoc-gen-tonic

# Install Go plugins (installs to ~/go/bin)
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Install Python plugins (OPTIONAL - only needed for Python services)
pip3 install --user grpcio-tools protobuf

# Add to ~/.zshrc for persistent PATH
echo 'export PATH=$HOME/.cargo/bin:$HOME/go/bin:$PATH' >> ~/.zshrc
source ~/.zshrc

# Verify installation
cd packages/proto && pnpm run check-plugins

# TypeScript plugin is installed via npm (ts-proto in package.json)
```

### Windows

```powershell
# Install protoc via chocolatey
choco install protoc

# Install Rust plugins (installs to %USERPROFILE%\.cargo\bin)
cargo install protoc-gen-prost protoc-gen-tonic

# Install Go plugins (installs to %USERPROFILE%\go\bin)
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

# Install Python plugins (OPTIONAL - only needed for Python services)
# Use pip normally on Windows
pip3 install --user grpcio-tools protobuf

# Add cargo and go bins to PATH
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\go\bin;$env:PATH"

# TypeScript plugin is installed via npm (ts-proto in package.json)
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
          echo "$HOME/.cargo/bin" >> $GITHUB_PATH
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

For isolated builds, use a Docker container with all tools pre-installed:

```dockerfile
FROM node:20-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
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

RUN pnpm install && pnpm gen && pnpm build
```

## Notes

- **No remote plugins**: All code generation happens locally, avoiding rate-limits
- **TypeScript**: Uses `ts-proto` npm package (installed via `package.json`)
- **Rust/Go/Python**: Requires one-time installation of compiler plugins
- **Parallel builds**: Local plugins support unlimited parallel generation

## Troubleshooting

### "executable file not found in $PATH"

If you see errors like `exec: "protoc-gen-prost": executable file not found in $PATH`:

1. **Verify installation locations:**

   ```bash
   # Check Rust plugins
   ls -la ~/.cargo/bin/protoc-gen-*

   # Check Go plugins
   ls -la ~/go/bin/protoc-gen-*

   # Check Python module
   python3 -c "import grpc_tools.protoc; print('OK')"
   ```

2. **Verify PATH in your shell profile:**

   ```bash
   # Add to ~/.bashrc or ~/.zshrc for persistent PATH
   export PATH=$HOME/.cargo/bin:$HOME/go/bin:$PATH

   # Then reload
   source ~/.bashrc  # or source ~/.zshrc
   ```

3. **Test manually:**

   ```bash
   # This should print plugin info or version
   protoc-gen-prost --version
   protoc-gen-go --version
   python3 -m grpc_tools.protoc --version
   ```

4. **For SSH sessions:** Make sure your `.bashrc` or `.zshrc` is loaded for non-interactive shells:
   ```bash
   # Add to ~/.bashrc or ~/.zshrc
   export PATH=$HOME/.cargo/bin:$HOME/go/bin:$PATH
   ```

### Python "ModuleNotFoundError: No module named 'grpc_tools'"

If you see Python import errors:

```bash
# On Debian/Ubuntu (recommended - avoids externally-managed-environment)
sudo apt-get install python3-grpc-tools python3-protobuf

# On macOS or other systems
pip3 install --user grpcio-tools protobuf

# Verify installation
python3 -c "import grpc_tools.protoc; print('OK')"
```

### Python "externally-managed-environment" error

On modern Debian/Ubuntu (Python 3.11+), use system packages instead of pip:

```bash
sudo apt-get install python3-grpc-tools python3-protobuf
```

Alternatively, create a virtual environment (not recommended for CI):

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install grpcio-tools protobuf
```
