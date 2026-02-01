#ifndef EVENT_PIPELINE_MONOLITH_RULES_HPP
#define EVENT_PIPELINE_MONOLITH_RULES_HPP

#include "../metrics.hpp"
#include "../queue.hpp"
#include "../types.hpp"

namespace pipeline {

void rulesThread(BlockingQueue<ParsedEvent>& input, BlockingQueue<EnrichedEvent>& output, Metrics& metrics);

} // namespace pipeline

#endif
