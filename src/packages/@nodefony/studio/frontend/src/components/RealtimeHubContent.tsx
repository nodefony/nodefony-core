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
  Switch,
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
  IconJson,
} from "@tabler/icons-react";
import { useConnection, useNotifications, useUi } from "../stores";
import { DocHint } from "./ui";
import type { NoticeLevel } from "nodefony";

/** Version de la doc des fiches d'aide (`DocHint`) du popover Hub. */
const HUB_DOC = "v1.0";

const STATE_META: Record<string, { color: string; label: string }> = {
  connected: { color: "teal", label: "connecté" },
  connecting: { color: "yellow", label: "connexion…" },
  reconnecting: { color: "yellow", label: "reconnexion…" },
  error: { color: "red", label: "erreur" },
  disconnected: { color: "gray", label: "déconnecté" },
};

/** Niveau de notice → couleur Mantine (incidents temps réel). */
const NOTICE_COLOR: Record<NoticeLevel, string> = {
  success: "teal",
  info: "blue",
  warning: "yellow",
  error: "red",
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

/**
 * Libellé d'ancienneté STABLE (anti-clignotement) : « à l'instant » sous 1,5 s, puis
 * secondes/minutes/heures ENTIÈRES. Jamais de ms ni de décimale → pas de bascule d'unité
 * ms↔s ni de digit qui saute à chaque tick (la cause du clignotement). Un canal rapide
 * reste sur « à l'instant » au lieu de faire défiler 200ms/800ms/1.2s.
 */
function sinceLabel(ms: number): string {
  if (ms < 1500) return "à l'instant";
  if (ms < 60000) return `il y a ${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `il y a ${Math.floor(ms / 60000)}min`;
  return `il y a ${Math.floor(ms / 3600000)}h`;
}

const ELLIPSIS = {
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap" as const,
};

/**
 * Cadence (ms) d'un canal cadencé, lue depuis le suffixe `:<ms>` de son nom (convention
 * `rateChannel`). `null` si le canal n'est pas cadencé (pas de suffixe numérique). Sous
 * cadence auto (AIMD), ce suffixe EST la cadence réelle en cours (la socket ré-abonne à
 * `base:<ms>`) → la table du Hub montre la cadence vivante par canal.
 */
function channelCadenceMs(channel: string): number | null {
  const tail = channel.slice(channel.lastIndexOf(":") + 1);
  const ms = Number.parseInt(tail, 10);
  return Number.isFinite(ms) && ms > 0 && String(ms) === tail ? ms : null;
}

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

// Style de carte canal hoisté (réf stable — pas recréé par render). `contain:content`
// isole reflow/paint à la carte (le tick 1 s ne repeint pas toute la liste).
const SUB_CARD_STYLE = { contain: "content" as const };

// Pastille d'activité : teal vif quand actif, gris atténué sinon. On anime UNIQUEMENT
// `opacity` (compositor, pas de repaint) — PAS de box-shadow/glow qui « bat » à chaque
// tick (paint coûteux = le clignotement). Réf de style stable par état (2 constantes).
const DOT_BASE = {
  width: 9,
  height: 9,
  borderRadius: "50%",
  flexShrink: 0,
  transition: "opacity 0.5s ease, background-color 0.5s ease",
} as const;
const DOT_ACTIVE = {
  ...DOT_BASE,
  background: "var(--mantine-color-teal-5)",
  opacity: 1,
};
const DOT_IDLE = {
  ...DOT_BASE,
  background: "var(--mantine-color-gray-6)",
  opacity: 0.55,
};
function ActivityDot({ active }: { active: boolean }) {
  return <Box style={active ? DOT_ACTIVE : DOT_IDLE} />;
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
    const ui = useUi();
    const notif = useNotifications();
    const incidents = notif.realtimeIncidents;
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
        {/* ── Cadence auto (AIMD) — réglage GLOBAL de la socket, partagé avec le store
            (même valeur que le switch de la console /nodefony/hub). ── */}
        <Group justify="space-between" align="center" wrap="nowrap" gap="xs">
          <Switch
            size="sm"
            checked={ui.adaptiveCadence}
            onChange={(e) => ui.setAdaptiveCadence(e.currentTarget.checked)}
            label="Cadence auto (AIMD)"
            aria-label="cadence adaptative globale de la socket Nodefony"
          />
          <DocHint
            title="Cadence auto (AIMD)"
            version={HUB_DOC}
            summary="Réglage GLOBAL de la Socket Nodefony (même valeur partout)."
            sections={[
              {
                label: "Principe",
                body: "Cadence adaptative (façon « ABR » vidéo) : la socket surveille le rythme réel d'arrivée sur chaque canal ; si le serveur prend du retard, elle RALENTIT seule puis RÉACCÉLÈRE quand c'est fluide.",
              },
              {
                label: "Effet",
                body: "Les pages suivent ce réglage ; la cadence réelle par canal se lit via le badge « ~Xs ».",
              },
            ]}
          />
        </Group>

        {/* ── Carte connexion ── */}
        <Paper withBorder p="sm" radius="md">
          <Stack gap={10}>
            <Group justify="space-between" wrap="nowrap">
              <Group gap="xs" wrap="nowrap" style={{ minWidth: 0 }}>
                <ThemeIcon
                  size="lg"
                  radius="md"
                  variant="light"
                  color={meta.color}
                >
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
                    <Badge
                      size="xs"
                      variant="light"
                      color="gray"
                      leftSection={<IconJson size={10} />}
                      title="Protocole de la socket"
                    >
                      JSON-RPC 2.0
                    </Badge>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {conn.latencyMs != null
                      ? `${conn.latencyMs} ms`
                      : "latence —"}{" "}
                    · uptime {uptime}
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
                      {copied ? (
                        <IconCheck size={14} />
                      ) : (
                        <IconCopy size={14} />
                      )}
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
                ? ` · dernière ${sinceLabel(now - conn.lastFrameAt)}`
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

        {/* ── Incidents temps réel ── criticités normalisées (close codes RFC
            6455 interprétés côté client, erreurs serveur poussées) qui cassent
            le temps réel. Distinct de « dernière erreur » : historique borné. */}
        {incidents.length > 0 && (
          <div>
            <Divider
              label={`Incidents temps réel (${incidents.length})`}
              labelPosition="left"
              mb="xs"
            />
            <ScrollArea.Autosize mah={180} type="auto">
              <Stack gap={6} role="log" aria-label="Incidents temps réel">
                {incidents.slice(0, 8).map((n, i) => (
                  <Paper key={`${n.ts}-${i}`} withBorder p="xs" radius="md">
                    <Group justify="space-between" wrap="nowrap" gap="xs">
                      <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                        <Badge
                          size="xs"
                          variant="light"
                          color={NOTICE_COLOR[n.level]}
                          style={{ flexShrink: 0 }}
                        >
                          {n.level}
                        </Badge>
                        <Text size="xs" style={ELLIPSIS}>
                          {n.message}
                        </Text>
                      </Group>
                      <Text
                        size="xs"
                        c="dimmed"
                        style={{
                          whiteSpace: "nowrap",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {n.code != null ? `${n.code} · ` : ""}
                        {sinceLabel(Math.max(0, now - n.ts))}
                      </Text>
                    </Group>
                  </Paper>
                ))}
              </Stack>
            </ScrollArea.Autosize>
          </div>
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
                    <Paper
                      key={s.channel}
                      withBorder
                      p="xs"
                      radius="md"
                      style={SUB_CARD_STYLE}
                    >
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
                                color={
                                  TRANSPORT_COLOR[s.transport ?? "ws"] ?? "gray"
                                }
                                style={{ flexShrink: 0 }}
                              >
                                {s.transport ?? "ws"}
                              </Badge>
                              <Text size="xs" c="dimmed" style={ELLIPSIS}>
                                {s.protocol ?? "—"}
                                {s.peer ? ` → ${s.peer}` : ""}
                              </Text>
                              {(() => {
                                const ms = channelCadenceMs(s.channel);
                                return ms != null ? (
                                  <Badge
                                    size="xs"
                                    variant="outline"
                                    color="grape"
                                    style={{
                                      flexShrink: 0,
                                      fontVariantNumeric: "tabular-nums",
                                    }}
                                    title="Cadence du canal (suffixe :ms). Sous cadence auto, c'est la valeur ajustée par l'AIMD."
                                  >
                                    ~{ms < 1000 ? `${ms}ms` : `${ms / 1000}s`}
                                  </Badge>
                                ) : null;
                              })()}
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
                              {ageMs != null ? sinceLabel(ageMs) : "—"}
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
                            variant="light"
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
