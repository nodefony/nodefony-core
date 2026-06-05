import { SimpleGrid } from "@mantine/core";
import { IconBroadcast } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { normalize, type HealthPayload } from "../../utils/realtimeHealth";
import { Metric, fmtMB } from "./_kit";

/**
 * Widget « Socket Nodefony » — KPIs du hub realtime (totaux pod, valides mono ET
 * cluster via `normalize().totals`). Backpressure = risque mémoire #1 à surveiller.
 */
function HubBody({ source }: WidgetRenderProps<HealthPayload>) {
  const n = normalize(source.data);
  if (!n) return null;
  const t = n.totals;
  return (
    <SimpleGrid cols={2} spacing="xs">
      <Metric label="Canaux" value={t.channelCount} />
      <Metric label="Connexions" value={t.connectionCount} />
      <Metric label="Fan-out" value={t.fanoutTotal} />
      <Metric
        label="Backpressure"
        value={fmtMB(t.backpressure.totalBufferedAmount)}
        unit="Mo"
      />
    </SimpleGrid>
  );
}

registerWidget<HealthPayload>({
  id: "realtime.hub",
  title: "Socket Nodefony",
  description: "Canaux, connexions, fan-out et backpressure du hub temps réel.",
  category: "realtime",
  icon: IconBroadcast,
  source: {
    kind: "hybrid",
    endpoint: "/nodefony/realtime/api/health",
    channel: "realtime:health",
  },
  defaultSpan: 6,
  minSpan: 4,
  render: HubBody,
});
