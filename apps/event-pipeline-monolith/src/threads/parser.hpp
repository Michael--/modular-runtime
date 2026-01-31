#ifndef EVENT_PIPELINE_MONOLITH_PARSER_HPP
#define EVENT_PIPELINE_MONOLITH_PARSER_HPP

#include <atomic>

#include "../metrics.hpp"
#include "../queue.hpp"
#include "../types.hpp"

namespace pipeline {

void parserThread(
  BlockingQueue<RawEvent>& input,
  BlockingQueue<ParsedEvent>& output,
  Metrics& metrics,
  std::atomic<int>& active_parsers
);

} // namespace pipeline

#endif
