/**
 * **Page config agrégée** (`/nodefony/config`) — « comprendre toute la config d'un
 * coup d'œil ». L'identité d'un déploiement = ce qui DIFFÈRE des défauts → la page
 * mène par les **écarts** (overrides actifs : qui surcharge, où, comment), puis
 * laisse explorer l'arbre complet (réutilise `ConfigLayout`, divulgation progressive).
 *
 * Source : data plane agrégé `/nodefony/kernel/api/config` (1 requête, secrets
 * redactés côté serveur). Lecture seule (l'édition live = phase ultérieure, cf kit).
 */
import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Accordion,
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
  Tooltip,
} from "@mantine/core";
import {
  IconAdjustmentsAlt,
  IconCheck,
  IconCopy,
  IconRefresh,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import {
  ConfigLayout,
  DataGrid,
  DataState,
  DocHint,
  PageHeader,
  StatCard,
  TipHint,
  type DataGridColumn,
} from "../../components/ui";
import {
  buildConfigModel,
  type ActiveOverride,
  type ConfigOverviewResponse,
} from "./configModel";

/** Méta d'affichage d'une provenance (aligné sur ConfigLayout `SOURCE_META`). */
const SRC: Record<string, { label: string; color: string }> = {
  default: { label: "défaut", color: "gray" },
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

  const model = useMemo(() => buildConfigModel(data?.modules ?? []), [data]);
  const { modules, overrides, stats } = model;

  // Explorateur : un seul module ouvert à la fois (perf + divulgation progressive)
  // → ConfigLayout n'est monté que pour le module déployé.
  const [open, setOpen] = useState<string | null>(null);

  const overrideCols = useMemo<DataGridColumn<ActiveOverride>[]>(
    () => [
      { key: "module", header: "Module", sortable: true, filterable: true },
      {
        key: "field",
        header: "Champ",
        sortable: true,
        filterable: true,
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
            color={SRC[r.source].color}
            tt="none"
          >
            {SRC[r.source].label}
          </Badge>
        ),
      },
      {
        key: "where",
        header: "Surchargé par",
        sortable: true,
        hint: "Qui surcharge, où : la variable d'env réelle (provenance env) ou le fichier nodefony.config.ts (provenance app).",
        render: (r) => <Code style={{ fontSize: 12 }}>{r.where}</Code>,
      },
      {
        key: "overrideKey",
        header: "Recette env (12-factor)",
        hint: "La variable d'environnement qui surcharge ce champ sans toucher au code (NF__<MODULE|APP>__<CHEMIN>). Copier-coller dans .env.local / l'orchestrateur.",
        render: (r) => <CopyKey value={r.overrideKey} />,
      },
    ],
    [],
  );

  const pct = (n: number): number =>
    stats.fieldCount ? Math.round((n / stats.fieldCount) * 100) : 0;

  return (
    <Stack gap="md">
      <PageHeader
        title="Configuration"
        subtitle={`${stats.moduleCount} module(s) · ${stats.fieldCount} réglage(s) · ${overrides.length} surcharge(s)`}
        icon={<IconAdjustmentsAlt size={22} />}
        actions={
          <ActionIcon
            variant="light"
            size="lg"
            aria-label="Recharger la configuration"
            loading={loading}
            onClick={reload}
          >
            <IconRefresh size={18} />
          </ActionIcon>
        }
      />

      <DataState
        loading={loading && !modules.length}
        error={error}
        empty={!modules.length}
        onRetry={reload}
        emptyMessage="Aucune configuration exposée."
      >
        {/* ── Bandeau instantané ───────────────────────────────────────── */}
        <Grid>
          <StatCard label="Modules" span={{ base: 6, sm: 3 }}>
            {stats.moduleCount}
          </StatCard>
          <StatCard label="Réglages" span={{ base: 6, sm: 3 }}>
            {stats.fieldCount}
          </StatCard>
          <StatCard
            label="Surcharges"
            span={{ base: 6, sm: 3 }}
            hint="Valeurs qui DIFFÈRENT du défaut (app + env) = l'identité de ce déploiement."
          >
            {overrides.length}
          </StatCard>
          <StatCard
            label="Secrets"
            span={{ base: 6, sm: 3 }}
            hint="Champs sensibles, masqués ici et rédigés dans les logs (redaction côté serveur)."
          >
            {stats.secrets}
          </StatCard>
        </Grid>

        {/* Répartition de provenance — la photo du déploiement en 1 barre. */}
        <Paper withBorder p="md" radius="md">
          <Group justify="space-between" mb={8}>
            <Group gap={6}>
              <Text fw={600} size="sm">
                Répartition par provenance
              </Text>
              <DocHint
                title="D'où viennent les valeurs"
                summary="Chaque réglage résolu provient d'une source : le défaut du framework, la config de l'app (nodefony.config.ts), ou une variable d'environnement (priorité max). Une config 100 % « défaut » = déploiement stock."
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
              color="gray"
            />
            <Progress.Section
              value={pct(stats.byProvenance.app)}
              color="grape"
            />
            <Progress.Section
              value={pct(stats.byProvenance.env)}
              color="teal"
            />
          </Progress.Root>
        </Paper>

        {/* ── Ce qui n'est PAS par défaut (le cœur) ────────────────────── */}
        <Paper withBorder p="md" radius="md">
          <Group gap={6} mb="sm">
            <Text fw={600}>Ce qui n'est pas par défaut</Text>
            <DocHint
              title="Les écarts au défaut"
              summary="La liste exacte des réglages surchargés — qui les surcharge (app / env), via quoi (la variable réelle ou nodefony.config.ts), et comment les piloter en 12-factor (recette NF__). C'est ce qui définit CE déploiement."
            />
          </Group>
          {overrides.length ? (
            <DataGrid
              mode="client"
              data={overrides}
              columns={overrideCols}
              getRowId={(r) => `${r.moduleKey}:${r.field}`}
              initialSort={{ key: "module", dir: "asc" }}
              searchable
              searchPlaceholder="Filtrer les surcharges…"
              height={overrides.length > 12 ? undefined : "auto"}
              persist={{ key: "studio.config.overrides", storage: "session" }}
            />
          ) : (
            <TipHint
              title="Déploiement 100 % par défaut"
              summary="Aucune valeur ne diffère du défaut du framework — rien n'est surchargé par l'app ni par l'environnement. C'est un état sain (config stock), pas une erreur."
            >
              <Badge variant="light" color="gray" tt="none">
                aucune surcharge
              </Badge>
            </TipHint>
          )}
        </Paper>

        {/* ── Explorateur complet (réutilise ConfigLayout, replié) ─────── */}
        <Paper withBorder p="md" radius="md">
          <Group gap={6} mb="sm">
            <Text fw={600}>Explorateur complet</Text>
            <Text size="sm" c="dimmed">
              tout l'arbre, module par module — déplier pour voir
            </Text>
          </Group>
          <Accordion
            value={open}
            onChange={setOpen}
            variant="separated"
            radius="md"
          >
            {modules.map((m) => (
              <Accordion.Item key={m.entry.key} value={m.entry.key}>
                <Accordion.Control
                  icon={
                    m.entry.isApp ? (
                      <Badge size="xs" variant="light" color="grape" tt="none">
                        app
                      </Badge>
                    ) : undefined
                  }
                >
                  <Group justify="space-between" wrap="nowrap" pr="md">
                    <Text fw={500}>{m.entry.name}</Text>
                    <Badge
                      size="xs"
                      variant="light"
                      color={m.schemaStatus === "zod" ? "teal" : "gray"}
                      tt="none"
                    >
                      {m.schemaStatus === "zod" ? "validé Zod" : "non migré"}
                    </Badge>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  {/* Monté UNIQUEMENT quand ouvert (perf : 1 ConfigLayout à la fois). */}
                  {open === m.entry.key && (
                    <ConfigLayout
                      module={m.entry.name}
                      schema={m.schemaStatus}
                      sections={m.sections}
                    />
                  )}
                </Accordion.Panel>
              </Accordion.Item>
            ))}
          </Accordion>
        </Paper>
      </DataState>
    </Stack>
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
