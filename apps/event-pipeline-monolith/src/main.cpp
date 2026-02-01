#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

#include "coordinator.hpp"
#include "metrics.hpp"

namespace
{

  void printUsage()
  {
    std::cout
        << "Usage: event-pipeline-monolith --input <file> [options]\n\n"
        << "Options:\n"
        << "  --input <file>       NDJSON input file\n"
        << "  --output <file>      Output file (default: aggregate-results.ndjson)\n"
        << "  --workers <number>   Parser worker threads (default: CPU count)\n"
        << "  --queue-size <num>   Max queue size per stage (default: 10000)\n"
        << "  -h, --help           Show this help message\n";
  }

  bool parseSize(const std::string &value, std::size_t &out)
  {
    char *end = nullptr;
    const long long parsed = std::strtoll(value.c_str(), &end, 10);
    if (end == value.c_str() || parsed <= 0)
    {
      return false;
    }
    out = static_cast<std::size_t>(parsed);
    return true;
  }

  bool parseArguments(int argc, char **argv, pipeline::PipelineConfig &config, std::string &error)
  {
    for (int i = 1; i < argc; i += 1)
    {
      const std::string arg = argv[i];

      if (arg == "--help" || arg == "-h")
      {
        printUsage();
        std::exit(0);
      }

      if (arg == "--input")
      {
        if (i + 1 >= argc)
        {
          error = "Missing value for --input";
          return false;
        }
        config.input_file = argv[i + 1];
        i += 1;
        continue;
      }

      if (arg == "--output")
      {
        if (i + 1 >= argc)
        {
          error = "Missing value for --output";
          return false;
        }
        config.output_file = argv[i + 1];
        i += 1;
        continue;
      }

      if (arg == "--workers")
      {
        if (i + 1 >= argc)
        {
          error = "Missing value for --workers";
          return false;
        }
        std::size_t workers = 0;
        if (!parseSize(argv[i + 1], workers))
        {
          error = "Invalid value for --workers";
          return false;
        }
        config.parser_threads = workers;
        i += 1;
        continue;
      }

      if (arg == "--queue-size")
      {
        if (i + 1 >= argc)
        {
          error = "Missing value for --queue-size";
          return false;
        }
        std::size_t size = 0;
        if (!parseSize(argv[i + 1], size))
        {
          error = "Invalid value for --queue-size";
          return false;
        }
        config.queue_size = size;
        i += 1;
        continue;
      }

      error = "Unknown argument: " + arg;
      return false;
    }

    if (config.input_file.empty())
    {
      error = "Input file is required";
      return false;
    }

    return true;
  }

} // namespace

int main(int argc, char **argv)
{
  pipeline::PipelineConfig config;
  config.output_file = "aggregate-results.ndjson";
  config.queue_size = 10000;

  const unsigned int hardware_threads = std::thread::hardware_concurrency();
  config.parser_threads = hardware_threads > 0 ? hardware_threads : 4;

  std::string error;
  if (!parseArguments(argc, argv, config, error))
  {
    std::cerr << error << "\n\n";
    printUsage();
    return 1;
  }

  pipeline::Metrics metrics;
  pipeline::PipelineCoordinator coordinator(config);
  const int result = coordinator.run(metrics);

  const pipeline::MetricsSnapshot snapshot = metrics.snapshot();
  const double total_processing = snapshot.reader_processing_ms + snapshot.parser_processing_ms +
                                  snapshot.rules_processing_ms + snapshot.aggregator_processing_ms +
                                  snapshot.writer_processing_ms;
  const double total_measured = total_processing + snapshot.queue_overhead_ms;

  std::cout << "\n=== Monolith Performance ===\n"
            << "Processed: " << snapshot.aggregated_events << " events\n"
            << "Invalid: " << snapshot.invalid_events << " events\n"
            << "Filtered: " << snapshot.filtered_events << " events\n"
            << "Duration: " << snapshot.duration_sec << " sec\n"
            << "Throughput: " << snapshot.throughput_per_sec << " events/sec\n";

  if (total_measured > 0)
  {
    std::cout << "\n=== Time Breakdown ===\n"
              << "Parser processing: " << snapshot.parser_processing_ms << "ms "
              << "(" << (snapshot.parser_processing_ms / total_measured * 100) << "%)\n"
              << "Rules processing: " << snapshot.rules_processing_ms << "ms "
              << "(" << (snapshot.rules_processing_ms / total_measured * 100) << "%)\n"
              << "Aggregator processing: " << snapshot.aggregator_processing_ms << "ms "
              << "(" << (snapshot.aggregator_processing_ms / total_measured * 100) << "%)\n"
              << "Total processing: " << total_processing << "ms "
              << "(" << (total_processing / total_measured * 100) << "%)\n"
              << "Queue overhead: " << snapshot.queue_overhead_ms << "ms "
              << "(" << (snapshot.queue_overhead_ms / total_measured * 100) << "%)\n";
  }

  return result;
}
