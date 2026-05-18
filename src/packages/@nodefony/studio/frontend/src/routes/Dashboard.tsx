import { observer } from "mobx-react-lite";
import { useEffect, useState } from "react";
import {
  Card,
  Group,
  Grid,
  Stack,
  Text,
  Title,
  Badge,
  RingProgress,
  Skeleton,
} from "@mantine/core";
import {
  IconCpu,
  IconUsers,
  IconRoute,
  IconActivityHeartbeat,
  IconClock,
} from "@tabler/icons-react";
import { useStore, useAuth, useConnection } from "../stores";

interface ServerInfo {
  name: string;
  version: string;
  env: string;
  pid: number;
  node: string;
  platform: string;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

export const Dashboard = observer(() => {
  const auth = useAuth();
  const conn = useConnection();
  const store = useStore();
  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const fetchInfo = () => {
      store.api
        .get<ServerInfo>("/info")
        .then((data) => {
          if (!cancelled) {
            setInfo(data);
            setLoading(false);
          }
        })
        .catch(() => setLoading(false));
    };
    fetchInfo();
    const id = setInterval(fetchInfo, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [store]);

  const heapPct = info
    ? Math.round((info.memory.heapUsed / info.memory.heapTotal) * 100)
    : 0;

  return (
    <Stack gap="lg">
      <Group justify="space-between" align="flex-end">
        <Stack gap={4}>
          <Title order={2}>Dashboard</Title>
          <Text c="dimmed" size="sm">
            Vue d'ensemble runtime — bienvenue {auth.user?.username}.
          </Text>
        </Stack>
        <Badge color={conn.isConnected ? "teal" : "gray"} variant="light" size="lg">
          {conn.isConnected ? "Realtime online" : conn.state}
        </Badge>
      </Group>

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between">
              <Stack gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Environnement
                </Text>
                {loading ? (
                  <Skeleton h={28} w={80} />
                ) : (
                  <Text fw={700} size="xl">
                    {info?.env ?? "n/a"}
                  </Text>
                )}
              </Stack>
              <IconCpu size={32} stroke={1.4} />
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between">
              <Stack gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Uptime
                </Text>
                {loading ? (
                  <Skeleton h={28} w={80} />
                ) : (
                  <Text fw={700} size="xl">
                    {info ? `PID ${info.pid}` : "—"}
                  </Text>
                )}
              </Stack>
              <IconClock size={32} stroke={1.4} />
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between">
              <Stack gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Sessions
                </Text>
                <Text fw={700} size="xl">
                  —
                </Text>
                <Text size="xs" c="dimmed">P10.3 IAdminApi</Text>
              </Stack>
              <IconUsers size={32} stroke={1.4} />
            </Group>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between">
              <Stack gap={2}>
                <Text size="xs" c="dimmed" tt="uppercase" fw={600}>
                  Routes
                </Text>
                <Text fw={700} size="xl">
                  —
                </Text>
                <Text size="xs" c="dimmed">P11.2 http:routes:list</Text>
              </Stack>
              <IconRoute size={32} stroke={1.4} />
            </Group>
          </Card>
        </Grid.Col>
      </Grid>

      <Grid>
        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md" p="lg">
            <Stack gap="md">
              <Group justify="space-between">
                <Title order={4}>Heap V8</Title>
                <IconActivityHeartbeat size={20} stroke={1.4} />
              </Group>
              {loading ? (
                <Skeleton h={120} />
              ) : info ? (
                <Group align="center" gap="xl">
                  <RingProgress
                    size={120}
                    thickness={12}
                    sections={[
                      { value: heapPct, color: heapPct > 80 ? "red" : heapPct > 60 ? "yellow" : "teal" },
                    ]}
                    label={
                      <Text ta="center" size="xs" fw={700}>
                        {heapPct}%
                      </Text>
                    }
                  />
                  <Stack gap={4}>
                    <Text size="sm">
                      <Text span c="dimmed">Heap used: </Text>
                      <Text span fw={600}>{bytes(info.memory.heapUsed)}</Text>
                    </Text>
                    <Text size="sm">
                      <Text span c="dimmed">Heap total: </Text>
                      <Text span fw={600}>{bytes(info.memory.heapTotal)}</Text>
                    </Text>
                    <Text size="sm">
                      <Text span c="dimmed">RSS: </Text>
                      <Text span fw={600}>{bytes(info.memory.rss)}</Text>
                    </Text>
                    <Text size="sm">
                      <Text span c="dimmed">External: </Text>
                      <Text span fw={600}>{bytes(info.memory.external)}</Text>
                    </Text>
                  </Stack>
                </Group>
              ) : (
                <Text c="dimmed">Backend non joignable</Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>

        <Grid.Col span={{ base: 12, md: 6 }}>
          <Card withBorder radius="md" p="lg">
            <Stack gap="sm">
              <Title order={4}>Process</Title>
              {loading ? (
                <Skeleton h={120} />
              ) : info ? (
                <Stack gap={6}>
                  <Group justify="space-between"><Text c="dimmed">Node</Text><Text ff="monospace">{info.node}</Text></Group>
                  <Group justify="space-between"><Text c="dimmed">Platform</Text><Text ff="monospace">{info.platform}</Text></Group>
                  <Group justify="space-between"><Text c="dimmed">Version</Text><Text ff="monospace">{info.version}</Text></Group>
                  <Group justify="space-between"><Text c="dimmed">PID</Text><Text ff="monospace">{info.pid}</Text></Group>
                </Stack>
              ) : (
                <Text c="dimmed">Backend non joignable</Text>
              )}
            </Stack>
          </Card>
        </Grid.Col>
      </Grid>
    </Stack>
  );
});
