import { observer } from "mobx-react-lite";
import { useCallback } from "react";
import { Link } from "react-router-dom";
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
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconAdjustmentsHorizontal,
  IconArrowRight,
  IconArrowsSplit2,
  IconBolt,
  IconBox,
  IconCpu,
  IconGitBranch,
  IconInfoCircle,
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
  DataState,
  KeyValue,
  DefinitionList,
  DocHint,
} from "../components/ui";

/** Version de la doc des fiches d'aide (`DocHint`) de la vue Runtime. */
const RT_DOC = "v1.0";

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
  entries: { entryName: string; type: string; version?: string }[];
}
interface FrontendStatusView {
  available: boolean;
  vite?: string;
  primary: ViteInstanceView;
  bundles: ViteInstanceView[];
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

/** Uptime → paliers entiers lisibles. */
function fmtUptime(s: number): string {
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.floor(s / 60)}min`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h${m}` : `${h}h`;
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

/** Les modes de lancement de la CLI — fiche statique pédagogique. */
const MODES: {
  id: RuntimeMode["id"];
  label: string;
  cmd: string;
  front: string;
  topo: string;
  run: string;
  use: string;
  color: string;
}[] = [
  {
    id: "development",
    label: "Développement",
    cmd: "nodefony development",
    front: "Vite + HMR (front rechargé à chaud)",
    topo: "1 process (obligatoire — Vite exige un maître unique)",
    run: "foreground",
    use: "Coder au quotidien : chaque modif front est rechargée instantanément, sans rebuild.",
    color: "teal",
  },
  {
    id: "production",
    label: "Production",
    cmd: "nodefony production",
    front: "Bundle figé (pas de Vite)",
    topo: "1 process (défaut cloud-native)",
    run: "foreground — 1 pod / container = 1 process",
    use: "Déploiement standard (k8s, Docker, Cloud Run) : le scaling est délégué à l'orchestrateur (HPA).",
    color: "blue",
  },
  {
    id: "cluster",
    label: "Cluster",
    cmd: "nodefony cluster -w N",
    front: "Bundle figé (pas de Vite)",
    topo: "1 master + N workers (même machine)",
    run: "foreground",
    use: "Une grosse VM / VPS / gros pod sans orchestrateur : exploiter plusieurs cœurs avec un seul lancement.",
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

/** Petite stat de la sous-card Vite : label + valeur (mono/tabular) + badge optionnel. */
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

/**
 * **Vue Runtime** (`/nodefony/runtime`) — page explicative : comment CE serveur est
 * lancé, les deux axes orthogonaux (pipeline front × modèle de process), les modes de la CLI, le
 * schéma master/workers et d'où vient le nombre de workers. L'état courant est
 * dérivé des endpoints déjà exposés (`kernel/api/info` + `realtime/api/health`).
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

  const mode = info.data ? deriveMode(info.data, health.data) : null;

  return (
    <PageLayout
      gap="xl"
      title="Runtime & Lancement"
      subtitle="Comment ce serveur tourne, et comment le lancer dans chaque mode."
      actions={
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={info.loading}
          onClick={() => {
            info.reload();
            health.reload();
            vite.reload();
          }}
        >
          Recharger
        </Button>
      }
    >
      {/* ───────── 1. État courant (dérivé du runtime) ───────── */}
      <DataState
        loading={info.loading && !info.data}
        error={info.error}
        onRetry={info.reload}
      >
        {info.data && mode ? (
          <Card withBorder radius="md" p="lg">
            <Group justify="space-between" align="flex-start" wrap="wrap">
              <Group gap="md" wrap="nowrap">
                <ThemeIcon
                  size={52}
                  radius="md"
                  variant="light"
                  color={mode.color}
                >
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
                      summary={`Déduit de l'environnement (« ${info.data.environment} ») et de la topologie (snapshot ${
                        health.data && isCluster(health.data)
                          ? "cluster"
                          : "per-instance"
                      }).`}
                      sections={[
                        {
                          label: "Note",
                          body: "En production/cluster, l'UI est servie depuis le bundle compilé (manifest.json, P14.5) — pas de Vite. L'API reste interrogeable dans tous les modes.",
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
                  {info.data.environment}
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
                  <KeyValue k="Version" v={info.data.version} mono />
                  <KeyValue k="Node.js" v={info.data.node} mono />
                </DefinitionList>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                <DefinitionList>
                  <KeyValue k="PID" v={String(info.data.pid)} mono />
                  <KeyValue k="Uptime" v={fmtUptime(info.data.uptime)} />
                </DefinitionList>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                <DefinitionList>
                  <KeyValue k="Plateforme" v={info.data.platform} mono />
                  <KeyValue k="Modules" v={String(info.data.modules)} />
                </DefinitionList>
              </Grid.Col>
              <Grid.Col span={{ base: 12, sm: 6, lg: 3 }}>
                <DefinitionList>
                  <KeyValue k="Domaine" v={info.data.domain} mono />
                  <KeyValue
                    k="Git"
                    v={`${info.data.git?.branch ?? "?"} @ ${info.data.git?.commit ?? "?"}`}
                    mono
                  />
                </DefinitionList>
              </Grid.Col>
            </Grid>

            {/* Sous-card Vite — visible en dev (HMR). En prod, Vite ne tourne pas. */}
            {mode.vite ? (
              <Paper
                withBorder
                radius="md"
                p="md"
                mt="md"
                bg="var(--mantine-color-teal-light)"
              >
                <Group justify="space-between" wrap="wrap" gap="sm">
                  <Group gap="xs" wrap="nowrap">
                    <ThemeIcon variant="light" color="teal" radius="md">
                      <IconBolt size={18} />
                    </ThemeIcon>
                    <div>
                      <Group gap={6} align="center">
                        <Text fw={700} size="sm">
                          Serveur Vite (dev)
                        </Text>
                        <DocHint
                          title="Serveur Vite"
                          version={RT_DOC}
                          summary="Process séparé qui transpile le front à la volée et pousse le HMR (rechargement à chaud). Le navigateur tape DIRECT son port pour les assets."
                          sections={[
                            {
                              label: "Dev only",
                              body: "Vite ne tourne JAMAIS en prod : là, l'UI vient du bundle compilé (manifest.json). C'est un outil de développement.",
                            },
                          ]}
                        />
                      </Group>
                      <Group gap={4} wrap="nowrap">
                        <Text size="xs" c="dimmed">
                          {vite.data?.bundles.length ?? 0} bundle(s) servis
                        </Text>
                        {vite.data && vite.data.bundles.length ? (
                          <DocHint
                            title="Entrées servies par Vite"
                            version={RT_DOC}
                            summary={`${vite.data.bundles.reduce((n, b) => n + b.entries.length, 0)} entrée(s) sur ${vite.data.bundles.length} instance(s) Vite (1 instance par famille de plugins).`}
                            sections={vite.data.bundles.map((b) => ({
                              label: `${b.family} · :${b.port ?? "—"}`,
                              body: b.entries.length ? (
                                <Stack gap={2}>
                                  {b.entries.map((e) => (
                                    <Text key={e.entryName} size="xs">
                                      {e.entryName}{" "}
                                      <Text span c="dimmed">
                                        ({e.type}
                                        {e.version ? ` · v${e.version}` : ""})
                                      </Text>
                                    </Text>
                                  ))}
                                </Stack>
                              ) : (
                                "aucune entrée"
                              ),
                            }))}
                          />
                        ) : null}
                      </Group>
                    </div>
                  </Group>
                  {vite.data ? (
                    <Group gap="xl">
                      <ViteStat
                        label="État"
                        value={vite.data.primary.state}
                        badge={vite.data.available ? "teal" : "orange"}
                      />
                      <ViteStat
                        label="HMR"
                        value={vite.data.available ? "actif" : "—"}
                        badge={vite.data.available ? "teal" : "gray"}
                      />
                      <ViteStat label="Vite" value={vite.data.vite ?? "—"} />
                      <ViteStat
                        label="Port"
                        value={vite.data.primary.port ?? "—"}
                      />
                      <ViteStat
                        label="PID"
                        value={vite.data.primary.pid ?? "—"}
                      />
                      <ViteStat
                        label="Protocole"
                        value={vite.data.primary.https ? "https" : "http"}
                      />
                    </Group>
                  ) : vite.loading ? (
                    <Text size="sm" c="dimmed">
                      lecture de l'état Vite…
                    </Text>
                  ) : (
                    <Text size="sm" c="dimmed">
                      état Vite indisponible
                    </Text>
                  )}
                </Group>
              </Paper>
            ) : null}

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
        ) : null}
      </DataState>

      {/* ───────── 2. Modes de lancement ───────── */}
      <div>
        <Section
          icon={<IconTerminal2 size={18} />}
          title="Modes de lancement"
        />
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          {MODES.map((m) => {
            const isCurrent = mode?.id === m.id;
            return (
              <Card
                key={m.id}
                withBorder
                radius="md"
                p="md"
                style={
                  isCurrent
                    ? { borderColor: `var(--mantine-color-${m.color}-5)` }
                    : undefined
                }
              >
                <Group justify="space-between" mb="xs">
                  <Text fw={700}>{m.label}</Text>
                  {isCurrent ? (
                    <Badge color={m.color} variant="filled">
                      actuel
                    </Badge>
                  ) : null}
                </Group>
                <Code block mb="sm">
                  {m.cmd}
                </Code>
                <DefinitionList gap={4}>
                  <KeyValue k="Front" v={m.front} />
                  <KeyValue k="Topologie" v={m.topo} />
                  <KeyValue k="Exécution" v={m.run} />
                </DefinitionList>
                <Text size="sm" c="dimmed" mt="sm">
                  {m.use}
                </Text>
              </Card>
            );
          })}
        </SimpleGrid>

        {/* Logique DevOps du réglage workers (décision session archi). */}
        <Paper withBorder radius="md" p="md" mt="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="light" color="gray" radius="md">
              <IconAdjustmentsHorizontal size={18} />
            </ThemeIcon>
            <Text fw={700}>
              Logique DevOps — <Code>workers</Code> est un paramètre de
              déploiement
            </Text>
          </Group>
          <Text size="sm" c="dimmed" mb="md" maw={840}>
            Ce choix se pose <b>au déploiement — en production / cluster</b>. En{" "}
            <b>développement</b>, la topologie est figée à 1 process (Vite exige
            un maître unique), donc rien à décider. Le <b>même artefact</b>{" "}
            tourne ensuite en 1 ou N process selon la <b>cible</b>, sans
            recompiler. La question pivot : <b>qui assure le scaling ?</b>
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
                1 pod / container = 1 process. Scaling <b>horizontal délégué</b>{" "}
                : k8s HPA, Cloud Run, Fargate, Nomad, Swarm ajoutent des
                réplicas. Supervision + restart assurés par l'orchestrateur
                (liveness / readiness) ; observabilité par pod, agrégée côté
                collecteur (Prometheus). <b>Défaut cloud-native.</b>
              </Text>
              <Text size="xs" fw={700} c="blue" mt="sm" mb={4}>
                Choisis-le si :
              </Text>
              <List size="xs" spacing={2}>
                <List.Item>
                  k8s / Cloud Run / Fargate / Nomad / Swarm.
                </List.Item>
                <List.Item>
                  tu veux auto-scaling (HPA), rolling updates, self-healing.
                </List.Item>
                <List.Item>pods éphémères, facturation à l'usage.</List.Item>
              </List>
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
                Une grosse VM / VPS / gros pod <b>sans orchestrateur</b>. Le
                master fork N workers (<Code>cluster</Code> Node), le noyau
                répartit les connexions. Scaling <b>vertical</b> : exploiter les
                cœurs d'une machine en un seul lancement. <Code>auto</Code> =
                cgroup-aware (lit le quota CPU du conteneur, jamais{" "}
                <Code>os.cpus()</Code> → ne sur-fork pas un pod bridé).
              </Text>
              <Text size="xs" fw={700} c="grape" mt="sm" mb={4}>
                Choisis-le si :
              </Text>
              <List size="xs" spacing={2}>
                <List.Item>
                  1 VM / VPS / bare-metal, pas d'orchestrateur.
                </List.Item>
                <List.Item>
                  tu veux saturer les cœurs sans gérer N réplicas.
                </List.Item>
                <List.Item>
                  déploiement simple (systemd, Docker restart-policy).
                </List.Item>
              </List>
              <Code block mt="sm">
                nodefony cluster -w N
              </Code>
            </Paper>
          </SimpleGrid>
          <Alert
            mt="md"
            variant="light"
            color="grape"
            icon={<IconInfoCircle size={18} />}
          >
            <b>Réglable sans rebuild</b> : on cible au déploiement via{" "}
            <Code>NODEFONY_WORKERS</Code> (Docker / k8s) ou{" "}
            <Code>cluster.workers</Code> (config app) — ordre de priorité
            détaillé plus bas. PM2 est déprécié : la supervision des process
            revient à l'orchestrateur (mode 1) ou au master (mode cluster).
          </Alert>
        </Paper>
      </div>

      {/* ───────── 3. Deux axes orthogonaux ───────── */}
      <div>
        <Section
          icon={<IconAdjustmentsHorizontal size={18} />}
          title="Deux axes orthogonaux"
        />
        <Text c="dimmed" mb="md" maw={780}>
          Sous le capot, le lancement se règle sur <b>deux axes indépendants</b>{" "}
          : le <b>pipeline front</b> (comment l'UI est servie) et le{" "}
          <b>modèle de process</b> (combien de process Node servent le trafic).
          Ils sont <b>orthogonaux</b> — l'un ne contraint pas l'autre, chaque
          combinaison est un point valide de la matrice. C'est de la séparation
          des préoccupations : une seule source de vérité par axe, aucun mode
          composite à maintenir en plus.
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Paper withBorder radius="md" p="md">
            <Group gap="xs" mb="xs">
              <ThemeIcon variant="light" color="teal" radius="md">
                <IconBolt size={18} />
              </ThemeIcon>
              <Text fw={700}>Axe 1 — Pipeline front</Text>
            </Group>
            <Text size="sm" c="dimmed" mb="sm">
              Comment les assets de l'UI sont produits et servis.
            </Text>
            <List size="sm" spacing={4}>
              <List.Item>
                <b>development</b> → serveur Vite : transpile à la volée + HMR
                (0 rebuild, état préservé).
              </List.Item>
              <List.Item>
                <b>production</b> → bundle pré-compilé +{" "}
                <Code>manifest.json</Code>, servi en statique (assets
                fingerprintés, immuables).
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
            <Text size="sm" c="dimmed" mb="sm">
              Combien de process Node servent le trafic (réglage{" "}
              <Code>workers</Code>).
            </Text>
            <List size="sm" spacing={4}>
              <List.Item>
                <b>1</b> → mono-process : aucune machinerie cluster (défaut
                cloud-native, 1 pod = 1 process, scaling délégué à
                l'orchestrateur).
              </List.Item>
              <List.Item>
                <b>N</b> → cluster : 1 master + N workers (<Code>cluster</Code>{" "}
                Node) sur la même machine, répartition par le noyau.
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
          <b>Pourquoi deux axes plutôt qu'une liste de modes ?</b> Servir le
          front et dimensionner les process sont des préoccupations
          orthogonales. En les découplant, le réglage <Code>workers</Code> reste
          la <b>seule</b> source de vérité de la topologie ;{" "}
          <Code>development</Code> impose juste 1 process (Vite exige un maître
          unique). On évite ainsi un mode composite « cluster-dev » à maintenir
          en parallèle.
        </Alert>
      </div>

      {/* ───────── 4. Schéma master / workers ───────── */}
      <div>
        <Section
          icon={<IconArrowsSplit2 size={18} />}
          title="Schéma — master & workers (mode cluster)"
        />
        <Text c="dimmed" mb="md" maw={760}>
          En cluster, un process <b>master</b> ne sert <b>aucun trafic HTTP</b>{" "}
          : il <i>fork</i> les workers, relaie les messages internes (IPC),
          agrège les sondes et tient le pont unique vers l'extérieur (futur
          Redis). Chaque
          <b> worker</b> est un serveur complet (HTTP + WS) avec sa propre sonde
          process. Le système d'exploitation répartit les connexions entre eux.
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
        <Alert
          mt="md"
          variant="light"
          color="teal"
          icon={<IconBolt size={18} />}
        >
          En <b>développement</b>, pas de master : <b>un seul process</b> avec
          Vite intégré (HMR). Le multi-process est réservé à production/cluster.
        </Alert>
      </div>

      {/* ───────── 5. D'où vient le nombre de workers ───────── */}
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
            Lien direct vers l'observabilité multi-process :
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
    </PageLayout>
  );
});

export default Runtime;
