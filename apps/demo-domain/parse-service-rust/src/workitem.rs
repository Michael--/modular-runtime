use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkItem {
    pub id: String,
    pub vectors: Vec<Vector>,
    pub matrix: Matrix,
    pub text: String,
    pub iterations: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Vector {
    pub values: Vec<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Matrix {
    pub rows: Vec<Vector>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessedWorkItem {
    pub id: String,
    pub normalized_vectors: Vec<Vector>,
    pub transposed_matrix: Matrix,
    pub checksum: f64,
}

/// Processes a WorkItem: vector normalization, matrix transpose, CPU work
pub fn process_work_item(item: &WorkItem) -> ProcessedWorkItem {
    // Vector normalization
    let normalized_vectors: Vec<Vector> = item.vectors.iter().map(normalize_vector).collect();

    // Matrix transpose
    let transposed_matrix = transpose_matrix(&item.matrix);

    // CPU-intensive work
    let mut checksum = 0.0;
    for i in 0..item.iterations {
        checksum += compute_checksum(&normalized_vectors, i as f64);
    }

    ProcessedWorkItem {
        id: item.id.clone(),
        normalized_vectors,
        transposed_matrix,
        checksum,
    }
}

/// Normalizes a vector (L2 norm)
fn normalize_vector(vec: &Vector) -> Vector {
    let values = &vec.values;
    let magnitude: f64 = values.iter().map(|v| v * v).sum::<f64>().sqrt();

    if magnitude == 0.0 {
        return Vector {
            values: values.clone(),
        };
    }

    Vector {
        values: values.iter().map(|v| v / magnitude).collect(),
    }
}

/// Transposes a matrix
fn transpose_matrix(matrix: &Matrix) -> Matrix {
    let rows = &matrix.rows;
    if rows.is_empty() {
        return Matrix { rows: vec![] };
    }

    let num_rows = rows.len();
    let num_cols = rows[0].values.len();

    let mut transposed = vec![];
    for col in 0..num_cols {
        let mut new_row = vec![];
        for row in rows.iter().take(num_rows) {
            new_row.push(row.values.get(col).copied().unwrap_or(0.0));
        }
        transposed.push(Vector { values: new_row });
    }

    Matrix { rows: transposed }
}

/// Computes a checksum over normalized vectors (simulates CPU work)
fn compute_checksum(vectors: &[Vector], iteration: f64) -> f64 {
    let mut sum = 0.0;
    for vec in vectors {
        for &v in &vec.values {
            sum += v * (iteration + 1.0) * 0.001;
        }
    }
    sum
}
