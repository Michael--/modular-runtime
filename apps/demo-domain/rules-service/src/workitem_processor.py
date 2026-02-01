"""WorkItem processing for rules-service"""
import json
import time
from typing import Dict, List, Any


def process_work_item(processed_item: Dict[str, Any]) -> Dict[str, Any]:
    """
    Processes a ProcessedWorkItem from parse service.
    Applies feature engineering and CPU-intensive operations.
    """
    start = time.perf_counter()

    item_id = processed_item.get('id', 'unknown')
    normalized_vectors = processed_item.get('normalizedVectors', [])
    transposed_matrix = processed_item.get('transposedMatrix', {})
    checksum = processed_item.get('checksum', 0.0)

    # Feature engineering: compute statistics
    vector_stats = compute_vector_statistics(normalized_vectors)

    # Matrix operations: compute eigenvalues (simplified)
    matrix_score = compute_matrix_score(transposed_matrix)

    # CPU-intensive iterations
    iterations = 500  # Fixed for now
    enriched_score = 0.0
    for i in range(iterations):
        enriched_score += (checksum + matrix_score + vector_stats['mean']) * (i + 1) * 0.001

    processing_time = (time.perf_counter() - start) * 1000

    return {
        'id': item_id,
        'eigenvalues': vector_stats['values'][:5],  # First 5 values as "eigenvalues"
        'score': enriched_score,
        'processing_time_ms': processing_time
    }


def compute_vector_statistics(vectors: List[Dict[str, List[float]]]) -> Dict[str, Any]:
    """Computes statistics over normalized vectors"""
    all_values = []
    for vec in vectors:
        all_values.extend(vec.get('values', []))

    if not all_values:
        return {'mean': 0.0, 'std': 0.0, 'values': []}

    mean = sum(all_values) / len(all_values)
    variance = sum((x - mean) ** 2 for x in all_values) / len(all_values)
    std = variance ** 0.5

    return {
        'mean': mean,
        'std': std,
        'values': all_values
    }


def compute_matrix_score(matrix: Dict[str, List[Dict[str, List[float]]]]) -> float:
    """Computes a score from matrix (sum of all elements)"""
    rows = matrix.get('rows', [])
    total = 0.0
    for row in rows:
        values = row.get('values', [])
        total += sum(values)
    return total
