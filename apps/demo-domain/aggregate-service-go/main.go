package main

import (
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	pipelinepb "aggregate-service-go/pipeline/v1"

	"google.golang.org/grpc"
)

const (
	defaultHost = "127.0.0.1"
	defaultPort = 6004
)

type aggregateStats struct {
	count int64
	sum   int64
}

type ServiceMetrics struct {
	serviceName      string
	eventsProcessed  int64
	processingTimeMs float64
	ipcSendTimeMs    float64
	ipcRecvTimeMs    float64
}

func (m *ServiceMetrics) recordRecv(durationMs float64) {
	m.ipcRecvTimeMs += durationMs
}

func (m *ServiceMetrics) recordProcessing(durationMs float64) {
	m.recordProcessingCount(durationMs, 1)
}

func (m *ServiceMetrics) recordProcessingCount(durationMs float64, count int64) {
	m.processingTimeMs += durationMs
	m.eventsProcessed += count
}

func (m *ServiceMetrics) recordSend(durationMs float64) {
	m.ipcSendTimeMs += durationMs
}

func (m *ServiceMetrics) printSummary() {
	total := m.processingTimeMs + m.ipcSendTimeMs + m.ipcRecvTimeMs
	if total == 0 {
		return
	}

	fmt.Printf("\n=== %s Metrics ===\n", m.serviceName)
	fmt.Printf("Events processed: %d\n", m.eventsProcessed)
	fmt.Printf("Processing time: %.2fms (%.1f%%)\n", m.processingTimeMs, (m.processingTimeMs/total)*100)
	fmt.Printf("IPC Send time: %.2fms (%.1f%%)\n", m.ipcSendTimeMs, (m.ipcSendTimeMs/total)*100)
	fmt.Printf("IPC Recv time: %.2fms (%.1f%%)\n", m.ipcRecvTimeMs, (m.ipcRecvTimeMs/total)*100)
	fmt.Println("Avg per event:")
	fmt.Printf("  Processing: %.4fms\n", m.processingTimeMs/float64(m.eventsProcessed))
	fmt.Printf("  IPC Send: %.4fms\n", m.ipcSendTimeMs/float64(m.eventsProcessed))
	fmt.Printf("  IPC Recv: %.4fms\n", m.ipcRecvTimeMs/float64(m.eventsProcessed))
}

type aggregateServer struct {
	pipelinepb.UnimplementedAggregateServiceServer
}

func (s *aggregateServer) Aggregate(stream pipelinepb.AggregateService_AggregateServer) error {
	stats := make(map[string]*aggregateStats)
	workItemResults := make([]*WorkItemResult, 0)
	metrics := &ServiceMetrics{serviceName: "aggregate-service"}

	for {
		recvStart := time.Now()
		request, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		metrics.recordRecv(float64(time.Since(recvStart).Microseconds()) / 1000.0)

		processStart := time.Now()
		enriched := request.GetEvent()
		if enriched == nil || !enriched.PassedRules {
			metrics.recordProcessing(float64(time.Since(processStart).Microseconds()) / 1000.0)
			continue
		}

		event := enriched.GetEvent()
		if event == nil {
			metrics.recordProcessing(float64(time.Since(processStart).Microseconds()) / 1000.0)
			continue
		}

		// Check if this is a WorkItem
		if event.Type == "work-item" {
			if workResult, err := processEnrichedWorkItem(event.User); err == nil {
				workItemResults = append(workItemResults, workResult)
			}
			metrics.recordProcessing(float64(time.Since(processStart).Microseconds()) / 1000.0)
			continue
		}

		// Normal event processing
		key := event.Type
		entry := stats[key]
		if entry == nil {
			entry = &aggregateStats{}
			stats[key] = entry
		}

		entry.count += 1
		entry.sum += event.Value
		metrics.recordProcessing(float64(time.Since(processStart).Microseconds()) / 1000.0)
	}

	// Send WorkItem results as individual results
	for _, item := range workItemResults {
		result := &pipelinepb.AggregateResult{
			Key:   item.ID,
			Count: 0,
			Sum:   int64(math.Round(item.FinalScore)),
			Avg:   item.FinalScore,
		}
		sendStart := time.Now()
		if err := stream.Send(&pipelinepb.AggregateResponse{Result: result}); err != nil {
			return err
		}
		metrics.recordSend(float64(time.Since(sendStart).Microseconds()) / 1000.0)
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

		sendStart := time.Now()
		if err := stream.Send(&pipelinepb.AggregateResponse{Result: result}); err != nil {
			return err
		}
		metrics.recordSend(float64(time.Since(sendStart).Microseconds()) / 1000.0)
	}

	metrics.printSummary()
	return nil
}

func (s *aggregateServer) AggregateBatch(stream pipelinepb.AggregateService_AggregateBatchServer) error {
	stats := make(map[string]*aggregateStats)
	workItemResults := make([]*WorkItemResult, 0)
	metrics := &ServiceMetrics{serviceName: "aggregate-service"}

	for {
		recvStart := time.Now()
		request, err := stream.Recv()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		metrics.recordRecv(float64(time.Since(recvStart).Microseconds()) / 1000.0)

		if len(request.Events) == 0 {
			continue
		}

		processStart := time.Now()
		for _, enriched := range request.Events {
			if enriched == nil || !enriched.PassedRules {
				continue
			}

			event := enriched.GetEvent()
			if event == nil {
				continue
			}

			// Check if this is a WorkItem
			if event.Type == "work-item" {
				if workResult, err := processEnrichedWorkItem(event.User); err == nil {
					workItemResults = append(workItemResults, workResult)
				}
				continue
			}

			// Normal event processing
			key := event.Type
			entry := stats[key]
			if entry == nil {
				entry = &aggregateStats{}
				stats[key] = entry
			}

			entry.count += 1
			entry.sum += event.Value
		}
		metrics.recordProcessingCount(
			float64(time.Since(processStart).Microseconds())/1000.0,
			int64(len(request.Events)),
		)
	}

	results := make([]*pipelinepb.AggregateResult, 0, len(stats)+len(workItemResults))

	// Add WorkItem results as individual results
	for _, item := range workItemResults {
		results = append(results, &pipelinepb.AggregateResult{
			Key:   item.ID,
			Count: 0,
			Sum:   int64(math.Round(item.FinalScore)),
			Avg:   item.FinalScore,
		})
	}

	for key, value := range stats {
		avg := 0.0
		if value.count > 0 {
			avg = float64(value.sum) / float64(value.count)
		}
		results = append(results, &pipelinepb.AggregateResult{
			Key:   key,
			Count: value.count,
			Sum:   value.sum,
			Avg:   avg,
		})
	}

	sendStart := time.Now()
	if err := stream.Send(&pipelinepb.AggregateBatchResponse{Results: results}); err != nil {
		return err
	}
	metrics.recordSend(float64(time.Since(sendStart).Microseconds()) / 1000.0)

	metrics.printSummary()
	return nil
}

func main() {
	host := flag.String("host", defaultHost, "Bind host")
	port := flag.Int("port", defaultPort, "Bind port")
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

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)
	<-shutdown

	server.GracefulStop()
}
