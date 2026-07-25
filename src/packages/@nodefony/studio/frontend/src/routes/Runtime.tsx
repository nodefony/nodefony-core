import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import { Link } from "react-router";
import {
  Alert,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Divider,
  Grid,
  Group,
  List,
  Paper,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconArrowsSplit2,
  IconBolt,
  IconBox,
  IconBook2,
  IconCpu,
  IconGitBranch,
  IconInfoCircle,
  IconPlugConnected,
  IconRefresh,
  IconRocket,
  IconServer,
  IconStack2,
  IconTerminal2,
} from "@tabler/icons-react";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import {
  PageLayout,
  StickyTabsList,
  DataState,
  KeyValue,
  DefinitionList,
  DocHint,
} from "../components/ui";

/** Version de la doc des fiches d'aide (`DocHint`) de la vue Runtime. */
const RT_DOC = "v2.0";

// ───────────────────────────────────────────────────────────────────────────
// Types MIROIR (frontière isomorphe : aucun runtime serveur dans le bundle).
// ───────────────────────────────────────────────────────────────────────────

/** Sous-ensemble de `/nodefony/kernel/api/info`. */
interface KernelInfo {
  version: string;
  environment: string;
  debug: boolean;
  domain: string;
  pid: number;
  node: string;
  platform: string;
  uptime: number;
  modules: number;
  git?: { branch?: string; commit?: string };
}

/** Discriminant cluster de `/nodefony/realtime/api/health`. */
interface ClusterHealthLite {
  cluster: true;
  instanceCount: number;
}
interface InstanceHealthLite {
  instanceId: string;
}
type HealthLite = ClusterHealthLite | InstanceHealthLite;

function isCluster(h: HealthLite): h is ClusterHealthLite {
  return (h as ClusterHealthLite).cluster === true;
}

/** Vue Vite servie par `/nodefony/frontend/api/vite` (miroir, sous-ensemble). */
interface ViteInstanceView {
  family: string;
  state: string;
  host: string;
  port: number | null;
  pid: number | null;
  https: boolean;
  restartCount: number;
  healthFailures?: number;
  entries: { entryName: string; type: string; version?: string }[];
}
interface FrontendStatusView {
  available: boolean;
  vite?: string;
  primary: ViteInstanceView;
  bundles: ViteInstanceView[];
}

/** Miroir de `DevStatusReport` (`/nodefony/kernel/api/processes`). */
type DevProcessRole = "supervisor" | "server" | "vite";
interface DevProcessInfo {
  pid: number;
  ppid: number;
  role: DevProcessRole;
  label: string;
  detail?: string;
  rssKb: number;
  cpu: number;
  uptimeSec: number;
}
interface PortState {
  port: number;
  listening: boolean;
}
interface DevStatusReport {
  devMode: boolean;
  supported: boolean;
  running: boolean;
  processes: DevProcessInfo[];
  ports: PortState[];
  summary: {
    supervisors: number;
    servers: number;
    vites: number;
    portsUp: number;
    portsTotal: number;
  };
  warnings: string[];
  pidfile: { path: string; pid: number | null; alive: boolean };
}

/** Mode de lancement DÉDUIT de l'état runtime (env + topologie). */
interface RuntimeMode {
  id: "development" | "production" | "cluster";
  label: string;
  /** Vite + HMR actif (uniquement en développement). */
  vite: boolean;
  /** Nombre de process Node qui servent le trafic. */
  processes: number;
  /** Description courte du rôle process. */
  role: string;
  color: string;
}

// ───────────────────────────────────────────────────────────────────────────
// Helpers de format (paliers lisibles, pas de churn).
// ───────────────────────────────────────────────────────────────────────────

/** Uptime (s) → paliers entiers lisibles. */
function fmtUptime(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h${m}` : `${h}h`;
}

/** RSS (kilo-octets, champ `ps`) → libellé court (`92 MB`, `204 MB`). */
function fmtRss(kb: number): string {
  if (kb < 1024) return `${kb} kB`;
  const mb = kb / 1024;
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Couleur d'accent d'un rôle de process dev (cohérent avec `nodefony status`). */
function roleColor(role: DevProcessRole): string {
  return role === "supervisor" ? "cyan" : role === "server" ? "teal" : "gray";
}

/**
 * Déduit le mode courant des données runtime déjà exposées : un snapshot
 * `cluster:true` ⇒ cluster (N workers) ; sinon l'environnement tranche
 * développement (Vite) vs production (mono-process figé). Honnête : on n'invente
 * rien, on lit `environment` + le discriminant cluster de la sonde socket.
 */
function deriveMode(info: KernelInfo, health: HealthLite | null): RuntimeMode {
  if (health && isCluster(health)) {
    return {
      id: "cluster",
      label: "Cluster",
      vite: false,
      processes: health.instanceCount,
      role: `1 master + ${health.instanceCount} worker(s)`,
      color: "grape",
    };
  }
  if (info.environment === "development") {
    return {
      id: "development",
      label: "Développement",
      vite: true,
      processes: 1,
      role: "process unique (Vite intégré)",
      color: "teal",
    };
  }
  return {
    id: "production",
    label: "Production",
    vite: false,
    processes: 1,
    role: "process unique (cloud-native, 1 pod)",
    color: "blue",
  };
}

/** Les 3 modes de lancement de la CLI — fiche statique pédagogique. */
const MODES: {
  id: RuntimeMode["id"];
  label: string;
  cmd: string;
  icon: React.ReactNode;
  front: string;
  topo: string;
  use: string;
  color: string;
}[] = [
  {
    id: "development",
    label: "Développement",
    cmd: "nodefony development",
    icon: <IconBolt size={20} />,
    front: "Vite + HMR (front rechargé à chaud)",
    topo: "1 process (Vite exige un maître unique)",
    use: "Coder au quotidien : chaque modif front est rechargée instantanément, sans rebuild.",
    color: "teal",
  },
  {
    id: "production",
    label: "Production",
    cmd: "nodefony production",
    icon: <IconServer size={20} />,
    front: "Bundle figé (pas de Vite)",
    topo: "1 process (défaut cloud-native)",
    use: "Déploiement standard (k8s, Docker, Cloud Run) : le scaling est délégué à l'orchestrateur (HPA).",
    color: "blue",
  },
  {
    id: "cluster",
    label: "Cluster",
    cmd: "nodefony cluster -w N",
    icon: <IconCpu size={20} />,
    front: "Bundle figé (pas de Vite)",
    topo: "1 master + N workers (même machine)",
    use: "Une grosse VM / VPS / gros pod sans orchestrateur : exploiter plusieurs cœurs en un lancement.",
    color: "grape",
  },
];

/** Provenance du nombre de workers — chaîne de priorité (1er défini gagne). */
const WORKER_SOURCES: {
  rank: number;
  key: string;
  desc: string;
  ex: string;
}[] = [
  {
    rank: 1,
    key: "CLI --workers <n|auto>",
    desc: "Override explicite de l'opérateur au lancement. Priorité maximale (jamais bridé).",
    ex: "nodefony cluster --workers 4",
  },
  {
    rank: 2,
    key: "env NODEFONY_WORKERS",
    desc: "Override de déploiement (Docker / k8s) sans éditer de fichier.",
    ex: "NODEFONY_WORKERS=4 nodefony cluster",
  },
  {
    rank: 3,
    key: "config cluster.workers",
    desc: "Le réglage DevOps par défaut de l'app — successeur de l'ancien « instances » de PM2.",
    ex: "cluster.config.ts → { workers: 4 }",
  },
  {
    rank: 4,
    key: "défaut",
    desc: "Mono-process cloud-native (1 process = 1 pod). Aucune machinerie cluster.",
    ex: "1",
  },
];

// ───────────────────────────────────────────────────────────────────────────
// Petits composants partagés.
// ───────────────────────────────────────────────────────────────────────────

/** Petite stat (label + valeur tabular, badge optionnel). */
function ViteStat({
  label,
  value,
  badge,
}: {
  label: string;
  value: string | number;
  badge?: string;
}) {
  return (
    <div>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
        {label}
      </Text>
      {badge ? (
        <Badge variant="light" color={badge} size="sm">
          {value}
        </Badge>
      ) : (
        <Text fw={600} size="sm" style={{ fontVariantNumeric: "tabular-nums" }}>
          {value}
        </Text>
      )}
    </div>
  );
}

/** En-tête de section (h2) avec icône. */
function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <Group gap="xs" mb="xs">
      <ThemeIcon variant="light" color="gray" radius="md">
        {icon}
      </ThemeIcon>
      <Title order={2} fz="h4">
        {title}
      </Title>
      {children}
    </Group>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ONGLET 1 — UTILISATION (factuel / ce qui tourne maintenant)
// ═══════════════════════════════════════════════════════════════════════════

/** Bandeau « ce serveur tourne en … » + identité runtime (version/pid/git…). */
function CurrentModeCard({
  info,
  health,
  mode,
}: {
  info: KernelInfo;
  health: HealthLite | null;
  mode: RuntimeMode;
}) {
  return (
    <Card withBorder radius="md" p="lg">
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Group gap="md" wrap="nowrap">
          <ThemeIcon size={52} radius="md" variant="light" color={mode.color}>
            <IconRocket size={30} />
          </ThemeIcon>
          <div>
            <Text size="xs" c="dimmed" tt="uppercase" fw={700}>
              Ce serveur tourne en
            </Text>
            <Group gap="xs" align="center">
              <Title order={2} fz="h2">
                {mode.label}
              </Title>
              <DocHint
                title="Mode courant"
                version={RT_DOC}
                summary={`Déduit de l'environnement (« ${info.environment} ») et de la topologie (snapshot ${
                  health && isCluster(health) ? "cluster" : "per-instance"
                }).`}
                sections={[
                  {
                    label: "Note",
                    body: "En production/cluster, l'UI est servie depuis le bundle compilé (manifest.json) — pas de Vite. L'API reste interrogeable dans tous les modes.",
                  },
                ]}
              />
            </Group>
            <Text size="sm" c="dimmed">
              {mode.role}
            </Text>
          </div>
        </Group>
        <Group gap="xs">
          <Badge size="lg" variant="light" color={mode.color}>
            {info.environment}
          </Badge>
          <Badge
            size="lg"
            variant={mode.vite ? "filled" : "light"}
            color={mode.vite ? "teal" : "gray"}
            leftSection={<IconBolt size={12} />}
          >
            {mode.vite ? "Vite / HMR actif" : "bundle figé"}
          </Badge>
          <Badge
            size="lg"
            variant="light"
            color="brand"
            leftSection={<IconServer size={12} />}
          >
            {mode.processes} process
          </Badge>
        </Group>
      </Group>

      <Divider my="md" />

      <Grid>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <DefinitionList>
            <KeyValue k="Version" v={info.version} mono />
            <KeyValue k="Node.js" v={info.node} mono />
          </DefinitionList>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <DefinitionList>
            <KeyValue k="PID" v={String(info.pid)} mono />
            <KeyValue k="Uptime" v={fmtUptime(info.uptime)} />
          </DefinitionList>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <DefinitionList>
            <KeyValue k="Plateforme" v={info.platform} mono />
            <KeyValue k="Modules" v={String(info.modules)} />
          </DefinitionList>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
          <DefinitionList>
            <KeyValue k="Domaine" v={info.domain} mono />
            <KeyValue
              k="Git"
              v={`${info.git?.branch ?? "?"} @ ${info.git?.commit ?? "?"}`}
              mono
            />
          </DefinitionList>
        </Grid.Col>
      </Grid>

      {mode.id === "cluster" ? (
        <Button
          mt="md"
          component={Link}
          to="/nodefony/cluster"
          variant="light"
          color="grape"
          rightSection={<IconArrowRight size={16} />}
        >
          Voir la salle des machines (1 carte/worker)
        </Button>
      ) : null}
    </Card>
  );
}

/** Les 3 modes en un coup d'œil — carte compacte, mode actuel surligné. */
function LaunchModes({ mode }: { mode: RuntimeMode | null }) {
  return (
    <div>
      <Section icon={<IconTerminal2 size={18} />} title="3 modes de lancement">
        <DocHint
          title="Modes de lancement"
          version={RT_DOC}
          summary="Nodefony se lance de 3 façons. Le mode actuellement utilisé par ce serveur est surligné ; le détail (axes, schéma cluster) suit ci-dessous."
        />
      </Section>
      <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="md">
        {MODES.map((m) => {
          const current = mode?.id === m.id;
          return (
            <Card
              key={m.id}
              withBorder
              radius="md"
              p="md"
              style={
                current
                  ? {
                      borderColor: `var(--mantine-color-${m.color}-5)`,
                      borderWidth: 2,
                    }
                  : undefined
              }
            >
              <Group justify="space-between" mb="xs" wrap="nowrap">
                <Group gap="xs" wrap="nowrap">
                  <ThemeIcon variant="light" color={m.color} radius="md">
                    {m.icon}
                  </ThemeIcon>
                  <Text fw={700}>{m.label}</Text>
                </Group>
                {current ? (
                  <Badge color={m.color} variant="filled" size="sm">
                    actuel
                  </Badge>
                ) : null}
              </Group>
              <Code block mb="sm">
                {m.cmd}
              </Code>
              <Group gap={6} wrap="nowrap" mb={4}>
                <IconBolt
                  size={13}
                  style={{ color: "var(--mantine-color-dimmed)" }}
                />
                <Text size="xs" c="dimmed">
                  {m.front}
                </Text>
              </Group>
              <Group gap={6} wrap="nowrap">
                <IconServer
                  size={13}
                  style={{ color: "var(--mantine-color-dimmed)" }}
                />
                <Text size="xs" c="dimmed">
                  {m.topo}
                </Text>
              </Group>
              <Text size="xs" c="dimmed" mt="sm" fs="italic">
                {m.use}
              </Text>
            </Card>
          );
        })}
      </SimpleGrid>
    </div>
  );
}

/** Topologie des process dev (supervisor → server → Vite) + ports — `nodefony status` en web. */
function ProcessTopology({
  data,
  loading,
  error,
  reload,
}: {
  data: DevStatusReport | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}) {
  return (
    <div>
      <Section icon={<IconStack2 size={18} />} title="Process en cours">
        <DocHint
          title="Process de développement"
          version={RT_DOC}
          summary="La topologie réelle observée (comme la commande « nodefony status ») : le superviseur, le serveur enfant et les serveurs Vite, avec PID, mémoire et CPU."
          sections={[
            {
              label: "Hors développement",
              body: "En production/cluster (1 process par pod, cloud-native), il n'y a ni superviseur ni Vite — cette section est donc vide. La topologie multi-process se voit alors dans la page Cluster.",
            },
          ]}
        />
      </Section>
      <DataState
        loading={loading && !data}
        error={error}
        onRetry={reload}
        empty={!!data && !data.running}
        emptyMessage={
          data && !data.devMode
            ? "Mode production : aucun process de développement (1 process unique cloud-native). Voir la page Cluster pour la topologie multi-process."
            : "Aucun process de développement détecté."
        }
      >
        {data && data.running ? (
          <Stack gap="md">
            <Paper withBorder radius="md" p={0} style={{ overflow: "hidden" }}>
              <Table
                striped
                highlightOnHover
                verticalSpacing="xs"
                horizontalSpacing="md"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Rôle</Table.Th>
                    <Table.Th>PID</Table.Th>
                    <Table.Th>PPID</Table.Th>
                    <Table.Th>Uptime</Table.Th>
                    <Table.Th>RSS</Table.Th>
                    <Table.Th>%CPU</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.processes.map((p) => (
                    <Table.Tr key={p.pid}>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Badge
                            variant="light"
                            color={roleColor(p.role)}
                            size="sm"
                          >
                            {p.label}
                          </Badge>
                          {p.detail ? (
                            <Tooltip
                              label={p.detail.replace(/\+/g, ", ")}
                              multiline
                              w={260}
                            >
                              <Text size="xs" c="dimmed" truncate maw={220}>
                                ↳ {p.detail.replace(/\+/g, ", ")}
                              </Text>
                            </Tooltip>
                          ) : null}
                        </Group>
                      </Table.Td>
                      <Table.Td>{p.pid}</Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {p.ppid}
                        </Text>
                      </Table.Td>
                      <Table.Td>{fmtUptime(p.uptimeSec)}</Table.Td>
                      <Table.Td>{fmtRss(p.rssKb)}</Table.Td>
                      <Table.Td>{p.cpu.toFixed(1)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Paper>

            {/* Ports serveur + synthèse. */}
            <Group justify="space-between" wrap="wrap" gap="md">
              <Group gap="xs" wrap="wrap">
                <Text size="sm" c="dimmed" fw={600}>
                  Ports serveur :
                </Text>
                {data.ports.map((port) => (
                  <Badge
                    key={port.port}
                    variant="light"
                    color={port.listening ? "teal" : "red"}
                    leftSection={<IconPlugConnected size={12} />}
                  >
                    {port.port} {port.listening ? "UP" : "DOWN"}
                  </Badge>
                ))}
              </Group>
              <Text size="sm" c="dimmed">
                {data.summary.supervisors} superviseur · {data.summary.servers}{" "}
                serveur · {data.summary.vites} Vite · {data.summary.portsUp}/
                {data.summary.portsTotal} ports UP
              </Text>
            </Group>

            {/* États incohérents (fail-loud, identique à `nodefony status`). */}
            {data.warnings.length ? (
              <Alert
                variant="light"
                color="yellow"
                icon={<IconInfoCircle size={18} />}
                title="À surveiller"
              >
                <List size="sm" spacing={2}>
                  {data.warnings.map((w, i) => (
                    <List.Item key={i}>{w}</List.Item>
                  ))}
                </List>
              </Alert>
            ) : null}
          </Stack>
        ) : null}
      </DataState>
    </div>
  );
}

/** Détail des serveurs Vite (1 par famille de plugins) — état, port, HMR, bundles. */
function ViteServers({
  vite,
  loading,
}: {
  vite: FrontendStatusView | null;
  loading: boolean;
}) {
  if (!vite && loading)
    return (
      <div>
        <Section icon={<IconBolt size={18} />} title="Serveurs Vite (dev)" />
        <Text size="sm" c="dimmed">
          lecture de l'état Vite…
        </Text>
      </div>
    );
  if (!vite || vite.bundles.length === 0) return null;

  return (
    <div>
      <Section icon={<IconBolt size={18} />} title="Serveurs Vite (dev)">
        <DocHint
          title="Serveurs Vite"
          version={RT_DOC}
          summary={`${vite.bundles.length} serveur(s) Vite — 1 par FAMILLE de plugins. Le navigateur tape directement leur port pour les assets + le HMR.`}
          sections={[
            {
              label: "Pourquoi plusieurs ?",
              body: "React et Vue partagent un plugin Vite et cohabitent dans une même instance ; Angular a son propre plugin (incompatible) → sa propre instance. Voir l'onglet « Comment ça marche ».",
            },
            {
              label: "Dev only",
              body: "Vite ne tourne JAMAIS en prod : l'UI vient alors du bundle compilé (manifest.json).",
            },
          ]}
        />
      </Section>
      <SimpleGrid cols={{ base: 1, lg: 2 }} spacing="md">
        {vite.bundles.map((b) => (
          <Paper
            key={b.family}
            withBorder
            radius="md"
            p="md"
            bg="var(--mantine-color-teal-light)"
          >
            <Group justify="space-between" mb="sm" wrap="nowrap">
              <Group gap="xs" wrap="nowrap">
                <ThemeIcon variant="light" color="teal" radius="md">
                  <IconBolt size={18} />
                </ThemeIcon>
                <div>
                  <Text fw={700} size="sm">
                    famille « {b.family} »
                  </Text>
                  <Text size="xs" c="dimmed">
                    {b.entries.length} entrée(s) servie(s)
                  </Text>
                </div>
              </Group>
              <Badge
                variant={b.state === "ready" ? "filled" : "light"}
                color={b.state === "ready" ? "teal" : "orange"}
                size="sm"
              >
                {b.state}
              </Badge>
            </Group>
            <Group gap="xl" mb="sm">
              <ViteStat label="Port" value={b.port ?? "—"} />
              <ViteStat label="PID" value={b.pid ?? "—"} />
              <ViteStat label="Protocole" value={b.https ? "https" : "http"} />
              <ViteStat label="Restarts" value={b.restartCount} />
              {typeof b.healthFailures === "number" ? (
                <ViteStat
                  label="Échecs santé"
                  value={b.healthFailures}
                  badge={b.healthFailures > 0 ? "orange" : "teal"}
                />
              ) : null}
            </Group>
            <Divider mb="xs" />
            <Stack gap={2}>
              {b.entries.map((e) => (
                <Group key={e.entryName} gap={6} wrap="nowrap">
                  <IconBox
                    size={13}
                    style={{ color: "var(--mantine-color-dimmed)" }}
                  />
                  <Text size="xs">
                    {e.entryName}{" "}
                    <Text span c="dimmed">
                      ({e.type}
                      {e.version ? ` · v${e.version}` : ""})
                    </Text>
                  </Text>
                </Group>
              ))}
            </Stack>
          </Paper>
        ))}
      </SimpleGrid>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// ONGLET 2 — COMMENT ÇA MARCHE (pédagogie)
// ═══════════════════════════════════════════════════════════════════════════

/** Une « brique » du schéma de pipeline (boîte encadrée centrée). */
function FlowBox({
  icon,
  title,
  subtitle,
  color = "gray",
  emphasis,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  color?: string;
  emphasis?: boolean;
}) {
  return (
    <Box
      style={{
        border: `${emphasis ? 2 : 1}px solid var(--mantine-color-${color}-${emphasis ? 5 : "default-border"})`,
        borderRadius: 8,
        padding: "10px 16px",
        textAlign: "center",
        minWidth: 220,
        background: emphasis
          ? `var(--mantine-color-${color}-light)`
          : undefined,
      }}
    >
      <Group gap={6} justify="center">
        {icon}
        <Text fw={700} size="sm">
          {title}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {subtitle}
      </Text>
    </Box>
  );
}

/** LE schéma central : comment Nodefony fait tourner les fronts (dev). */
function HowFrontendsRun() {
  const down = (
    <IconArrowRight
      size={20}
      style={{
        color: "var(--mantine-color-dimmed)",
        transform: "rotate(90deg)",
      }}
    />
  );
  return (
    <div>
      <Section
        icon={<IconBolt size={18} />}
        title="Comment Nodefony fait tourner les fronts"
      />
      <Text c="dimmed" mb="md" maw={820}>
        C'est le différenciateur Nodefony : <b>une seule commande</b> lance
        plusieurs frameworks front (React, Vue, Angular…) avec{" "}
        <b>HMR (rechargement à chaud)</b>, supervisés, au-dessus du même
        backend. En développement, la chaîne est la suivante :
      </Text>
      <Paper withBorder radius="md" p="lg">
        <Stack align="center" gap="sm">
          <FlowBox
            icon={<IconTerminal2 size={16} />}
            title="nodefony development"
            subtitle="1 seule commande"
          />
          {down}
          <FlowBox
            icon={<IconAdjustmentsHorizontal size={16} />}
            title="DevSupervisor"
            subtitle="process parent · surveille le backend · rebuild + restart"
            color="cyan"
          />
          {down}
          <FlowBox
            icon={<IconServer size={16} />}
            title="Serveur Nodefony (enfant)"
            subtitle="HTTP + WS + Kernel · FrontendService orchestre les Vite"
            color="teal"
            emphasis
          />
          <Text size="xs" c="dimmed">
            ↓ un serveur Vite par <b>famille de plugins</b>
          </Text>
          <SimpleGrid cols={{ base: 1, xs: 2 }} spacing="md" w="100%">
            <FlowBox
              icon={<IconBolt size={16} />}
              title="Vite — famille « default »"
              subtitle="React + Vue (plugins compatibles) · HMR · ex. studio, shop"
              color="teal"
            />
            <FlowBox
              icon={<IconBolt size={16} />}
              title="Vite — famille « angular »"
              subtitle="plugin Angular dédié · HMR · ex. admin"
              color="teal"
            />
          </SimpleGrid>
        </Stack>
      </Paper>
      <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md" mt="md">
        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb={4}>
            Pourquoi un superviseur ?
          </Text>
          <Text size="sm" c="dimmed">
            Le backend ESM ne peut pas se recharger à chaud lui-même. Le{" "}
            <b>DevSupervisor</b> surveille les sources serveur, rebuild de façon
            ciblée et <b>redémarre le process enfant</b> proprement (groupe de
            process) — sans que tu relances quoi que ce soit.
          </Text>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb={4}>
            Pourquoi plusieurs Vite ?
          </Text>
          <Text size="sm" c="dimmed">
            Vite charge des <b>plugins par framework</b>. React et Vue
            cohabitent dans une même instance ; Angular a son plugin propre
            (incompatible) → <b>sa propre instance</b>. Une famille = une
            instance = un port.
          </Text>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Text fw={600} size="sm" mb={4}>
            Et en production ?
          </Text>
          <Text size="sm" c="dimmed">
            Plus de superviseur ni de Vite : chaque front est <b>pré-compilé</b>{" "}
            en bundle figé (<Code>manifest.json</Code>), servi en statique. Un
            seul process Node (cloud-native).
          </Text>
        </Paper>
      </SimpleGrid>
      <Alert mt="md" variant="light" color="teal" icon={<IconBolt size={18} />}>
        L'onglet <b>Utilisation</b> montre cette chaîne <b>en vrai</b> : les
        process réellement lancés (superviseur / serveur / Vite) et les bundles
        servis par chaque instance.
      </Alert>
    </div>
  );
}

/** Logique DevOps du réglage `workers` (orchestrateur vs cluster in-process). */
function DevOpsWorkers() {
  return (
    <Paper withBorder radius="md" p="md">
      <Group gap="xs" mb="xs">
        <ThemeIcon variant="light" color="gray" radius="md">
          <IconAdjustmentsHorizontal size={18} />
        </ThemeIcon>
        <Text fw={700}>
          Logique DevOps — <Code>workers</Code> est un paramètre de déploiement
        </Text>
      </Group>
      <Text size="sm" c="dimmed" mb="md" maw={840}>
        Ce choix se pose <b>au déploiement — en production / cluster</b>. En{" "}
        <b>développement</b>, la topologie est figée à 1 process (Vite exige un
        maître unique), donc rien à décider. Le <b>même artefact</b> tourne
        ensuite en 1 ou N process selon la <b>cible</b>, sans recompiler. La
        question pivot : <b>qui assure le scaling ?</b>
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Paper withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="light" color="blue" radius="md">
              <IconServer size={18} />
            </ThemeIcon>
            <Text fw={600}>
              Orchestrateur → <Code>workers: 1</Code>
            </Text>
          </Group>
          <Text size="sm" c="dimmed">
            1 pod / container = 1 process. Scaling <b>horizontal délégué</b> :
            k8s HPA, Cloud Run, Fargate, Nomad, Swarm ajoutent des réplicas.
            Supervision + restart assurés par l'orchestrateur (liveness /
            readiness). <b>Défaut cloud-native.</b>
          </Text>
          <Code block mt="sm">
            nodefony production
          </Code>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="light" color="grape" radius="md">
              <IconCpu size={18} />
            </ThemeIcon>
            <Text fw={600}>
              Cluster in-process → <Code>workers: N | auto</Code>
            </Text>
          </Group>
          <Text size="sm" c="dimmed">
            Une grosse VM / VPS / gros pod <b>sans orchestrateur</b>. Le master
            fork N workers (<Code>cluster</Code> Node), le noyau répartit les
            connexions. <Code>auto</Code> = cgroup-aware (lit le quota CPU du
            conteneur, jamais <Code>os.cpus()</Code> → ne sur-fork pas un pod
            bridé).
          </Text>
          <Code block mt="sm">
            nodefony cluster -w N
          </Code>
        </Paper>
      </SimpleGrid>
    </Paper>
  );
}

/** Les deux axes orthogonaux (pipeline front × modèle de process). */
function OrthogonalAxes() {
  return (
    <div>
      <Section
        icon={<IconAdjustmentsHorizontal size={18} />}
        title="Deux axes orthogonaux"
      />
      <Text c="dimmed" mb="md" maw={780}>
        Sous le capot, le lancement se règle sur <b>deux axes indépendants</b> :
        le <b>pipeline front</b> (comment l'UI est servie) et le{" "}
        <b>modèle de process</b> (combien de process Node servent le trafic).
        Ils sont <b>orthogonaux</b> — chaque combinaison est un point valide.
      </Text>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
        <Paper withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="light" color="teal" radius="md">
              <IconBolt size={18} />
            </ThemeIcon>
            <Text fw={700}>Axe 1 — Pipeline front</Text>
          </Group>
          <List size="sm" spacing={4}>
            <List.Item>
              <b>development</b> → serveur Vite : transpile à la volée + HMR (0
              rebuild, état préservé).
            </List.Item>
            <List.Item>
              <b>production</b> → bundle pré-compilé +{" "}
              <Code>manifest.json</Code>, servi en statique (assets
              fingerprintés).
            </List.Item>
          </List>
        </Paper>
        <Paper withBorder radius="md" p="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="light" color="grape" radius="md">
              <IconCpu size={18} />
            </ThemeIcon>
            <Text fw={700}>Axe 2 — Modèle de process</Text>
          </Group>
          <List size="sm" spacing={4}>
            <List.Item>
              <b>1</b> → mono-process : aucune machinerie cluster (défaut
              cloud-native, scaling délégué à l'orchestrateur).
            </List.Item>
            <List.Item>
              <b>N</b> → cluster : 1 master + N workers (<Code>cluster</Code>{" "}
              Node), répartition par le noyau.
            </List.Item>
          </List>
        </Paper>
      </SimpleGrid>
      <Alert
        mt="md"
        variant="light"
        color="blue"
        icon={<IconInfoCircle size={18} />}
      >
        <b>Pourquoi deux axes plutôt qu'une liste de modes ?</b> Servir le front
        et dimensionner les process sont orthogonaux. En les découplant,{" "}
        <Code>workers</Code> reste la <b>seule</b> source de vérité de la
        topologie ; <Code>development</Code> impose juste 1 process. On évite un
        mode composite « cluster-dev » à maintenir.
      </Alert>
    </div>
  );
}

/** Schéma master/workers du mode cluster. */
function MasterWorkers() {
  return (
    <div>
      <Section
        icon={<IconArrowsSplit2 size={18} />}
        title="Schéma — master & workers (mode cluster)"
      />
      <Text c="dimmed" mb="md" maw={760}>
        En cluster, un process <b>master</b> ne sert <b>aucun trafic HTTP</b> :
        il <i>fork</i> les workers, relaie les messages internes (IPC), agrège
        les sondes. Chaque <b>worker</b> est un serveur complet (HTTP + WS). Le
        système d'exploitation répartit les connexions.
      </Text>
      <Paper withBorder radius="md" p="lg">
        <Stack align="center" gap="md">
          <Box
            style={{
              border: "2px solid var(--mantine-color-grape-5)",
              borderRadius: 8,
              padding: "10px 18px",
              textAlign: "center",
            }}
          >
            <Group gap={6} justify="center">
              <IconStack2 size={16} />
              <Text fw={700} size="sm">
                master
              </Text>
            </Group>
            <Text size="xs" c="dimmed">
              fork · relais IPC · agrège sondes · 0 HTTP
            </Text>
          </Box>
          <IconArrowsSplit2
            size={22}
            style={{ color: "var(--mantine-color-dimmed)" }}
          />
          <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md" w="100%">
            {[1, 2, 3].map((n) => (
              <Box
                key={n}
                style={{
                  border: "1px solid var(--mantine-color-default-border)",
                  borderRadius: 8,
                  padding: "10px 14px",
                  textAlign: "center",
                }}
              >
                <Group gap={6} justify="center">
                  <IconCpu size={16} />
                  <Text fw={600} size="sm">
                    worker {n}
                  </Text>
                </Group>
                <Text size="xs" c="dimmed">
                  HTTP + WS · sonde process
                </Text>
              </Box>
            ))}
          </SimpleGrid>
        </Stack>
      </Paper>
      <Alert mt="md" variant="light" color="teal" icon={<IconBolt size={18} />}>
        En <b>développement</b>, pas de master : <b>un seul process</b> avec
        Vite intégré (HMR). Le multi-process est réservé à production/cluster.
      </Alert>
    </div>
  );
}

/** Résolution du nombre de workers (chaîne de priorité). */
function WorkerResolution() {
  return (
    <div>
      <Section
        icon={<IconBox size={18} />}
        title="D'où vient le nombre de workers ?"
      >
        <DocHint
          title="Résolution de la topologie"
          version={RT_DOC}
          summary="Une seule fonction (resolveTopology) tranche, dans cet ordre de priorité. Le premier réglage défini gagne."
          sections={[
            {
              label: "auto",
              body: "La valeur « auto » calcule les workers selon le quota CPU du conteneur (cgroup-aware), jamais os.cpus() — pour ne pas saturer un pod limité.",
            },
          ]}
        />
      </Section>
      <Stack gap="xs">
        {WORKER_SOURCES.map((s) => (
          <Paper key={s.rank} withBorder radius="md" p="sm">
            <Group wrap="nowrap" align="flex-start" gap="md">
              <ThemeIcon
                variant="light"
                color={s.rank === 1 ? "brand" : "gray"}
                radius="xl"
              >
                <Text fw={700} size="sm">
                  {s.rank}
                </Text>
              </ThemeIcon>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Code>{s.key}</Code>
                <Text size="sm" c="dimmed" mt={4}>
                  {s.desc}
                </Text>
                <Text size="xs" c="dimmed" mt={4} ff="monospace">
                  ex : {s.ex}
                </Text>
              </div>
            </Group>
          </Paper>
        ))}
      </Stack>
      <Group gap="xs" mt="md">
        <ThemeIcon variant="light" color="gray" radius="md" size="sm">
          <IconGitBranch size={14} />
        </ThemeIcon>
        <Text size="sm" c="dimmed">
          Observabilité multi-process :
        </Text>
        <Button
          component={Link}
          to="/nodefony/cluster"
          size="xs"
          variant="light"
          rightSection={<IconArrowRight size={14} />}
        >
          Vue Cluster
        </Button>
      </Group>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * **Vue Runtime** (`/nodefony/runtime`) — deux onglets : **Utilisation** (l'état
 * RÉEL de ce serveur : mode, process en cours, serveurs Vite) et **Comment ça
 * marche** (la pédagogie : comment Nodefony fait tourner les fronts, les modes,
 * les axes, le cluster). L'état est dérivé des endpoints data plane déjà exposés.
 */
export const Runtime = observer(() => {
  const store = useStore();

  const info = useResource(
    useCallback(
      () => store.api.getAbsolute<KernelInfo>("/nodefony/kernel/api/info"),
      [store],
    ),
  );
  const health = useResource(
    useCallback(
      () => store.api.getAbsolute<HealthLite>("/nodefony/realtime/api/health"),
      [store],
    ),
  );
  const vite = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<FrontendStatusView>(
          "/nodefony/frontend/api/vite",
        ),
      [store],
    ),
  );
  const procs = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<DevStatusReport>(
          "/nodefony/kernel/api/processes",
        ),
      [store],
    ),
  );

  const mode = info.data ? deriveMode(info.data, health.data) : null;

  const reloadAll = () => {
    info.reload();
    health.reload();
    vite.reload();
    procs.reload();
  };

  return (
    <PageLayout
      title="Runtime & Lancement"
      subtitle="Comment ce serveur tourne, et comment Nodefony fait tourner les fronts."
      actions={
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={info.loading || procs.loading}
          onClick={reloadAll}
        >
          Recharger
        </Button>
      }
    >
      <Tabs defaultValue="usage" keepMounted={false}>
        <StickyTabsList>
          <Tabs.Tab value="usage" leftSection={<IconRocket size={16} />}>
            Utilisation
          </Tabs.Tab>
          <Tabs.Tab value="how" leftSection={<IconBook2 size={16} />}>
            Doc
          </Tabs.Tab>
        </StickyTabsList>

        {/* ───────── Onglet UTILISATION ───────── */}
        <Tabs.Panel value="usage" pt="md">
          <Stack gap="xl">
            <DataState
              loading={info.loading && !info.data}
              error={info.error}
              onRetry={info.reload}
            >
              {info.data && mode ? (
                <CurrentModeCard
                  info={info.data}
                  health={health.data}
                  mode={mode}
                />
              ) : null}
            </DataState>

            <ProcessTopology
              data={procs.data}
              loading={procs.loading}
              error={procs.error}
              reload={procs.reload}
            />

            <ViteServers vite={vite.data} loading={vite.loading} />
          </Stack>
        </Tabs.Panel>

        {/* ───────── Onglet COMMENT ÇA MARCHE ───────── */}
        <Tabs.Panel value="how" pt="md">
          <Stack gap="xl">
            <LaunchModes mode={mode} />
            <HowFrontendsRun />
            <OrthogonalAxes />
            <DevOpsWorkers />
            <MasterWorkers />
            <WorkerResolution />
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </PageLayout>
  );
});

export default Runtime;
