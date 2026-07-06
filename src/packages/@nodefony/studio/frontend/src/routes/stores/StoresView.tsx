import { observer } from "mobx-react-lite";
import { useCallback, useState } from "react";
import {
  Stack,
  Grid,
  Group,
  Badge,
  Code,
  Text,
  Button,
  Alert,
  Tabs,
  CopyButton,
  ActionIcon,
  Tooltip,
} from "@mantine/core";
import {
  IconRefresh,
  IconDatabase,
  IconServer,
  IconAlertTriangle,
  IconList,
  IconHelpCircle,
  IconRoute,
  IconCopy,
  IconCheck,
  IconFolder,
} from "@tabler/icons-react";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import {
  PageHeader,
  DataState,
  StatCard,
  DocHint,
  WarnHint,
  DataGrid,
  type DataGridColumn,
} from "../../components/ui";
import type { UsersStatus } from "../users/usersModel";
import {
  STORES_ENDPOINT,
  USERS_STATUS_ENDPOINT,
  BRICK_LABEL,
  BRICK_PURPOSE,
  PROVENANCE_LABEL,
  NATURE_LABEL,
  sortBricks,
  isVolatileDurable,
  userBrick,
  formatSource,
  storeLocation,
  baseName,
  type Infra,
  type StoresPayload,
  type StoreResolution,
} from "./storesModel";
import { StoresHelp } from "./StoresHelp";
import { TransportTab } from "./TransportTab";

/** Données prêtes pour le rendu : infra + lignes (briques + user fusionné). */
interface StoresData {
  infra: Infra;
  rows: StoreResolution[];
}

/** Couleur du badge de durabilité. */
function natureColor(nature: StoreResolution["nature"]): string {
  if (nature === "durable") return "teal";
  if (nature === "ephemeral") return "yellow";
  return "cyan";
}

const COLUMNS: DataGridColumn<StoreResolution>[] = [
  {
    key: "brick",
    header: "Brique",
    sortable: true,
    value: (r) => BRICK_LABEL[r.brick] ?? r.brick,
    render: (r) => (
      <Stack gap={0}>
        <Group gap={4} wrap="nowrap">
          <Text size="sm" fw={600}>
            {BRICK_LABEL[r.brick] ?? r.brick}
          </Text>
          {BRICK_PURPOSE[r.brick] && (
            <DocHint
              title={BRICK_LABEL[r.brick] ?? r.brick}
              summary={BRICK_PURPOSE[r.brick]}
            />
          )}
        </Group>
        <Text size="xs" c="dimmed">
          {r.brick}
        </Text>
      </Stack>
    ),
  },
  {
    key: "resolved",
    header: "Store actif",
    sortable: true,
    value: (r) => r.resolved,
    render: (r) => (
      <Badge
        variant="light"
        color={isVolatileDurable(r) ? "orange" : "grape"}
        leftSection={<IconDatabase size={12} />}
        style={{ textTransform: "none" }}
      >
        {r.resolved}
      </Badge>
    ),
  },
  {
    key: "location",
    header: "Emplacement",
    value: (r) => storeLocation(r).path ?? storeLocation(r).hint,
    render: (r) => {
      const { path, hint } = storeLocation(r);
      // Backend sans chemin local (memory / réseau) → on explique où vit la donnée.
      if (!path) {
        return (
          <Text size="xs" c="dimmed">
            {hint}
          </Text>
        );
      }
      // Chemin physique : nom de fichier en évidence + chemin complet copiable.
      return (
        <Group gap={4} wrap="nowrap">
          <IconFolder size={13} style={{ flexShrink: 0, opacity: 0.6 }} />
          <Tooltip label={path} openDelay={300} multiline maw={420}>
            <Code style={{ fontSize: 11 }}>{baseName(path)}</Code>
          </Tooltip>
          <CopyButton value={path} timeout={1500}>
            {({ copied, copy }) => (
              <ActionIcon
                size="xs"
                variant="subtle"
                color={copied ? "teal" : "gray"}
                onClick={copy}
                aria-label={`Copier le chemin de ${r.brick}`}
              >
                {copied ? <IconCheck size={12} /> : <IconCopy size={12} />}
              </ActionIcon>
            )}
          </CopyButton>
        </Group>
      );
    },
  },
  {
    key: "provenance",
    header: "Provenance",
    sortable: true,
    value: (r) => PROVENANCE_LABEL[r.provenance],
    render: (r) => {
      const source = formatSource(r.source);
      return (
        <Stack gap={2}>
          <Group gap={6} wrap="nowrap">
            <Badge
              variant="light"
              color={r.provenance === "infra" ? "blue" : "gray"}
              style={{ textTransform: "none" }}
            >
              {PROVENANCE_LABEL[r.provenance]}
            </Badge>
            <DocHint
              title="Provenance de la résolution"
              summary={r.reason}
              sections={
                source ? [{ label: "Source", body: source }] : undefined
              }
            />
          </Group>
          {source && (
            <Text size="xs" c="dimmed">
              {source}
            </Text>
          )}
        </Stack>
      );
    },
  },
  {
    key: "configured",
    header: "Configuré",
    value: (r) => r.configured,
    render: (r) => <Code>{r.configured}</Code>,
  },
  {
    key: "available",
    header: "Backends dispo",
    render: (r) =>
      r.available.length === 0 ? (
        <Text size="xs" c="dimmed">
          —
        </Text>
      ) : (
        <Group gap={4}>
          {r.available.map((b) => (
            <Badge
              key={b}
              size="sm"
              variant={b === r.resolved ? "filled" : "outline"}
              color={b === r.resolved ? "grape" : "gray"}
              style={{ textTransform: "none" }}
            >
              {b}
            </Badge>
          ))}
        </Group>
      ),
  },
  {
    key: "nature",
    header: "Durabilité",
    sortable: true,
    value: (r) => NATURE_LABEL[r.nature],
    render: (r) => (
      <Group gap={6} wrap="nowrap">
        <Badge
          variant="dot"
          color={natureColor(r.nature)}
          style={{ textTransform: "none" }}
        >
          {NATURE_LABEL[r.nature]}
        </Badge>
        {isVolatileDurable(r) && (
          <WarnHint
            title="Store durable volatil"
            summary="Brique durable en « memory » : données perdues au redémarrage et non partagées entre pods. Déclarer une infra durable (NF_DATABASE_URL) ou un store persistant explicite."
          />
        )}
      </Group>
    ),
  },
];

/**
 * Écran « Stores de persistance » : état RUNTIME de chaque brique (store résolu,
 * provenance, backends disponibles, durabilité) + bandeau de l'infra déclarée.
 */
export const StoresView = observer(() => {
  const store = useStore();
  const fetcher = useCallback(async (): Promise<StoresData> => {
    const [payload, userStatus] = await Promise.all([
      store.api.getAbsolute<StoresPayload>(STORES_ENDPOINT),
      // Le statut user vit dans un autre module (peut 403/manquer) → non bloquant.
      store.api
        .getAbsolute<UsersStatus>(USERS_STATUS_ENDPOINT)
        .catch(() => null),
    ]);
    const extra = userBrick(userStatus);
    const rows = sortBricks(
      extra ? [...payload.stores, extra] : payload.stores,
    );
    return { infra: payload.infra, rows };
  }, [store]);

  const { data, loading, error, reload } = useResource(fetcher);
  const rows = data?.rows ?? [];
  const infra = data?.infra;
  const volatileCount = rows.filter(isVolatileDurable).length;
  const [tab, setTab] = useState<string | null>("stores");

  return (
    <Stack gap="md">
      <PageHeader
        title="Stores de persistance"
        subtitle={
          `${rows.length} brique(s)` +
          (volatileCount > 0 ? ` · ${volatileCount} volatile(s)` : "")
        }
        icon={<IconDatabase size={22} />}
        actions={
          <Group gap="xs">
            <DocHint
              title="Stores de persistance"
              summary="Pour chaque brique, le backend RÉELLEMENT actif au runtime, sa provenance et les backends disponibles — la matrice brique×backend, branchée sur le vrai état."
              sections={[
                {
                  label: "Store actif",
                  body: "Le backend effectivement résolu au boot (replis inclus) — pas le défaut théorique.",
                },
                {
                  label: "Provenance",
                  body: "« défaut-infra » = choisi automatiquement depuis l'infra déclarée (URLs NF_DATABASE_URL/NF_REDIS_URL). « explicite » = backend nommé dans la config ou l'env.",
                },
                {
                  label: "Durabilité",
                  body: "durable = doit survivre au redémarrage ; éphémère/session tolèrent la volatilité. Un store durable en « memory » (⚠) perd ses données au redémarrage et n'est pas partagé entre pods.",
                },
              ]}
            />
            <Button
              variant="light"
              leftSection={<IconRefresh size={16} />}
              loading={loading}
              onClick={reload}
            >
              Recharger
            </Button>
          </Group>
        }
      />

      <Tabs value={tab} onChange={setTab} mt="xs">
        <Tabs.List>
          <Tabs.Tab value="stores" leftSection={<IconList size={15} />}>
            Stores
          </Tabs.Tab>
          <Tabs.Tab value="transport" leftSection={<IconRoute size={15} />}>
            Flux &amp; transport
          </Tabs.Tab>
          <Tabs.Tab value="help" leftSection={<IconHelpCircle size={15} />}>
            Utilisation &amp; aide
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="stores" pt="md">
          <DataState
            loading={loading && !rows.length}
            error={error}
            empty={!rows.length && !infra}
            onRetry={reload}
            emptyMessage="Aucune brique de persistance résolue."
          >
            {infra && (
              <Grid>
                <StatCard
                  label="Base de données"
                  icon={<IconDatabase size={18} />}
                  span={{ base: 12, sm: 4 }}
                  hint={
                    infra.database
                      ? infra.database.url
                      : "Aucune infra base déclarée (NF_DATABASE_URL) — repli local."
                  }
                >
                  <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
                    {infra.database
                      ? (infra.database.dialect ?? infra.database.scheme)
                      : "—"}
                  </Text>
                </StatCard>
                <StatCard
                  label="Cache (Redis)"
                  icon={<IconServer size={18} />}
                  span={{ base: 12, sm: 4 }}
                  hint={
                    infra.cache
                      ? infra.cache.url
                      : "Aucune infra cache déclarée (NF_REDIS_URL)."
                  }
                >
                  <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
                    {infra.cache ? "présent" : "absent"}
                  </Text>
                </StatCard>
                <StatCard
                  label="Logs (relecture)"
                  icon={<IconServer size={18} />}
                  span={{ base: 12, sm: 4 }}
                  hint={
                    infra.logs
                      ? (infra.logs.lokiUrl ?? infra.logs.opensearchUrl ?? "—")
                      : "Aucune infra logs déclarée — sink stdout."
                  }
                >
                  <Text fz={22} fw={700} style={{ lineHeight: 1.2 }}>
                    {infra.logs
                      ? infra.logs.lokiUrl
                        ? "loki"
                        : infra.logs.opensearchUrl
                          ? "opensearch"
                          : "—"
                      : "stdout"}
                  </Text>
                </StatCard>
              </Grid>
            )}

            {volatileCount > 0 && (
              <Alert
                variant="light"
                color="orange"
                icon={<IconAlertTriangle size={16} />}
                title="Persistance volatile détectée"
              >
                {volatileCount} brique(s) durable(s) résolue(s) en « memory » :
                données perdues au redémarrage et non partagées entre pods.
                Déclarer une infra durable (NF_DATABASE_URL) ou un store
                explicite persistant.
              </Alert>
            )}

            <DataGrid
              mode="client"
              data={rows}
              columns={COLUMNS}
              getRowId={(r) => r.brick}
              searchable
              searchPlaceholder="Filtrer une brique…"
              persist={{ key: "studio.stores", storage: "session" }}
            />
          </DataState>
        </Tabs.Panel>

        <Tabs.Panel value="transport" pt="md">
          {tab === "transport" && <TransportTab infra={infra} />}
        </Tabs.Panel>

        <Tabs.Panel value="help" pt="md">
          {tab === "help" && <StoresHelp />}
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
});
