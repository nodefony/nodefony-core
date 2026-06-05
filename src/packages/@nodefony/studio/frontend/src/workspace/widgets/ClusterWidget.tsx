import { Badge, Group, SimpleGrid, Text } from "@mantine/core";
import { IconCpu } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { normalize, type HealthPayload } from "../../utils/realtimeHealth";
import { Metric, WorkerTile, fmtMB } from "./_kit";

/**
 * Widget « Workers » — la salle des machines en cluster : une tuile par worker
 * (CPU / heap), forable. En mono, invite à lancer le cluster. Source agrégée master.
 */
function WorkersBody({ source }: WidgetRenderProps<HealthPayload>) {
  const n = normalize(source.data);
  if (!n) return null;
  if (!n.cluster || n.instances.length <= 1) {
    return (
      <Group gap="xs">
        <Badge color="blue" variant="light" size="lg">
          Mono-process
        </Badge>
        <Text size="sm" c="dimmed">
          1 process. Lancez <code>nodefony cluster -w N</code> pour répartir sur
          les cœurs.
        </Text>
      </Group>
    );
  }
  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="xs">
      {n.instances.map((inst) => {
        const p = inst.process;
        const tile = (
          <WorkerTile pid={p?.pid}>
            <Group gap="md">
              <Metric
                label="CPU"
                value={p?.cpuPercent != null ? Math.round(p.cpuPercent) : "—"}
                unit="%"
              />
              <Metric
                label="Heap"
                value={p ? fmtMB(p.heapUsed) : "—"}
                unit="Mo"
              />
            </Group>
          </WorkerTile>
        );
        return p?.pid ? (
          <a
            key={inst.instanceId}
            href={`/nodefony/cluster`}
            style={{ textDecoration: "none", color: "inherit" }}
          >
            {tile}
          </a>
        ) : (
          <div key={inst.instanceId}>{tile}</div>
        );
      })}
    </SimpleGrid>
  );
}

registerWidget<HealthPayload>({
  id: "cluster.workers",
  title: "Workers (cluster)",
  description: "Une tuile par worker (CPU/heap). Mono-process : 1 seule.",
  category: "cluster",
  icon: IconCpu,
  source: {
    kind: "hybrid",
    endpoint: "/nodefony/realtime/api/health",
    channel: "realtime:health",
  },
  clusterAware: true,
  defaultSpan: 8,
  minSpan: 4,
  render: WorkersBody,
});
