package main

import (
  "context"
  "flag"
  "fmt"
  "io"
  "log"
  "net"
  "os"
  "os/signal"
  "syscall"

  brokerpb "aggregate-service-go/broker/v1"
  pipelinepb "aggregate-service-go/pipeline/v1"

  "google.golang.org/grpc"
  "google.golang.org/grpc/credentials/insecure"
)

const (
  defaultHost        = "127.0.0.1"
  defaultPort        = 6004
  defaultBroker      = "127.0.0.1:50051"
  defaultRole        = "default"
)

type aggregateStats struct {
  count int64
  sum   int64
}

type aggregateServer struct {
  pipelinepb.UnimplementedAggregateServiceServer
}

func (s *aggregateServer) Aggregate(stream pipelinepb.AggregateService_AggregateServer) error {
  stats := make(map[string]*aggregateStats)

  for {
    request, err := stream.Recv()
    if err == io.EOF {
      break
    }
    if err != nil {
      return err
    }

    enriched := request.GetEvent()
    if enriched == nil || !enriched.PassedRules {
      continue
    }

    event := enriched.GetEvent()
    if event == nil {
      continue
    }

    key := event.Type
    entry := stats[key]
    if entry == nil {
      entry = &aggregateStats{}
      stats[key] = entry
    }

    entry.count += 1
    entry.sum += event.Value
  }

  for key, value := range stats {
    avg := 0.0
    if value.count > 0 {
      avg = float64(value.sum) / float64(value.count)
    }
    result := &pipelinepb.AggregateResult{
      Key:   key,
      Count: value.count,
      Sum:   value.sum,
      Avg:   avg,
    }
    if err := stream.Send(&pipelinepb.AggregateResponse{Result: result}); err != nil {
      return err
    }
  }

  return nil
}

func registerWithBroker(ctx context.Context, host string, port int, brokerAddress string) error {
  conn, err := grpc.DialContext(ctx, brokerAddress, grpc.WithTransportCredentials(insecure.NewCredentials()))
  if err != nil {
    return err
  }
  defer conn.Close()

  client := brokerpb.NewBrokerServiceClient(conn)
  _, err = client.RegisterService(ctx, &brokerpb.RegisterServiceRequest{
    Info: &brokerpb.ServiceInfo{
      InterfaceName: pipelinepb.AggregateService_ServiceDesc.ServiceName,
      Role:          defaultRole,
    },
    Url:  host,
    Port: int32(port),
  })
  return err
}

func main() {
  host := flag.String("host", defaultHost, "Bind host")
  port := flag.Int("port", defaultPort, "Bind port")
  broker := flag.String("broker", defaultBroker, "Broker address")
  noBroker := flag.Bool("no-broker", false, "Disable broker registration")
  flag.Parse()

  listener, err := net.Listen("tcp", fmt.Sprintf("%s:%d", *host, *port))
  if err != nil {
    log.Fatalf("Failed to listen: %v", err)
  }

  server := grpc.NewServer()
  pipelinepb.RegisterAggregateServiceServer(server, &aggregateServer{})

  go func() {
    if err := server.Serve(listener); err != nil {
      log.Fatalf("Failed to serve: %v", err)
    }
  }()

  log.Printf("Aggregate service listening on %s:%d", *host, *port)

  if !*noBroker {
    ctx, cancel := context.WithTimeout(context.Background(), grpc.DefaultDialTimeout)
    defer cancel()

    if err := registerWithBroker(ctx, *host, *port, *broker); err != nil {
      log.Printf("Failed to register with broker: %v", err)
    }
  }

  shutdown := make(chan os.Signal, 1)
  signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
  <-shutdown

  server.GracefulStop()
}
