#ifndef EVENT_PIPELINE_MONOLITH_METRICS_HPP
#define EVENT_PIPELINE_MONOLITH_METRICS_HPP

#include <atomic>
#include <chrono>
#include <cstdint>

namespace pipeline
{

  struct MetricsSnapshot
  {
    std::int64_t read_events = 0;
    std::int64_t parsed_events = 0;
    std::int64_t invalid_events = 0;
    std::int64_t filtered_events = 0;
    std::int64_t aggregated_events = 0;
    double throughput_per_sec = 0.0;
    double duration_sec = 0.0;
    double reader_processing_ms = 0.0;
    double parser_processing_ms = 0.0;
    double rules_processing_ms = 0.0;
    double aggregator_processing_ms = 0.0;
    double writer_processing_ms = 0.0;
    double queue_overhead_ms = 0.0;
  };

  class Metrics
  {
  public:
    void markStart();
    void markEnd();

    void incrementRead();
    void incrementParsed();
    void incrementInvalid();
    void incrementFiltered();
    void incrementAggregated();

    void addReaderProcessing(double ms);
    void addParserProcessing(double ms);
    void addRulesProcessing(double ms);
    void addAggregatorProcessing(double ms);
    void addWriterProcessing(double ms);
    void addQueueOverhead(double ms);

    MetricsSnapshot snapshot() const;

  private:
    std::atomic<std::int64_t> read_events_{0};
    std::atomic<std::int64_t> parsed_events_{0};
    std::atomic<std::int64_t> invalid_events_{0};
    std::atomic<std::int64_t> filtered_events_{0};
    std::atomic<std::int64_t> aggregated_events_{0};
    std::atomic<std::int64_t> reader_processing_us_{0};
    std::atomic<std::int64_t> parser_processing_us_{0};
    std::atomic<std::int64_t> rules_processing_us_{0};
    std::atomic<std::int64_t> aggregator_processing_us_{0};
    std::atomic<std::int64_t> writer_processing_us_{0};
    std::atomic<std::int64_t> queue_overhead_us_{0};
    std::chrono::steady_clock::time_point start_{};
    std::chrono::steady_clock::time_point end_{};
    bool started_ = false;
    bool ended_ = false;
  };

} // namespace pipeline

#endif
