import { observer } from "mobx-react-lite";
import { useEffect, useId, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import dayjs from "dayjs";
import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Grid,
  Group,
  Loader,
  Modal,
  NavLink,
  Progress,
  rem,
  RingProgress,
  ScrollArea,
  Stack,
  Table,
  Tabs,
  Text,
  ThemeIcon,
  Title,
  Tooltip,
  TypographyStylesProvider,
  useMantineColorScheme,
} from "@mantine/core";
import {
  IconAppWindow,
  IconPuzzle,
  IconArrowLeft,
  IconInfoCircle,
  IconPackages,
  IconRoute,
  IconSettings,
  IconAffiliate,
  IconAlertTriangle,
  IconBook,
  IconCode,
  IconFileText,
  IconMaximize,
  IconShieldCheck,
  IconFlask,
  IconPlayerPlay,
} from "@tabler/icons-react";
import { useStore } from "../stores";

interface ModuleDetailData {
  key: string;
  name: string;
  version: string | null;
  isApp: boolean;
  path: string | null;
  dependencies: string[];
  services: { name: string; class: string | null }[];
  config: Record<string, unknown>;
}
interface RouteRow {
  name: string;
  path: string | null;
  methods: string[];
  controller: string | null;
  action: string | null;
  module: string | null;
  bypassFirewall: boolean;
}
interface DocSummary {
  slug: string;
  title: string;
  status: string | null;
  since: string | null;
  updated: string | null;
  gitUpdated: string | null;
  order: number;
}
interface DocContent {
  slug: string;
  frontmatter: Record<string, unknown>;
  markdown: string;
  gitUpdated: string | null;
}
interface ModuleSymbol {
  name: string;
  kind: string;
  file: string;
  description: string | null;
  extends: string | null;
  implements: string[];
  decorators: string[];
}
interface CoverageFileRow {
  file: string;
  lines: number;
  statements: number;
  functions: number;
  branches: number;
}
interface CoverageReport {
  available: boolean;
  generated?: string | null;
  total?: { lines: number; statements: number; functions: number; branches: number };
  files?: CoverageFileRow[];
}
interface TestsInfo {
  files: string[];
  devMode: boolean;
}
interface TestRunResult {
  ok: boolean;
  code: number | null;
  passed: number;
  failed: number;
  durationMs: number;
  output: string;
  mode: string;
}

const METHOD_COLORS: Record<string, string> = {
  GET: "teal",
  POST: "blue",
  PUT: "yellow",
  PATCH: "grape",
  DELETE: "red",
  WEBSOCKET: "cyan",
  ANY: "gray",
};

const STATUS_COLORS: Record<string, string> = {
  stable: "teal",
  draft: "gray",
  deprecated: "red",
};

const KIND_COLORS: Record<string, string> = {
  class: "orange",
  interface: "blue",
  function: "teal",
  type: "grape",
  enum: "yellow",
};

/**
 * ModuleDetail — page d'un module (route `/nodefony/modules/:name`).
 * Onglets affichés UNIQUEMENT s'ils ont du contenu (un pseudo-module comme
 * `core` n'a ni Routes ni Config ni Services → ces onglets disparaissent).
 */
export const ModuleDetail = observer(() => {
  const { name = "" } = useParams();
  const navigate = useNavigate();
  const store = useStore();
  const [data, setData] = useState<ModuleDetailData | null>(null);
  const [routes, setRoutes] = useState<RouteRow[]>([]);
  const [docs, setDocs] = useState<DocSummary[]>([]);
  const [symbols, setSymbols] = useState<ModuleSymbol[]>([]);
  const [coverage, setCoverage] = useState<CoverageReport>({ available: false });
  const [tests, setTests] = useState<TestsInfo>({ files: [], devMode: false });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      store.api.getAbsolute<ModuleDetailData>(
        `/nodefony/kernel/api/module/${encodeURIComponent(name)}`,
      ),
      store.api
        .getAbsolute<RouteRow[]>("/nodefony/framework/api/routes")
        .catch(() => [] as RouteRow[]),
      store.api
        .getAbsolute<{ docs: DocSummary[] }>(
          `/nodefony/kernel/api/module/${encodeURIComponent(name)}/docs`,
        )
        .then((r) => r.docs ?? [])
        .catch(() => [] as DocSummary[]),
      store.api
        .getAbsolute<{ symbols: ModuleSymbol[] }>(
          `/nodefony/kernel/api/module/${encodeURIComponent(name)}/symbols`,
        )
        .then((r) => r.symbols ?? [])
        .catch(() => [] as ModuleSymbol[]),
      store.api
        .getAbsolute<CoverageReport>(
          `/nodefony/kernel/api/module/${encodeURIComponent(name)}/coverage`,
        )
        .catch(() => ({ available: false }) as CoverageReport),
      store.api
        .getAbsolute<TestsInfo>(
          `/nodefony/kernel/api/module/${encodeURIComponent(name)}/tests`,
        )
        .catch(() => ({ files: [], devMode: false }) as TestsInfo),
    ])
      .then(([d, allRoutes, docList, symList, cov, testsInfo]) => {
        if (cancelled) return;
        setData(d);
        setRoutes(allRoutes.filter((r) => r.module === name));
        setDocs(docList);
        setSymbols(symList);
        setCoverage(cov);
        setTests(testsInfo);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, name]);

  if (loading) {
    return (
      <Group justify="center" py="xl">
        <Loader />
      </Group>
    );
  }

  if (error || !data) {
    return (
      <Stack gap="md">
        <Button
          variant="subtle"
          leftSection={<IconArrowLeft size={16} />}
          onClick={() => navigate("/nodefony/modules")}
          w="fit-content"
        >
          Modules
        </Button>
        <Alert color="red" icon={<IconAlertTriangle size={16} />} title="Module introuvable">
          {error ?? `Aucun module "${name}".`}
        </Alert>
      </Stack>
    );
  }

  const hasDocs = docs.length > 0;
  const hasApi = symbols.length > 0;
  const hasCoverage = coverage.available === true;
  const hasTests = tests.files.length > 0;
  const hasDeps = data.dependencies.length > 0;
  const hasRoutes = routes.length > 0;
  const hasServices = data.services.length > 0;
  const hasConfig = !!data.config && Object.keys(data.config).length > 0;

  return (
    <Stack gap="md">
      <Button
        variant="subtle"
        leftSection={<IconArrowLeft size={16} />}
        onClick={() => navigate("/nodefony/modules")}
        w="fit-content"
        px={0}
      >
        Modules
      </Button>

      {/* ── En-tête ── */}
      <Group gap="md" wrap="nowrap">
        <ThemeIcon variant="light" color={data.isApp ? "orange" : "gray"} size={54} radius="md">
          {data.isApp ? <IconAppWindow size={30} /> : <IconPuzzle size={30} />}
        </ThemeIcon>
        <Stack gap={4}>
          <Group gap="sm">
            <Title order={2}>{data.name}</Title>
            {data.version && <Badge variant="default">v{data.version}</Badge>}
            <Badge variant="light" color={data.isApp ? "orange" : "gray"}>
              {data.isApp ? "application" : "package"}
            </Badge>
          </Group>
          <Text c="dimmed" size="sm" ff="monospace">
            {data.path ?? "—"}
          </Text>
        </Stack>
      </Group>

      {/* ── Card à onglets (seuls les onglets avec contenu sont affichés) ── */}
      <Card withBorder radius="md" p={0}>
        <Tabs defaultValue={hasDocs ? "docs" : "overview"}>
          <Tabs.List>
            <Tabs.Tab value="overview" leftSection={<IconInfoCircle size={16} />}>
              Vue d'ensemble
            </Tabs.Tab>
            {hasDocs && (
              <Tabs.Tab value="docs" leftSection={<IconBook size={16} />} rightSection={<CountBadge n={docs.length} />}>
                Docs
              </Tabs.Tab>
            )}
            {hasApi && (
              <Tabs.Tab value="api" leftSection={<IconCode size={16} />} rightSection={<CountBadge n={symbols.length} />}>
                API
              </Tabs.Tab>
            )}
            {hasCoverage && (
              <Tabs.Tab
                value="coverage"
                leftSection={<IconShieldCheck size={16} />}
                rightSection={
                  <Badge size="xs" variant="light" color={covColor(coverage.total?.lines ?? 0)}>
                    {Math.round(coverage.total?.lines ?? 0)}%
                  </Badge>
                }
              >
                Coverage
              </Tabs.Tab>
            )}
            {hasTests && (
              <Tabs.Tab value="tests" leftSection={<IconFlask size={16} />} rightSection={<CountBadge n={tests.files.length} />}>
                Tests
              </Tabs.Tab>
            )}
            {hasDeps && (
              <Tabs.Tab value="deps" leftSection={<IconPackages size={16} />} rightSection={<CountBadge n={data.dependencies.length} />}>
                Dépendances
              </Tabs.Tab>
            )}
            {hasRoutes && (
              <Tabs.Tab value="routes" leftSection={<IconRoute size={16} />} rightSection={<CountBadge n={routes.length} />}>
                Routes
              </Tabs.Tab>
            )}
            {hasServices && (
              <Tabs.Tab value="services" leftSection={<IconAffiliate size={16} />} rightSection={<CountBadge n={data.services.length} />}>
                Services
              </Tabs.Tab>
            )}
            {hasConfig && (
              <Tabs.Tab value="config" leftSection={<IconSettings size={16} />}>
                Config
              </Tabs.Tab>
            )}
          </Tabs.List>

          <Box p="lg">
            <Tabs.Panel value="overview">
              <Grid>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Stack gap={6}>
                    <Field k="Clé" v={data.key} mono />
                    <Field k="Package" v={data.name} />
                    <Field k="Version" v={data.version ?? "—"} />
                    <Field k="Type" v={data.isApp ? "application" : "package"} />
                  </Stack>
                </Grid.Col>
                <Grid.Col span={{ base: 12, sm: 6 }}>
                  <Stack gap={6}>
                    {hasDeps && <Field k="Dépendances" v={String(data.dependencies.length)} />}
                    {hasRoutes && <Field k="Routes" v={String(routes.length)} />}
                    {hasServices && <Field k="Services" v={String(data.services.length)} />}
                    {hasApi && <Field k="Symboles" v={String(symbols.length)} />}
                    <Field k="Chemin" v={data.path ?? "—"} mono />
                  </Stack>
                </Grid.Col>
              </Grid>
            </Tabs.Panel>

            {hasDocs && (
              <Tabs.Panel value="docs">
                <DocsPanel moduleKey={name} version={data.version} docs={docs} />
              </Tabs.Panel>
            )}

            {hasApi && (
              <Tabs.Panel value="api">
                <ApiPanel symbols={symbols} />
              </Tabs.Panel>
            )}

            {hasCoverage && (
              <Tabs.Panel value="coverage">
                <CoveragePanel report={coverage} />
              </Tabs.Panel>
            )}

            {hasTests && (
              <Tabs.Panel value="tests">
                <TestsPanel moduleKey={name} tests={tests} />
              </Tabs.Panel>
            )}

            {hasDeps && (
              <Tabs.Panel value="deps">
                <Group gap={8}>
                  {data.dependencies.map((d) => (
                    <Badge
                      key={d}
                      variant="outline"
                      size="md"
                      color={d === "nodefony" || d.startsWith("@nodefony/") ? "orange" : "gray"}
                    >
                      {d}
                    </Badge>
                  ))}
                </Group>
              </Tabs.Panel>
            )}

            {hasRoutes && (
              <Tabs.Panel value="routes">
                <Table.ScrollContainer minWidth={560}>
                  <Table striped highlightOnHover withRowBorders={false}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Méthodes</Table.Th>
                        <Table.Th>Chemin</Table.Th>
                        <Table.Th>Controller</Table.Th>
                        <Table.Th>Action</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {routes.map((r) => (
                        <Table.Tr key={r.name}>
                          <Table.Td>
                            <Group gap={4}>
                              {r.methods.map((m) => (
                                <Badge key={m} size="xs" color={METHOD_COLORS[m] ?? "gray"} variant="light">
                                  {m}
                                </Badge>
                              ))}
                            </Group>
                          </Table.Td>
                          <Table.Td><Code>{r.path}</Code></Table.Td>
                          <Table.Td><Text size="xs">{r.controller ?? "—"}</Text></Table.Td>
                          <Table.Td><Text size="xs" c="dimmed">{r.action ?? "—"}</Text></Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Tabs.Panel>
            )}

            {hasServices && (
              <Tabs.Panel value="services">
                <Table.ScrollContainer minWidth={420}>
                  <Table striped highlightOnHover withRowBorders={false}>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Nom (DI)</Table.Th>
                        <Table.Th>Classe</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {data.services.map((s) => (
                        <Table.Tr key={s.name}>
                          <Table.Td><Code>{s.name}</Code></Table.Td>
                          <Table.Td><Text size="xs" c="dimmed">{s.class ?? "—"}</Text></Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Tabs.Panel>
            )}

            {hasConfig && (
              <Tabs.Panel value="config">
                <ScrollArea.Autosize mah={520}>
                  <Code block>{JSON.stringify(data.config, null, 2)}</Code>
                </ScrollArea.Autosize>
              </Tabs.Panel>
            )}
          </Box>
        </Tabs>
      </Card>
    </Stack>
  );
});

/** Hauteur de lecture inline = viewport moins l'en-tête de page + onglets. */
const READER_HEIGHT = "calc(100vh - 250px)";

/**
 * DocsPanel — lecture fluide de la doc colocalisée.
 * Pleine hauteur (TOC + lecture occupent tout le viewport, scroll indépendant),
 * largeur de lecture bornée (confort), typo soignée, liens internes `.md`
 * cliquables, et **bouton plein écran** (schémas réseau/architecture en grand).
 */
function DocsPanel({
  moduleKey,
  version,
  docs,
}: {
  moduleKey: string;
  version: string | null;
  docs: DocSummary[];
}) {
  const store = useStore();
  const [active, setActive] = useState<string | null>(docs[0]?.slug ?? null);
  const [content, setContent] = useState<DocContent | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setDocLoading(true);
    setDocError(null);
    store.api
      .getAbsolute<DocContent>(
        `/nodefony/kernel/api/module/${encodeURIComponent(moduleKey)}/docs/${encodeURIComponent(active)}`,
      )
      .then((c) => {
        if (!cancelled) setContent(c);
      })
      .catch((e) => {
        if (!cancelled) setDocError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setDocLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [store, moduleKey, active]);

  const meta = docs.find((d) => d.slug === active);

  // Composants markdown → primitives Mantine + liens internes `.md` cliquables
  // + rendu Mermaid des blocks ```mermaid (vrais diagrammes vectoriels).
  const mdComponents: Components = {
    code({ className, children }) {
      if (/\blanguage-mermaid\b/.test(className ?? "")) {
        return <MermaidDiagram code={String(children ?? "").replace(/\n$/, "")} />;
      }
      return <code className={className}>{children}</code>;
    },
    a({ href, children }) {
      const h = String(href ?? "");
      const isExternal = /^https?:\/\//i.test(h);
      const m = h.match(/^\.?\/?([a-z0-9._-]+)\.md(#.*)?$/i);
      const slug = m?.[1];
      if (slug && docs.some((d) => d.slug === slug)) {
        return (
          <Anchor
            onClick={(e) => {
              e.preventDefault();
              setActive(slug);
            }}
            style={{ cursor: "pointer" }}
          >
            {children}
          </Anchor>
        );
      }
      return (
        <Anchor href={h} target={isExternal ? "_blank" : undefined} rel={isExternal ? "noreferrer" : undefined}>
          {children}
        </Anchor>
      );
    },
  };

  const toc = (
    <>
      <Text size="xs" c="dimmed" tt="uppercase" fw={700} mb={6} px="xs">
        Sommaire
      </Text>
      <Stack gap={2}>
        {docs.map((d) => (
          <NavLink
            key={d.slug}
            active={d.slug === active}
            label={d.title}
            leftSection={<IconFileText size={16} />}
            onClick={() => setActive(d.slug)}
            styles={{ label: { fontSize: rem(13) } }}
          />
        ))}
      </Stack>
    </>
  );

  // Corps markdown — `full` élargit la colonne de lecture en plein écran.
  const body = (full: boolean) =>
    docLoading ? (
      <Group justify="center" py="xl"><Loader size="sm" /></Group>
    ) : docError ? (
      <Alert color="red" icon={<IconAlertTriangle size={16} />}>{docError}</Alert>
    ) : content ? (
      <TypographyStylesProvider>
        <Box style={{ maxWidth: rem(full ? 1100 : 820), fontSize: rem(15), lineHeight: 1.75 }}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {content.markdown}
          </ReactMarkdown>
        </Box>
      </TypographyStylesProvider>
    ) : null;

  const header = (full: boolean) =>
    meta && (
      <Group gap="xs" mb="md" wrap="nowrap">
        <Title order={3} style={{ flex: 1, minWidth: 0 }} lineClamp={1}>
          {meta.title}
        </Title>
        {version && <Badge variant="default" size="sm">v{version}</Badge>}
        {meta.status && (
          <Badge size="sm" color={STATUS_COLORS[meta.status] ?? "gray"} variant="light">
            {meta.status}
          </Badge>
        )}
        {(content?.gitUpdated ?? meta.gitUpdated) && (
          <Tooltip label="Dernier commit git de ce fichier (détecte la dérive doc↔code)">
            <Text size="xs" c="dimmed">
              maj {dayjs(content?.gitUpdated ?? meta.gitUpdated).format("YYYY-MM-DD")}
            </Text>
          </Tooltip>
        )}
        {!full && (
          <Tooltip label="Plein écran (schémas)">
            <ActionIcon variant="subtle" color="gray" onClick={() => setFullscreen(true)}>
              <IconMaximize size={18} />
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
    );

  return (
    <>
      <Grid gutter="xl">
        <Grid.Col span={{ base: 12, sm: 3 }}>
          <ScrollArea h={READER_HEIGHT} type="hover">
            {toc}
          </ScrollArea>
        </Grid.Col>
        <Grid.Col span={{ base: 12, sm: 9 }}>
          {header(false)}
          <ScrollArea h={READER_HEIGHT} type="auto" offsetScrollbars>
            {body(false)}
          </ScrollArea>
        </Grid.Col>
      </Grid>

      <Modal
        opened={fullscreen}
        onClose={() => setFullscreen(false)}
        fullScreen
        radius={0}
        title={meta?.title ?? "Documentation"}
        styles={{ body: { height: "calc(100vh - 60px)" } }}
      >
        <Grid gutter="xl" h="100%">
          <Grid.Col span={{ base: 12, sm: 3 }}>
            <ScrollArea h="calc(100vh - 90px)" type="hover">
              {toc}
            </ScrollArea>
          </Grid.Col>
          <Grid.Col span={{ base: 12, sm: 9 }}>
            <ScrollArea h="calc(100vh - 90px)" type="auto" offsetScrollbars>
              {body(true)}
            </ScrollArea>
          </Grid.Col>
        </Grid>
      </Modal>
    </>
  );
}

/**
 * MermaidDiagram — rend un block ```mermaid en SVG vectoriel.
 * Mermaid est **chargé en lazy** (`import()` dynamique) → chunk séparé, tiré
 * uniquement quand une doc contient un schéma. Thème suivi du colorScheme.
 */
function MermaidDiagram({ code }: { code: string }) {
  const { colorScheme } = useMantineColorScheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: colorScheme === "light" ? "default" : "dark",
          securityLevel: "strict",
          fontFamily: "inherit",
        });
        const { svg } = await mermaid.render(`mermaid-${baseId}-${Date.now()}`, code);
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, colorScheme, baseId]);

  if (error) {
    return (
      <Alert color="orange" icon={<IconAlertTriangle size={16} />} title="Schéma Mermaid invalide" my="md">
        <Code block>{code}</Code>
        <Text size="xs" c="dimmed" mt="xs">{error}</Text>
      </Alert>
    );
  }
  return <Box ref={containerRef} my="md" style={{ overflowX: "auto", textAlign: "center" }} />;
}

/** ApiPanel — référence API auto (kind/nom/description) depuis `.ai/symbols.json`. */
function ApiPanel({ symbols }: { symbols: ModuleSymbol[] }) {
  return (
    <Table.ScrollContainer minWidth={620}>
      <Table striped highlightOnHover withRowBorders={false}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th w={110}>Kind</Table.Th>
            <Table.Th>Nom</Table.Th>
            <Table.Th>Description</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {symbols.map((s) => (
            <Table.Tr key={`${s.kind}:${s.name}`}>
              <Table.Td>
                <Badge size="xs" variant="light" color={KIND_COLORS[s.kind] ?? "gray"}>
                  {s.kind}
                </Badge>
              </Table.Td>
              <Table.Td>
                <Code>{s.name}</Code>
                {s.extends && (
                  <Text span size="xs" c="dimmed" ml={6}>
                    extends {s.extends}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Text size="xs" c={s.description ? undefined : "dimmed"}>
                  {s.description ?? "—"}
                </Text>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/** Badge résultat d'un run de tests. */
function ResultBadge({ res }: { res: TestRunResult }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Badge color={res.ok ? "teal" : "red"} variant="light">
        {res.ok ? "✓" : "✗"} {res.passed} passed{res.failed ? ` / ${res.failed} failed` : ""}
      </Badge>
      <Text size="xs" c="dimmed">{(res.durationMs / 1000).toFixed(1)}s</Text>
    </Group>
  );
}

/**
 * TestsPanel — lance les tests du module (un fichier ou toute la suite) via
 * `POST /nodefony/kernel/api/module/{key}/test/run` (gardé DEV-ONLY côté
 * backend). « Lancer tous » = `npm run coverage` (rafraîchit aussi le coverage).
 */
function TestsPanel({ moduleKey, tests }: { moduleKey: string; tests: TestsInfo }) {
  const store = useStore();
  const ALL = "__all__";
  const [results, setResults] = useState<Record<string, TestRunResult | "running">>({});

  const fail = (k: string, msg: string) =>
    setResults((r) => ({
      ...r,
      [k]: { ok: false, code: null, passed: 0, failed: 0, durationMs: 0, output: msg, mode: "" },
    }));

  // Run ASYNCHRONE : POST démarre + rend jobId, puis on poll GET ?jobId (les
  // requêtes restent courtes → robuste, pas de "Failed to fetch" sur un run long).
  const run = async (file?: string) => {
    const k = file ?? ALL;
    const base = `/nodefony/kernel/api/module/${encodeURIComponent(moduleKey)}/test/run`;
    setResults((r) => ({ ...r, [k]: "running" }));
    try {
      const start = await store.api.postAbsolute<{ jobId?: string }>(base, file ? { file } : {});
      const jobId = start.jobId;
      if (!jobId) return fail(k, "pas de jobId renvoyé");
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 1500));
        const st = await store.api.getAbsolute<{ done: boolean } & TestRunResult>(
          `${base}?jobId=${encodeURIComponent(jobId)}`,
        );
        if (st.done) {
          setResults((r) => ({ ...r, [k]: st }));
          return;
        }
      }
      fail(k, "timeout (run trop long)");
    } catch (e) {
      fail(k, e instanceof Error ? e.message : String(e));
    }
  };

  if (!tests.devMode) {
    return (
      <Alert color="yellow" icon={<IconAlertTriangle size={16} />} title="Lancement désactivé">
        Le lancement des tests depuis Studio n'est autorisé qu'en mode <Code>development</Code>.
      </Alert>
    );
  }

  const allRes = results[ALL];
  const failures = Object.entries(results).filter(
    ([, r]) => r !== "running" && !(r as TestRunResult).ok,
  ) as [string, TestRunResult][];

  return (
    <Stack gap="md">
      <Group>
        <Button
          leftSection={<IconPlayerPlay size={16} />}
          loading={allRes === "running"}
          onClick={() => run()}
        >
          Lancer tous (+ coverage)
        </Button>
        {allRes && allRes !== "running" && <ResultBadge res={allRes} />}
        <Text size="xs" c="dimmed">
          « Lancer tous » régénère aussi le coverage (recharge la page pour le voir à jour).
        </Text>
      </Group>

      <Table.ScrollContainer minWidth={560}>
        <Table striped highlightOnHover withRowBorders={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Fichier de test</Table.Th>
              <Table.Th w={90}>Action</Table.Th>
              <Table.Th>Résultat</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {tests.files.map((f) => {
              const res = results[f];
              return (
                <Table.Tr key={f}>
                  <Table.Td><Code>{f}</Code></Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconPlayerPlay size={14} />}
                      loading={res === "running"}
                      onClick={() => run(f)}
                    >
                      Run
                    </Button>
                  </Table.Td>
                  <Table.Td>{res && res !== "running" ? <ResultBadge res={res} /> : null}</Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>

      {failures.map(([k, r]) => (
        <Alert key={k} color="red" icon={<IconAlertTriangle size={16} />} title={`Échec : ${k === ALL ? "suite complète" : k}`}>
          <ScrollArea.Autosize mah={240}>
            <Code block>{r.output || "(pas de sortie)"}</Code>
          </ScrollArea.Autosize>
        </Alert>
      ))}
    </Stack>
  );
}

/** Seuil couleur couverture : ≥80 teal, ≥50 jaune, sinon rouge. */
function covColor(pct: number): string {
  if (pct >= 80) return "teal";
  if (pct >= 50) return "yellow";
  return "red";
}

/**
 * CoveragePanel — affiche le dernier rapport de couverture (vitest+v8,
 * json-summary servi par `/nodefony/kernel/api/module/{key}/coverage`).
 * Studio AFFICHE le rapport, il ne lance pas les tests.
 */
function CoveragePanel({ report }: { report: CoverageReport }) {
  const t = report.total;
  const files = report.files ?? [];
  const ring = (pct: number, label: string) => (
    <Stack gap={4} align="center">
      <RingProgress
        size={92}
        thickness={8}
        roundCaps
        sections={[{ value: pct, color: covColor(pct) }]}
        label={<Text ta="center" fw={700} size="sm">{Math.round(pct)}%</Text>}
      />
      <Text size="xs" c="dimmed">{label}</Text>
    </Stack>
  );
  return (
    <Stack gap="md">
      <Group gap="xl" wrap="wrap" align="flex-start">
        {ring(t?.lines ?? 0, "Lines")}
        {ring(t?.statements ?? 0, "Statements")}
        {ring(t?.functions ?? 0, "Functions")}
        {ring(t?.branches ?? 0, "Branches")}
        {report.generated && (
          <Tooltip label="Date du dernier rapport (npm run coverage)">
            <Text size="xs" c="dimmed" mt="md">
              généré {dayjs(report.generated).format("YYYY-MM-DD HH:mm")}
            </Text>
          </Tooltip>
        )}
      </Group>
      <Text size="xs" c="dimmed">
        Couverture des tests <b>unit</b> (vitest + @vitest/coverage-v8). L'intégration
        tape un serveur séparé → non mesurée ici.
      </Text>
      <Table.ScrollContainer minWidth={560}>
        <Table striped highlightOnHover withRowBorders={false}>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Fichier</Table.Th>
              <Table.Th w={190}>Lines</Table.Th>
              <Table.Th w={80}>Funcs</Table.Th>
              <Table.Th w={90}>Branches</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {files.map((f) => (
              <Table.Tr key={f.file}>
                <Table.Td><Code>{f.file}</Code></Table.Td>
                <Table.Td>
                  <Group gap="xs" wrap="nowrap">
                    <Progress value={f.lines} color={covColor(f.lines)} w={110} size="sm" />
                    <Text size="xs" w={34} ta="right">{Math.round(f.lines)}%</Text>
                  </Group>
                </Table.Td>
                <Table.Td><Text size="xs" c={covColor(f.functions)}>{Math.round(f.functions)}%</Text></Table.Td>
                <Table.Td><Text size="xs" c={covColor(f.branches)}>{Math.round(f.branches)}%</Text></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <Badge size="xs" variant="light" color="gray">
      {n}
    </Badge>
  );
}

function Field({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl">
      <Text size="sm" c="dimmed">{k}</Text>
      <Text size="sm" fw={500} ff={mono ? "monospace" : undefined} style={{ wordBreak: "break-all", textAlign: "right" }}>
        {v}
      </Text>
    </Group>
  );
}

export default ModuleDetail;
