# Setup & CI

The setup is intentionally more extensive because this repo exercises multiple languages beyond JavaScript (Rust, Go, Python, and optionally C++). That extra tooling overhead is required to prove the polyglot concept.

## Quick Start (macOS/Linux)

```bash
./setup-protoc-plugins.sh
pnpm -C packages/proto run check-plugins
```

If anything is missing, follow the full instructions in `CI_SETUP.md`.

## Platform Support

- Development and builds are verified on macOS and Linux.
- Windows has not been fully tested yet.

## CI Pipeline Script

Run the CI script locally with:

```bash
pnpm run ci
```

This executes the same pipeline CI uses:

- Clean (optional)
- Generate protobuf code
- Build all packages
- Typecheck
- Lint
- Unit tests
- E2E tests (optional)

Integration tests only run when `RUN_INTEGRATION_TESTS=true` is set.

## Full Setup Guide

For per-OS install commands, PATH notes, and Docker examples, see `CI_SETUP.md`.
For a fast plugin sanity check, use `packages/proto/check-plugins.sh`.
