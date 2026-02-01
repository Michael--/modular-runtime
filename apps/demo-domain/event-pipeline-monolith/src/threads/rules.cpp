#include "rules.hpp"

namespace pipeline {

void rulesThread(BlockingQueue<ParsedEvent>& input, BlockingQueue<EnrichedEvent>& output, Metrics& metrics) {
  ParsedEvent parsed;
  while (input.pop(parsed)) {
    const bool passed = parsed.value >= 10 && parsed.type != "view";
    if (!passed) {
      metrics.incrementFiltered();
      continue;
    }

    EnrichedEvent enriched;
    enriched.event = std::move(parsed);
    enriched.passed_rules = true;
    enriched.metadata.emplace("rule", "min_value_and_type");

    if (!output.push(std::move(enriched))) {
      break;
    }
  }

  output.close();
}

} // namespace pipeline
