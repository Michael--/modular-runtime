#!/usr/bin/env bash
# Quick setup script for protoc plugins on Linux/macOS

set -e

echo "🔧 Installing protoc plugins..."
echo ""

# Detect OS
OS="$(uname -s)"
case "${OS}" in
    Linux*)     PLATFORM="Linux";;
    Darwin*)    PLATFORM="macOS";;
    *)          PLATFORM="Unknown";;
esac

echo "Platform detected: $PLATFORM"
echo ""

# Check if cargo is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ cargo not found. Please install Rust first:"
    echo "   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    exit 1
fi

# Check if go is installed
if ! command -v go &> /dev/null; then
    echo "❌ go not found. Please install Go first:"
    if [ "$PLATFORM" = "macOS" ]; then
        echo "   brew install go"
    else
        echo "   https://go.dev/dl/"
    fi
    exit 1
fi

echo "✅ Prerequisites found"
echo ""

# Install Rust plugins
echo "📦 Installing Rust plugins..."
cargo install protoc-gen-prost protoc-gen-tonic

echo ""
echo "📦 Installing Go plugins..."
go install google.golang.org/protobuf/cmd/protoc-gen-go@latest
go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest

echo ""
echo "✅ All plugins installed!"
echo ""

# Check which shell config to update
SHELL_CONFIG=""
if [ -n "$BASH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.bashrc"
elif [ -n "$ZSH_VERSION" ]; then
    SHELL_CONFIG="$HOME/.zshrc"
else
    # Fallback
    if [ -f "$HOME/.zshrc" ]; then
        SHELL_CONFIG="$HOME/.zshrc"
    elif [ -f "$HOME/.bashrc" ]; then
        SHELL_CONFIG="$HOME/.bashrc"
    else
        SHELL_CONFIG="$HOME/.profile"
    fi
fi

# Add PATH to shell config if not already present
if ! grep -q 'cargo/bin.*go/bin' "$SHELL_CONFIG" 2>/dev/null; then
    echo "📝 Adding PATH to $SHELL_CONFIG..."
    echo "" >> "$SHELL_CONFIG"
    echo "# Protoc plugins" >> "$SHELL_CONFIG"
    echo 'export PATH=$HOME/.cargo/bin:$HOME/go/bin:$PATH' >> "$SHELL_CONFIG"
    echo "✅ PATH updated in $SHELL_CONFIG"
else
    echo "✅ PATH already configured in $SHELL_CONFIG"
fi

echo ""
echo "🎉 Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Reload your shell: source $SHELL_CONFIG"
echo "  2. Verify installation: cd packages/proto && pnpm run check-plugins"
echo "  3. Generate protobuf code: pnpm gen"
