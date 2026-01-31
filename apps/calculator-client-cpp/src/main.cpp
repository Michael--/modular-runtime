#include <atomic>
#include <csignal>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <memory>
#include <optional>
#include <random>
#include <string>
#include <thread>

#include <grpcpp/grpcpp.h>

#include "broker/v1/broker.grpc.pb.h"
#include "calculator/v1/calculator.grpc.pb.h"

namespace
{
  constexpr const char *kBrokerAddressEnv = "BROKER_ADDRESS";
  constexpr const char *kDefaultBrokerAddress = "127.0.0.1:50051";
  constexpr const char *kServiceName = "calculator.v1.CalculatorService";
  constexpr const char *kDefaultRole = "default";
  constexpr int kReconnectDelaySeconds = 3;
  constexpr int kConnectTimeoutSeconds = 3;
  constexpr int kRpcTimeoutSeconds = 3;

  std::atomic<bool> g_running{true};

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

  std::string BrokerAddress()
  {
    const char *value = std::getenv(kBrokerAddressEnv);
    if (value == nullptr || std::string(value).empty())
    {
      std::cout << "Using default broker address: " << kDefaultBrokerAddress
                << " (set " << kBrokerAddressEnv << " to override)" << std::endl;
      return kDefaultBrokerAddress;
    }
    return value;
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

int main()
{
  std::signal(SIGINT, HandleSignal);
  std::signal(SIGTERM, HandleSignal);

  std::cout << "Starting C++ calculator client..." << std::endl;

  const std::string broker_address = BrokerAddress();

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
      const grpc::Status status = calculator_stub->Calculate(&context, request, &response);
      if (!status.ok())
      {
        std::cerr << "Calculation failed: " << status.error_message() << std::endl;
        break;
      }

      std::cout << "calculate(" << a << " " << OperationSymbol(operation) << " " << b
                << ") => " << response.result() << std::endl;

      std::this_thread::sleep_for(std::chrono::seconds(2));
    }

    if (g_running)
    {
      std::cerr << "Calculator connection lost, retrying in "
                << kReconnectDelaySeconds << " seconds..." << std::endl;
      std::this_thread::sleep_for(std::chrono::seconds(kReconnectDelaySeconds));
    }
  }

  std::cout << "Shutting down." << std::endl;
  return 0;
}
