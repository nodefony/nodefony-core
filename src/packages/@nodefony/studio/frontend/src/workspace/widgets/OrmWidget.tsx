import { Group, Stack, Text } from "@mantine/core";
import { IconDatabase } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { ClusterView } from "../ClusterView";
import { normalize, type HealthPayload } from "../../utils/realtimeHealth";
import { BigMetric, Metric, WorkerTile, useLiveSeries, useRate } from "./_kit";

/**
 * Widget « ORM » — débit requêtes/s DÉRIVÉ du cumul `totals.orm.queryTotal` + courbe,
 * connecteurs et latence EWMA. Agrégé master (cohérent en cluster). Cumuls monotones
 * (count ≠ rate → pas de couleur d'alarme).
 */
function OrmBody({ source }: WidgetRenderProps<HealthPayload>) {
  const norm = normalize(source.data);
  const o = norm?.totals.orm ?? null;
  const rate = useRate(o?.queryTotal, norm?.ts);
  const series = useLiveSeries(rate != null ? Math.round(rate) : null);
  return (
    <ClusterView
      normalized={norm}
      renderSummary={(t) => {
        const orm = t.orm;
        if (!orm)
          return (
            <Text size="sm" c="dimmed">
              Aucun driver ORM sondé.
            </Text>
          );
        return (
          <Stack gap="xs">
            <BigMetric
              label="Requêtes / s"
              value={rate != null ? Math.round(rate) : null}
              unit="req/s"
              color="grape"
              series={series}
            />
            <Group gap="xl">
              <Metric
                label="Connecteurs"
                value={`${orm.connected}/${orm.connectors}`}
              />
              <Metric label="Total" value={orm.queryTotal} />
              <Metric
                label="EWMA max"
                value={orm.maxEwmaMs != null ? orm.maxEwmaMs.toFixed(2) : "—"}
                unit="ms"
              />
            </Group>
          </Stack>
        );
      }}
      renderInstance={(inst) => {
        const oi = inst.orm;
        return (
          <WorkerTile pid={inst.process?.pid}>
            {oi ? (
              <Group gap="md">
                <Metric
                  label="Connecteurs"
                  value={`${oi.connected}/${oi.connectors}`}
                />
                <Metric label="Requêtes" value={oi.queryTotal} />
              </Group>
            ) : (
              <Text size="xs" c="dimmed">
                ORM non sondé
              </Text>
            )}
          </WorkerTile>
        );
      }}
      drillTo={() => "/nodefony/orm"}
    />
  );
}

registerWidget<HealthPayload>({
  id: "orm.health",
  title: "ORM",
  description: "Débit requêtes/s + courbe, connecteurs, latence (agrégé pod).",
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
