#ifndef EVENT_PIPELINE_MONOLITH_WRITER_HPP
#define EVENT_PIPELINE_MONOLITH_WRITER_HPP

#include <string>

#include "../queue.hpp"
#include "../types.hpp"

namespace pipeline {

void writerThread(const std::string& output_file, BlockingQueue<AggregateResult>& input);

} // namespace pipeline

#endif
