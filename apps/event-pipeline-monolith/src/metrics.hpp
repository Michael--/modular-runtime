#ifndef EVENT_PIPELINE_MONOLITH_METRICS_HPP
#define EVENT_PIPELINE_MONOLITH_METRICS_HPP

#include <atomic>
#include <chrono>
#include <cstdint>

namespace pipeline {

struct MetricsSnapshot {
  std::int64_t read_events = 0;
  std::int64_t parsed_events = 0;
  std::int64_t invalid_events = 0;
  std::int64_t filtered_events = 0;
  std::int64_t aggregated_events = 0;
  double throughput_per_sec = 0.0;
  double duration_sec = 0.0;
};

class Metrics {
 public:
  void markStart();
  void markEnd();

  void incrementRead();
  void incrementParsed();
  void incrementInvalid();
  void incrementFiltered();
  void incrementAggregated();

  MetricsSnapshot snapshot() const;

 private:
  std::atomic<std::int64_t> read_events_{0};
  std::atomic<std::int64_t> parsed_events_{0};
  std::atomic<std::int64_t> invalid_events_{0};
  std::atomic<std::int64_t> filtered_events_{0};
  std::atomic<std::int64_t> aggregated_events_{0};
  std::chrono::steady_clock::time_point start_{};
  std::chrono::steady_clock::time_point end_{};
  bool started_ = false;
  bool ended_ = false;
};

} // namespace pipeline

#endif
