import { Badge, SimpleGrid, Stack, Text } from "@mantine/core";
import { IconBroadcast } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { normalize, type HealthPayload } from "../../utils/realtimeHealth";
import { BigMetric, Metric, fmtMB, useLiveSeries, useRate } from "./_kit";
import { PLATFORM_CHANNELS } from "nodefony";

/**
 * Widget « Socket Nodefony » — débit fan-out/s DÉRIVÉ du cumul + courbe, canaux,
 * connexions et backpressure (risque mémoire #1). Totaux pod (valides mono ET cluster).
 */
function HubBody({ source }: WidgetRenderProps<HealthPayload>) {
  const norm = normalize(source.data);
  const t = norm?.totals ?? null;
  const rate = useRate(t?.fanoutTotal, norm?.ts);
  const series = useLiveSeries(rate != null ? Math.round(rate) : null);
  if (!t) return null;
  const bp = t.backpressure;
  return (
    <Stack gap="xs">
      <BigMetric
        label="Fan-out / s"
        value={rate != null ? Math.round(rate) : null}
        unit="msg/s"
        color="cyan"
        series={series}
      />
      <SimpleGrid cols={2} spacing="xs">
        <Metric label="Canaux" value={t.channelCount} />
        <Metric label="Connexions" value={t.connectionCount} />
        <Metric
          label="Backpressure"
          value={fmtMB(bp.totalBufferedAmount)}
          unit="Mo"
        />
        <div>
          <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
            Consommateurs lents
          </Text>
          <Badge
            color={bp.slowConsumers > 0 ? "orange" : "teal"}
            variant="light"
            size="lg"
          >
            {bp.slowConsumers}
          </Badge>
        </div>
      </SimpleGrid>
    </Stack>
  );
}

registerWidget<HealthPayload>({
  id: "realtime.hub",
  tags: ["realtime", "panneau"],
  title: "Socket Nodefony",
  description: "Débit fan-out/s + courbe, canaux, connexions, backpressure.",
  category: "realtime",
  icon: IconBroadcast,
  source: {
    kind: "hybrid",
    endpoint: "/nodefony/realtime/api/health",
    channel: PLATFORM_CHANNELS.socket,
  },
  defaultSpan: 6,
  minSpan: 4,
  render: HubBody,
});
