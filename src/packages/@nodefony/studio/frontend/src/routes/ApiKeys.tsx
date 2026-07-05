/**
 * Console **API Keys** (PAT — P6.12 + P6.15). Trois portées (modes) dans une page,
 * pilotées par un sélecteur :
 *
 *  - **Utilisateur** (« Mes clés ») : self-service — lister, **créer** (secret 1×),
 *    révoquer SES clés (data plane `/nodefony/security/api/keys`, session BFF).
 *  - **Administration** (`ROLE_NODEFONY_ADMIN`) : voir **toutes** les clés
 *    (gouvernance), révoquer n'importe laquelle (réponse à incident) — PAS de
 *    création pour autrui (une clé est personnelle). Data plane admin.
 *  - **Tenant** (P17) : même vue scopée à un tenant — slot grisé (le DTO porte
 *    déjà `tenantId`).
 *
 * Les mutations (création, révocation) passent en **POST/DELETE HTTP** (pipeline
 * complet, CSRF appliqué — la Socket Nodefony reste GET-only). Le gating de mode
 * côté front = affichage ; l'enforcement réel = RBAC serveur sur l'endpoint admin.
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
  SegmentedControl,
  Modal,
  Alert,
} from "@mantine/core";
import {
  IconKey,
  IconPlus,
  IconRefresh,
  IconUser,
  IconShieldLock,
  IconBuildingCommunity,
  IconList,
  IconHelpCircle,
  IconBan,
  IconAlertTriangle,
  IconCircleCheck,
  IconClock,
} from "@tabler/icons-react";
import { hasRole } from "nodefony/roles";

import { useStore, useAuth, useNotifications } from "../stores";
import { useResource } from "../hooks";
import { PageLayout, StatCard, DataState, DocHint } from "../components/ui";
import {
  KEYS_ENDPOINT,
  KEYS_CAPABILITIES_ENDPOINT,
  ADMIN_KEYS_ENDPOINT,
  API_KEYS_STATUS_ENDPOINT,
  ADMIN_ROLE,
  API_KEYS_DOC,
  adminRevokeEndpoint,
  userRevokeEndpoint,
  countByStatus,
  describeApiKeysError,
  type ApiKey,
  type ApiKeyCapabilities,
  type ApiKeysStatus,
} from "./apikeys/apiKeysModel";
import { ApiKeysTable } from "./apikeys/ApiKeysTable";
import { CreateApiKeyModal } from "./apikeys/CreateApiKeyModal";
import { ApiKeysHelp } from "./apikeys/ApiKeysHelp";
import { BrickStoreChip } from "./stores/BrickStoreChip";

type Mode = "user" | "admin";

export const ApiKeys = observer(() => {
  const store = useStore();
  const auth = useAuth();
  const notifications = useNotifications();
  const isAdmin = hasRole(auth.roles, ADMIN_ROLE);

  const [mode, setMode] = useState<Mode>(isAdmin ? "admin" : "user");
  const [tab, setTab] = useState<string>("keys");
  const [createOpen, setCreateOpen] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState<ApiKey | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  // Révocation en masse : les clés cochées + le `clearSelection` du DataGrid.
  const [confirmBulk, setConfirmBulk] = useState<{
    keys: ApiKey[];
    clear: () => void;
  } | null>(null);
  const [bulkRevoking, setBulkRevoking] = useState(false);

  const endpoint = mode === "admin" ? ADMIN_KEYS_ENDPOINT : KEYS_ENDPOINT;

  const fetcher = useCallback(async (): Promise<ApiKey[]> => {
    try {
      const res = await store.api.getAbsolute<{ keys: ApiKey[] }>(endpoint);
      return res.keys ?? [];
    } catch (e) {
      throw new Error(describeApiKeysError(e));
    }
  }, [store, endpoint]);
  const { data, loading, error, reload } = useResource(fetcher);
  const keys = useMemo(() => data ?? [], [data]);

  // Capacités d'émission (formulaire + onglet aide) — chargées une fois.
  const capFetcher = useCallback(async (): Promise<ApiKeyCapabilities> => {
    try {
      return await store.api.getAbsolute<ApiKeyCapabilities>(
        KEYS_CAPABILITIES_ENDPOINT,
      );
    } catch (e) {
      throw new Error(describeApiKeysError(e));
    }
  }, [store]);
  const { data: caps } = useResource(capFetcher);

  // Statut « où on écrit » : backend du token store (classe + driver). Endpoint
  // RBAC admin → un non-admin reçoit 403 (badge simplement masqué, pas d'erreur).
  const statusFetcher = useCallback(
    () => store.api.getAbsolute<ApiKeysStatus>(API_KEYS_STATUS_ENDPOINT),
    [store],
  );
  const { data: status } = useResource(statusFetcher);

  const counts = useMemo(() => countByStatus(keys), [keys]);

  const modeData = useMemo(
    () => [
      { value: "admin", label: "Administration" },
      { value: "user", label: "Mes clés" },
      { value: "tenant", label: "Tenant (P17)", disabled: true },
    ],
    [],
  );

  async function doRevoke(): Promise<void> {
    if (!confirmRevoke) return;
    const key = confirmRevoke;
    setRevokingId(key.id);
    try {
      if (mode === "admin") {
        await store.api.postAbsolute(adminRevokeEndpoint(key.id));
      } else {
        await store.api.deleteAbsolute(userRevokeEndpoint(key.id));
      }
      notifications.notify("success", `Clé « ${key.name} » révoquée.`, {
        source: "api",
      });
      setConfirmRevoke(null);
      reload();
    } catch (e) {
      notifications.notify("error", describeApiKeysError(e), { source: "api" });
    } finally {
      setRevokingId(null);
    }
  }

  // Révoque en masse : boucle sur l'endpoint UNITAIRE du mode courant (idempotent,
  // ordre libre) — 0 endpoint batch côté back, feedback agrégé réussis/échecs.
  async function doBulkRevoke(): Promise<void> {
    if (!confirmBulk) return;
    const { keys: targets, clear } = confirmBulk;
    setBulkRevoking(true);
    try {
      const results = await Promise.allSettled(
        targets.map((k) =>
          mode === "admin"
            ? store.api.postAbsolute(adminRevokeEndpoint(k.id))
            : store.api.deleteAbsolute(userRevokeEndpoint(k.id)),
        ),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      notifications.notify(
        failed === 0 ? "success" : "warning",
        failed === 0
          ? `${ok} clé(s) révoquée(s).`
          : `${ok} révoquée(s), ${failed} échec(s).`,
        { source: "api" },
      );
      clear();
      setConfirmBulk(null);
      reload();
    } catch (e) {
      notifications.notify("error", describeApiKeysError(e), { source: "api" });
    } finally {
      setBulkRevoking(false);
    }
  }

  const subtitle =
    mode === "admin"
      ? `Toutes les clés — ${counts.total} clé(s) · ${counts.active} active(s)`
      : `Mes clés — ${counts.total} clé(s) · ${counts.active} active(s)`;

  return (
    <PageLayout
      title="API Keys"
      subtitle={subtitle}
      icon={<IconKey size={26} />}
      actions={
        <Group gap="sm" wrap="nowrap">
          {mode === "user" && (
            <Button
              leftSection={<IconPlus size={16} />}
              disabled={!caps?.enabled}
              onClick={() => setCreateOpen(true)}
            >
              Nouvelle clé
            </Button>
          )}
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
      {/* Sélecteur de portée — seulement pour un admin (un user n'a que ses clés). */}
      {isAdmin && (
        <Group gap="xs" align="center">
          <SegmentedControl
            value={mode}
            onChange={(v) => {
              if (v === "tenant") return;
              setMode(v as Mode);
            }}
            data={modeData}
            color={mode === "admin" ? "orange" : "brand"}
          />
          <DocHint
            title="Portée des clés"
            version={API_KEYS_DOC}
            summary="« Mes clés » = self-service (vos propres jetons). « Administration » = gouvernance de toutes les clés du système (lister, révoquer en réponse à incident)."
            sections={[
              {
                label: "Pourquoi pas de création en Administration",
                body: "Une clé porte l'identité et les droits frais de son porteur ; en créer une « au nom de » quelqu'un serait une usurpation. L'admin supervise et révoque ; chacun crée ses propres clés.",
              },
              {
                label: "Tenant (P17)",
                body: "La même vue, filtrée par organisation/tenant — disponible avec le multi-tenant (le champ tenantId existe déjà sur chaque clé).",
              },
            ]}
          />
          {mode === "admin" && (
            <Text size="xs" c="dimmed">
              Vue gouvernance — révocation en réponse à incident, audité.
            </Text>
          )}
          {status && status.store !== "none" && (
            <BrickStoreChip brick="tokens" />
          )}
        </Group>
      )}

      <Grid>
        <StatCard
          label="Total"
          icon={<IconKey size={20} color="var(--mantine-color-brand-5)" />}
          hint="Nombre de clés API dans cette portée (actives + expirées + révoquées)."
        >
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {counts.total}
          </Text>
        </StatCard>
        <StatCard
          label="Actives"
          icon={
            <IconCircleCheck size={20} color="var(--mantine-color-teal-6)" />
          }
          hint="Clés utilisables : ni expirées, ni révoquées."
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
          label="Expirées"
          icon={<IconClock size={20} color="var(--mantine-color-orange-6)" />}
          hint="Clés dont la date d'expiration est passée (rejetées à l'usage)."
        >
          <Text
            fz={28}
            fw={700}
            c="orange"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.expired}
          </Text>
        </StatCard>
        <StatCard
          label="Révoquées"
          icon={<IconBan size={20} color="var(--mantine-color-red-6)" />}
          hint="Clés désactivées manuellement (conservées un temps pour l'audit)."
        >
          <Text
            fz={28}
            fw={700}
            c="red"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.revoked}
          </Text>
        </StatCard>
      </Grid>

      <Tabs value={tab} onChange={(v) => v && setTab(v)} mt="xs">
        <Tabs.List>
          <Tabs.Tab value="keys" leftSection={<IconList size={15} />}>
            Clés
          </Tabs.Tab>
          <Tabs.Tab value="help" leftSection={<IconHelpCircle size={15} />}>
            Utilisation &amp; aide
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="keys" pt="md">
          <DataState loading={loading && !data} error={error} onRetry={reload}>
            <ApiKeysTable
              keys={keys}
              showSubject={mode === "admin"}
              onRevoke={(k) => setConfirmRevoke(k)}
              onBulkRevoke={(k, clear) => setConfirmBulk({ keys: k, clear })}
              revokingId={revokingId}
            />
          </DataState>
        </Tabs.Panel>
        <Tabs.Panel value="help" pt="md">
          {tab === "help" &&
            (caps ? (
              <ApiKeysHelp capabilities={caps} />
            ) : (
              <Text size="sm" c="dimmed">
                Capacités indisponibles (clés API désactivées ou non
                authentifié).
              </Text>
            ))}
        </Tabs.Panel>
      </Tabs>

      {/* Création (self-service) — secret affiché 1×. */}
      {caps && (
        <CreateApiKeyModal
          opened={createOpen}
          onClose={() => setCreateOpen(false)}
          capabilities={caps}
          onCreated={reload}
        />
      )}

      {/* Confirmation de révocation. */}
      <Modal
        opened={confirmRevoke !== null}
        onClose={() => (revokingId ? undefined : setConfirmRevoke(null))}
        title={
          <Group gap="xs">
            <IconBan size={18} color="var(--mantine-color-red-6)" />
            <Text fw={700}>Révoquer la clé ?</Text>
          </Group>
        }
        centered
      >
        {confirmRevoke && (
          <Stack gap="md">
            <Alert
              variant="light"
              color="red"
              icon={<IconAlertTriangle size={16} />}
            >
              <Text size="sm">
                La clé <strong>« {confirmRevoke.name} »</strong>
                {mode === "admin" ? (
                  <>
                    {" "}
                    du porteur <strong>{confirmRevoke.subjectId}</strong>
                  </>
                ) : null}{" "}
                sera <strong>immédiatement et définitivement</strong>{" "}
                désactivée. Tout script qui l'utilise sera rejeté (401). Action
                irréversible.
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={revokingId !== null}
                onClick={() => setConfirmRevoke(null)}
              >
                Annuler
              </Button>
              <Button
                color="red"
                leftSection={<IconBan size={16} />}
                loading={revokingId === confirmRevoke.id}
                onClick={doRevoke}
              >
                Révoquer
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Confirmation — révocation EN MASSE des clés cochées. */}
      <Modal
        opened={confirmBulk !== null}
        onClose={() => (bulkRevoking ? undefined : setConfirmBulk(null))}
        title={
          <Group gap="xs">
            <IconBan size={18} color="var(--mantine-color-red-6)" />
            <Text fw={700}>Révoquer les clés sélectionnées ?</Text>
          </Group>
        }
        centered
      >
        {confirmBulk && (
          <Stack gap="md">
            <Alert
              variant="light"
              color="red"
              icon={<IconAlertTriangle size={16} />}
            >
              <Text size="sm">
                <strong>{confirmBulk.keys.length}</strong> clé(s) seront{" "}
                <strong>immédiatement et définitivement</strong> désactivées —
                tout script qui les utilise sera rejeté (401). Action
                irréversible.
                {mode === "admin"
                  ? " Ces clés appartiennent à leurs porteurs respectifs (action de gouvernance, auditée)."
                  : ""}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={bulkRevoking}
                onClick={() => setConfirmBulk(null)}
              >
                Annuler
              </Button>
              <Button
                color="red"
                leftSection={<IconBan size={16} />}
                loading={bulkRevoking}
                onClick={doBulkRevoke}
              >
                Révoquer {confirmBulk.keys.length}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageLayout>
  );
});

export default ApiKeys;
