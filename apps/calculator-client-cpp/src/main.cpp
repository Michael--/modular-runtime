#include <atomic>
#include <algorithm>
#include <csignal>
#include <chrono>
#include <cstdlib>
#include <iomanip>
#include <iostream>
#include <memory>
#include <optional>
#include <random>
#include <string>
#include <sstream>
#include <thread>
#include <curl/curl.h>

#include <grpcpp/grpcpp.h>

#include "broker/v1/broker.grpc.pb.h"
#include "calculator/v1/calculator.grpc.pb.h"

namespace
{
  constexpr const char *kBrokerAddressEnv = "BROKER_ADDRESS";
  constexpr const char *kDefaultBrokerAddress = "127.0.0.1:50051";
  constexpr const char *kDefaultTopologyProxyAddress = "http://127.0.0.1:50055";
  constexpr const char *kServiceName = "calculator.v1.CalculatorService";
  constexpr const char *kDefaultRole = "default";
  constexpr int kReconnectDelaySeconds = 3;
  constexpr int kConnectTimeoutSeconds = 3;
  constexpr int kRpcTimeoutSeconds = 3;
  constexpr int kTopologyRetryMinSeconds = 1;
  constexpr int kTopologyRetryMaxSeconds = 15;

  std::atomic<bool> g_running{true};
  std::string g_service_id;
  int g_topology_retry_seconds = kTopologyRetryMinSeconds;
  std::chrono::steady_clock::time_point g_next_topology_register =
      std::chrono::steady_clock::time_point::min();

  struct ServiceEndpoint
  {
    std::string url;
    int port = 0;
    ServiceEndpoint(std::string u, int p) : url(std::move(u)), port(p) {}
  };

  void HandleSignal(int /*signal*/)
  {
    g_running = false;
  }

  std::string BrokerAddress(int argc, char *argv[])
  {
    std::string broker_address = kDefaultBrokerAddress;
    for (int i = 1; i < argc; ++i)
    {
      std::string arg = argv[i];
      if (arg == "--broker-address" && i + 1 < argc)
      {
        broker_address = argv[++i];
      }
    }
    const char *env_value = std::getenv(kBrokerAddressEnv);
    if (env_value != nullptr && !std::string(env_value).empty())
    {
      broker_address = env_value;
    }
    else if (argc == 1)
    {
      std::cout << "Using default broker address: " << kDefaultBrokerAddress
                << " (set " << kBrokerAddressEnv << " or use --broker-address to override)" << std::endl;
    }
    return broker_address;
  }

  // HTTP helper: callback for curl response
  size_t WriteCallback(void *contents, size_t size, size_t nmemb, std::string *output)
  {
    size_t total_size = size * nmemb;
    output->append(static_cast<char *>(contents), total_size);
    return total_size;
  }

  // HTTP POST helper
  bool HttpPost(const std::string &url, const std::string &json_body, std::string &response)
  {
    CURL *curl = curl_easy_init();
    if (!curl)
    {
      return false;
    }

    struct curl_slist *headers = nullptr;
    headers = curl_slist_append(headers, "Content-Type: application/json");

    curl_easy_setopt(curl, CURLOPT_URL, url.c_str());
    curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_body.c_str());
    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
    curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, WriteCallback);
    curl_easy_setopt(curl, CURLOPT_WRITEDATA, &response);
    curl_easy_setopt(curl, CURLOPT_TIMEOUT, 5L);

    CURLcode res = curl_easy_perform(curl);
    long http_code = 0;
    curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &http_code);

    curl_slist_free_all(headers);
    curl_easy_cleanup(curl);

    return res == CURLE_OK && http_code == 200;
  }

  // Extract serviceId from JSON response
  std::string ExtractServiceId(const std::string &json_response)
  {
    // Simple JSON parsing: look for "serviceId":"..."
    const std::string key = "\"serviceId\":\"";
    size_t pos = json_response.find(key);
    if (pos == std::string::npos)
    {
      return "";
    }
    pos += key.length();
    size_t end_pos = json_response.find("\"", pos);
    if (end_pos == std::string::npos)
    {
      return "";
    }
    return json_response.substr(pos, end_pos - pos);
  }

  // Register with topology service via HTTP proxy
  bool RegisterTopology(const std::string &proxy_address)
  {
    std::string url = proxy_address + "/register";
    std::string json_body = R"({
      "serviceName": "calculator-client-cpp",
      "serviceType": "SERVICE_TYPE_CLIENT",
      "language": "SERVICE_LANGUAGE_CPP",
      "version": "1.0.0",
      "enableActivity": true
    })";

    std::string response;
    if (!HttpPost(url, json_body, response))
    {
      std::cerr << "Failed to register with topology service" << std::endl;
      return false;
    }

    g_service_id = ExtractServiceId(response);
    if (g_service_id.empty())
    {
      std::cerr << "Failed to extract serviceId from response: " << response << std::endl;
      return false;
    }

    std::cout << "Registered with topology service: " << g_service_id << std::endl;
    return true;
  }

  void ResetTopologyRetry()
  {
    g_topology_retry_seconds = kTopologyRetryMinSeconds;
    g_next_topology_register = std::chrono::steady_clock::now();
  }

  void ScheduleTopologyRetry()
  {
    const auto now = std::chrono::steady_clock::now();
    g_next_topology_register = now + std::chrono::seconds(g_topology_retry_seconds);
    g_topology_retry_seconds =
        std::min(g_topology_retry_seconds * 2, kTopologyRetryMaxSeconds);
  }

  bool EnsureTopologyRegistered(const std::string &proxy_address)
  {
    if (!g_service_id.empty())
    {
      return true;
    }

    const auto now = std::chrono::steady_clock::now();
    if (now < g_next_topology_register)
    {
      return false;
    }

    if (RegisterTopology(proxy_address))
    {
      ResetTopologyRetry();
      return true;
    }

    ScheduleTopologyRetry();
    return false;
  }

  // Report activity to topology service
  void ReportActivity(const std::string &proxy_address, bool success, int latency_ms)
  {
    if (!EnsureTopologyRegistered(proxy_address))
    {
      return;
    }

    std::ostringstream json_body;
    json_body << "{"
              << "\"serviceId\":\"" << g_service_id << "\","
              << "\"targetService\":\"calculator-server\","
              << "\"type\":\"ACTIVITY_TYPE_REQUEST_SENT\","
              << "\"latencyMs\":" << latency_ms << ","
              << "\"success\":" << (success ? "true" : "false")
              << "}";

    std::string url = proxy_address + "/activity";
    std::string response;
    if (!HttpPost(url, json_body.str(), response))
    {
      std::cerr << "Topology activity report failed; will re-register." << std::endl;
      g_service_id.clear();
      ScheduleTopologyRetry();
    }
  }

  // Unregister from topology service
  void UnregisterTopology(const std::string &proxy_address)
  {
    if (g_service_id.empty())
    {
      return;
    }

    std::string url = proxy_address + "/unregister";
    std::ostringstream json_body;
    json_body << "{\"serviceId\":\"" << g_service_id << "\"}";

    std::string response;
    if (HttpPost(url, json_body.str(), response))
    {
      std::cout << "Unregistered from topology service" << std::endl;
    }
    g_service_id.clear();
  }

  bool RoleMatches(const std::string &role)
  {
    return role.empty() || role == kDefaultRole;
  }

  bool WaitForChannelReady(
      const std::shared_ptr<grpc::Channel> &channel,
      const std::string &label)
  {
    const auto deadline =
        std::chrono::system_clock::now() + std::chrono::seconds(kConnectTimeoutSeconds);
    const bool connected = channel->WaitForConnected(deadline);
    if (!connected)
    {
      std::cerr << label << " not ready (timeout " << kConnectTimeoutSeconds
                << "s)" << std::endl;
    }
    return connected;
  }

  std::unique_ptr<ServiceEndpoint> ResolveService(
      broker::v1::BrokerService::Stub &stub)
  {
    std::cout << "Asking broker to lookup service..." << std::endl;
    broker::v1::LookupServiceRequest request;
    request.set_interface_name(kServiceName);
    request.set_role(kDefaultRole);

    broker::v1::LookupServiceResponse response;
    grpc::ClientContext context;
    context.set_deadline(
        std::chrono::system_clock::now() + std::chrono::seconds(kRpcTimeoutSeconds));
    context.set_wait_for_ready(true);
    const grpc::Status status = stub.LookupService(&context, request, &response);
    if (!status.ok())
    {
      std::cerr << "LookupService failed: " << status.error_message() << std::endl;
    }
    else if (response.error().empty() && !response.url().empty() && response.port() > 0)
    {
      std::cout << "Broker lookup returned an endpoint." << std::endl;
      return std::make_unique<ServiceEndpoint>(response.url(), response.port());
    }

    if (!response.error().empty())
    {
      std::cerr << "Calculator service not found: " << response.error() << std::endl;
    }

    std::cout << "Asking broker for available services..." << std::endl;
    broker::v1::GetAvailableServicesRequest list_request;
    broker::v1::GetAvailableServicesResponse list_response;
    grpc::ClientContext list_context;
    list_context.set_deadline(
        std::chrono::system_clock::now() + std::chrono::seconds(kRpcTimeoutSeconds));
    list_context.set_wait_for_ready(true);

    const grpc::Status list_status =
        stub.GetAvailableServices(&list_context, list_request, &list_response);
    if (!list_status.ok())
    {
      std::cerr << "GetAvailableServices failed: " << list_status.error_message()
                << std::endl;
      return nullptr;
    }

    std::cout << "Broker returned " << list_response.services_size() << " services."
              << std::endl;
    for (const auto &service : list_response.services())
    {
      if (!service.has_info())
      {
        continue;
      }
      const auto &info = service.info();
      if (info.interface_name() != kServiceName)
      {
        continue;
      }
      if (!RoleMatches(info.role()))
      {
        continue;
      }
      return std::make_unique<ServiceEndpoint>(service.url(), service.port());
    }

    return nullptr;
  }

  calculator::v1::Operation RandomOperation(std::mt19937 &rng)
  {
    std::uniform_int_distribution<int> op_dist(1, 4);
    const int value = op_dist(rng);
    switch (value)
    {
    case 1:
      return calculator::v1::OPERATION_ADD;
    case 2:
      return calculator::v1::OPERATION_SUBTRACT;
    case 3:
      return calculator::v1::OPERATION_MULTIPLY;
    default:
      return calculator::v1::OPERATION_DIVIDE;
    }
  }

  const char *OperationSymbol(calculator::v1::Operation operation)
  {
    switch (operation)
    {
    case calculator::v1::OPERATION_ADD:
      return "+";
    case calculator::v1::OPERATION_SUBTRACT:
      return "-";
    case calculator::v1::OPERATION_MULTIPLY:
      return "*";
    case calculator::v1::OPERATION_DIVIDE:
      return "/";
    default:
      return "?";
    }
  }
} // namespace

int main(int argc, char *argv[])
{
  std::signal(SIGINT, HandleSignal);
  std::signal(SIGTERM, HandleSignal);

  std::cout << std::fixed << std::setprecision(6);

  std::cout << "Starting C++ calculator client..." << std::endl;

  // Initialize curl globally
  curl_global_init(CURL_GLOBAL_ALL);

  const std::string broker_address = BrokerAddress(argc, argv);
  const std::string topology_proxy = kDefaultTopologyProxyAddress;

  // Attempt initial topology registration (with retries in the main loop).
  EnsureTopologyRegistered(topology_proxy);

  std::random_device rd;
  std::mt19937 rng(rd());
  std::uniform_real_distribution<double> value_dist(0.0, 10.0);

  while (g_running)
  {
    std::cout << "Connecting to broker at " << broker_address << std::endl;
    auto broker_channel =
        grpc::CreateChannel(broker_address, grpc::InsecureChannelCredentials());
    if (!WaitForChannelReady(broker_channel, "Broker channel"))
    {
      if (!g_running)
      {
        break;
      }
      std::cerr << "Broker not reachable, retrying in "
                << kReconnectDelaySeconds << " seconds..." << std::endl;
      std::this_thread::sleep_for(std::chrono::seconds(kReconnectDelaySeconds));
      continue;
    }
    std::cout << "Broker channel ready." << std::endl;
    auto broker_stub = broker::v1::BrokerService::NewStub(broker_channel);

    auto service = ResolveService(*broker_stub);
    if (!service)
    {
      if (!g_running)
      {
        break;
      }
      std::cerr << "Service not available, retrying in "
                << kReconnectDelaySeconds << " seconds..." << std::endl;
      std::this_thread::sleep_for(std::chrono::seconds(kReconnectDelaySeconds));
      continue;
    }

    const std::string calculator_address =
        service->url + ":" + std::to_string(service->port);
    std::cout << "Connecting to calculator service at " << calculator_address << std::endl;

    auto calculator_channel =
        grpc::CreateChannel(calculator_address, grpc::InsecureChannelCredentials());
    if (!WaitForChannelReady(calculator_channel, "Calculator channel"))
    {
      if (!g_running)
      {
        break;
      }
      std::cerr << "Calculator not reachable, retrying in "
                << kReconnectDelaySeconds << " seconds..." << std::endl;
      std::this_thread::sleep_for(std::chrono::seconds(kReconnectDelaySeconds));
      continue;
    }
    auto calculator_stub = calculator::v1::CalculatorService::NewStub(calculator_channel);

    while (g_running)
    {
      EnsureTopologyRegistered(topology_proxy);

      const double a = value_dist(rng);
      const double b = value_dist(rng);
      const auto operation = RandomOperation(rng);

      calculator::v1::CalculateRequest request;
      request.set_operand1(a);
      request.set_operand2(b);
      request.set_operation(operation);

      calculator::v1::CalculateResponse response;
      grpc::ClientContext context;
      context.set_deadline(
          std::chrono::system_clock::now() + std::chrono::seconds(kRpcTimeoutSeconds));

      auto start = std::chrono::steady_clock::now();
      const grpc::Status status = calculator_stub->Calculate(&context, request, &response);
      auto end = std::chrono::steady_clock::now();
      int latency_ms = std::chrono::duration_cast<std::chrono::milliseconds>(end - start).count();

      if (!status.ok())
      {
        std::cerr << "Calculation failed: " << status.error_message() << std::endl;
        ReportActivity(topology_proxy, false, latency_ms);
        break;
      }

      std::cout << "calculate(" << a << " " << OperationSymbol(operation) << " " << b
                << ") => " << response.result() << std::endl;

      ReportActivity(topology_proxy, true, latency_ms);

      std::this_thread::sleep_for(std::chrono::seconds(2));
    }

    if (g_running)
    {
      std::cerr << "Calculator connection lost, retrying in "
                << kReconnectDelaySeconds << " seconds..." << std::endl;
      std::this_thread::sleep_for(std::chrono::seconds(kReconnectDelaySeconds));
    }
  }

  // Unregister from topology service
  UnregisterTopology(topology_proxy);

  std::cout << "Shutting down." << std::endl;

  curl_global_cleanup();
  return 0;
}
