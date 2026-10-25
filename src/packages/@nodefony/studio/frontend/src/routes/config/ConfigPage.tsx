/**
 * **Page config agrégée** (`/nodefony/config`) — « trouver un réglage, comprendre
 * d'où vient sa valeur, savoir comment la changer ».
 *
 * En tête, toujours visibles : une intro en clair et la **recherche globale**
 * (tous les modules ET le noyau, tolérante aux accents, fautes et synonymes —
 * `configSearchEngine.ts`). Un résultat mène directement à la ligne du réglage.
 * Puis les onglets (`?tab=`, lien partageable), du plus regardé au moins :
 *  - **Coup d'œil** (défaut) : mode, adresses d'écoute, verrous de sécurité avec
 *    leur verdict, ce que l'environnement a changé ;
 *  - **Écarts** : ce qui diffère du défaut — qui surcharge, où, comment ;
 *  - **Modules** : une boîte par brique. L'APPLICATION est la première : sa
 *    config racine (domaine, ports, journaux, modules chargés) s'ouvre sous la
 *    grille (`&app=1`), éditable à chaud en développement — un seul geste pour
 *    toute config, là où un onglet « Noyau » à part en faisait deux ;
 *  - **Décors** : les environnements de test du cœur — présent seulement si le
 *    serveur constate qu'il tourne dans le dépôt du framework.
 *
 * Source : data plane agrégé `/nodefony/kernel/api/config` (1 requête, secrets
 * redactés côté serveur).
 */
import { useCallback, useMemo } from "react";
import { observer } from "mobx-react-lite";
import { useNavigate, useSearchParams } from "react-router";
import {
  ActionIcon,
  Badge,
  Code,
  CopyButton,
  Grid,
  Group,
  Paper,
  Progress,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconAdjustmentsAlt,
  IconArrowRight,
  IconCheck,
  IconCopy,
  IconArrowsDiff,
  IconEye,
  IconPackages,
  IconRefresh,
  IconServer2,
  IconStack2,
  IconX,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import {
  DataGrid,
  DataState,
  DocHint,
  PageHeader,
  TabbedPage,
  TipHint,
  type ConfigField,
  type DataGridColumn,
  type EditResult,
} from "../../components/ui";
import {
  buildConfigModel,
  type ActiveOverride,
  type ConfigOverviewResponse,
  type ModuleConfig,
} from "./configModel";
import { ConfigModuleCard } from "./ConfigModuleCard";
import { ConfigExplorer } from "./ConfigExplorer";
import { ConfigSearch } from "./ConfigSearch";
import { ConfigEssentials, type GlanceRuntime } from "./ConfigEssentials";
import { FieldHelp } from "./FieldHelp";
import {
  buildConfigSearchIndex,
  type ConfigSearchDoc,
} from "./configSearchEngine";
import { configErrorMessage } from "./configEdit";
import { ConfigTestbed } from "./ConfigTestbed";
import type { TestbedCapability } from "./testbedModel";
import { PAGE_INTRO, PAGE_LEAD, TAB_INTRO } from "./configTexts";

/** Onglets de la page (valeur d'URL `?tab=`). */
const TABS = ["glance", "overrides", "modules", "testbed"] as const;
type ConfigTab = (typeof TABS)[number];

function isTab(v: string | null): v is ConfigTab {
  return TABS.some((t) => t === v);
}

/** Provenance affichée pour une source absente de la table. */
const DEFAULT_SRC = { label: "défaut", color: "gray" };

const SRC: Record<string, { label: string; color: string }> = {
  default: DEFAULT_SRC,
  app: { label: "app", color: "grape" },
  env: { label: "env", color: "teal" },
};

/** Pastille de copie d'une recette d'override (`NF__…`). */
function CopyKey({ value }: { value: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Code style={{ fontSize: 12 }}>{value}</Code>
      <CopyButton value={value} timeout={1500}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? "Copié" : "Copier"} withArrow>
            <ActionIcon
              size="sm"
              variant="subtle"
              color={copied ? "teal" : "gray"}
              aria-label={`Copier ${value}`}
              onClick={copy}
            >
              {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

/** Maillons de la cascade de priorité (la DERNIÈRE source définie gagne). */
const CASCADE: { label: string; color: string; help: string }[] = [
  {
    label: "défaut",
    color: "gray",
    help: "La valeur d'usine du framework (personne ne l'a changée).",
  },
  { label: "module", color: "blue", help: "La config propre du module." },
  {
    label: "app",
    color: "grape",
    help: "nodefony.config.ts, ou un autre module qui reconfigure celui-ci.",
  },
  {
    label: "env",
    color: "teal",
    help: "Une variable d'environnement — elle a le dernier mot.",
  },
];

/** Carte d'aide : explique la priorité des surcharges (visible, pas au survol). */
function CascadeCard() {
  return (
    <Paper withBorder p="md" radius="md">
      <Group gap={6} mb={8}>
        <ThemeIcon size="sm" variant="light" color="grape">
          <IconStack2 size={14} />
        </ThemeIcon>
        <Text fw={600} size="sm">
          Qui gagne ?
        </Text>
        <Text size="sm" c="dimmed">
          chaque niveau remplace le précédent
        </Text>
      </Group>
      <Group gap={4} wrap="wrap" mb={8}>
        {CASCADE.map((s, i) => (
          <Group key={s.label} gap={4} wrap="nowrap">
            {i > 0 && (
              <IconArrowRight size={13} style={{ opacity: 0.4 }} aria-hidden />
            )}
            <Tooltip label={s.help} withArrow>
              <Badge
                variant="light"
                color={s.color}
                tt="none"
                tabIndex={0}
                style={{ cursor: "help" }}
              >
                {s.label}
              </Badge>
            </Tooltip>
          </Group>
        ))}
      </Group>
      <Text size="xs" c="dimmed">
        Comme des calques posés les uns sur les autres : on voit le dernier. Une
        variable d'environnement (<Code style={{ fontSize: 11 }}>NF__…</Code>)
        l'emporte sur le fichier — c'est ce qui permet de déployer sans toucher
        au code. La colonne « Provenance » dit quel calque se voit.
      </Text>
    </Paper>
  );
}

/** Intro d'un onglet : visible, en tête du panneau. */
function TabIntro({ children }: { children: string }) {
  return (
    <Text size="sm" c="dimmed" maw={900}>
      {children}
    </Text>
  );
}

export const ConfigPage = observer(() => {
  const store = useStore();
  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<ConfigOverviewResponse>(
        "/nodefony/kernel/api/config",
      ),
    [store],
  );
  const { data, loading, error, reload } = useResource(fetcher);
  // Mode d'exécution (dev/prod, debug) : le coup d'œil juge certains verrous
  // différemment en production. Un échec n'empêche rien : le mode reste « inconnu ».
  const infoFetcher = useCallback(
    () => store.api.getAbsolute<GlanceRuntime>("/nodefony/kernel/api/info"),
    [store],
  );
  const { data: runtime } = useResource(infoFetcher);
  // L'onglet Décors n'existe que sur le dépôt du framework : constat SERVEUR
  // (module `test`, absent d'une application générée → 404 → pas d'onglet).
  const testbedFetcher = useCallback(
    () =>
      store.api.getAbsolute<TestbedCapability>(
        "/nodefony/test/api/testbed-capability",
      ),
    [store],
  );
  const { data: testbedCapability } = useResource(testbedFetcher);
  const hasTestbed = testbedCapability?.supported === true;

  const model = useMemo(() => buildConfigModel(data?.modules ?? []), [data]);
  const { modules, overrides, stats } = model;
  const searchIndex = useMemo(() => buildConfigSearchIndex(modules), [modules]);
  const app: ModuleConfig | undefined = modules.find((m) => m.entry.isApp);
  const moduleCards = useMemo(
    () => modules.filter((m) => !m.entry.isApp),
    [modules],
  );
  const navigate = useNavigate();

  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get("tab");
  // `?tab=core` : ancien lien vers l'onglet Noyau, désormais la boîte
  // Application de l'onglet Modules — un lien partagé ne casse pas.
  const legacyCore = tabParam === "core";
  const tab: ConfigTab = legacyCore
    ? "modules"
    : isTab(tabParam)
      ? tabParam
      : "glance";
  const appOpen =
    tab === "modules" && (legacyCore || searchParams.get("app") === "1");
  const focusKey = appOpen ? (searchParams.get("key") ?? undefined) : undefined;

  const changeTab = useCallback(
    (v: string) => {
      if (isTab(v)) setSearchParams({ tab: v });
    },
    [setSearchParams],
  );

  // Un résultat de recherche mène À la ligne : dans la boîte Application (cet
  // écran) ou dans l'onglet Config du module.
  const openHit = useCallback(
    (doc: ConfigSearchDoc) => {
      if (doc.isApp) {
        setSearchParams({ tab: "modules", app: "1", key: doc.field.key });
        return;
      }
      const q = new URLSearchParams({ tab: "config", key: doc.field.key });
      void navigate(
        `/nodefony/modules/${encodeURIComponent(doc.moduleKey)}?${q.toString()}`,
      );
    },
    [navigate, setSearchParams],
  );

  // Édition à chaud d'un réglage du noyau (dev) : même contrat que l'onglet
  // Config d'un module — le serveur reste autoritaire.
  const appKey = app?.entry.key;
  const handleCoreEdit = useCallback(
    async (field: ConfigField, value: unknown): Promise<EditResult> => {
      if (!appKey) return { ok: false, error: "Aucune application exposée." };
      try {
        await store.api.patchAbsolute(
          `/nodefony/kernel/api/config/${encodeURIComponent(appKey)}`,
          { path: field.key, value },
        );
        store.notifications.notify(
          "success",
          `${field.key} mis à jour (à chaud)`,
          { title: "Configuration" },
        );
        reload();
        return { ok: true };
      } catch (e) {
        const msg = configErrorMessage(e);
        store.notifications.notify("error", msg, { title: "Édition refusée" });
        return { ok: false, error: msg };
      }
    },
    [store, appKey, reload],
  );

  const overrideCols = useMemo<DataGridColumn<ActiveOverride>[]>(
    () => [
      {
        key: "module",
        header: "Module",
        sortable: true,
        filterable: true,
        value: (r) => r.module,
        render: (r) => (
          <Text size="sm" fw={500}>
            {r.module}
          </Text>
        ),
      },
      {
        key: "field",
        header: "Réglage",
        sortable: true,
        filterable: true,
        value: (r) => r.field,
        render: (r) => <Code style={{ fontSize: 12 }}>{r.field}</Code>,
      },
      {
        key: "source",
        header: "Provenance",
        sortable: true,
        filterable: true,
        filterType: "select",
        filterOptions: ["app", "env"],
        render: (r) => (
          <Badge
            size="sm"
            variant="light"
            color={(SRC[r.source] ?? DEFAULT_SRC).color}
            tt="none"
          >
            {(SRC[r.source] ?? DEFAULT_SRC).label}
          </Badge>
        ),
      },
      {
        key: "where",
        header: "Surchargé par",
        sortable: true,
        hint: "Qui a changé la valeur : la variable d'environnement réellement posée (provenance env), ou le fichier qui la pose (provenance app).",
        render: (r) => <Code style={{ fontSize: 12 }}>{r.where}</Code>,
      },
      {
        key: "overrideKey",
        header: "Variable pour la changer",
        hint: "La variable d'environnement qui change ce réglage sans toucher au code (NF__<MODULE|APP>__<CHEMIN>). À copier dans .env (poste) ou chez l'hébergeur.",
        render: (r) => <CopyKey value={r.overrideKey} />,
      },
    ],
    [],
  );

  const pct = (n: number): number =>
    stats.fieldCount ? Math.round((n / stats.fieldCount) * 100) : 0;

  const reloadAction = (
    <ActionIcon
      variant="light"
      size="lg"
      aria-label="Recharger la configuration"
      loading={loading}
      onClick={reload}
    >
      <IconRefresh size={18} />
    </ActionIcon>
  );

  if (!modules.length) {
    return (
      <Stack gap="md">
        <PageHeader
          title="Configuration"
          icon={<IconAdjustmentsAlt size={22} />}
          actions={reloadAction}
        />
        <DataState
          loading={loading}
          error={error}
          empty
          onRetry={reload}
          emptyMessage="Aucune configuration exposée."
        >
          {null}
        </DataState>
      </Stack>
    );
  }

  const toggleApp = () =>
    setSearchParams(
      appOpen ? { tab: "modules" } : { tab: "modules", app: "1" },
    );

  const appPanel =
    app && appOpen ? (
      <Paper withBorder radius="md" p="md" id="config-app">
        <Stack gap="md">
          <Group justify="space-between" wrap="nowrap">
            <Group gap={8} wrap="nowrap">
              <Badge size="sm" variant="light" color="grape" tt="none">
                app
              </Badge>
              <Text fw={600}>Application — nodefony.config.ts</Text>
            </Group>
            <ActionIcon
              variant="subtle"
              color="gray"
              aria-label="Replier la configuration de l'application"
              onClick={toggleApp}
            >
              <IconX size={16} />
            </ActionIcon>
          </Group>
          <TabIntro>{TAB_INTRO.core}</TabIntro>
          <ConfigExplorer
            module={app.entry.name}
            seg={app.entry.seg}
            schema={app.schemaStatus}
            sections={app.sections}
            editable={import.meta.env.DEV}
            onEdit={handleCoreEdit}
            focusKey={focusKey}
            renderHelp={(f) => (
              <FieldHelp field={f} moduleName={app.entry.name} isApp />
            )}
          />
        </Stack>
      </Paper>
    ) : null;

  const modulesPanel = (
    <Stack gap="md">
      <TabIntro>{TAB_INTRO.modules}</TabIntro>
      <Grid>
        {app && (
          <Grid.Col span={{ base: 12, sm: 6, lg: 4 }}>
            <ConfigModuleCard m={app} onOpen={toggleApp} />
          </Grid.Col>
        )}
        {moduleCards.map((m) => (
          <Grid.Col key={m.entry.key} span={{ base: 12, sm: 6, lg: 4 }}>
            <ConfigModuleCard
              m={m}
              onOpen={() =>
                void navigate(
                  `/nodefony/modules/${encodeURIComponent(m.entry.key)}?tab=config`,
                )
              }
            />
          </Grid.Col>
        ))}
      </Grid>
      {appPanel}
    </Stack>
  );

  const overridesPanel = (
    <Stack gap="md">
      <TabIntro>{TAB_INTRO.overrides}</TabIntro>
      <CascadeCard />

      {/* Répartition de provenance — la photo du déploiement en 1 barre. */}
      <Paper withBorder p="md" radius="md">
        <Group justify="space-between" mb={8}>
          <Group gap={6}>
            <Text fw={600} size="sm">
              D'où viennent les valeurs
            </Text>
            <DocHint
              title="D'où viennent les valeurs"
              summary={`Sur ${stats.fieldCount} réglages, ${stats.byProvenance.default} gardent leur valeur d'usine, ${stats.byProvenance.app} sont posés par nodefony.config.ts et ${stats.byProvenance.env} par une variable d'environnement. Une barre entièrement grise = un déploiement qui n'a rien changé.`}
            />
          </Group>
          <Group gap="md">
            <Legend
              color="gray"
              label={`défaut ${stats.byProvenance.default}`}
            />
            <Legend color="grape" label={`app ${stats.byProvenance.app}`} />
            <Legend color="teal" label={`env ${stats.byProvenance.env}`} />
          </Group>
        </Group>
        <Progress.Root size="xl" radius="sm">
          <Progress.Section
            value={pct(stats.byProvenance.default)}
            aria-label={`Provenance défaut : ${pct(stats.byProvenance.default)} %`}
            color="gray"
          />
          <Progress.Section
            value={pct(stats.byProvenance.app)}
            aria-label={`Provenance application : ${pct(stats.byProvenance.app)} %`}
            color="grape"
          />
          <Progress.Section
            value={pct(stats.byProvenance.env)}
            aria-label={`Provenance environnement : ${pct(stats.byProvenance.env)} %`}
            color="teal"
          />
        </Progress.Root>
      </Paper>

      <Paper withBorder p="md" radius="md">
        <Group gap={6} mb="sm">
          <Text fw={600}>Réglages modifiés</Text>
          <Text size="sm" c="dimmed">
            {overrides.length} diffèrent de la valeur d'usine
          </Text>
        </Group>
        {overrides.length ? (
          <DataGrid
            mode="client"
            data={overrides}
            columns={overrideCols}
            getRowId={(r) => `${r.moduleKey}:${r.field}`}
            initialSort={{ key: "module", dir: "asc" }}
            searchable
            searchPlaceholder="Filtrer les réglages modifiés…"
            height={overrides.length > 12 ? undefined : "auto"}
            persist={{ key: "studio.config.overrides", storage: "session" }}
          />
        ) : (
          <TipHint
            title="Déploiement 100 % par défaut"
            summary="Aucune valeur ne diffère de la valeur d'usine : ni le fichier ni l'environnement n'ont rien changé. C'est un état sain, pas une erreur."
          >
            <Badge variant="light" color="gray" tt="none">
              aucune modification
            </Badge>
          </TipHint>
        )}
      </Paper>
    </Stack>
  );

  return (
    <TabbedPage
      title="Configuration"
      subtitle={`${moduleCards.length} module(s) · ${stats.fieldCount} réglages · ${overrides.length} modifié(s) · ${stats.secrets} secret(s)`}
      icon={<IconAdjustmentsAlt size={22} />}
      actions={reloadAction}
      statusBar={
        <Stack gap={6}>
          <Group gap={6} wrap="nowrap">
            <Text size="sm" c="dimmed">
              {PAGE_LEAD}
            </Text>
            <DocHint
              title="Comment lire cette page"
              summary={PAGE_INTRO}
              width={380}
            />
          </Group>
          <ConfigSearch index={searchIndex} onOpen={openHit} />
        </Stack>
      }
      value={tab}
      onChange={changeTab}
      tabs={[
        {
          value: "glance",
          label: "Coup d'œil",
          icon: <IconEye size={16} />,
          panel: (
            <ConfigEssentials
              index={searchIndex}
              runtime={runtime ?? null}
              counts={{ modified: overrides.length, secrets: stats.secrets }}
              onOpen={openHit}
              onShowOverrides={() => changeTab("overrides")}
            />
          ),
        },
        {
          value: "overrides",
          label: "Écarts",
          icon: <IconArrowsDiff size={16} />,
          badge: (
            <Badge size="xs" variant="light" color="grape">
              {overrides.length}
            </Badge>
          ),
          panel: overridesPanel,
        },
        {
          value: "modules",
          label: "Modules",
          icon: <IconPackages size={16} />,
          badge: (
            <Badge size="xs" variant="light" color="gray">
              {moduleCards.length + (app ? 1 : 0)}
            </Badge>
          ),
          panel: modulesPanel,
        },
        ...(hasTestbed
          ? [
              {
                value: "testbed",
                label: "Décors",
                icon: <IconServer2 size={16} />,
                badge: (
                  <Badge size="xs" variant="light" color="gray" tt="none">
                    dépôt seul
                  </Badge>
                ),
                panel: tab === "testbed" ? <ConfigTestbed /> : null,
              },
            ]
          : []),
      ]}
    />
  );
});

/** Petite légende couleur → label (réutilisée pour la barre de provenance). */
function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Group gap={6} wrap="nowrap">
      <Badge
        size="xs"
        circle
        variant="filled"
        color={color}
        style={{ width: 10, height: 10, padding: 0 }}
      />
      <Text size="xs" c="dimmed">
        {label}
      </Text>
    </Group>
  );
}
