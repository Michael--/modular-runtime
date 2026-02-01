#ifndef EVENT_PIPELINE_MONOLITH_COORDINATOR_HPP
#define EVENT_PIPELINE_MONOLITH_COORDINATOR_HPP

#include <cstddef>
#include <string>

#include "metrics.hpp"

namespace pipeline {

struct PipelineConfig {
  std::string input_file;
  std::string output_file;
  std::size_t parser_threads = 0;
  std::size_t queue_size = 0;
};

class PipelineCoordinator {
 public:
  explicit PipelineCoordinator(PipelineConfig config);

  int run(Metrics& metrics);

 private:
  PipelineConfig config_;
};

} // namespace pipeline

#endif
