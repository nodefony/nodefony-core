import { Group, Text } from "@mantine/core";
import { IconDatabase } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { ClusterView } from "../ClusterView";
import {
  normalize,
  type HealthPayload,
  type InstanceHealth,
} from "../../utils/realtimeHealth";
import { Metric, WorkerTile } from "./_kit";

function OrmInstance({ inst }: { inst: InstanceHealth }) {
  const o = inst.orm;
  return (
    <WorkerTile pid={inst.process?.pid}>
      {o ? (
        <Group gap="md">
          <Metric
            label="Connecteurs"
            value={`${o.connected}/${o.connectors}`}
          />
          <Metric label="Requêtes" value={o.queryTotal} />
        </Group>
      ) : (
        <Text size="xs" c="dimmed">
          ORM non sondé
        </Text>
      )}
    </WorkerTile>
  );
}

/**
 * Widget « ORM » — santé lean agrégée master (`totals.orm` pod, `instances[].orm`
 * par worker). Cumuls monotones (count ≠ rate → pas de couleur d'alarme).
 */
function OrmBody({ source }: WidgetRenderProps<HealthPayload>) {
  return (
    <ClusterView
      normalized={normalize(source.data)}
      renderInstance={(inst) => <OrmInstance inst={inst} />}
      renderSummary={(t) => {
        const o = t.orm;
        if (!o)
          return (
            <Text size="sm" c="dimmed">
              Aucun driver ORM sondé.
            </Text>
          );
        return (
          <Group gap="xl">
            <Metric
              label="Connecteurs"
              value={`${o.connected}/${o.connectors}`}
            />
            <Metric label="Requêtes" value={o.queryTotal} />
            <Metric
              label="EWMA max"
              value={o.maxEwmaMs != null ? o.maxEwmaMs.toFixed(2) : "—"}
              unit="ms"
            />
          </Group>
        );
      }}
      drillTo={() => "/nodefony/orm"}
    />
  );
}

registerWidget<HealthPayload>({
  id: "orm.health",
  title: "ORM",
  description: "Connecteurs, requêtes et latence ORM (agrégé pod en cluster).",
  category: "orm",
  icon: IconDatabase,
  source: {
    kind: "hybrid",
    endpoint: "/nodefony/realtime/api/health",
    channel: "realtime:health",
  },
  clusterAware: true,
  defaultSpan: 6,
  minSpan: 4,
  render: OrmBody,
});
