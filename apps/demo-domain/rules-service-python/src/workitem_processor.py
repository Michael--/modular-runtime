"""
Processes WorkItems for compute-heavy workloads.
Performs eigenvalue computation and feature engineering.
"""

import math
from typing import Dict, List, Any


def process_work_item(processed_item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a ProcessedWorkItem from parse-service (Rust).
    Performs eigenvalue simulation and feature engineering.

    Args:
        processed_item: ProcessedWorkItem with normalized vectors and transposed matrix

    Returns:
        EnrichedWorkItem with eigenvalues and computed score
    """
    work_item_id = processed_item.get("id", "unknown")
    normalized_vectors = processed_item.get("normalized_vectors", [])
    checksum = processed_item.get("checksum", 0)
    transposed_matrix = processed_item.get("transposed_matrix", {})

    # Compute eigenvalues (simplified simulation)
    eigenvalues = compute_eigenvalues(normalized_vectors)

    # Compute matrix score
    matrix_score = 0.0
    if "rows" in transposed_matrix:
        for row in transposed_matrix["rows"]:
            if "values" in row:
                matrix_score += sum(row["values"])

    # Compute mean of all values
    all_values = []
    for vec_obj in normalized_vectors:
        values = vec_obj.get("values", [])
        all_values.extend(values)
    mean = sum(all_values) / len(all_values) if all_values else 0.0

    # CPU-intensive feature engineering
    score = feature_engineering(eigenvalues, checksum, matrix_score, mean, iterations=500)

    return {
        "id": work_item_id,
        "eigenvalues": eigenvalues,
        "score": score,
        "processing_time_ms": 0  # Could add timing if needed
    }


def compute_eigenvalues(vectors: List[Dict[str, List[float]]]) -> List[float]:
    """
    Simplified eigenvalue computation.
    In reality, this would use numpy.linalg.eig on the matrix.
    """
    if not vectors:
        return []

    all_values = []
    for vec_obj in vectors:
        values = vec_obj.get("values", [])
        all_values.extend(values)

    return all_values[:5]  # Use first 5 values as eigenvalues


def feature_engineering(eigenvalues: List[float], checksum: float, matrix_score: float, mean: float, iterations: int = 500) -> float:
    """
    CPU-intensive feature engineering with iterative computation.

    Args:
        eigenvalues: Computed eigenvalues from vectors
        checksum: Checksum from parse service
        matrix_score: Score from transposed matrix
        mean: Mean of all vector values
        iterations: Number of compute iterations (default: 500)

    Returns:
        Computed score
    """
    score = 0.0

    # CPU-intensive iterations
    for i in range(iterations):
        score += (checksum + matrix_score + mean) * (i + 1) * 0.001

    return score
