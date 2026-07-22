import { useEffect, useState } from "react";
import { Box, Group, Stack, Text } from "@mantine/core";
import { IconFileText } from "@tabler/icons-react";
import { registerWidget } from "../registry";
import type { WidgetRenderProps } from "../types";
import { ansiToReact } from "../../utils/ansiToReact";
import type { LogRecord } from "../../routes/logs/logsTypes";
import {
  fmtClock,
  isAlertSeverity,
  recordMessage,
  toRecord,
} from "../../routes/logs/logFormat";
import { SeverityBadge } from "../../routes/logs/LogVisuals";
import { PLATFORM_CHANNELS } from "nodefony";

/** Frame coalescée du canal `nodefony:syslog` : `{ logs:[...], dropped }`. */
interface LogFrame {
  logs?: unknown[];
  dropped?: number;
}
const MAX = 12;

/** Extrait les LogRecord d'une frame (tableau coalescé, ou enregistrement seul). */
function extractRecords(frame: unknown): LogRecord[] {
  if (!frame || typeof frame !== "object") return [];
  const f = frame as LogFrame;
  const items = Array.isArray(f.logs) ? f.logs : [frame];
  const out: LogRecord[] = [];
  for (const it of items) {
    const r = toRecord(it);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Widget « Logs (live) » — flux `nodefony:syslog`. RÉUTILISE les briques de la page
 * Logs (`toRecord` / `recordMessage` / `ansiToReact` / `SeverityBadge`) → même rendu
 * que la console (sévérités colorées, ANSI, lignes d'alerte surlignées). Le `WidgetHost`
 * pousse la dernière frame via `source.data` ; on en garde un petit ring (tail).
 */
function LogsBody({ source }: WidgetRenderProps<LogFrame>) {
  const [ring, setRing] = useState<LogRecord[]>([]);
  const frame = source.data;
  useEffect(() => {
    if (!frame) return;
    const recs = extractRecords(frame);
    if (recs.length === 0) return;
    setRing((r) => {
      const next = [...r, ...recs];
      return next.length > MAX ? next.slice(-MAX) : next;
    });
  }, [frame]);

  if (ring.length === 0)
    return (
      <Text size="sm" c="dimmed">
        En attente de logs…
      </Text>
    );

  return (
    <Stack
      gap={1}
      style={{
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 12,
      }}
    >
      {ring
        .slice()
        .reverse()
        .map((rec, i) => {
          const alert = isAlertSeverity(rec.severityName);
          return (
            <Group
              key={`${rec.uid}-${i}`}
              gap={6}
              wrap="nowrap"
              align="flex-start"
              style={{
                padding: "1px 4px",
                borderRadius: 4,
                background: alert
                  ? "var(--mantine-color-red-light)"
                  : undefined,
              }}
            >
              <Text
                size="xs"
                c="dimmed"
                style={{
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                  opacity: 0.7,
                }}
              >
                {fmtClock(rec.timeStamp)}
              </Text>
              <Box style={{ flexShrink: 0 }}>
                <SeverityBadge severity={rec.severityName} />
              </Box>
              {rec.moduleName ? (
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ flexShrink: 0, maxWidth: 90 }}
                  truncate
                >
                  {rec.moduleName}
                </Text>
              ) : null}
              <Text size="xs" style={{ wordBreak: "break-word", minWidth: 0 }}>
                {ansiToReact(recordMessage(rec))}
              </Text>
            </Group>
          );
        })}
    </Stack>
  );
}

registerWidget<LogFrame>({
  id: "logs.live",
  tags: ["logs", "liste"],
  title: "Logs (live)",
  description: "Flux des derniers logs du serveur (ANSI + sévérités colorées).",
  category: "logs",
  icon: IconFileText,
  source: { kind: "live", channel: PLATFORM_CHANNELS.syslog },
  defaultSpan: 6,
  minSpan: 4,
  render: LogsBody,
});
