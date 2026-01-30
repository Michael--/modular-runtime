/* eslint-disable no-console */
import * as grpc from '@grpc/grpc-js'
import { credentials } from '@grpc/grpc-js'

/**
 * Abstract class representing a manager for gRPC clients.
 * It provides functionality to connect to a gRPC server and handle service changes.
 * It also provides functionality to handle connection and disconnection events.
 * Reconnection is scheduled if the connection is lost.
 * @template TClient - The type of the gRPC client.
 * @template TServiceChangeNotification - The type of the service change notification.
 */
export abstract class ClientManager<TClient extends grpc.Client> {
  private readonly address: string
  public readonly serviceName: string
  public client: TClient | null = null
  public onConnected?: () => void
  public onDisconnected?: () => void
  private reconnectDelay: number = 3000 // 3 seconds
  private deadlineDelay: number = 10000 // 10 seconds
  private reconnectTimer: NodeJS.Timeout | null = null

  /**
   * Creates an instance of ClientManager.
   * @param {string} url - The URL of the gRPC server.
   * @param {number} port - The port of the gRPC server.
   * @param {new (address: string, credentials: grpc.ChannelCredentials) => TClient} clientConstructor - The constructor for the gRPC client.
   */
  public constructor(
    url: string,
    port: number,
    serviceName: string,
    private clientConstructor: new (
      address: string,
      credentials: grpc.ChannelCredentials
    ) => TClient
  ) {
    this.address = `${url}:${port}`
    this.serviceName = serviceName
    console.log(
      `Creating ${this.serviceName} client manager at ${this.address}, reconnect delay: ${this.reconnectDelay / 1000}s, deadline delay: ${
        this.deadlineDelay / 1000
      }s`
    )
  }

  /**
   * Internal method to handle connection event.
   * If needed, it can be overridden in the derived class.
   */
  protected connected() {}

  /**
   * Internal method to handle disconnection event.
   * If needed, it can be overridden in the derived class.
   */
  protected disconnected() {}

  /**
   * Connects to the gRPC server and sets up the client and client stream.
   * If the connection fails, it schedules a reconnect.
   * @protected
   */
  protected connect() {
    try {
      if (this.client != null) return
      this.client = new this.clientConstructor(this.address, credentials.createInsecure())

      // deadline is 10 seconds in the future
      this.client.waitForReady(new Date(Date.now() + this.deadlineDelay), (error) => {
        if (error) {
          console.error(`waitForReady: ${error.message}`)
          this.client = null
          this.scheduleReconnect()
        } else {
          this.clearReconnectTimer()
          console.log('waitForReady: done')
          if (this.client == null) throw new Error('Client not connected')
          // call internal connect and also notify any listeners
          this.connected()
          this.onConnected?.()

          // TODO: fiddle connectivity state, ensure it is READY, assign number to enum value
          const s = this.client.getChannel().getConnectivityState(true)
          console.log('Connectivity state:', s)
          if (s === undefined) {
            console.error('Connectivity state is undefined')
            this.client = null
            this.scheduleReconnect()
            return
          }
          // deadline is 2147483 seconds in the future, it is 24.8 days (will cause a reconnect at least once a month)
          this.client
            .getChannel()
            .watchConnectivityState(s, new Date(Date.now() + 2147483 * 1000), (error) => {
              const s2 = this.client?.getChannel().getConnectivityState(true)
              console.warn('Watch connectivity state:', s, s2, error?.message)
              if ((s === 2 && s2 !== 2) /*READY*/ || error) {
                this.client = null
                this.scheduleReconnect()
              }
            })
        }
      })
    } catch (_error) {
      this.client = null
      console.error('A Failed to create broker client:', _error)
      this.scheduleReconnect()
    }
  }

  /**
   * Schedules a reconnect attempt after a delay.
   * @private
   */
  private scheduleReconnect() {
    if (this.client != null) return
    if (this.reconnectTimer != null) return
    console.log(`Reconnecting in ${this.reconnectDelay / 1000} seconds...`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (this.client != null) return
      console.log(`Reconnecting ${this.serviceName} at ${this.address} now...`)
      this.connect()
    }, this.reconnectDelay)
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer == null) return
    clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
  }
}
