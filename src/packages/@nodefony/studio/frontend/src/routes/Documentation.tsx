import { observer } from "mobx-react-lite";
import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Box,
  Code,
  Collapse,
  Grid,
  Group,
  NavLink,
  Paper,
  rem,
  ScrollArea,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import {
  IconAffiliate,
  IconBrandReact,
  IconBroadcast,
  IconBuildingBroadcastTower,
  IconChevronDown,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconCircuitResistor,
  IconClock,
  IconCpu,
  IconDeviceDesktop,
  IconFileText,
  IconHeartbeat,
  IconLayoutSidebarRightCollapse,
  IconLayoutSidebarRightExpand,
  IconPlugConnected,
  IconRadar2,
  IconRouteSquare,
  IconSearch,
  IconServer2,
  IconStack2,
} from "@tabler/icons-react";
import { useNodefonyChannelData, useNodefonyState } from "nodefony/react";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import { RoleSwitch } from "../components/RoleSwitch";
import {
  DataState,
  DocHint,
  DocLayout,
  FlowGraph,
  GraphHint,
  MarkdownDoc,
  PageHeader,
  StatCard,
  type FlowGraphEdge,
  type FlowGraphNode,
} from "../components/ui";

/* ════════════════════════════════════════════════════════════════════════
 * Documentation — PAGE DE DÉMO (POC pour décider de l'archi du portail doc).
 *
 * Montre en VRAI `/nodefony/documentation` : portail unifié + menu + sélecteur
 * de PERSONA, graphes « beaux » (brique partagée FlowGraph = React Flow + dagre),
 * doc DYNAMIQUE (Mermaid dans le markdown + bloc LIVE sonde realtime:health),
 * et un onglet temporaire MIGRATION (MIGRATION_STATUS.md, lecture facile).
 * Data plane démo = `DocumentationController`. Briques (FlowGraph/MarkdownDoc)
 * réutilisées par la vue module et le futur @nodefony/documentation.
 * Cf mémoire [[project_doc_portal_faisabilite]].
 * ════════════════════════════════════════════════════════════════════════ */

const DOC_VERSION = "v0.1-démo";

type Persona = "developer" | "devops" | "supervisor" | "admin";

/* ─── Graphe 1 : architecture de la Socket (couches) ────────────────────── */
const SOCKET_NODES: FlowGraphNode[] = [
  {
    id: "client",
    data: {
      label: "RealtimeClient",
      sub: "Navigateur · isomorphe · subscribe/publish/request",
      icon: <IconDeviceDesktop size={20} />,
      color: "blue",
    },
  },
  {
    id: "transport",
    data: {
      label: "Transport (WSS)",
      sub: "IRealtimeTransport · seul à connaître le réseau",
      icon: <IconPlugConnected size={20} />,
      color: "cyan",
    },
  },
  {
    id: "peer",
    data: {
      label: "JsonRpcPeer",
      sub: "JSON-RPC 2.0 · même protocole des 2 côtés",
      icon: <IconStack2 size={20} />,
      color: "grape",
    },
  },
  {
    id: "hub",
    data: {
      label: "RealtimeHub",
      sub: "Broker pub/sub · fan-out par canal",
      icon: <IconBroadcast size={20} />,
      color: "indigo",
      emphasis: true,
    },
  },
  {
    id: "backplane",
    data: {
      label: "IBackplane — fond de panier",
      sub: "Loopback → IPC cluster → Redis",
      icon: <IconCircuitResistor size={20} />,
      color: "orange",
      emphasis: true,
    },
  },
  {
    id: "w1",
    data: {
      label: "Worker A",
      sub: "process / pod",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
  {
    id: "w2",
    data: {
      label: "Worker B",
      sub: "process / pod",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
  {
    id: "w3",
    data: {
      label: "Worker C",
      sub: "process / pod",
      icon: <IconCpu size={20} />,
      color: "teal",
    },
  },
];
const SOCKET_EDGES: FlowGraphEdge[] = [
  { source: "client", target: "transport", label: "WSS", color: "blue" },
  { source: "transport", target: "peer", label: "frames", color: "cyan" },
  { source: "peer", target: "hub", label: "subscribe", color: "grape" },
  { source: "hub", target: "backplane", label: "publish", color: "indigo" },
  { source: "backplane", target: "w1", label: "fan-out", color: "orange" },
  { source: "backplane", target: "w2", label: "fan-out", color: "orange" },
  { source: "backplane", target: "w3", label: "fan-out", color: "orange" },
];

/* ─── Graphe 2 : le patron des SONDES (probe → hub → studio) ─────────────── */
const PROBE_NODES: FlowGraphNode[] = [
  {
    id: "probe",
    data: {
      label: "I<X>Probe.probe()",
      sub: "Sonde dans le service (ORM, http…) · best-effort",
      icon: <IconRadar2 size={20} />,
      color: "lime",
      emphasis: true,
    },
  },
  {
    id: "health",
    data: {
      label: "build<X>Health()",
      sub: "Agrège la sonde en un bilan de santé",
      icon: <IconHeartbeat size={20} />,
      color: "green",
    },
  },
  {
    id: "endpoint",
    data: {
      label: "GET /api/<x>/health",
      sub: "1er paint (HTTP one-shot)",
      icon: <IconRouteSquare size={20} />,
      color: "cyan",
    },
  },
  {
    id: "ticker",
    data: {
      label: "Provider ticker",
      sub: "publish périodique (transport-agnostique)",
      icon: <IconClock size={20} />,
      color: "violet",
    },
  },
  {
    id: "channel",
    data: {
      label: "Canal <x>:health",
      sub: "via RealtimeHub (le même que ci-dessus)",
      icon: <IconBuildingBroadcastTower size={20} />,
      color: "indigo",
      emphasis: true,
    },
  },
  {
    id: "studio",
    data: {
      label: "Panneau Studio",
      sub: "Générique via broker · 0 dép au module",
      icon: <IconBrandReact size={20} />,
      color: "pink",
    },
  },
];
const PROBE_EDGES: FlowGraphEdge[] = [
  { source: "probe", target: "health", label: "métriques", color: "lime" },
  { source: "health", target: "endpoint", label: "snapshot", color: "green" },
  { source: "health", target: "ticker", label: "live", color: "green" },
  { source: "endpoint", target: "channel", color: "cyan" },
  { source: "ticker", target: "channel", label: "push", color: "violet" },
  { source: "channel", target: "studio", label: "abonnement", color: "indigo" },
];

/* ─── Bloc LIVE — une sonde EN VRAI (realtime:health = sonde de la Socket) ── */
interface RealtimeHealth {
  channels?: { channel: string; subscribers: number; messages: number }[];
  connectionCount?: number;
  publishTotal?: number;
  fanoutTotal?: number;
  messagesSentTotal?: number;
}
const SocketLiveBlock = observer(() => {
  const data = useNodefonyChannelData<RealtimeHealth>("realtime:health");
  const channels = data?.channels ?? [];
  const fmt = (n: number | undefined) =>
    n === undefined ? "—" : n.toLocaleString("fr-FR");
  return (
    <Grid>
      <StatCard
        label="Connexions"
        icon={<IconPlugConnected size={16} />}
        span={{ base: 6, sm: 3 }}
      >
        {fmt(data?.connectionCount)}
      </StatCard>
      <StatCard
        label="Canaux actifs"
        icon={<IconBroadcast size={16} />}
        span={{ base: 6, sm: 3 }}
      >
        {channels.length || "—"}
      </StatCard>
      <StatCard
        label="Fan-out total"
        icon={<IconAffiliate size={16} />}
        span={{ base: 6, sm: 3 }}
      >
        {fmt(data?.fanoutTotal ?? data?.publishTotal)}
      </StatCard>
      <StatCard
        label="Messages émis"
        icon={<IconRouteSquare size={16} />}
        span={{ base: 6, sm: 3 }}
      >
        {fmt(data?.messagesSentTotal)}
      </StatCard>
      {channels.length > 0 && (
        <Grid.Col span={12}>
          <Paper withBorder radius="md" p="sm">
            <Text size="xs" fw={700} c="dimmed" tt="uppercase" mb={6}>
              Canaux abonnés (live)
            </Text>
            <Group gap="xs">
              {channels.slice(0, 12).map((c) => (
                <Badge
                  key={c.channel}
                  variant="light"
                  color="indigo"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {c.channel} · {c.subscribers}
                </Badge>
              ))}
            </Group>
          </Paper>
        </Grid.Col>
      )}
    </Grid>
  );
});

/* ─── Tableau de faisabilité ─────────────────────────────────────────────── */
const FEASIBILITY = [
  [
    "docsReader.ts (parse frontmatter)",
    "Module @nodefony/documentation (service + API)",
  ],
  [
    "Endpoints kernel docs/symbols",
    "Index transverse (sections) + tags audience",
  ],
  ["symbols.json + relations", "Registre de providers dynamiques ({{ }})"],
  [
    "Bus realtime + hooks nodefony/react",
    "Convention Mermaid + composant auto-graphe",
  ],
  [
    "React Flow + dagre (déjà bundlés)",
    "Portail /nodefony/documentation (nav persona, recherche, TOC)",
  ],
  ["Frontmatter version/status/git", "(P6) gate RBAC par audience"],
].map(([exists, build]) => ({ exists, build }));

function FeasibilityTable() {
  return (
    <Table withTableBorder withColumnBorders verticalSpacing="sm" striped>
      <Table.Thead>
        <Table.Tr>
          <Table.Th>
            <Badge color="teal" variant="light">
              ✅ Existe (réutilisable)
            </Badge>
          </Table.Th>
          <Table.Th>
            <Badge color="orange" variant="light">
              🔨 À construire
            </Badge>
          </Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {FEASIBILITY.map((r) => (
          <Table.Tr key={r.exists}>
            <Table.Td>
              <Text size="sm">{r.exists}</Text>
            </Table.Td>
            <Table.Td>
              <Text size="sm">{r.build}</Text>
            </Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}

function SectionTitle({
  icon,
  color,
  children,
  hint,
}: {
  icon: ReactNode;
  color: string;
  children: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Group gap="xs" mt="xl" mb="xs">
      <ThemeIcon variant="light" color={color} radius="md" size={30}>
        {icon}
      </ThemeIcon>
      <Title order={3} style={{ flex: 1 }}>
        {children}
      </Title>
      {hint}
    </Group>
  );
}

/* ─── Types data plane (miroir local) ───────────────────────────────────── */
interface DocPage {
  slug: string;
  title: string;
  audience?: Persona[];
  version?: string;
  status?: string;
  wip?: boolean;
}
interface DocSection {
  id: string;
  label: string;
  pages: DocPage[];
}
interface DocTree {
  audiences: { key: Persona; label: string; desc: string }[];
  sections: DocSection[];
}
interface DocContent {
  slug: string;
  title: string;
  version?: string;
  vars?: Record<string, string | number>;
  markdown: string;
  temporary?: boolean;
}

function resolveVars(
  md: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return md;
  return md.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) =>
    k in vars ? String(vars[k]) : m,
  );
}

/* ════════════════════════════════════════════════════════════════════════
 * PAGE
 * ════════════════════════════════════════════════════════════════════════ */
export const Documentation = observer(() => {
  const store = useStore();
  const state = useNodefonyState();
  const [persona, setPersona] = useState<Persona>("developer");
  const [activeSlug, setActiveSlug] = useState("socket");
  const [live, setLive] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [navQuery, setNavQuery] = useState("");

  const treeFetcher = useCallback(
    () => store.api.getAbsolute<DocTree>("/nodefony/documentation/api/tree"),
    [store],
  );
  const tree = useResource(treeFetcher);

  const pageFetcher = useCallback(
    () =>
      store.api.getAbsolute<DocContent>(
        `/nodefony/documentation/api/page/${encodeURIComponent(activeSlug)}`,
      ),
    [store, activeSlug],
  );
  const page = useResource(pageFetcher);

  const visible = (audience?: Persona[]) =>
    persona === "admin" || !audience || audience.includes(persona);

  const sections = tree.data?.sections ?? [];
  const markdown = page.data
    ? resolveVars(page.data.markdown, page.data.vars)
    : "";
  const isSocket = activeSlug === "socket";

  // Recherche dans la nav : filtre les pages (titre) ; déplie les sections trouvées.
  const navQ = navQuery.trim().toLowerCase();
  const navSections = sections
    .map((s) => ({
      ...s,
      pages: s.pages.filter(
        (p) =>
          visible(p.audience) &&
          (!navQ || p.title.toLowerCase().includes(navQ)),
      ),
    }))
    .filter((s) => s.pages.length > 0);
  const expandAll = () =>
    setCollapsed(Object.fromEntries(sections.map((s) => [s.id, false])));
  const collapseAll = () =>
    setCollapsed(Object.fromEntries(sections.map((s) => [s.id, true])));

  return (
    <Stack gap="md">
      <PageHeader
        title="Documentation"
        subtitle="Démo — portail unifié /nodefony/documentation (POC, pour décider)"
        icon={<IconFileText size={22} />}
        sticky
        actions={
          <RoleSwitch
            value={persona}
            onChange={(v) => setPersona(v as Persona)}
            size="sm"
          />
        }
      />

      <DocLayout
        navTitle="Documentation"
        navActions={
          <Group gap={2} wrap="nowrap">
            <Tooltip label="Tout déplier">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={expandAll}
                aria-label="Tout déplier"
              >
                <IconChevronsDown size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Tout plier">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={collapseAll}
                aria-label="Tout plier"
              >
                <IconChevronsUp size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        navSearch={
          <TextInput
            size="xs"
            mb={6}
            placeholder="Rechercher une page…"
            value={navQuery}
            onChange={(e) => setNavQuery(e.currentTarget.value)}
            leftSection={<IconSearch size={13} />}
            aria-label="Rechercher dans la documentation"
          />
        }
        nav={
          <DataState
            loading={tree.loading && !tree.data}
            error={tree.error}
            onRetry={tree.reload}
            minHeight={120}
          >
            <Stack gap={4}>
              {navSections.map((s) => {
                // En recherche → toujours déplié ; sinon tout plié par défaut.
                const isCollapsed = navQ ? false : (collapsed[s.id] ?? true);
                return (
                  <Box key={s.id}>
                    <UnstyledButton
                      onClick={() =>
                        setCollapsed((c) => ({ ...c, [s.id]: !isCollapsed }))
                      }
                      aria-expanded={!isCollapsed}
                      style={{ width: "100%", borderRadius: rem(4) }}
                    >
                      <Group gap={4} wrap="nowrap" px="xs" py={3}>
                        {isCollapsed ? (
                          <IconChevronRight size={13} />
                        ) : (
                          <IconChevronDown size={13} />
                        )}
                        <Text size="xs" fw={700} c="dimmed" style={{ flex: 1 }}>
                          {s.label}
                        </Text>
                        <Badge size="xs" variant="default" radius="sm">
                          {s.pages.length}
                        </Badge>
                      </Group>
                    </UnstyledButton>
                    <Collapse in={!isCollapsed}>
                      {s.pages.map((p) => (
                        <NavLink
                          key={p.slug}
                          active={p.slug === activeSlug}
                          label={p.title}
                          leftSection={<IconFileText size={15} />}
                          rightSection={
                            p.wip ? (
                              <Badge size="xs" variant="light" color="gray">
                                à venir
                              </Badge>
                            ) : undefined
                          }
                          disabled={p.wip}
                          onClick={() => !p.wip && setActiveSlug(p.slug)}
                          styles={{ label: { fontSize: rem(12.5) } }}
                        />
                      ))}
                    </Collapse>
                  </Box>
                );
              })}
              {!navSections.length && (
                <Text size="xs" c="dimmed" px="xs" py={4}>
                  Aucune page ne correspond.
                </Text>
              )}
            </Stack>
          </DataState>
        }
        title={
          <Group gap="xs" wrap="nowrap">
            <Title order={2} lineClamp={1} style={{ minWidth: 0 }}>
              {page.data?.title ?? "—"}
            </Title>
            {page.data?.temporary && (
              <Badge color="yellow" variant="light">
                temporaire
              </Badge>
            )}
            <Badge variant="default">{page.data?.version ?? DOC_VERSION}</Badge>
          </Group>
        }
        tocMarkdown={isSocket ? undefined : markdown}
        mode="page"
      >
        <DataState
          loading={page.loading && !page.data}
          error={page.error}
          onRetry={page.reload}
          minHeight={300}
        >
          {isSocket ? (
            <>
              <Alert
                color="blue"
                variant="light"
                icon={<IconServer2 size={18} />}
              >
                <b>La Socket Nodefony en une image.</b> Une multiprise
                intelligente : une <b>seule prise</b> côté client et serveur, et
                tu y branches autant de canaux que tu veux. Tu ne changes jamais
                la prise — seulement le <b>fond de panier</b> derrière
                (mono-process, cluster, ou Redis).
              </Alert>

              <SectionTitle
                icon={<IconStack2 size={18} />}
                color="indigo"
                hint={
                  <GraphHint
                    title="Architecture de la Socket"
                    version={DOC_VERSION}
                    summary="Les couches traversées par un message, du navigateur jusqu'aux workers."
                    sections={[
                      {
                        label: "Comment lire",
                        body: "De haut en bas : le client parle au Hub via un transport ; le Hub publie sur le backplane qui diffuse (fan-out) à tous les workers. Glisse les nœuds, zoom via la minimap.",
                      },
                    ]}
                  />
                }
              >
                Architecture — les couches
              </SectionTitle>
              <FlowGraph
                nodes={SOCKET_NODES}
                edges={SOCKET_EDGES}
                dir="TB"
                height={520}
                ariaLabel="Architecture en couches de la Socket Nodefony"
              />

              <SectionTitle icon={<IconFileText size={18} />} color="grape">
                Le détail (doc rédigée)
              </SectionTitle>
              <Text size="xs" c="dimmed" mb="xs">
                ↓ Servi par <Code>/nodefony/documentation/api/page/socket</Code>{" "}
                — le schéma de séquence est <b>écrit dans le markdown</b>{" "}
                (Mermaid) et les valeurs en bas sont{" "}
                <b>résolues côté serveur</b>.
              </Text>
              <MarkdownDoc markdown={markdown} />

              <SectionTitle
                icon={<IconRadar2 size={18} />}
                color="lime"
                hint={
                  <GraphHint
                    title="Le patron des sondes"
                    version={DOC_VERSION}
                    summary="Comment un sous-système publie ses constantes vitales jusqu'à Studio."
                    sections={[
                      {
                        label: "Comment lire",
                        body: "De gauche à droite : une sonde mesure, build*Health l'agrège, exposée en HTTP (1er paint) ET poussée par un ticker sur un canal santé, que Studio affiche — sans dépendre du module.",
                      },
                    ]}
                  />
                }
              >
                Les sondes — observabilité
              </SectionTitle>
              <Alert
                color="lime"
                variant="light"
                icon={<IconRadar2 size={18} />}
              >
                <b>
                  Une sonde, c'est un thermomètre branché sur un sous-système.
                </b>{" "}
                Elle prend les <b>constantes vitales</b> (requêtes/s, latence,
                erreurs) et les <b>publie sur un canal santé</b>. Studio
                s'abonne et affiche — il reste <b>générique</b> : il lit juste
                un canal <Code>&lt;module&gt;:health</Code>.
              </Alert>
              <FlowGraph
                nodes={PROBE_NODES}
                edges={PROBE_EDGES}
                dir="LR"
                height={360}
                ariaLabel="Patron des sondes : probe vers hub vers Studio"
              />

              <SectionTitle
                icon={<IconHeartbeat size={18} />}
                color="teal"
                hint={
                  <DocHint
                    title="Sonde en direct"
                    version={DOC_VERSION}
                    summary="La doc cite l'état RÉEL : ce bloc lit le canal realtime:health (la sonde de la Socket elle-même)."
                    sections={[
                      {
                        label: "Si 0 / vide",
                        body: "Aucun abonné actif ou flux santé non démarré : active le temps réel, ouvre d'autres pages Studio pour générer des canaux.",
                      },
                    ]}
                  />
                }
              >
                La sonde en vrai — <Code>realtime:health</Code>
              </SectionTitle>
              <Group gap="sm" mb="sm">
                <Switch
                  checked={live}
                  onChange={(e) => setLive(e.currentTarget.checked)}
                  label="Temps réel"
                  aria-label="Activer le temps réel"
                />
                <Badge
                  variant="dot"
                  color={state === "connected" ? "teal" : "gray"}
                >
                  {state}
                </Badge>
                <Text size="xs" c="dimmed">
                  Démontre « l'info dynamique récupérée et affichée dans la doc
                  ».
                </Text>
              </Group>
              {live ? (
                <SocketLiveBlock />
              ) : (
                <Paper withBorder radius="md" p="lg" ta="center" c="dimmed">
                  <IconHeartbeat
                    size={28}
                    style={{ opacity: 0.5 }}
                    aria-hidden
                  />
                  <Text size="sm" mt="xs">
                    Active le « Temps réel » pour brancher la sonde de la
                    Socket.
                  </Text>
                </Paper>
              )}

              <SectionTitle
                icon={<IconBuildingBroadcastTower size={18} />}
                color="orange"
              >
                Faisabilité — existe vs à construire
              </SectionTitle>
              <FeasibilityTable />
              <Text size="xs" c="dimmed" mt="xs">
                Verdict : l'infra est à ~60 %. Le travail neuf = le module
                d'index + le portail + le moteur de directives dynamiques. Rien
                dans le hot path runtime.
              </Text>
            </>
          ) : (
            <>
              {page.data?.temporary && (
                <Alert
                  color="yellow"
                  variant="light"
                  icon={<IconFileText size={18} />}
                  mb="md"
                >
                  Page <b>temporaire</b> branchée pour ta lecture — contenu lu
                  en direct depuis le fichier du repo. Le vrai module gèrera ça
                  proprement.
                </Alert>
              )}
              <MarkdownDoc markdown={markdown} maxWidth={1000} />
            </>
          )}
        </DataState>
      </DocLayout>
    </Stack>
  );
});

export default Documentation;
