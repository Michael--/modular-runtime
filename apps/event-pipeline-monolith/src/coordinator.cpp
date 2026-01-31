#include "coordinator.hpp"

#include <atomic>
#include <thread>
#include <vector>

#include "queue.hpp"
#include "threads/aggregator.hpp"
#include "threads/parser.hpp"
#include "threads/reader.hpp"
#include "threads/rules.hpp"
#include "threads/writer.hpp"

namespace pipeline {

PipelineCoordinator::PipelineCoordinator(PipelineConfig config) : config_(std::move(config)) {}

int PipelineCoordinator::run(Metrics& metrics) {
  BlockingQueue<RawEvent> raw_queue(config_.queue_size);
  BlockingQueue<ParsedEvent> parsed_queue(config_.queue_size);
  BlockingQueue<EnrichedEvent> enriched_queue(config_.queue_size);
  BlockingQueue<AggregateResult> result_queue(config_.queue_size);

  std::atomic<int> active_parsers(static_cast<int>(config_.parser_threads));

  metrics.markStart();

  std::thread reader_thread(readerThread, config_.input_file, std::ref(raw_queue), std::ref(metrics));

  std::vector<std::thread> parser_threads;
  parser_threads.reserve(config_.parser_threads);
  for (std::size_t i = 0; i < config_.parser_threads; i += 1) {
    parser_threads.emplace_back(
      parserThread,
      std::ref(raw_queue),
      std::ref(parsed_queue),
      std::ref(metrics),
      std::ref(active_parsers)
    );
  }

  std::thread rules_thread(rulesThread, std::ref(parsed_queue), std::ref(enriched_queue), std::ref(metrics));
  std::thread aggregator_thread(
    aggregatorThread,
    std::ref(enriched_queue),
    std::ref(result_queue),
    std::ref(metrics)
  );
  std::thread writer_thread(writerThread, config_.output_file, std::ref(result_queue));

  reader_thread.join();
  for (auto& thread : parser_threads) {
    thread.join();
  }
  rules_thread.join();
  aggregator_thread.join();
  writer_thread.join();

  metrics.markEnd();
  return 0;
}

} // namespace pipeline
