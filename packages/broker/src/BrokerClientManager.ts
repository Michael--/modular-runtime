/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import {
  BrokerServiceClient,
  NotifyServiceChangesResponse,
  RegisterServiceRequest,
} from '../../proto/generated/ts/broker/v1/broker'
import { ClientManager } from '../../common/dist/index.js'

/**
 * Interface representing extended service information.
 */
export interface ExtServiceInfo {
  name: string
  role: string
  url: string
  port: number
}

/**
 * Class representing a manager for BrokerClient.
 * It extends the ClientManager class to manage BrokerClient connections and service registrations.
 */
export class BrokerClientManager extends ClientManager<BrokerServiceClient> {
  public static instance: BrokerClientManager | null = null
  private registeredServices: ExtServiceInfo[] = []
  public onChanges?: (changes: NotifyServiceChangesResponse) => void
  private clientStream: grpc.ClientReadableStream<unknown> | null = null

  /**
   * Creates a singleton instance of BrokerClientManager.
   * @param {string} url - The URL of the gRPC server.
   * @param {number} port - The port of the gRPC server.
   * @returns {BrokerClientManager} The singleton instance of BrokerClientManager.
   */
  public static create(url: string, port: number): BrokerClientManager {
    if (BrokerClientManager.instance) return BrokerClientManager.instance
    BrokerClientManager.instance = new BrokerClientManager(url, port)
    return BrokerClientManager.instance
  }

  /**
   * Private constructor to enforce singleton pattern.
   * @param {string} url - The URL of the gRPC server.
   * @param {number} port - The port of the gRPC server.
   */
  private constructor(url: string, port: number) {
    super(url, port, BrokerServiceClient.serviceName, BrokerServiceClient)
  }

  /**
   * Gets the client stream for service change notifications.
   * @returns {grpc.ClientReadableStream<NotifyServiceChangesResponse>} The client stream.
   * @throws {Error} If the client is not connected.
   */
  getClientStream(): grpc.ClientReadableStream<NotifyServiceChangesResponse> {
    if (this.client == null) throw new Error('Client not connected')
    return this.client.notifyServiceChanges({})
  }

  override connected() {
    super.connected()
    if (this.client == null) throw new Error('Client not connected')
    this.clientStream = this.client.notifyServiceChanges({})
    this.clientStream.on('data', (changes) => {
      this.onChanges?.(changes)
    })
    this.clientStream.on('error', (error) => {
      console.error('Client stream error:', error.message)
      this.client = null
    })
    this.clientStream.on('end', () => {
      console.log('Client stream ended')
      this.client = null
    })
  }

  override disconnected() {
    super.disconnected()
  }

  /**
   * Gets the available services from the broker.
   * @returns {Promise<RegisterServiceRequest[]>} A promise that resolves to the list of available services.
   */
  public getAvailableServices(): Promise<RegisterServiceRequest[]> {
    return new Promise((resolve, reject) => {
      this.client?.getAvailableServices({}, (error, response) => {
        if (error) {
          reject(new Error('Failed to get available services'))
        } else {
          resolve(response.services)
        }
      })
    })
  }

  /**
   * Gets the service information for a specific gRPC client and role.
   * @param {new (...args: any[]): grpc.Client} grpcClient - The gRPC client constructor.
   * @param {string} [role="default"] - The role of the service.
   * @returns {Promise<{ url: string; port: number } | null>} The service information or null if not found.
   */
  public async getService(
    grpcClient: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new (...args: any[]): grpc.Client
      serviceName: string
    },
    role: string = 'default'
  ) {
    const clients = await this.getAvailableServices()
    const service = clients.find(
      (service) =>
        service.info?.interfaceName === grpcClient.serviceName && service.info?.role === role
    )
    if (service != null) return { url: service.url, port: service.port }
    return null
  }

  /**
   * Registers a service with the broker.
   * @param {new (...args: any[]): grpc.Client} grpcClient - The gRPC client constructor.
   * @param {string} url - The URL of the service.
   * @param {number} port - The port of the service.
   */
  public registerService(
    grpcClient: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      new (...args: any[]): grpc.Client
      serviceName: string
    },
    url: string,
    port: number
  ) {
    const info: ExtServiceInfo = {
      name: grpcClient.serviceName,
      role: 'default',
      url,
      port,
    }
    this.client?.registerService(
      {
        info: {
          interfaceName: info.name,
          role: info.role,
        },
        url: info.url,
        port: info.port,
      },
      (error) => {
        if (error) {
          console.error('Failed to register service:', info.name)
        } else {
          this.registeredServices.push(info)
          console.log('Service registered successfully:', info.name)
        }
      }
    )
  }

  /**
   * Unregisters a service from the broker.
   * @param {ExtServiceInfo} info - The extended service information.
   * @returns {Promise<void>} A promise that resolves when the service is unregistered.
   * @private
   */
  private async unregisterService(info: ExtServiceInfo): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client?.unregisterService({ interfaceName: info.name, role: info.role }, (error) => {
        if (error) {
          console.error(`Failed to unregister service ${JSON.stringify(info)}:`)
          reject(error)
        } else {
          console.log(`Service ${JSON.stringify(info)} unregistered successfully:`)
          resolve()
        }
      })
    })
  }

  /**
   * Shuts down the BrokerClientManager by unregistering all registered services.
   * @returns {Promise<void>} A promise that resolves when all services are unregistered.
   */
  public async shutdown() {
    const promises = this.registeredServices.map((service) =>
      this.unregisterService(service).catch((err) =>
        console.error('Error unregistering service:', err)
      )
    )
    this.registeredServices = []
    await Promise.all(promises)
  }
}
