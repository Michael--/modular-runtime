import { describe, expect, it } from 'vitest'
import {
  ActivityType,
  ConnectionState,
  ServiceLanguage,
  ServiceState,
  ServiceType,
  UpdateType,
} from '../../../packages/proto/generated/ts/runtime/v1/topology'
import { TopologyStore } from './topology-store'

describe('TopologyStore', () => {
  it('registers a service and returns a node update', () => {
    const store = new TopologyStore({
      generateId: () => 'service-1',
      now: () => 1000,
    })

    const result = store.registerService({
      serviceName: 'calculator-client',
      serviceType: ServiceType.SERVICE_TYPE_CLIENT,
      language: ServiceLanguage.SERVICE_LANGUAGE_TYPESCRIPT,
    })

    expect(result.handle.serviceId).toBe('service-1')
    expect(result.updates).toHaveLength(1)
    expect(result.updates[0].type).toBe(UpdateType.UPDATE_TYPE_NODE_ADDED)
    expect(result.updates[0].node?.state).toBe(ServiceState.SERVICE_STATE_REGISTERED)
  })

  it('marks services stale and removes them after timeout', () => {
    let now = 0
    const store = new TopologyStore({
      generateId: () => 'service-2',
      now: () => now,
      heartbeatIntervalMs: 1000,
      timeoutMultiplier: 3,
    })

    store.registerService({
      serviceName: 'calculator-server',
      serviceType: ServiceType.SERVICE_TYPE_SERVER,
      language: ServiceLanguage.SERVICE_LANGUAGE_TYPESCRIPT,
    })

    now = 2500
    const staleUpdates = store.sweep()
    expect(staleUpdates.some((update) => update.type === UpdateType.UPDATE_TYPE_NODE_UPDATED)).toBe(
      true
    )
    const staleNode = staleUpdates.find((update) => update.node)?.node
    expect(staleNode?.state).toBe(ServiceState.SERVICE_STATE_STALE)

    now = 3501
    const removeUpdates = store.sweep()
    expect(
      removeUpdates.some((update) => update.type === UpdateType.UPDATE_TYPE_NODE_REMOVED)
    ).toBe(true)
    expect(store.snapshot().nodes).toHaveLength(0)
  })

  it('aggregates activity into edge metrics', () => {
    let now = 0
    const store = new TopologyStore({
      generateId: () => 'service-3',
      now: () => now,
      activityFlushMs: 1000,
    })

    const registerResult = store.registerService({
      serviceName: 'calculator-client',
      serviceType: ServiceType.SERVICE_TYPE_CLIENT,
      language: ServiceLanguage.SERVICE_LANGUAGE_TYPESCRIPT,
    })

    const serviceId = registerResult.handle.serviceId
    now = 10
    store.recordActivity({
      serviceId,
      targetService: 'calculator-server',
      type: ActivityType.ACTIVITY_TYPE_RESPONSE_RECEIVED,
      latencyMs: 50,
      batchSize: 1,
      success: true,
    })

    now = 1010
    const updates = store.flushActivity()
    expect(updates.some((update) => update.type === UpdateType.UPDATE_TYPE_EDGE_UPDATED)).toBe(true)

    const snapshot = store.snapshot()
    expect(snapshot.edges).toHaveLength(1)
    const edge = snapshot.edges[0]
    expect(edge.totalRequests).toBe('1')
    expect(edge.avgLatencyMs).toBeCloseTo(50)
    expect(edge.state).toBe(ConnectionState.CONNECTION_STATE_ACTIVE)
    expect(snapshot.nodes[0].state).toBe(ServiceState.SERVICE_STATE_ACTIVE)
  })

  it('removes idle edges with unresolved targets after timeout', () => {
    let now = 0
    const store = new TopologyStore({
      generateId: () => 'service-4',
      now: () => now,
      idleTimeoutMs: 1000,
      unknownEdgeTimeoutMs: 1500,
    })

    const registerResult = store.registerService({
      serviceName: 'calculator-client',
      serviceType: ServiceType.SERVICE_TYPE_CLIENT,
      language: ServiceLanguage.SERVICE_LANGUAGE_TYPESCRIPT,
    })

    const serviceId = registerResult.handle.serviceId
    now = 10
    store.recordActivity({
      serviceId,
      targetService: 'calculator.v1.CalculatorService::default',
      type: ActivityType.ACTIVITY_TYPE_RESPONSE_RECEIVED,
      latencyMs: 50,
      batchSize: 1,
      success: true,
    })

    now = 2000
    const updates = store.sweep()
    expect(updates.some((update) => update.type === UpdateType.UPDATE_TYPE_EDGE_REMOVED)).toBe(true)
    expect(store.snapshot().edges).toHaveLength(0)
  })
})
