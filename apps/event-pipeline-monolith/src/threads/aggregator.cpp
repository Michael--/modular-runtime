#include "aggregator.hpp"

#include <unordered_map>

namespace pipeline {

namespace {

struct AggregateStats {
  std::int64_t count = 0;
  std::int64_t sum = 0;
};

} // namespace

void aggregatorThread(
  BlockingQueue<EnrichedEvent>& input,
  BlockingQueue<AggregateResult>& output,
  Metrics& metrics
) {
  std::unordered_map<std::string, AggregateStats> stats;

  EnrichedEvent enriched;
  while (input.pop(enriched)) {
    if (!enriched.passed_rules) {
      continue;
    }
    auto& entry = stats[enriched.event.type];
    entry.count += 1;
    entry.sum += enriched.event.value;
    metrics.incrementAggregated();
  }

  for (const auto& [key, value] : stats) {
    AggregateResult result;
    result.key = key;
    result.count = value.count;
    result.sum = value.sum;
    result.avg = value.count == 0 ? 0.0 : static_cast<double>(value.sum) / value.count;
    if (!output.push(std::move(result))) {
      break;
    }
  }

  output.close();
}

} // namespace pipeline
