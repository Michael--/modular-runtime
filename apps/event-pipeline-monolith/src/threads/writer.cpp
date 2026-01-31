#include "writer.hpp"

#include <fstream>
#include <iostream>

namespace pipeline {

void writerThread(const std::string& output_file, BlockingQueue<AggregateResult>& input) {
  std::ofstream output(output_file);
  if (!output.is_open()) {
    std::cerr << "Failed to open output file: " << output_file << "\n";
    return;
  }

  AggregateResult result;
  while (input.pop(result)) {
    output << "{\"key\":\"" << result.key << "\",\"count\":" << result.count
           << ",\"sum\":" << result.sum << ",\"avg\":" << result.avg << "}\n";
  }
}

} // namespace pipeline
