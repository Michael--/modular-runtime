#ifndef EVENT_PIPELINE_MONOLITH_TYPES_HPP
#define EVENT_PIPELINE_MONOLITH_TYPES_HPP

#include <cstdint>
#include <string>
#include <unordered_map>

namespace pipeline {

struct RawEvent {
  std::string raw_json;
  std::int64_t sequence = 0;
};

struct ParsedEvent {
  std::string type;
  std::string user;
  std::int64_t value = 0;
  std::int64_t timestamp = 0;
  std::int64_t sequence = 0;
  bool valid = false;
};

struct EnrichedEvent {
  ParsedEvent event;
  std::unordered_map<std::string, std::string> metadata;
  bool passed_rules = false;
};

struct AggregateResult {
  std::string key;
  std::int64_t count = 0;
  std::int64_t sum = 0;
  double avg = 0.0;
};

} // namespace pipeline

#endif
