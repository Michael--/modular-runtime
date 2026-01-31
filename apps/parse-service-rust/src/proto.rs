// Generated files are produced via `pnpm -C packages/proto gen`.
// The prost and tonic plugins write into the same files.

pub mod broker {
  pub mod v1 {
    include!(concat!(
      env!("CARGO_MANIFEST_DIR"),
      "/../../packages/proto/generated/rust/broker.v1.rs"
    ));
  }
}

pub mod pipeline {
  pub mod v1 {
    include!(concat!(
      env!("CARGO_MANIFEST_DIR"),
      "/../../packages/proto/generated/rust/pipeline.v1.rs"
    ));
  }
}
