#include "reader.hpp"

#include <fstream>
#include <iostream>

namespace pipeline {

void readerThread(const std::string& input_file, BlockingQueue<RawEvent>& output, Metrics& metrics) {
  std::ifstream input(input_file);
  if (!input.is_open()) {
    std::cerr << "Failed to open input file: " << input_file << "\n";
    output.close();
    return;
  }

  std::string line;
  std::int64_t sequence = 0;
  while (std::getline(input, line)) {
    RawEvent event{line, sequence};
    if (!output.push(std::move(event))) {
      break;
    }
    metrics.incrementRead();
    sequence += 1;
  }

  output.close();
}

} // namespace pipeline
