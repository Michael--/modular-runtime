#include "parser.hpp"

#include <cstdlib>
#include <cstring>
#include <ctime>
#include <iomanip>
#include <iostream>
#include <sstream>

namespace pipeline
{

  namespace
  {

    bool extractStringField(const std::string &json, const std::string &key, std::string &out)
    {
      const std::string needle = "\"" + key + "\"";
      const std::size_t key_pos = json.find(needle);
      if (key_pos == std::string::npos)
      {
        return false;
      }
      const std::size_t colon_pos = json.find(':', key_pos + needle.size());
      if (colon_pos == std::string::npos)
      {
        return false;
      }
      const std::size_t first_quote = json.find('"', colon_pos + 1);
      if (first_quote == std::string::npos)
      {
        return false;
      }
      const std::size_t second_quote = json.find('"', first_quote + 1);
      if (second_quote == std::string::npos)
      {
        return false;
      }
      out = json.substr(first_quote + 1, second_quote - first_quote - 1);
      return true;
    }

    bool extractIntField(const std::string &json, const std::string &key, std::int64_t &out)
    {
      const std::string needle = "\"" + key + "\"";
      const std::size_t key_pos = json.find(needle);
      if (key_pos == std::string::npos)
      {
        return false;
      }
      const std::size_t colon_pos = json.find(':', key_pos + needle.size());
      if (colon_pos == std::string::npos)
      {
        return false;
      }
      const std::size_t value_pos = json.find_first_of("-0123456789", colon_pos + 1);
      if (value_pos == std::string::npos)
      {
        return false;
      }

      const char *start = json.c_str() + value_pos;
      char *end = nullptr;
      const long long parsed = std::strtoll(start, &end, 10);
      if (start == end)
      {
        return false;
      }
      out = static_cast<std::int64_t>(parsed);
      return true;
    }

    bool parseIsoTimestamp(const std::string &value, std::int64_t &out_ms)
    {
      if (value.size() < 19)
      {
        return false;
      }

      std::tm tm = {};
      std::istringstream stream(value.substr(0, 19));
      stream >> std::get_time(&tm, "%Y-%m-%dT%H:%M:%S");
      if (stream.fail())
      {
        return false;
      }

#if defined(_WIN32)
      const std::time_t seconds = _mkgmtime(&tm);
#else
      const std::time_t seconds = timegm(&tm);
#endif
      if (seconds < 0)
      {
        return false;
      }
      out_ms = static_cast<std::int64_t>(seconds) * 1000;
      return true;
    }

    bool isSupportedType(const std::string &type)
    {
      return type == "click" || type == "view" || type == "purchase";
    }

  } // namespace

  void parserThread(
      BlockingQueue<RawEvent> &input,
      BlockingQueue<ParsedEvent> &output,
      Metrics &metrics,
      std::atomic<int> &active_parsers)
  {
    RawEvent raw;
    while (input.pop(raw))
    {
      const auto process_start = std::chrono::steady_clock::now();

      ParsedEvent parsed;
      parsed.sequence = raw.sequence;

      std::string ts;
      if (!extractStringField(raw.raw_json, "ts", ts))
      {
        metrics.incrementInvalid();
        const auto process_end = std::chrono::steady_clock::now();
        metrics.addParserProcessing(
            std::chrono::duration_cast<std::chrono::duration<double, std::milli>>(process_end - process_start).count());
        continue;
      }

      if (!extractStringField(raw.raw_json, "type", parsed.type) || !isSupportedType(parsed.type))
      {
        metrics.incrementInvalid();
        const auto process_end = std::chrono::steady_clock::now();
        metrics.addParserProcessing(
            std::chrono::duration_cast<std::chrono::duration<double, std::milli>>(process_end - process_start).count());
        continue;
      }

      if (!extractStringField(raw.raw_json, "user", parsed.user))
      {
        metrics.incrementInvalid();
        const auto process_end = std::chrono::steady_clock::now();
        metrics.addParserProcessing(
            std::chrono::duration_cast<std::chrono::duration<double, std::milli>>(process_end - process_start).count());
        continue;
      }

      if (!extractIntField(raw.raw_json, "value", parsed.value))
      {
        metrics.incrementInvalid();
        const auto process_end = std::chrono::steady_clock::now();
        metrics.addParserProcessing(
            std::chrono::duration_cast<std::chrono::duration<double, std::milli>>(process_end - process_start).count());
        continue;
      }

      if (!parseIsoTimestamp(ts, parsed.timestamp))
      {
        parsed.timestamp = 0;
      }

      parsed.valid = true;
      metrics.incrementParsed();

      const auto process_end = std::chrono::steady_clock::now();
      metrics.addParserProcessing(
          std::chrono::duration_cast<std::chrono::duration<double, std::milli>>(process_end - process_start).count());

      const auto queue_start = std::chrono::steady_clock::now();
      if (!output.push(std::move(parsed)))
      {
        break;
      }
      const auto queue_end = std::chrono::steady_clock::now();
      metrics.addQueueOverhead(
          std::chrono::duration_cast<std::chrono::duration<double, std::milli>>(queue_end - queue_start).count());
    }

    if (active_parsers.fetch_sub(1) == 1)
    {
      output.close();
    }
  }

} // namespace pipeline
