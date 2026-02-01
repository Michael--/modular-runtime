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
    
    # Compute eigenvalues (simplified simulation)
    eigenvalues = compute_eigenvalues(normalized_vectors)
    
    # CPU-intensive feature engineering
    # REDUCED iterations for testing: 50 instead of 500
    score = feature_engineering(eigenvalues, checksum, iterations=50)
    
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
    
    eigenvalues = []
    
    for vec_obj in vectors:
        values = vec_obj.get("values", [])
        if not values:
            continue
        
        # Simplified: use variance and mean as pseudo-eigenvalues
        mean = sum(values) / len(values)
        variance = sum((x - mean) ** 2 for x in values) / len(values)
        
        eigenvalues.append(variance)
        eigenvalues.append(mean)
    
    return eigenvalues[:10]  # Limit to 10 eigenvalues


def feature_engineering(eigenvalues: List[float], checksum: float, iterations: int = 50) -> float:
    """
    CPU-intensive feature engineering with iterative computation.
    
    Args:
        eigenvalues: Computed eigenvalues from vectors
        checksum: Checksum from parse service
        iterations: Number of compute iterations (default: 50 for testing)
        
    Returns:
        Computed score
    """
    if not eigenvalues:
        return 0.0
    
    score = 0.0
    eigenvalue_sum = sum(eigenvalues)
    
    # CPU-intensive iterations
    for i in range(iterations):
        # Complex computation pattern
        factor = (i + 1) * 0.01
        score += (eigenvalue_sum + checksum) * factor
        
        # Add some mathematical operations
        for ev in eigenvalues:
            score += math.sin(ev * factor) * 0.1
    
    return score
