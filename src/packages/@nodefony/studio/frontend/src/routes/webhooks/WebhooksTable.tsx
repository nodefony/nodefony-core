/**
 * Table des endpoints webhook — **pagination, tri, filtres et recherche côté
 * SERVEUR** (DataGrid + fiche détail Modal centré). Admin-only (gouvernance
 * plateforme). Les actions (modifier, activer/désactiver, tourner/révéler le
 * secret, supprimer) sont déléguées au parent qui confirme et appelle le bon
 * endpoint du data plane.
 *
 * Ce qui est triable, filtrable et cherchable vient du catalogue
 * (`AdminStore.pageCapabilities`) : le registre des webhooks peut vivre en
 * mémoire ou en base, et un store coupé ne déclare plus rien — les en-têtes
 * deviennent alors inertes au lieu de répondre `400`.
 */
import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import type { IPage } from "nodefony";
import {
  Stack,
  Group,
  Code,
  Text,
  Modal,
  Alert,
  Box,
  Button,
  Menu,
  ActionIcon,
  Anchor,
  Tabs,
} from "@mantine/core";
import {
  IconWebhook,
  IconDots,
  IconEdit,
  IconRotateClockwise,
  IconEye,
  IconTrash,
  IconPlayerPlay,
  IconPlayerPause,
  IconInfoCircle,
  IconExternalLink,
  IconHistory,
} from "@tabler/icons-react";

import {
  DataGrid,
  DocHint,
  PageFilters,
  toPageParams,
  fromPage,
  type DataGridColumn,
  type DataGridServerQuery,
  type DataGridServerResult,
  type PageFilterLabels,
} from "../../components/ui";
import { useStore } from "../../stores";
import { DeliveriesPanel } from "./DeliveriesPanel";
import {
  WEBHOOKS_DOC,
  WEBHOOKS_ENDPOINT,
  fmtDate,
  fmtSince,
  describeWebhooksError,
  type WebhookEndpoint,
} from "./webhooksModel";
import {
  EnabledBadge,
  DeliveryBadge,
  FailureBadge,
  EventChips,
  StorageBadge,
} from "./webhooksFormat";

/** Une ligne label → valeur (la valeur peut être un nœud riche : badge…). */
function Field({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="xl" align="flex-start">
      <Text size="sm" c="dimmed" style={{ flexShrink: 0 }}>
        {k}
      </Text>
      <Box style={{ textAlign: "right", minWidth: 0 }}>{children}</Box>
    </Group>
  );
}

/** Actions disponibles sur un endpoint (déléguées au parent). */
export interface WebhookActions {
  onEdit: (ep: WebhookEndpoint) => void;
  onToggle: (ep: WebhookEndpoint) => void;
  onRotate: (ep: WebhookEndpoint) => void;
  onReveal: (ep: WebhookEndpoint) => void;
  onDelete: (ep: WebhookEndpoint) => void;
}

/** Menu d'actions par ligne (kebab) — stoppe la propagation au clic de ligne. */
function RowActions({
  ep,
  actions,
  busyId,
}: {
  ep: WebhookEndpoint;
  actions: WebhookActions;
  busyId: string | null;
}) {
  return (
    <Menu shadow="md" position="bottom-end" withinPortal>
      <Menu.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={`Actions du webhook ${ep.url}`}
          loading={busyId === ep.id}
          onClick={(e) => e.stopPropagation()}
        >
          <IconDots size={16} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
        <Menu.Item
          leftSection={<IconEdit size={14} />}
          onClick={() => actions.onEdit(ep)}
        >
          Modifier
        </Menu.Item>
        <Menu.Item
          leftSection={
            ep.enabled ? (
              <IconPlayerPause size={14} />
            ) : (
              <IconPlayerPlay size={14} />
            )
          }
          onClick={() => actions.onToggle(ep)}
        >
          {ep.enabled ? "Désactiver" : "Activer"}
        </Menu.Item>
        <Menu.Item
          leftSection={<IconRotateClockwise size={14} />}
          onClick={() => actions.onRotate(ep)}
        >
          Tourner le secret
        </Menu.Item>
        <Menu.Item
          leftSection={<IconEye size={14} />}
          onClick={() => actions.onReveal(ep)}
        >
          Révéler le secret
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item
          color="red"
          leftSection={<IconTrash size={14} />}
          onClick={() => actions.onDelete(ep)}
        >
          Supprimer
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/**
 * Habillage des filtres publiés par `GET webhooks` (`WEBHOOK_FILTERS`).
 *
 * `failing` recoupe volontairement `enabled` : un endpoint peut être actif ET
 * en échec. Les deux filtres se cumulent donc au lieu de s'exclure — c'est ce
 * qui permet de poser la question « qui est actif mais ne passe plus ? ».
 */
const WEBHOOK_FILTER_LABELS: PageFilterLabels = {
  enabled: {
    label: "État",
    hint: "Actif = le dispatcher lui livre. Désactivé = à la main, ou par le coupe-circuit après trop d'échecs consécutifs.",
    values: { true: "Actifs", false: "Désactivés" },
  },
  event: {
    label: "Événement",
    hint: "Endpoints ABONNÉS à cet événement — « qui écoute user.created ? ». Nom exact de l'événement.",
    placeholder: "user.created",
  },
  failing: {
    label: "Livraison",
    hint: "En échec = compteur d'échecs consécutifs non nul. Se cumule avec l'état : un endpoint actif peut être en échec.",
    values: { true: "En échec", false: "Sains" },
  },
};

export const WebhooksTable = observer(function WebhooksTable({
  store: storeLabel,
  driver,
  filters,
  onFiltersChange,
  reloadKey = 0,
  actions,
  busyId,
}: {
  /** Classe réelle du store (badge « où on écrit »). */
  store: string;
  /** Filtres actifs — tenus par la page, dont les cartes de tête les suivent. */
  filters: Record<string, string>;
  onFiltersChange: (next: Record<string, string>) => void;
  /** Change de valeur pour recharger la page affichée après une mutation. */
  reloadKey?: number;
  driver: "memory" | "orm" | null;
  actions: WebhookActions;
  /** Id de l'endpoint en cours de mutation (spinner kebab). */
  busyId: string | null;
}) {
  const store = useStore();
  const [selected, setSelected] = useState<WebhookEndpoint | null>(null);
  const [detailTab, setDetailTab] = useState<string | null>("infos");
  const caps = store.admin.pageCapabilities(WEBHOOKS_ENDPOINT);
  const filterSignal = JSON.stringify(filters);

  const loader = useCallback(
    async (
      q: DataGridServerQuery,
    ): Promise<DataGridServerResult<WebhookEndpoint>> => {
      const params = toPageParams(q, filters);
      try {
        // Le data plane rend `endpoints` là où le contrat de page dit `items` :
        // on recompose la page ici, sans apprendre au traducteur un nom propre
        // à une ressource.
        const res = await store.api.getAbsolute<
          Omit<IPage<WebhookEndpoint>, "items"> & {
            endpoints: WebhookEndpoint[];
          }
        >(`${WEBHOOKS_ENDPOINT}?${params}`);
        return fromPage({ ...res, items: res.endpoints ?? [] });
      } catch (e) {
        throw new Error(describeWebhooksError(e), { cause: e });
      }
      // `reloadKey` change l'identité du loader → le grid recharge sa page.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [store, filterSignal, reloadKey],
  );

  const sortable = useMemo(
    () => new Set(caps?.sortable ?? []),
    [caps?.sortable],
  );

  const columns = useMemo<DataGridColumn<WebhookEndpoint>[]>(
    () => [
      {
        key: "url",
        header: "URL",
        sortable: sortable.has("url"),
        value: (r) => r.url,
        render: (r) => (
          <Text size="sm" style={{ wordBreak: "break-all" }}>
            {r.url}
          </Text>
        ),
        size: 240,
      },
      {
        key: "description",
        header: "Description",
        // Le registre ne déclare pas ce champ triable (il n'est indexé nulle
        // part) : l'en-tête était cliquable et le tri partait en 400.
        sortable: sortable.has("description"),
        value: (r) => r.description ?? "",
        render: (r) =>
          r.description ? (
            <Text size="sm" style={{ wordBreak: "break-word" }}>
              {r.description}
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          ),
        size: 180,
      },
      {
        key: "events",
        header: "Événements",
        value: (r) => r.events.join(", "),
        render: (r) => <EventChips events={r.events} />,
        size: 200,
      },
      {
        key: "enabled",
        header: "État",
        // Le filtre est passé dans la barre au-dessus, alimentée par le
        // vocabulaire publié — le même filtre à deux endroits divergerait.
        sortable: sortable.has("enabled"),
        value: (r) => (r.enabled ? "Actif" : "Désactivé"),
        render: (r) => <EnabledBadge enabled={r.enabled} />,
        size: 110,
      },
      {
        key: "lastDelivery",
        // Non déclaré triable : l'horodatage de dernière livraison n'est pas
        // une colonne du registre mais un état de livraison.
        header: "Dernière livraison",
        sortable: sortable.has("lastDelivery"),
        value: (r) => r.lastDeliveryAt ?? 0,
        render: (r) => (
          <Group gap={6} wrap="nowrap">
            <DeliveryBadge endpoint={r} />
            <Text size="xs" c="dimmed">
              {fmtSince(r.lastDeliveryAt)}
            </Text>
          </Group>
        ),
        size: 200,
      },
      {
        key: "failureCount",
        header: "Échecs",
        sortable: sortable.has("failureCount"),
        align: "right",
        value: (r) => r.failureCount,
        render: (r) => <FailureBadge count={r.failureCount} />,
        size: 90,
      },
      {
        key: "actions",
        header: "",
        align: "right",
        render: (r) => <RowActions ep={r} actions={actions} busyId={busyId} />,
        size: 60,
      },
    ],
    [actions, busyId, sortable],
  );

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          Clic sur une ligne pour le détail.
        </Text>
        <DocHint
          title="Webhooks sortants"
          version={WEBHOOKS_DOC}
          summary="Un webhook notifie une URL externe quand un événement d'audit souscrit survient (modèle GitHub/Stripe). Chaque livraison est signée (Standard Webhooks v1) avec un secret propre à l'endpoint."
          sections={[
            {
              label: "Livraison",
              body: "Au plus une livraison par événement matchant. En cas d'échec : retries bornés avec backoff, puis auto-désactivation au-delà d'un seuil (le compteur d'échecs consécutifs le pilote).",
            },
            {
              label: "Sécurité",
              body: "L'URL est validée anti-SSRF (pas d'IP privée/interne, redirections 3xx non suivies, IP épinglée anti-rebinding). Le secret de signature est chiffré au repos et n'est montré qu'à la création/rotation/révélation.",
            },
            {
              label: "Anti-boucle",
              body: "Les événements de la catégorie webhook (webhook.created/disabled…) ne déclenchent jamais de livraison (sinon boucle infinie).",
            },
          ]}
        />
        <Box style={{ flex: 1 }} />
        <StorageBadge store={storeLabel} driver={driver} />
      </Group>

      <PageFilters
        spec={caps?.filters ?? null}
        value={filters}
        onChange={onFiltersChange}
        labels={WEBHOOK_FILTER_LABELS}
      />

      <DataGrid
        mode="server"
        loader={loader}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => {
          setSelected(r);
          setDetailTab("infos");
        }}
        dimRow={(r) => !r.enabled}
        initialSort={
          sortable.has("url") ? { key: "url", dir: "asc" } : undefined
        }
        // Le registre relaie `q` à son store : la recherche aboutit vraiment,
        // et le catalogue le publie (elle disparaît si les webhooks sont coupés).
        searchable={caps?.search ?? false}
        searchPlaceholder="Rechercher (URL, description, événement…)"
        resetPageSignal={filterSignal}
        pageSize={25}
        persist={{ key: "studio.webhooks", storage: "session" }}
        emptyMessage="Aucun webhook ne correspond."
      />

      <Modal
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <Group gap="xs">
              <IconWebhook size={18} />
              <Text fw={700}>Webhook</Text>
              <EnabledBadge enabled={selected.enabled} />
            </Group>
          ) : (
            ""
          )
        }
        centered
        size="lg"
      >
        {selected && (
          <Tabs value={detailTab} onChange={setDetailTab}>
            <Tabs.List mb="md">
              <Tabs.Tab
                value="infos"
                leftSection={<IconInfoCircle size={15} />}
              >
                Infos
              </Tabs.Tab>
              <Tabs.Tab
                value="deliveries"
                leftSection={<IconHistory size={15} />}
              >
                Livraisons récentes
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="infos">
              <Stack gap="sm">
                <Field k="URL de destination">
                  <Anchor
                    href={selected.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    size="sm"
                    style={{ wordBreak: "break-all" }}
                  >
                    <Group gap={4} wrap="nowrap" justify="flex-end">
                      {selected.url}
                      <IconExternalLink size={13} />
                    </Group>
                  </Anchor>
                </Field>
                <Field k="Identifiant">
                  <Code>{selected.id}</Code>
                </Field>
                <Field k="Événements">
                  <EventChips events={selected.events} />
                </Field>
                {selected.description && (
                  <Field k="Description">
                    <Text size="sm">{selected.description}</Text>
                  </Field>
                )}
                <Field k="Dernière livraison">
                  <Group gap={6} wrap="nowrap" justify="flex-end">
                    <DeliveryBadge endpoint={selected} />
                    <Text size="sm" c="dimmed">
                      {selected.lastDeliveryAt === null
                        ? ""
                        : fmtDate(selected.lastDeliveryAt)}
                    </Text>
                  </Group>
                </Field>
                {selected.lastDeliveryError && (
                  <Field k="Erreur de livraison">
                    <Text size="sm" c="red" style={{ wordBreak: "break-word" }}>
                      {selected.lastDeliveryError}
                    </Text>
                  </Field>
                )}
                <Field k="Échecs consécutifs">
                  <FailureBadge count={selected.failureCount} />
                </Field>
                {selected.createdBy && (
                  <Field k="Créé par">
                    <Code>{selected.createdBy}</Code>
                  </Field>
                )}
                {selected.tenantId && (
                  <Field k="Tenant">
                    <Code>{selected.tenantId}</Code>
                  </Field>
                )}
                <Field k="Créé le">
                  <Text size="sm">{fmtDate(selected.createdAt)}</Text>
                </Field>
                <Field k="Modifié le">
                  <Text size="sm">{fmtDate(selected.updatedAt)}</Text>
                </Field>

                <Alert
                  variant="light"
                  color="gray"
                  icon={<IconInfoCircle size={16} />}
                  mt="xs"
                >
                  <Text size="xs">
                    Le secret de signature n'est pas affiché ici : utilisez «
                    Révéler le secret » (action sensible, auditée). « Tourner le
                    secret » invalide immédiatement l'ancien.
                  </Text>
                </Alert>

                <Group justify="space-between" mt="xs">
                  <Button
                    variant="default"
                    leftSection={
                      selected.enabled ? (
                        <IconPlayerPause size={16} />
                      ) : (
                        <IconPlayerPlay size={16} />
                      )
                    }
                    onClick={() => {
                      const ep = selected;
                      setSelected(null);
                      actions.onToggle(ep);
                    }}
                  >
                    {selected.enabled ? "Désactiver" : "Activer"}
                  </Button>
                  <Group gap="xs">
                    <Button
                      variant="light"
                      leftSection={<IconEdit size={16} />}
                      onClick={() => {
                        const ep = selected;
                        setSelected(null);
                        actions.onEdit(ep);
                      }}
                    >
                      Modifier
                    </Button>
                    <Button
                      color="red"
                      variant="light"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => {
                        const ep = selected;
                        setSelected(null);
                        actions.onDelete(ep);
                      }}
                    >
                      Supprimer
                    </Button>
                  </Group>
                </Group>
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="deliveries">
              {detailTab === "deliveries" && (
                <DeliveriesPanel id={selected.id} />
              )}
            </Tabs.Panel>
          </Tabs>
        )}
      </Modal>
    </Stack>
  );
});
