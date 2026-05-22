import { observer } from "mobx-react-lite";
import { useEffect, useState, type ReactNode } from "react";
import {
  Stack,
  Group,
  Text,
  Badge,
  Divider,
  Alert,
  Code,
  ScrollArea,
  Paper,
  ThemeIcon,
  ActionIcon,
  Tooltip,
  CopyButton,
  Box,
  SimpleGrid,
  Button,
  Loader,
} from "@mantine/core";
import {
  IconPlugConnected,
  IconPlugX,
  IconReload,
  IconAlertCircle,
  IconActivity,
  IconX,
  IconCopy,
  IconCheck,
  IconBolt,
  IconMessages,
  IconExternalLink,
} from "@tabler/icons-react";
import { useConnection } from "../stores";

const STATE_META: Record<string, { color: string; label: string }> = {
  connected: { color: "teal", label: "connecté" },
  connecting: { color: "yellow", label: "connexion…" },
  reconnecting: { color: "yellow", label: "reconnexion…" },
  error: { color: "red", label: "erreur" },
  disconnected: { color: "gray", label: "déconnecté" },
};

/** Couleur du badge transport (ws/sse/webrtc/tcp…) — protocole encapsulé à côté. */
const TRANSPORT_COLOR: Record<string, string> = {
  ws: "indigo",
  sse: "grape",
  webrtc: "teal",
  tcp: "orange",
};

function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function fmtAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}min`;
}

const ELLIPSIS = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

/** Nb de barres affichées dans le VU-mètre (les + récentes à droite). */
const METER_BARS = 24;

/** VU-mètre SVG style « son » — barres verticales du débit (recharts cassé R19 →
 *  maison, cf mémoire feedback_recharts_react19). Opacité croissante = égaliseur. */
function BarMeter({ data, color }: { data: number[]; color: string }) {
  const w = 80;
  const h = 20;
  const gap = 1;
  const bars = data.slice(-METER_BARS);
  const n = bars.length;
  if (n === 0) return <Box w={w} h={h} />;
  const max = Math.max(1, ...bars);
  const bw = (w - gap * (n - 1)) / n;
  return (
    <svg width={w} height={h} style={{ display: "block" }} aria-hidden>
      {bars.map((v, i) => {
        const bh = v > 0 ? Math.max(1.5, (v / max) * h) : 1;
        const x = i * (bw + gap);
        const op = 0.3 + 0.7 * (i / Math.max(1, n - 1));
        return (
          <rect
            key={i}
            x={x.toFixed(1)}
            y={(h - bh).toFixed(1)}
            width={bw.toFixed(1)}
            height={bh.toFixed(1)}
            rx={Math.min(1, bw / 2)}
            fill={color}
            opacity={v > 0 ? op : 0.18}
          />
        );
      })}
    </svg>
  );
}

/** Pastille d'activité : brille (glow teal) quand un message vient d'arriver. */
function ActivityDot({ active }: { active: boolean }) {
  return (
    <Box
      w={9}
      h={9}
      style={{
        borderRadius: "50%",
        flexShrink: 0,
        background: active
          ? "var(--mantine-color-teal-5)"
          : "var(--mantine-color-gray-5)",
        boxShadow: active ? "0 0 7px 1px var(--mantine-color-teal-5)" : "none",
        transition: "background 0.3s ease, box-shadow 0.3s ease",
      }}
    />
  );
}

function StatTile({
  icon,
  label,
  value,
  accent,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <Paper withBorder p="xs" radius="md">
      <Group gap={6} wrap="nowrap">
        <ThemeIcon
          size="sm"
          radius="md"
          variant="light"
          color={accent ? "teal" : "gray"}
        >
          {icon}
        </ThemeIcon>
        <div style={{ minWidth: 0 }}>
          <Text
            fw={700}
            size="md"
            lh={1}
            style={{
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            {value}
          </Text>
          <Text size="xs" c="dimmed">
            {label}
          </Text>
        </div>
      </Group>
    </Paper>
  );
}

/**
 * RealtimeHubContent — contenu « béton » du hub temps réel : carte connexion
 * (état animé + latence + uptime live + endpoint copiable + reconnect), stats
 * agrégées, puis par canal VU-mètre de débit + activité + coupure.
 *
 * Réutilisé tel quel dans le **HoverCard du chip topbar** (aperçu) et dans la
 * **console Realtime**. `onOpenConsole` ajoute un pied « Ouvrir la console ».
 * L'horloge locale (âges/uptime) ne tourne QUE pendant que ce composant est
 * monté (popover ouvert) → 0 timer sinon.
 */
export const RealtimeHubContent = observer(
  ({ onOpenConsole }: { onOpenConsole?: () => void }) => {
    const conn = useConnection();
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
      const id = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(id);
    }, []);

    const subs = Array.from(conn.activeSubscriptions.values()).sort((a, b) =>
      a.channel.localeCompare(b.channel),
    );
    const meta = STATE_META[conn.state] ?? STATE_META.disconnected;
    const uptime = conn.connectedAt ? fmtUptime(now - conn.connectedAt) : "—";
    const aggRate = subs.reduce((acc, s) => acc + s.rate, 0);
    const busy = conn.state === "connecting" || conn.state === "reconnecting";

    return (
      <Stack gap="md">
        {/* ── Carte connexion ── */}
        <Paper withBorder p="sm" radius="md">
          <Stack gap={10}>
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <ThemeIcon size="lg" radius="md" variant="light" color={meta.color}>
                  {conn.isConnected ? (
                    <IconPlugConnected size={18} />
                  ) : (
                    <IconPlugX size={18} />
                  )}
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <Text fw={600} size="sm" c={`${meta.color}.6`}>
                      {meta.label}
                    </Text>
                    {busy && <Loader size={12} color={meta.color} />}
                  </Group>
                  <Text size="xs" c="dimmed">
                    {conn.latencyMs != null ? `${conn.latencyMs} ms` : "latence —"} ·
                    uptime {uptime}
                  </Text>
                </div>
              </Group>
              <Tooltip label="Reconnecter">
                <ActionIcon
                  variant="subtle"
                  color={meta.color}
                  onClick={() => conn.reconnect()}
                  aria-label="reconnect"
                >
                  <IconReload size={16} />
                </ActionIcon>
              </Tooltip>
            </Group>

            <Group gap={4} wrap="nowrap">
              <Code style={{ flex: 1, minWidth: 0, ...ELLIPSIS }}>
                {conn.endpointUrl || "—"}
              </Code>
              <CopyButton value={conn.endpointUrl}>
                {({ copied, copy }) => (
                  <Tooltip label={copied ? "Copié" : "Copier l'URL"}>
                    <ActionIcon
                      variant="subtle"
                      color={copied ? "teal" : "gray"}
                      onClick={copy}
                      aria-label="copy url"
                    >
                      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
                    </ActionIcon>
                  </Tooltip>
                )}
              </CopyButton>
            </Group>

            <Text
              size="xs"
              c={conn.framesReceived > 0 ? "teal.6" : "dimmed"}
              style={{
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {conn.framesReceived.toLocaleString()} frames reçues
              {conn.lastFrameAt
                ? ` · dernière il y a ${fmtAge(now - conn.lastFrameAt)}`
                : " · aucune"}
              {conn.lastFrameMethod ? ` · ${conn.lastFrameMethod}` : ""}
            </Text>
          </Stack>
        </Paper>

        {conn.lastError && (
          <Alert
            color="orange"
            icon={<IconAlertCircle size={16} />}
            title="Dernière erreur"
            variant="light"
            p="xs"
          >
            <Text size="xs">{conn.lastError}</Text>
          </Alert>
        )}

        {/* ── Stats agrégées ── */}
        <SimpleGrid cols={3} spacing="xs">
          <StatTile
            icon={<IconMessages size={16} />}
            label="messages"
            value={conn.totalMessages.toLocaleString()}
          />
          <StatTile
            icon={<IconBolt size={16} />}
            label="débit/s"
            value={String(aggRate)}
            accent={aggRate > 0}
          />
          <StatTile
            icon={<IconActivity size={16} />}
            label="canaux"
            value={String(conn.subscriptionCount)}
          />
        </SimpleGrid>

        {/* ── Canaux abonnés ── */}
        <div>
          <Divider
            label={`Canaux abonnés (${subs.length})`}
            labelPosition="left"
            mb="xs"
          />
          <ScrollArea.Autosize mah={300} type="auto">
            {subs.length === 0 ? (
              <Paper withBorder p="md" radius="md">
                <Text size="sm" c="dimmed" ta="center">
                  Aucun canal abonné actuellement.
                </Text>
              </Paper>
            ) : (
              <Stack gap="xs">
                {subs.map((s) => {
                  const ageMs = s.lastMessage
                    ? Math.max(0, now - s.lastMessage)
                    : null;
                  const active = ageMs != null && ageMs < 1500;
                  return (
                    <Paper key={s.channel} withBorder p="xs" radius="md">
                      <Group justify="space-between" wrap="nowrap" gap="xs">
                        <Group
                          gap={8}
                          wrap="nowrap"
                          style={{ minWidth: 0, flex: 1 }}
                        >
                          <ActivityDot active={active} />
                          <div style={{ minWidth: 0 }}>
                            <Code style={{ ...ELLIPSIS, display: "block" }}>
                              {s.channel}
                            </Code>
                            <Group
                              gap={5}
                              wrap="nowrap"
                              mt={3}
                              style={{ minWidth: 0 }}
                            >
                              <Badge
                                size="xs"
                                variant="light"
                                color={TRANSPORT_COLOR[s.transport ?? "ws"] ?? "gray"}
                                style={{ flexShrink: 0 }}
                              >
                                {s.transport ?? "ws"}
                              </Badge>
                              <Text size="xs" c="dimmed" style={ELLIPSIS}>
                                {s.protocol ?? "—"}
                                {s.peer ? ` → ${s.peer}` : ""}
                              </Text>
                            </Group>
                            <Text
                              size="xs"
                              c="dimmed"
                              style={{
                                fontVariantNumeric: "tabular-nums",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {s.msgCount.toLocaleString()} msg ·{" "}
                              {ageMs != null ? `il y a ${fmtAge(ageMs)}` : "—"}
                            </Text>
                          </div>
                        </Group>
                        <Group gap={8} wrap="nowrap">
                          <BarMeter
                            data={s.series}
                            color="var(--mantine-color-teal-5)"
                          />
                          <Badge
                            size="sm"
                            variant={s.rate > 0 ? "filled" : "light"}
                            color={s.rate > 0 ? "teal" : "gray"}
                            miw={46}
                            style={{ fontVariantNumeric: "tabular-nums" }}
                          >
                            {s.rate}/s
                          </Badge>
                          <Tooltip label="Couper ce canal">
                            <ActionIcon
                              variant="subtle"
                              color="red"
                              size="sm"
                              onClick={() => conn.unsubscribe(s.channel)}
                              aria-label={`couper ${s.channel}`}
                            >
                              <IconX size={14} />
                            </ActionIcon>
                          </Tooltip>
                        </Group>
                      </Group>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </ScrollArea.Autosize>
        </div>

        {onOpenConsole && (
          <Button
            variant="light"
            size="xs"
            fullWidth
            leftSection={<IconExternalLink size={14} />}
            onClick={onOpenConsole}
          >
            Ouvrir le Realtime Hub
          </Button>
        )}
      </Stack>
    );
  },
);
