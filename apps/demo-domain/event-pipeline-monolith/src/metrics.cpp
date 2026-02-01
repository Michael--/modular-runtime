#include "metrics.hpp"

namespace pipeline
{

  void Metrics::markStart()
  {
    start_ = std::chrono::steady_clock::now();
    started_ = true;
  }

  void Metrics::markEnd()
  {
    end_ = std::chrono::steady_clock::now();
    ended_ = true;
  }

  void Metrics::incrementRead()
  {
    read_events_.fetch_add(1, std::memory_order_relaxed);
  }

  void Metrics::incrementParsed()
  {
    parsed_events_.fetch_add(1, std::memory_order_relaxed);
  }

  void Metrics::incrementInvalid()
  {
    invalid_events_.fetch_add(1, std::memory_order_relaxed);
  }

  void Metrics::incrementFiltered()
  {
    filtered_events_.fetch_add(1, std::memory_order_relaxed);
  }

  void Metrics::incrementAggregated()
  {
    aggregated_events_.fetch_add(1, std::memory_order_relaxed);
  }

  void Metrics::addReaderProcessing(double ms)
  {
    reader_processing_us_.fetch_add(static_cast<std::int64_t>(ms * 1000), std::memory_order_relaxed);
  }

  void Metrics::addParserProcessing(double ms)
  {
    parser_processing_us_.fetch_add(static_cast<std::int64_t>(ms * 1000), std::memory_order_relaxed);
  }

  void Metrics::addRulesProcessing(double ms)
  {
    rules_processing_us_.fetch_add(static_cast<std::int64_t>(ms * 1000), std::memory_order_relaxed);
  }

  void Metrics::addAggregatorProcessing(double ms)
  {
    aggregator_processing_us_.fetch_add(static_cast<std::int64_t>(ms * 1000), std::memory_order_relaxed);
  }

  void Metrics::addWriterProcessing(double ms)
  {
    writer_processing_us_.fetch_add(static_cast<std::int64_t>(ms * 1000), std::memory_order_relaxed);
  }

  void Metrics::addQueueOverhead(double ms)
  {
    queue_overhead_us_.fetch_add(static_cast<std::int64_t>(ms * 1000), std::memory_order_relaxed);
  }

  MetricsSnapshot Metrics::snapshot() const
  {
    MetricsSnapshot snapshot;
    snapshot.read_events = read_events_.load(std::memory_order_relaxed);
    snapshot.parsed_events = parsed_events_.load(std::memory_order_relaxed);
    snapshot.invalid_events = invalid_events_.load(std::memory_order_relaxed);
    snapshot.filtered_events = filtered_events_.load(std::memory_order_relaxed);
    snapshot.aggregated_events = aggregated_events_.load(std::memory_order_relaxed);
    snapshot.reader_processing_ms = reader_processing_us_.load(std::memory_order_relaxed) / 1000.0;
    snapshot.parser_processing_ms = parser_processing_us_.load(std::memory_order_relaxed) / 1000.0;
    snapshot.rules_processing_ms = rules_processing_us_.load(std::memory_order_relaxed) / 1000.0;
    snapshot.aggregator_processing_ms = aggregator_processing_us_.load(std::memory_order_relaxed) / 1000.0;
    snapshot.writer_processing_ms = writer_processing_us_.load(std::memory_order_relaxed) / 1000.0;
    snapshot.queue_overhead_ms = queue_overhead_us_.load(std::memory_order_relaxed) / 1000.0;

    if (started_ && ended_)
    {
      const auto duration = std::chrono::duration_cast<std::chrono::duration<double>>(end_ - start_);
      snapshot.duration_sec = duration.count();
      if (snapshot.duration_sec > 0.0)
      {
        snapshot.throughput_per_sec = snapshot.aggregated_events / snapshot.duration_sec;
      }
    }

    return snapshot;
  }

} // namespace pipeline
