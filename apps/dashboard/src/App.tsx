import { useState } from 'react'
import {
  AppShell,
  ActionIcon,
  Badge,
  Box,
  Burger,
  Card,
  Divider,
  Grid,
  Group,
  NavLink,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  Title,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core'
import { useDisclosure } from '@mantine/hooks'
import { ConnectionsTable } from './components/ConnectionsTable'
import { ServicesTable } from './components/ServicesTable'
import { StatusPill } from './components/StatusPill'
import { TopologyGraph } from './components/TopologyGraph'
import { useTopologyStream } from './hooks/useTopologyStream'
import { formatTimestamp } from './utils/formatters'

const NAV_ITEMS = [
  {
    id: 'overview',
    label: 'Overview',
    description: 'Snapshot highlights and health signals.',
  },
  {
    id: 'topology',
    label: 'Topology',
    description: 'Interactive service graph view.',
  },
  {
    id: 'services',
    label: 'Services',
    description: 'Registered services and runtime status.',
  },
  {
    id: 'connections',
    label: 'Connections',
    description: 'Live connections and traffic levels.',
  },
  {
    id: 'stream',
    label: 'Stream',
    description: 'Topology stream and connection details.',
  },
] as const

type DashboardView = (typeof NAV_ITEMS)[number]['id']

interface StatCardProps {
  label: string
  value: string
  hint: string
}

const StatCard = ({ label, value, hint }: StatCardProps): JSX.Element => (
  <Card className="stat-card" padding="md" radius="lg" withBorder>
    <Text size="xs" className="app-eyebrow">
      {label}
    </Text>
    <Text className="stat-value">{value}</Text>
    <Text size="xs" c="dimmed">
      {hint}
    </Text>
  </Card>
)

/** Main dashboard application shell. */
export const App = (): JSX.Element => {
  const [activeView, setActiveView] = useState<DashboardView>('overview')
  const [opened, { toggle, close }] = useDisclosure()
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('dark', {
    getInitialValueInEffect: true,
  })
  const { status, snapshot, lastEventMs, streamUrl } = useTopologyStream()
  const lastUpdate = lastEventMs !== '0' ? lastEventMs : snapshot.timestampMs
  const formattedLastUpdate = formatTimestamp(lastUpdate)

  const navItems = NAV_ITEMS.map((item) => {
    if (item.id === 'services') {
      return { ...item, description: `${snapshot.nodes.length} services registered.` }
    }
    if (item.id === 'connections') {
      return { ...item, description: `${snapshot.edges.length} active connections.` }
    }
    return item
  })

  const overviewStats: StatCardProps[] = [
    {
      label: 'Services',
      value: snapshot.nodes.length.toLocaleString(),
      hint: 'Registered in the runtime.',
    },
    {
      label: 'Connections',
      value: snapshot.edges.length.toLocaleString(),
      hint: 'Active routing edges.',
    },
    {
      label: 'Last Update',
      value: formattedLastUpdate,
      hint: 'Most recent snapshot.',
    },
    {
      label: 'Stream',
      value: status.toUpperCase(),
      hint: 'Topology feed status.',
    },
  ]

  const renderOverview = (): JSX.Element => (
    <Stack gap="lg">
      <Card className="dashboard-hero" padding="lg" radius="lg" withBorder>
        <Group justify="space-between" align="flex-start" gap="lg">
          <Box>
            <Text size="xs" className="app-eyebrow">
              Runtime Overview
            </Text>
            <Title order={2}>Live Topology Snapshot</Title>
            <Text c="dimmed" mt={6} maw={520}>
              Consolidated health indicators, the live graph, and quick runtime tables in one
              glance.
            </Text>
          </Box>
          <StatusPill status={status} />
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} spacing="md" mt="lg">
          {overviewStats.map((stat) => (
            <StatCard key={stat.label} {...stat} />
          ))}
        </SimpleGrid>
      </Card>

      <Grid gutter="md">
        <Grid.Col span={{ base: 12, lg: 8 }}>
          <Card className="dashboard-card" padding="lg" radius="lg" withBorder>
            <Group justify="space-between" align="center" mb="sm">
              <Title order={4}>Topology Graph</Title>
              <Badge variant="light">Live layout</Badge>
            </Group>
            <TopologyGraph snapshot={snapshot} />
          </Card>
        </Grid.Col>
        <Grid.Col span={{ base: 12, lg: 4 }}>
          <Stack gap="md">
            <Card className="dashboard-card" padding="lg" radius="lg" withBorder>
              <Group justify="space-between" align="center" mb="xs">
                <Title order={5}>Services</Title>
                <Badge variant="light">{snapshot.nodes.length}</Badge>
              </Group>
              <ScrollArea h={240}>
                <ServicesTable nodes={snapshot.nodes} />
              </ScrollArea>
            </Card>
            <Card className="dashboard-card" padding="lg" radius="lg" withBorder>
              <Group justify="space-between" align="center" mb="xs">
                <Title order={5}>Connections</Title>
                <Badge variant="light">{snapshot.edges.length}</Badge>
              </Group>
              <ScrollArea h={240}>
                <ConnectionsTable edges={snapshot.edges} />
              </ScrollArea>
            </Card>
          </Stack>
        </Grid.Col>
      </Grid>
    </Stack>
  )

  const renderTopology = (): JSX.Element => (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Box>
          <Title order={2}>Topology Graph</Title>
          <Text c="dimmed">Interactive routing map with state-driven styling.</Text>
        </Box>
        <StatusPill status={status} />
      </Group>
      <Card className="dashboard-card" padding="lg" radius="lg" withBorder>
        <TopologyGraph snapshot={snapshot} />
      </Card>
    </Stack>
  )

  const renderServices = (): JSX.Element => (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Box>
          <Title order={2}>Services</Title>
          <Text c="dimmed">Registered services, heartbeats, and runtime metadata.</Text>
        </Box>
        <Badge variant="light">{snapshot.nodes.length} total</Badge>
      </Group>
      <Card className="dashboard-card" padding="lg" radius="lg" withBorder>
        <ServicesTable nodes={snapshot.nodes} />
      </Card>
    </Stack>
  )

  const renderConnections = (): JSX.Element => (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Box>
          <Title order={2}>Connections</Title>
          <Text c="dimmed">Live edges, throughput, and latency signals.</Text>
        </Box>
        <Badge variant="light">{snapshot.edges.length} total</Badge>
      </Group>
      <Card className="dashboard-card" padding="lg" radius="lg" withBorder>
        <ConnectionsTable edges={snapshot.edges} />
      </Card>
    </Stack>
  )

  const renderStream = (): JSX.Element => (
    <Stack gap="md">
      <Group justify="space-between" align="flex-start">
        <Box>
          <Title order={2}>Topology Stream</Title>
          <Text c="dimmed">Connection details and last snapshot timestamps.</Text>
        </Box>
        <StatusPill status={status} />
      </Group>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Card className="dashboard-card" padding="lg" radius="lg" withBorder>
          <Text size="xs" className="app-eyebrow">
            Stream URL
          </Text>
          <Text fw={600} mt={4}>
            {streamUrl}
          </Text>
          <Text size="sm" c="dimmed" mt="xs">
            Live SSE endpoint configured by the runtime client.
          </Text>
        </Card>
        <Card className="dashboard-card" padding="lg" radius="lg" withBorder>
          <Text size="xs" className="app-eyebrow">
            Update Cadence
          </Text>
          <Text fw={600} mt={4}>
            Last update at {formattedLastUpdate}
          </Text>
          <Text size="sm" c="dimmed" mt="xs">
            Snapshot timestamp: {formatTimestamp(snapshot.timestampMs)}
          </Text>
        </Card>
      </SimpleGrid>
      <Card className="dashboard-card" padding="lg" radius="lg" withBorder>
        <Group justify="space-between" align="center" mb="xs">
          <Title order={5}>Recent Activity</Title>
          <Badge variant="light">Status {status}</Badge>
        </Group>
        <Text size="sm" c="dimmed">
          Last event timestamp: {formatTimestamp(lastEventMs)}
        </Text>
      </Card>
    </Stack>
  )

  const renderView = (): JSX.Element => {
    switch (activeView) {
      case 'topology':
        return renderTopology()
      case 'services':
        return renderServices()
      case 'connections':
        return renderConnections()
      case 'stream':
        return renderStream()
      case 'overview':
      default:
        return renderOverview()
    }
  }

  const toggleColorScheme = (): void => {
    setColorScheme(computedColorScheme === 'dark' ? 'light' : 'dark')
  }

  return (
    <AppShell
      className="dashboard-shell"
      header={{ height: 76 }}
      navbar={{ width: 280, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding="md"
    >
      <AppShell.Header className="dashboard-header">
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
            <Box>
              <Text size="xs" className="app-eyebrow">
                Modular Runtime
              </Text>
              <Title order={3}>Runtime Dashboard</Title>
            </Box>
          </Group>
          <Group gap="lg">
            <Box className="header-meta">
              <Text size="xs" c="dimmed">
                Last update
              </Text>
              <Text fw={600}>{formattedLastUpdate}</Text>
            </Box>
            <ActionIcon
              variant="default"
              size="lg"
              radius="md"
              onClick={toggleColorScheme}
              aria-label="Toggle color scheme"
              className="theme-toggle"
            >
              <Text size="xs" fw={600}>
                {computedColorScheme === 'dark' ? 'Dark' : 'Light'}
              </Text>
            </ActionIcon>
            <StatusPill status={status} />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar className="dashboard-navbar">
        <Stack h="100%" gap="md" p="md">
          <Box>
            <Text size="xs" className="app-eyebrow">
              Views
            </Text>
            <Stack gap="xs" mt="sm">
              {navItems.map((item) => (
                <NavLink
                  key={item.id}
                  active={activeView === item.id}
                  label={item.label}
                  description={item.description}
                  onClick={() => {
                    setActiveView(item.id)
                    close()
                  }}
                />
              ))}
            </Stack>
          </Box>
          <Divider />
          <Card className="nav-card" padding="md" radius="lg" withBorder>
            <Text size="xs" className="app-eyebrow">
              Topology Stream
            </Text>
            <Text fw={600} mt={6}>
              {streamUrl}
            </Text>
            <Text size="xs" c="dimmed" mt="xs">
              Live feed endpoint for topology updates.
            </Text>
            <Group mt="md" gap="sm">
              <StatusPill status={status} />
              <Text size="xs" c="dimmed">
                Updated {formattedLastUpdate}
              </Text>
            </Group>
          </Card>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main className="dashboard-main">{renderView()}</AppShell.Main>
    </AppShell>
  )
}
