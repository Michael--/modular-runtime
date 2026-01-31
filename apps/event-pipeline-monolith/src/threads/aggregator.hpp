#ifndef EVENT_PIPELINE_MONOLITH_AGGREGATOR_HPP
#define EVENT_PIPELINE_MONOLITH_AGGREGATOR_HPP

#include "../metrics.hpp"
#include "../queue.hpp"
#include "../types.hpp"

namespace pipeline {

void aggregatorThread(
  BlockingQueue<EnrichedEvent>& input,
  BlockingQueue<AggregateResult>& output,
  Metrics& metrics
);

} // namespace pipeline

#endif
