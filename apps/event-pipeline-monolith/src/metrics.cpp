#include "metrics.hpp"

namespace pipeline {

void Metrics::markStart() {
  start_ = std::chrono::steady_clock::now();
  started_ = true;
}

void Metrics::markEnd() {
  end_ = std::chrono::steady_clock::now();
  ended_ = true;
}

void Metrics::incrementRead() {
  read_events_.fetch_add(1, std::memory_order_relaxed);
}

void Metrics::incrementParsed() {
  parsed_events_.fetch_add(1, std::memory_order_relaxed);
}

void Metrics::incrementInvalid() {
  invalid_events_.fetch_add(1, std::memory_order_relaxed);
}

void Metrics::incrementFiltered() {
  filtered_events_.fetch_add(1, std::memory_order_relaxed);
}

void Metrics::incrementAggregated() {
  aggregated_events_.fetch_add(1, std::memory_order_relaxed);
}

MetricsSnapshot Metrics::snapshot() const {
  MetricsSnapshot snapshot;
  snapshot.read_events = read_events_.load(std::memory_order_relaxed);
  snapshot.parsed_events = parsed_events_.load(std::memory_order_relaxed);
  snapshot.invalid_events = invalid_events_.load(std::memory_order_relaxed);
  snapshot.filtered_events = filtered_events_.load(std::memory_order_relaxed);
  snapshot.aggregated_events = aggregated_events_.load(std::memory_order_relaxed);

  if (started_ && ended_) {
    const auto duration = std::chrono::duration_cast<std::chrono::duration<double>>(end_ - start_);
    snapshot.duration_sec = duration.count();
    if (snapshot.duration_sec > 0.0) {
      snapshot.throughput_per_sec = snapshot.aggregated_events / snapshot.duration_sec;
    }
  }

  return snapshot;
}

} // namespace pipeline
