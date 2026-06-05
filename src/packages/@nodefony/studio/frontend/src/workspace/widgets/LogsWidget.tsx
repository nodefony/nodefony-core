import { useEffect, useState } from "react";
import { Badge, Group, Stack, Text } from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { safeStringify } from "../../components/ui";

/** Sous-ensemble d'un Pdu syslog (miroir tolérant — champs optionnels). */
interface PduLite {
  severityName?: string;
  severity?: number | string;
  msgid?: string;
  payload?: unknown;
}

const MAX = 8;
const SEV_COLOR: Record<string, string> = {
  EMERGENCY: "red",
  ALERT: "red",
  CRITICAL: "red",
  CRITIC: "red",
  ERROR: "red",
  WARNING: "orange",
  NOTICE: "blue",
  INFO: "gray",
  DEBUG: "gray",
};

function sevLabel(p: PduLite): string {
  const s =
    p.severityName ?? (typeof p.severity === "string" ? p.severity : "");
  return s.toUpperCase();
}
function payloadText(p: PduLite): string {
  if (typeof p.payload === "string") return p.payload;
  if (p.payload == null) return "";
  return safeStringify(p.payload);
}

/**
 * Widget « Logs (live) » — flux `syslog:stream`. Le `WidgetHost` pousse le dernier
 * Pdu via `source.data` ; on en garde un petit ring local (tail). Non cluster-aware
 * (le WS tombe sur le worker courant — vue cluster des logs = page Logs dédiée).
 */
function LogsBody({ source }: WidgetRenderProps<PduLite>) {
  const [ring, setRing] = useState<PduLite[]>([]);
  const pdu = source.data;
  useEffect(() => {
    if (!pdu) return;
    setRing((r) => [...r.slice(-(MAX - 1)), pdu]);
  }, [pdu]);

  if (ring.length === 0)
    return (
      <Text size="sm" c="dimmed">
        En attente de logs…
      </Text>
    );

  return (
    <Stack gap={2}>
      {ring
        .slice()
        .reverse()
        .map((p, i) => {
          const sev = sevLabel(p);
          return (
            <Group key={i} gap="xs" wrap="nowrap">
              <Badge
                size="xs"
                variant="light"
                color={SEV_COLOR[sev] ?? "gray"}
                style={{ flexShrink: 0 }}
              >
                {sev || "LOG"}
              </Badge>
              {p.msgid ? (
                <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
                  {p.msgid}
                </Text>
              ) : null}
              <Text size="xs" truncate>
                {payloadText(p)}
              </Text>
            </Group>
          );
        })}
    </Stack>
  );
}

registerWidget<PduLite>({
  id: "logs.live",
  title: "Logs (live)",
  description: "Flux des derniers logs du serveur en temps réel.",
  category: "logs",
  icon: IconFileText,
  source: { kind: "live", channel: "syslog:stream" },
  defaultSpan: 6,
  minSpan: 4,
  render: LogsBody,
});
