import { useMemo, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import {
  Badge,
  Button,
  Code,
  Divider,
  Group,
  Modal,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import {
  IconArrowRight,
  IconBolt,
  IconBook,
  IconDatabase,
} from "@tabler/icons-react";
import { KeyValue, DefinitionList } from "../../components/ui";
import "../../workspace/widgets"; // side-effect : peuple le registre de blocs
import { BlockView, getBlock } from "../../blocks";
import type { NormalizedHealth } from "../../utils/realtimeHealth";
import { useTwinLive } from "./twinLive";
import {
  ARCH_NODE_INFO,
  useRecentLogActivity,
  type ArchNodeId,
  type LogPulse,
} from "./twinArchitecture";
import type { ConnectorRow, KernelInfo } from "./useTwinTopology";

/* ════════════════════════════════════════════════════════════════════════
 * TwinNodePanel — la boîte ⓘ (dialog d'EXPLICATIONS) du Jumeau.
 *
 * Ouverte par l'icône ⓘ d'une brique. Montre ce qui s'y passe en direct +
 * une section « Liens & docs » (emplacement des futurs extraits de doc ciblés
 * tirés du portail `/nodefony/documentation`). Gère les briques d'archi
 * (ArchNodeId) ET les connecteurs réels (`conn-<name>`).
 * ════════════════════════════════════════════════════════════════════════ */

function fmt(n: number | undefined | null): string {
  if (n === undefined || n === null || Number.isNaN(n)) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
function fmtBytes(n: number | undefined): string {
  if (!n) return "—";
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1)} Mo`;
}
function fmtUptime(s: number | undefined): string {
  if (!s) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h${m}` : `${h}h`;
}
function sevColor(s: string): string {
  if (/(emerg|alert|crit|error|err)/.test(s)) return "red";
  if (/warn/.test(s)) return "yellow";
  if (/(notice|info)/.test(s)) return "blue";
  return "gray";
}
function vendorColor(vendor: string): string {
  const v = vendor.toLowerCase();
  if (v.includes("drizzle")) return "lime";
  if (v.includes("mongoose")) return "green";
  return "teal";
}

/** Bouton de forage vers une page Studio (ferme le dialog avant de naviguer). */
function GoTo({
  href,
  label,
  icon,
  onClose,
}: {
  href: string;
  label: string;
  icon?: ReactNode;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  return (
    <Button
      variant="light"
      size="xs"
      leftSection={icon}
      rightSection={icon ? undefined : <IconArrowRight size={14} />}
      onClick={() => {
        onClose();
        navigate(href);
      }}
    >
      {label}
    </Button>
  );
}

/* ─── Panneaux par métier ─────────────────────────────────────────────────── */

function HttpPanel({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { count, recent } = useRecentLogActivity();
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge
          color={count > 0 ? "teal" : "gray"}
          variant="light"
          leftSection={<IconBolt size={12} />}
        >
          {count} événement(s) / 8 s
        </Badge>
      </Group>
      <Text size="sm" fw={600}>
        Requêtes récentes
      </Text>
      <Text size="xs" c="dimmed">
        Chaque ligne porte son <Code>requestId</Code> — cliquez-le pour suivre
        la requête de bout en bout.
      </Text>
      <ScrollArea.Autosize mah={300}>
        <Stack gap={6}>
          {recent.length === 0 ? (
            <Text size="sm" c="dimmed">
              En attente d'activité… (le trafic arrive ici en direct)
            </Text>
          ) : (
            recent.map((l: LogPulse, i: number) => (
              <Group
                key={`${l.requestId ?? "x"}-${i}`}
                gap={6}
                wrap="nowrap"
                align="flex-start"
              >
                <Badge
                  size="xs"
                  color={sevColor(l.severity)}
                  variant="light"
                  style={{ flexShrink: 0 }}
                >
                  {l.severity}
                </Badge>
                {l.requestId ? (
                  <Code
                    style={{ cursor: "pointer", flexShrink: 0 }}
                    onClick={() => {
                      onClose();
                      navigate(
                        `/nodefony/logs/trace/${encodeURIComponent(l.requestId as string)}`,
                      );
                    }}
                  >
                    {l.requestId.slice(0, 8)}
                  </Code>
                ) : (
                  <Code c="dimmed" style={{ flexShrink: 0 }}>
                    —
                  </Code>
                )}
                <Text size="xs" lineClamp={2} style={{ minWidth: 0 }}>
                  {l.message || (
                    <span style={{ opacity: 0.5 }}>(sans message)</span>
                  )}
                </Text>
              </Group>
            ))
          )}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}

function WsPanel({
  totals,
}: {
  totals: NormalizedHealth["totals"] | undefined;
}) {
  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue k="Connexions WS" v={fmt(totals?.connectionCount)} />
        <KeyValue k="Canaux abonnés" v={fmt(totals?.channelCount)} />
        <KeyValue k="Messages émis" v={fmt(totals?.messagesSentTotal)} />
        <KeyValue k="Octets émis" v={fmtBytes(totals?.bytesSentTotal)} />
        <KeyValue k="Entrants (inbound)" v={fmt(totals?.inboundTotal)} />
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le WebSocket est full-duplex : il alimente le Realtime Hub (la Socket
        Nodefony) qui fan-out vers les abonnés.
      </Text>
    </Stack>
  );
}

function KernelPanel({ info }: { info: KernelInfo | null }) {
  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue k="Version" v={info?.version ?? "—"} mono />
        <KeyValue k="Environnement" v={info?.environment ?? "—"} />
        <KeyValue k="Uptime" v={fmtUptime(info?.uptime)} />
        <KeyValue k="PID" v={info ? String(info.pid) : "—"} mono />
        <KeyValue k="Node" v={info?.node ?? "—"} mono />
        <KeyValue k="Modules chargés" v={fmt(info?.modules)} />
        {info?.git?.branch ? (
          <KeyValue
            k="Git"
            v={`${info.git.branch} · ${info.git.commit ?? ""}`}
            mono
          />
        ) : null}
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le kernel route chaque requête vers son controller, orchestre le boot et
        héberge les services (DI).
      </Text>
    </Stack>
  );
}

function OrmPanel({
  totals,
}: {
  totals: NormalizedHealth["totals"] | undefined;
}) {
  const orm = totals?.orm;
  if (!orm) {
    return (
      <Text size="sm" c="dimmed">
        Aucun flux ORM remonté. En production, activez la sonde de flux (
        <Code>NODEFONY_ORM_FLOW=1</Code>).
      </Text>
    );
  }
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge color={orm.connected > 0 ? "teal" : "red"} variant="light">
          {orm.connected}/{orm.connectors} connecteur(s)
        </Badge>
      </Group>
      <DefinitionList>
        <KeyValue k="Requêtes (total)" v={fmt(orm.queryTotal)} />
        <KeyValue k="Lentes" v={fmt(orm.slowTotal)} />
        <KeyValue k="Erreurs" v={fmt(orm.errorTotal)} />
        <KeyValue k="Reconnexions" v={fmt(orm.reconnectTotal)} />
        <KeyValue
          k="Latence EWMA max"
          v={orm.maxEwmaMs != null ? `${orm.maxEwmaMs.toFixed(2)} ms` : "—"}
        />
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le pipeline touche l'ORM pour chaque requête base ; les connecteurs
        portent les connexions réelles aux bases.
      </Text>
    </Stack>
  );
}

function ConnectorPanel({ connector }: { connector: ConnectorRow }) {
  return (
    <Stack gap="sm">
      <Group gap="xs">
        <Badge color={connector.connected ? "teal" : "red"} variant="light">
          {connector.connected ? "connecté" : "déconnecté"}
        </Badge>
        <Badge color={vendorColor(connector.vendor)} variant="light">
          {connector.vendor}
        </Badge>
      </Group>
      <DefinitionList>
        <KeyValue k="Nom" v={connector.name} mono />
        <KeyValue k="Driver" v={connector.driver} mono />
        <KeyValue k="Cible" v={connector.target} mono />
        <KeyValue k="Version" v={connector.version} mono />
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Connecteur de base géré par l'ORM <b>{connector.vendor}</b> via le
        driver <Code>{connector.driver}</Code>.
      </Text>
    </Stack>
  );
}

function RealtimePanel({ norm }: { norm: NormalizedHealth | null }) {
  const totals = norm?.totals;
  const chans = useMemo(() => {
    const m = new Map<string, { subscribers: number; messages: number }>();
    for (const inst of norm?.instances ?? []) {
      for (const c of inst.channels) {
        const e = m.get(c.channel) ?? { subscribers: 0, messages: 0 };
        e.subscribers += c.subscribers;
        e.messages += c.messages;
        m.set(c.channel, e);
      }
    }
    return [...m.entries()].sort((a, b) => b[1].messages - a[1].messages);
  }, [norm]);
  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue k="Canaux actifs" v={fmt(totals?.channelCount)} />
        <KeyValue k="Fan-out (total)" v={fmt(totals?.fanoutTotal)} />
        <KeyValue k="Connexions" v={fmt(totals?.connectionCount)} />
        <KeyValue
          k="Backpressure"
          v={`${fmtBytes(totals?.backpressure.totalBufferedAmount)} · ${totals?.backpressure.slowConsumers ?? 0} lents`}
        />
      </DefinitionList>
      <Text size="sm" fw={600}>
        Canaux ({chans.length})
      </Text>
      <ScrollArea.Autosize mah={220}>
        <Stack gap={4}>
          {chans.map(([name, s]) => (
            <Group key={name} justify="space-between" gap="xs" wrap="nowrap">
              <Code style={{ minWidth: 0 }}>{name}</Code>
              <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
                <Badge size="xs" variant="light" color="grape">
                  {s.subscribers} ab.
                </Badge>
                <Text
                  size="xs"
                  c="dimmed"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {fmt(s.messages)} msg
                </Text>
              </Group>
            </Group>
          ))}
        </Stack>
      </ScrollArea.Autosize>
    </Stack>
  );
}

function BpRealtimePanel({
  norm,
  cluster,
}: {
  norm: NormalizedHealth | null;
  cluster: boolean;
}) {
  const bp = norm?.instances[0]?.backplane;
  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue
          k="Driver"
          v={bp?.driver ?? (cluster ? "ipc" : "loopback")}
          mono
        />
        <KeyValue k="Portée" v={bp?.kind ?? (cluster ? "cluster" : "local")} />
        <KeyValue k="Cross-pod" v={bp?.crossPod ? "oui" : "non"} />
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le fond de panier relie les process : un message publié sur un worker
        est relayé aux autres (Loopback en mono-process → IPC en cluster →
        Redis/Kafka multi-hôtes). Cliquez la brique pour voir tous les backends.
      </Text>
    </Stack>
  );
}

function BpLogsPanel({ info }: { info: KernelInfo | null }) {
  const log = info?.backplanes?.log;
  return (
    <Stack gap="sm">
      <DefinitionList>
        <KeyValue k="Driver" v={log?.driver ?? "—"} mono />
        <KeyValue k="Sortie (sink)" v={log?.sink ?? "—"} mono />
      </DefinitionList>
      <Text size="xs" c="dimmed">
        Le backplane de logs collecte chaque Pdu et le diffuse (console,
        fichier, Loki, OpenSearch…) sans coupler le code à la destination.{" "}
        <Code>syslog:stream</Code> en est la prise temps réel.
      </Text>
    </Stack>
  );
}

/* ─── Métadonnées + contenu d'un nœud ─────────────────────────────────────── */

interface NodeMeta {
  title: string;
  color: string;
  icon: () => ReactNode;
  href: string;
}

function metaOf(nodeId: string, connectors: ConnectorRow[]): NodeMeta | null {
  if (nodeId.startsWith("conn-")) {
    const c = connectors.find((x) => `conn-${x.name}` === nodeId);
    if (!c) return null;
    return {
      title: c.name,
      color: vendorColor(c.vendor),
      icon: () => <IconDatabase size={20} />,
      href: "/nodefony/orm",
    };
  }
  if (nodeId in ARCH_NODE_INFO) return ARCH_NODE_INFO[nodeId as ArchNodeId];
  return null;
}

/** Contenu live d'un nœud — abonné `realtime:health` tant que le dialog est ouvert. */
function PanelContent({
  nodeId,
  info,
  connectors,
  onClose,
}: {
  nodeId: string;
  info: KernelInfo | null;
  connectors: ConnectorRow[];
  onClose: () => void;
}) {
  const live = useTwinLive();
  const norm = live.normalized;
  const totals = norm?.totals;

  if (nodeId.startsWith("conn-")) {
    const c = connectors.find((x) => `conn-${x.name}` === nodeId);
    return c ? <ConnectorPanel connector={c} /> : null;
  }
  switch (nodeId as ArchNodeId) {
    case "http":
      return <HttpPanel onClose={onClose} />;
    case "ws":
      return <WsPanel totals={totals} />;
    case "kernel":
      return <KernelPanel info={info} />;
    case "orm":
    case "connectors":
      return <OrmPanel totals={totals} />;
    case "realtime": {
      // PREUVE de la généricité : le dialog monte le MÊME bloc que le bureau.
      const def = getBlock("realtime.hub");
      if (def) {
        return (
          <BlockView
            def={def}
            ctx={{
              live: true,
              cluster: !!norm?.cluster,
              instanceCount: norm?.instances.length ?? 1,
              roles: [],
            }}
            container="dialog"
          />
        );
      }
      return <RealtimePanel norm={norm} />;
    }
    case "bp-realtime":
      return (
        <BpRealtimePanel norm={norm} cluster={!!info?.cluster?.isCluster} />
      );
    case "bp-logs": {
      // Le MÊME bloc « Log Backplane » qu'au bureau (tuiles lecture/écriture/temps réel).
      const def = getBlock("logs.backplane");
      if (def) {
        return (
          <BlockView
            def={def}
            ctx={{
              live: false,
              cluster: !!norm?.cluster,
              instanceCount: norm?.instances.length ?? 1,
              roles: [],
            }}
            container="dialog"
          />
        );
      }
      return <BpLogsPanel info={info} />;
    }
    default:
      return null;
  }
}

export interface TwinNodePanelProps {
  nodeId: string | null;
  info: KernelInfo | null;
  connectors: ConnectorRow[];
  onClose: () => void;
}

/** Boîte ⓘ — dialog « explications » d'une brique du Jumeau. */
export function TwinNodePanel({
  nodeId,
  info,
  connectors,
  onClose,
}: TwinNodePanelProps) {
  const meta = nodeId ? metaOf(nodeId, connectors) : null;
  return (
    <Modal
      opened={nodeId !== null && meta !== null}
      onClose={onClose}
      size="lg"
      centered
      radius="md"
      title={
        meta ? (
          <Group gap="xs">
            <ThemeIcon variant="light" color={meta.color} radius="md">
              {meta.icon()}
            </ThemeIcon>
            <Text fw={700}>{meta.title}</Text>
            <Badge size="xs" color="teal" variant="dot">
              en direct
            </Badge>
          </Group>
        ) : null
      }
    >
      {nodeId && meta ? (
        <Stack gap="sm">
          <PanelContent
            nodeId={nodeId}
            info={info}
            connectors={connectors}
            onClose={onClose}
          />
          <Divider my={4} label="Liens & docs" labelPosition="left" />
          <Group gap="xs">
            <GoTo href={meta.href} label="Page dédiée" onClose={onClose} />
            <GoTo
              href="/nodefony/documentation"
              label="Documentation"
              icon={<IconBook size={14} />}
              onClose={onClose}
            />
          </Group>
          <Text size="10px" c="dimmed">
            Bientôt : extraits de doc ciblés tirés du portail, directement ici.
          </Text>
        </Stack>
      ) : null}
    </Modal>
  );
}

export default TwinNodePanel;
