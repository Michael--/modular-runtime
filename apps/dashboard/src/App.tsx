import { ConnectionsTable } from './components/ConnectionsTable'
import { ServicesTable } from './components/ServicesTable'
import { StatusPill } from './components/StatusPill'
import { TopologyGraph } from './components/TopologyGraph'
import { useTopologyStream } from './hooks/useTopologyStream'
import { formatTimestamp } from './utils/formatters'

/** Main dashboard application shell. */
export const App = (): JSX.Element => {
  const { status, snapshot, lastEventMs, streamUrl } = useTopologyStream()
  const lastUpdate = lastEventMs !== '0' ? lastEventMs : snapshot.timestampMs

  return (
    <div className="app-shell">
      <header>
        <div>
          <h1>Runtime Dashboard</h1>
          <p className="subtitle">Topology graph plus a simple runtime table view for debugging.</p>
        </div>
        <StatusPill status={status} />
      </header>
      <main>
        <section className="panel">
          <div className="panel-title">Overview</div>
          <div className="meta-grid">
            <div>
              <strong>{snapshot.nodes.length}</strong>
              Services
            </div>
            <div>
              <strong>{snapshot.edges.length}</strong>
              Connections
            </div>
            <div>
              <strong>{formatTimestamp(lastUpdate)}</strong>
              Last Update
            </div>
            <div>
              <strong>{streamUrl}</strong>
              Stream URL
            </div>
          </div>
        </section>

        <section className="panel panel--graph">
          <div className="panel-title">Topology Graph</div>
          <TopologyGraph snapshot={snapshot} />
        </section>

        <section className="panel">
          <div className="panel-title">Services</div>
          <ServicesTable nodes={snapshot.nodes} />
        </section>

        <section className="panel">
          <div className="panel-title">Connections</div>
          <ConnectionsTable edges={snapshot.edges} />
        </section>
      </main>
    </div>
  )
}
