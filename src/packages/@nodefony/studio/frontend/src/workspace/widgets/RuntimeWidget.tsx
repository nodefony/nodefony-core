import { Badge, Group, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconRocket } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { Metric, fmtUptime } from "./_kit";

/** Sous-ensemble de `/nodefony/kernel/api/info` (miroir, frontière isomorphe). */
export interface KernelInfo {
  version: string;
  environment: string;
  node: string;
  uptime: number;
  modules: number;
  domain: string;
  pid: number;
  platform: string;
  git?: { branch?: string; commit?: string };
}

/**
 * Widget « Mode & lancement » — cluster-aware : la topologie vient de `ctx`
 * (dérivé de `realtime:health` master). En cluster → badge Cluster + N workers.
 */
function RuntimeModeBody({ source, ctx }: WidgetRenderProps<KernelInfo>) {
  const info = source.data;
  if (!info) return null;
  const label = ctx.cluster
    ? "Cluster"
    : info.environment === "development"
      ? "Développement"
      : "Production";
  const color = ctx.cluster
    ? "grape"
    : info.environment === "development"
      ? "teal"
      : "blue";
  return (
    <Stack gap="xs">
      <Group gap="xs">
        <Badge color={color} variant="light" size="lg">
          {label}
        </Badge>
        <Badge variant="light" color="gray">
          {ctx.cluster ? `${ctx.instanceCount} workers` : "1 process"}
        </Badge>
        <Badge variant="outline" color="gray">
          {info.environment}
        </Badge>
      </Group>
      <SimpleGrid cols={2} spacing="xs">
        <Metric label="Node" value={info.node} />
        <Metric label="Uptime" value={fmtUptime(info.uptime)} />
        <Metric label="Modules" value={info.modules} />
        <Metric label="PID" value={info.pid} />
      </SimpleGrid>
      <Text size="xs" c="dimmed" ff="monospace">
        {info.git?.branch ?? "?"} @ {info.git?.commit ?? "?"}
      </Text>
    </Stack>
  );
}

registerWidget<KernelInfo>({
  id: "runtime.mode",
  title: "Mode & lancement",
  description: "Comment ce serveur tourne : environnement, topologie, workers.",
  category: "runtime",
  icon: IconRocket,
  source: { kind: "snapshot", endpoint: "/nodefony/kernel/api/info" },
  clusterAware: true,
  defaultSpan: 6,
  minSpan: 4,
  render: RuntimeModeBody,
});
