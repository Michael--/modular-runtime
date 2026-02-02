# Rust Parse Service Optimization

## Problem

Initial Rust implementation was significantly slower than TypeScript for CPU-bound work-items workload:

- Before: 2,725 items/s (Rust debug) vs 10,700 items/s (TypeScript)
- Parse processing time: 3,351ms for 10k items

## Root Causes

### 1. Debug Build Used by Default

The demo script used `cargo run` without `--release` flag, resulting in unoptimized debug builds with:

- No compiler optimizations
- Debug assertions enabled
- Poor code generation

### 2. Double JSON Parsing

Original code in `parse_event()`:

```rust
let parsed: Value = serde_json::from_str(&event.raw_json).ok()?;
let object = parsed.as_object()?;

if object.contains_key("id") && object.contains_key("vectors") {
  if let Ok(work_item) = serde_json::from_value::<WorkItem>(parsed.clone()) {
    // Process work item
  }
}
```

Issues:

- Parse JSON string → generic `Value`
- Check for WorkItem keys
- Deserialize `Value` → `WorkItem` with **expensive `.clone()`**
- If not WorkItem, continue with `Value`

This meant:

- 2 deserialization passes for WorkItems
- Unnecessary heap allocation from `.clone()`
- Extra traversal for key checking

### 3. Incorrect Measurement Interpretation

Metrics showed "Processing time: 3351ms (97.6%)" but throughput was still poor. The measurement was correct - the implementation was the bottleneck, not the metrics.

## Solutions Applied

### 1. Enable Release Builds

Changed `run-split-pipeline.mjs`:

```diff
- args: ['run', '--manifest-path', 'apps/demo-domain/parse-service-rust/Cargo.toml'],
+ args: ['run', '--release', '--manifest-path', 'apps/demo-domain/parse-service-rust/Cargo.toml'],
```

Impact: Enables `-O3` level optimizations, inlining, dead code elimination.

### 2. Optimize JSON Parsing

New code:

```rust
// Try to parse as WorkItem first (single parse attempt)
if let Ok(work_item) = serde_json::from_str::<WorkItem>(&event.raw_json) {
  let processed = process_work_item(&work_item);
  // ... return result
}

// Fall back to normal event parsing
let parsed: Value = serde_json::from_str(&event.raw_json).ok()?;
let object = parsed.as_object()?;
```

Benefits:

- Single deserialization attempt for WorkItems (fast path)
- No `.clone()` - direct deserialization from string
- Falls back to generic parsing only if WorkItem fails
- Eliminates extra key checking overhead

## Results

### Events Workload (100k, batch=100)

| Metric        | Before   | After     | Improvement |
| ------------- | -------- | --------- | ----------- |
| Throughput    | 76,161/s | 78,927/s  | 1.04x       |
| vs TypeScript | 0.99x    | **1.02x** | Now faster  |

### Work-items Workload (10k, no batching)

| Metric        | Before  | After   | Improvement |
| ------------- | ------- | ------- | ----------- |
| Throughput    | 2,725/s | 7,716/s | **2.83x**   |
| Parse time    | 3,351ms | 238ms   | **14.1x**   |
| vs TypeScript | 0.25x   | 0.72x   | Much closer |

## Key Learnings

1. **Always use release builds for benchmarks** - debug mode can be 10-20x slower
2. **Profile before optimizing** - but understand what metrics mean
3. **Minimize allocations** - `.clone()` on large JSON objects is expensive
4. **Single-pass parsing** - try specific types before falling back to generic
5. **Rust can match or exceed Node.js** - when properly optimized

## Remaining Gap for Work-items

TypeScript still leads work-items by ~40% (10.7k/s vs 7.7k/s). Potential causes:

- IPC overhead differences (Rust tonic vs Node.js gRPC)
- V8's highly optimized JIT for numeric operations
- Additional micro-optimizations possible in Rust

For events workload, the gap is closed and Rust is now slightly faster.
