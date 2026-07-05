/**
 * Console **Webhooks sortants** (P6.13 Slice C) — gouvernance plateforme
 * (`ROLE_NODEFONY_ADMIN`, page montée sous le `RoleGuardOutlet` admin de
 * `App.tsx`). Lister les endpoints, créer (secret 1×), modifier, activer/
 * désactiver, tourner/révéler le secret, supprimer ; visualiser la santé de
 * livraison (statut HTTP + erreurs + échecs).
 *
 * Toutes les mutations passent en POST/PATCH/DELETE HTTP (pipeline complet :
 * CSRF + clé d'idempotence portées par `ApiClient` ; la Socket reste GET-only).
 * Le gating de rôle réel = RBAC serveur sur le data plane `SecurityAdminApi`.
 */
import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Stack,
  Grid,
  Group,
  Tabs,
  Text,
  Button,
  Modal,
  Alert,
} from "@mantine/core";
import {
  IconWebhook,
  IconPlus,
  IconRefresh,
  IconList,
  IconHelpCircle,
  IconCircleCheck,
  IconPlayerPause,
  IconAlertTriangle,
  IconTrash,
} from "@tabler/icons-react";

import { useStore, useNotifications } from "../stores";
import { useResource } from "../hooks";
import { PageLayout, StatCard, DataState } from "../components/ui";
import { BrickStoreChip } from "./stores/BrickStoreChip";
import {
  WEBHOOKS_ENDPOINT,
  webhookEndpoint,
  webhookRotateEndpoint,
  webhookRevealEndpoint,
  countWebhooks,
  describeWebhooksError,
  type WebhookEndpoint,
  type WebhookListResponse,
  type WebhookSecretReveal,
} from "./webhooks/webhooksModel";
import { WebhooksTable, type WebhookActions } from "./webhooks/WebhooksTable";
import { WebhookFormModal } from "./webhooks/WebhookFormModal";
import { WebhooksHelp } from "./webhooks/WebhooksHelp";
import {
  SecretRevealModal,
  type RevealContext,
} from "./webhooks/SecretRevealModal";

/** Secret affiché par le modal rotate/reveal. */
interface RevealState {
  context: Exclude<RevealContext, "created">;
  secret: string;
  url: string;
}

export const Webhooks = observer(() => {
  const store = useStore();
  const notifications = useNotifications();

  // `undefined` = formulaire fermé ; `null` = création ; endpoint = édition.
  const [formTarget, setFormTarget] = useState<
    WebhookEndpoint | null | undefined
  >(undefined);
  const [reveal, setReveal] = useState<RevealState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<WebhookEndpoint | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  /** Id de l'endpoint en cours de mutation rapide (spinner kebab). */
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetcher = useCallback(async (): Promise<WebhookListResponse> => {
    try {
      return await store.api.getAbsolute<WebhookListResponse>(
        WEBHOOKS_ENDPOINT,
      );
    } catch (e) {
      throw new Error(describeWebhooksError(e));
    }
  }, [store]);
  const { data, loading, error, reload } = useResource(fetcher);

  const endpoints = useMemo(() => data?.endpoints ?? [], [data]);
  const counts = useMemo(() => countWebhooks(endpoints), [endpoints]);
  const configEnabled = data?.enabled ?? false;

  // ── Mutations rapides (kebab / détail) ──────────────────────────────────────
  const toggle = useCallback(
    async (ep: WebhookEndpoint): Promise<void> => {
      setBusyId(ep.id);
      try {
        await store.api.patchAbsolute(webhookEndpoint(ep.id), {
          enabled: !ep.enabled,
        });
        notifications.notify(
          "success",
          `Webhook ${ep.enabled ? "désactivé" : "activé"}.`,
          { source: "api" },
        );
        reload();
      } catch (e) {
        notifications.notify("error", describeWebhooksError(e), {
          source: "api",
        });
      } finally {
        setBusyId(null);
      }
    },
    [store, notifications, reload],
  );

  const rotate = useCallback(
    async (ep: WebhookEndpoint): Promise<void> => {
      setBusyId(ep.id);
      try {
        const res = await store.api.postAbsolute<WebhookSecretReveal>(
          webhookRotateEndpoint(ep.id),
        );
        setReveal({ context: "rotated", secret: res.secret, url: ep.url });
        reload();
      } catch (e) {
        notifications.notify("error", describeWebhooksError(e), {
          source: "api",
        });
      } finally {
        setBusyId(null);
      }
    },
    [store, notifications, reload],
  );

  const revealSecret = useCallback(
    async (ep: WebhookEndpoint): Promise<void> => {
      setBusyId(ep.id);
      try {
        const res = await store.api.postAbsolute<{ secret: string }>(
          webhookRevealEndpoint(ep.id),
        );
        setReveal({ context: "revealed", secret: res.secret, url: ep.url });
      } catch (e) {
        notifications.notify("error", describeWebhooksError(e), {
          source: "api",
        });
      } finally {
        setBusyId(null);
      }
    },
    [store, notifications],
  );

  async function doDelete(): Promise<void> {
    if (!confirmDelete) return;
    const ep = confirmDelete;
    setDeleting(true);
    try {
      await store.api.deleteAbsolute(webhookEndpoint(ep.id));
      notifications.notify("success", "Webhook supprimé.", { source: "api" });
      setConfirmDelete(null);
      reload();
    } catch (e) {
      notifications.notify("error", describeWebhooksError(e), {
        source: "api",
      });
    } finally {
      setDeleting(false);
    }
  }

  const actions = useMemo<WebhookActions>(
    () => ({
      onEdit: (ep) => setFormTarget(ep),
      onToggle: toggle,
      onRotate: rotate,
      onReveal: revealSecret,
      onDelete: (ep) => setConfirmDelete(ep),
    }),
    [toggle, rotate, revealSecret],
  );

  const subtitle = `${counts.total} endpoint(s) · ${counts.active} actif(s)${
    counts.failing > 0 ? ` · ${counts.failing} en échec` : ""
  }`;

  return (
    <PageLayout
      title="Webhooks"
      subtitle={subtitle}
      icon={<IconWebhook size={26} />}
      actions={
        <Group gap="sm" wrap="nowrap">
          <BrickStoreChip brick="webhooks" />
          <Button
            leftSection={<IconPlus size={16} />}
            disabled={!configEnabled}
            onClick={() => setFormTarget(null)}
          >
            Nouveau webhook
          </Button>
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
    >
      {data && !configEnabled && (
        <Alert
          variant="light"
          color="orange"
          icon={<IconAlertTriangle size={16} />}
          title="Webhooks désactivés"
        >
          Le sous-système webhooks est désactivé en configuration sécurité (
          <Text span ff="monospace" fz="xs">
            webhooks.enabled = false
          </Text>
          ) ou son store n'est pas provisionné. La création est indisponible ;
          les endpoints existants (s'il y en a) sont affichés en lecture seule.
        </Alert>
      )}

      <Grid>
        <StatCard
          label="Total"
          icon={<IconWebhook size={20} color="var(--mantine-color-brand-5)" />}
          hint="Nombre d'endpoints webhook enregistrés."
        >
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {counts.total}
          </Text>
        </StatCard>
        <StatCard
          label="Actifs"
          icon={
            <IconCircleCheck size={20} color="var(--mantine-color-teal-6)" />
          }
          hint="Endpoints qui reçoivent les livraisons (enabled)."
        >
          <Text
            fz={28}
            fw={700}
            c="teal"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.active}
          </Text>
        </StatCard>
        <StatCard
          label="En échec"
          icon={
            <IconAlertTriangle
              size={20}
              color="var(--mantine-color-orange-6)"
            />
          }
          hint="Endpoints avec au moins un échec de livraison consécutif courant (auto-désactivation au-delà du seuil)."
        >
          <Text
            fz={28}
            fw={700}
            c={counts.failing > 0 ? "orange" : undefined}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.failing}
          </Text>
        </StatCard>
        <StatCard
          label="Désactivés"
          icon={
            <IconPlayerPause size={20} color="var(--mantine-color-gray-6)" />
          }
          hint="Endpoints inactifs (désactivés manuellement ou auto-désactivés après trop d'échecs)."
        >
          <Text
            fz={28}
            fw={700}
            c="dimmed"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.disabled}
          </Text>
        </StatCard>
      </Grid>

      <Tabs defaultValue="endpoints" mt="xs">
        <Tabs.List>
          <Tabs.Tab value="endpoints" leftSection={<IconList size={15} />}>
            Endpoints
          </Tabs.Tab>
          <Tabs.Tab value="help" leftSection={<IconHelpCircle size={15} />}>
            Utilisation &amp; aide
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="endpoints" pt="md">
          <DataState loading={loading && !data} error={error} onRetry={reload}>
            <WebhooksTable
              endpoints={endpoints}
              store={data?.store ?? "none"}
              driver={data?.driver ?? null}
              actions={actions}
              busyId={busyId}
            />
          </DataState>
        </Tabs.Panel>
        <Tabs.Panel value="help" pt="md">
          <WebhooksHelp />
        </Tabs.Panel>
      </Tabs>

      {/* Création / édition — secret affiché 1× à la création. Remonté par cible
          (clé) pour réinitialiser le formulaire. */}
      {formTarget !== undefined && (
        <WebhookFormModal
          key={formTarget?.id ?? "create"}
          opened
          endpoint={formTarget}
          onClose={() => setFormTarget(undefined)}
          onSaved={reload}
        />
      )}

      {/* Secret révélé (rotation / révélation). */}
      <SecretRevealModal
        opened={reveal !== null}
        onClose={() => setReveal(null)}
        secret={reveal?.secret ?? null}
        url={reveal?.url ?? ""}
        context={reveal?.context ?? "revealed"}
      />

      {/* Confirmation de suppression. */}
      <Modal
        opened={confirmDelete !== null}
        onClose={() => (deleting ? undefined : setConfirmDelete(null))}
        title={
          <Group gap="xs">
            <IconTrash size={18} color="var(--mantine-color-red-6)" />
            <Text fw={700}>Supprimer le webhook ?</Text>
          </Group>
        }
        centered
      >
        {confirmDelete && (
          <Stack gap="md">
            <Alert
              variant="light"
              color="red"
              icon={<IconAlertTriangle size={16} />}
            >
              <Text size="sm">
                L'endpoint{" "}
                <Text span ff="monospace" fz="xs">
                  {confirmDelete.url}
                </Text>{" "}
                sera <strong>définitivement supprimé</strong> ; plus aucune
                livraison ne lui sera envoyée. Action irréversible (auditée).
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={deleting}
                onClick={() => setConfirmDelete(null)}
              >
                Annuler
              </Button>
              <Button
                color="red"
                leftSection={<IconTrash size={16} />}
                loading={deleting}
                onClick={doDelete}
              >
                Supprimer
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageLayout>
  );
});

export default Webhooks;
