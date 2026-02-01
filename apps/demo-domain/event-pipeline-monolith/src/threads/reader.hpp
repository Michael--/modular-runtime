#ifndef EVENT_PIPELINE_MONOLITH_READER_HPP
#define EVENT_PIPELINE_MONOLITH_READER_HPP

#include <string>

#include "../metrics.hpp"
#include "../queue.hpp"
#include "../types.hpp"

namespace pipeline {

void readerThread(const std::string& input_file, BlockingQueue<RawEvent>& output, Metrics& metrics);

} // namespace pipeline

#endif
