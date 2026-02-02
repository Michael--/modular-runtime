package main

import (
	"encoding/json"
	"math"
)

type EnrichedWorkItem struct {
	ID          string    `json:"id"`
	Eigenvalues []float64 `json:"eigenvalues"`
	Score       float64   `json:"score"`
}

type WorkItemResult struct {
	ID             string  `json:"id"`
	FinalScore     float64 `json:"final_score"`
	ProcessedCount int64   `json:"processed_count"`
}

// processEnrichedWorkItem processes an EnrichedWorkItem from rules service
func processEnrichedWorkItem(enrichedJSON string) (*WorkItemResult, error) {
	var item EnrichedWorkItem
	if err := json.Unmarshal([]byte(enrichedJSON), &item); err != nil {
		return nil, err
	}

	// Compute dot products from eigenvalues
	dotProducts := make([]float64, 0)
	for i := 0; i < len(item.Eigenvalues)-1; i++ {
		dp := item.Eigenvalues[i] * item.Eigenvalues[i+1]
		dotProducts = append(dotProducts, dp)
	}

	// Sum of eigenvalues
	eigenSum := 0.0
	for _, val := range item.Eigenvalues {
		eigenSum += val
	}

	// CPU-intensive iterations
	finalScore := 0.0
	iterations := 50
	for i := 0; i < iterations; i++ {
		finalScore += (item.Score + eigenSum) * float64(i+1) * 0.001
	}

	// Add dot product contribution
	for _, dp := range dotProducts {
		finalScore += math.Abs(dp) * 0.1
	}

	return &WorkItemResult{
		ID:             item.ID,
		FinalScore:     finalScore,
		ProcessedCount: 1,
	}, nil
}
