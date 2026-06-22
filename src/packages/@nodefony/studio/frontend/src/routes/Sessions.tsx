/**
 * Console **Sessions** (P6.15). Trois portées (modes) dans une page, comme la
 * console API Keys :
 *
 *  - **Mes sessions** (tout authentifié) : les sessions de l'utilisateur courant
 *    (ses appareils / onglets connectés) — révoquer une de ses sessions. Tape
 *    l'endpoint self-service `sessions/mine`, scopé CÔTÉ SERVEUR à l'identité de
 *    l'appelant (anti-IDOR) → un non-admin ne voit/révoque QUE les siennes.
 *  - **Administration** (`ROLE_NODEFONY_ADMIN`) : toutes les sessions du serveur
 *    (gouvernance) — révoquer n'importe laquelle, logout everywhere d'un compte.
 *  - **Tenant** (P17) : même vue scopée à une organisation — grisé (le DTO porte
 *    déjà `tenantId`).
 *
 * Le data plane back `@nodefony/http` expose les DEUX surfaces : self-service
 * (`sessions/mine`, tout authentifié) et admin (`sessions/list`+`revoke-user`,
 * RBAC ADMIN). Le mode pilote l'endpoint et masque les contrôles admin pour un
 * non-admin (sélecteur de portée, filtre serveur, statut du sous-système).
 *
 * Les mutations passent en **POST HTTP** (pipeline CSRF — la Socket reste GET-only).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Stack,
  Grid,
  Group,
  Tabs,
  Text,
  Button,
  SegmentedControl,
  TextInput,
  Modal,
  Alert,
  CloseButton,
} from "@mantine/core";
import {
  IconList,
  IconRefresh,
  IconUserCheck,
  IconUserOff,
  IconUsers,
  IconSearch,
  IconHelpCircle,
  IconBan,
  IconLogout,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { hasRole } from "nodefony/roles";

import { useStore, useAuth, useNotifications } from "../stores";
import { useResource } from "../hooks";
import { PageLayout, StatCard, DataState, DocHint } from "../components/ui";
import {
  ADMIN_ROLE,
  SESSIONS_DOC,
  SESSIONS_LIST_WINDOW,
  sessionsListEndpoint,
  sessionsMineEndpoint,
  revokeSessionEndpoint,
  revokeSessionMineEndpoint,
  revokeUserSessionsEndpoint,
  countByAuth,
  describeSessionsError,
  SESSIONS_STATUS_ENDPOINT,
  type SessionSummary,
  type SessionListResponse,
  type SessionsStatus,
} from "./sessions/sessionsModel";
import { SessionsTable } from "./sessions/SessionsTable";
import { SessionsHelp } from "./sessions/SessionsHelp";
import { StorageBadge } from "./sessions/sessionsFormat";

type Mode = "mine" | "all";

export const Sessions = observer(() => {
  const store = useStore();
  const auth = useAuth();
  const notifications = useNotifications();
  const currentUser = auth.user?.username ?? null;
  const isAdmin = hasRole(auth.roles, ADMIN_ROLE);
  const canMine = currentUser !== null;

  const [mode, setMode] = useState<Mode>(isAdmin && canMine ? "all" : "mine");
  const [tab, setTab] = useState<string>("list");
  // Filtre serveur par utilisateur (mode Administration uniquement) — debounced.
  const [userInput, setUserInput] = useState("");
  const [userFilter, setUserFilter] = useState("");
  const [confirmRevoke, setConfirmRevoke] = useState<SessionSummary | null>(
    null,
  );
  const [confirmRevokeUser, setConfirmRevokeUser] = useState<string | null>(
    null,
  );
  const [revokingRef, setRevokingRef] = useState<string | null>(null);
  const [revokingUser, setRevokingUser] = useState(false);
  // Révocation en masse : les sessions cochées + le `clearSelection` du DataGrid.
  const [confirmBulk, setConfirmBulk] = useState<{
    sessions: SessionSummary[];
    clear: () => void;
  } | null>(null);
  const [bulkRevoking, setBulkRevoking] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setUserFilter(userInput.trim()), 300);
    return () => clearTimeout(t);
  }, [userInput]);

  // Mode « Mes sessions » : endpoint self-service `sessions/mine` (scopé serveur,
  // PAS de ?user= — anti-IDOR). Mode Administration : énumération globale filtrée
  // par l'utilisateur saisi (ou rien = toutes).
  const adminUserFilter = userFilter || undefined;

  const fetcher = useCallback(async (): Promise<SessionListResponse> => {
    try {
      const url =
        mode === "mine"
          ? sessionsMineEndpoint({ limit: SESSIONS_LIST_WINDOW })
          : sessionsListEndpoint({
              user: adminUserFilter,
              limit: SESSIONS_LIST_WINDOW,
            });
      return await store.api.getAbsolute<SessionListResponse>(url);
    } catch (e) {
      throw new Error(describeSessionsError(e));
    }
  }, [store, mode, adminUserFilter]);
  const { data, loading, error, reload } = useResource(fetcher);

  // Révocation : endpoint scopé self (anti-IDOR) en mode « mine », endpoint admin
  // en mode « all » — le mode pilote la cible des mutations.
  const revokeOneEndpoint =
    mode === "mine" ? revokeSessionMineEndpoint : revokeSessionEndpoint;

  // Statut « où on écrit » (driver + durcissement) = endpoint ADMIN → on ne le
  // sollicite QUE pour un admin (sinon 403 inutile dans la console d'un user).
  const statusFetcher = useCallback(
    (): Promise<SessionsStatus | null> =>
      isAdmin
        ? store.api.getAbsolute<SessionsStatus>(SESSIONS_STATUS_ENDPOINT)
        : Promise.resolve(null),
    [store, isAdmin],
  );
  const { data: status } = useResource(statusFetcher);

  const sessions = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? sessions.length;
  const truncated = total > sessions.length;
  const counts = useMemo(() => countByAuth(sessions), [sessions]);

  const modeData = useMemo(
    () => [
      { value: "all", label: "Administration" },
      { value: "mine", label: "Mes sessions", disabled: !canMine },
      { value: "tenant", label: "Tenant (P17)", disabled: true },
    ],
    [canMine],
  );

  async function doRevoke(): Promise<void> {
    if (!confirmRevoke) return;
    const session = confirmRevoke;
    setRevokingRef(session.ref);
    try {
      await store.api.postAbsolute(revokeOneEndpoint(session.ref));
      notifications.notify("success", `Session ${session.ref} révoquée.`, {
        source: "api",
      });
      setConfirmRevoke(null);
      reload();
    } catch (e) {
      notifications.notify("error", describeSessionsError(e), {
        source: "api",
      });
    } finally {
      setRevokingRef(null);
    }
  }

  async function doRevokeUser(): Promise<void> {
    if (!confirmRevokeUser) return;
    const identifier = confirmRevokeUser;
    setRevokingUser(true);
    try {
      const res = await store.api.postAbsolute<{ ok: true; count: number }>(
        revokeUserSessionsEndpoint(identifier),
      );
      notifications.notify(
        "success",
        `${res?.count ?? 0} session(s) de « ${identifier} » révoquée(s).`,
        { source: "api" },
      );
      setConfirmRevokeUser(null);
      reload();
    } catch (e) {
      notifications.notify("error", describeSessionsError(e), {
        source: "api",
      });
    } finally {
      setRevokingUser(false);
    }
  }

  // Révoque en masse : boucle sur l'endpoint unitaire (idempotent, ordre libre)
  // — 0 endpoint batch côté back, feedback agrégé réussis/échecs.
  async function doBulkRevoke(): Promise<void> {
    if (!confirmBulk) return;
    const { sessions: targets, clear } = confirmBulk;
    setBulkRevoking(true);
    try {
      const results = await Promise.allSettled(
        targets.map((s) => store.api.postAbsolute(revokeOneEndpoint(s.ref))),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      notifications.notify(
        failed === 0 ? "success" : "warning",
        failed === 0
          ? `${ok} session(s) révoquée(s).`
          : `${ok} révoquée(s), ${failed} échec(s).`,
        { source: "api" },
      );
      clear();
      setConfirmBulk(null);
      reload();
    } catch (e) {
      notifications.notify("error", describeSessionsError(e), {
        source: "api",
      });
    } finally {
      setBulkRevoking(false);
    }
  }

  const bulkHasSelf =
    confirmBulk?.sessions.some(
      (s) => s.authenticated && s.user === currentUser,
    ) ?? false;

  const revokeUserIsSelf =
    confirmRevokeUser !== null && confirmRevokeUser === currentUser;

  const subtitle =
    mode === "mine"
      ? `Mes sessions — ${counts.total} active(s)`
      : `Toutes les sessions — ${counts.total}${truncated ? ` sur ${total}` : ""} · ${counts.authenticated} authentifiée(s)`;

  return (
    <PageLayout
      title="Sessions"
      subtitle={subtitle}
      icon={<IconList size={26} />}
      actions={
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={reload}
        >
          Recharger
        </Button>
      }
    >
      {/* Portée — Mes sessions / Administration / Tenant (réserve multi-tenant P17). */}
      <Group gap="md" align="center" wrap="wrap">
        <Group gap="xs" align="center">
          {/* Sélecteur de portée = admin seulement (un non-admin n'a que « mine »). */}
          {isAdmin && (
            <SegmentedControl
              value={mode}
              onChange={(v) => {
                if (v === "tenant") return;
                setMode(v as Mode);
              }}
              data={modeData}
              color={mode === "all" ? "orange" : "brand"}
            />
          )}
          <DocHint
            title="Portée des sessions"
            version={SESSIONS_DOC}
            summary="« Mes sessions » = vos appareils/onglets connectés. « Administration » = toutes les sessions du serveur (gouvernance)."
            sections={[
              {
                label: "Mes sessions (self-service)",
                body: "« Mes sessions » interroge l'endpoint dédié sessions/mine, scopé à votre identité CÔTÉ SERVEUR : vous ne voyez et ne révoquez QUE vos propres sessions (anti-IDOR). Accessible à tout utilisateur authentifié, pas seulement aux admins.",
              },
              {
                label: "Tenant (P17)",
                body: "La même vue scopée à une organisation — disponible avec le multi-tenant (le champ tenantId existe déjà sur chaque session).",
              },
            ]}
          />
          {mode === "all" && (
            <Text size="xs" c="dimmed">
              Vue gouvernance — révocation auditée.
            </Text>
          )}
          {status?.enabled && (
            <StorageBadge
              driver={status.driver}
              storage={status.storage}
              revocationHardened={status.revocationHardened}
              savePath={status.savePath}
            />
          )}
        </Group>
        {mode === "all" && (
          <TextInput
            leftSection={<IconSearch size={15} />}
            placeholder="Filtrer par utilisateur (serveur)…"
            value={userInput}
            onChange={(e) => setUserInput(e.currentTarget.value)}
            aria-label="Filtrer les sessions par identifiant d'utilisateur"
            rightSection={
              userInput ? (
                <CloseButton
                  size="sm"
                  aria-label="Effacer le filtre utilisateur"
                  onClick={() => setUserInput("")}
                />
              ) : null
            }
            style={{ minWidth: 260 }}
          />
        )}
      </Group>

      {truncated && (
        <Alert
          variant="light"
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
        >
          <Text size="sm">
            {total} sessions au total — seules les {sessions.length} premières
            sont affichées (fenêtre plafonnée à {SESSIONS_LIST_WINDOW}). Filtrez
            par utilisateur pour cibler.
          </Text>
        </Alert>
      )}

      <Grid>
        <StatCard
          label="Total"
          icon={<IconList size={20} color="var(--mantine-color-brand-5)" />}
          hint="Nombre de sessions persistées dans la fenêtre chargée (authentifiées + anonymes)."
        >
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {counts.total}
          </Text>
        </StatCard>
        <StatCard
          label="Authentifiées"
          icon={<IconUserCheck size={20} color="var(--mantine-color-teal-6)" />}
          hint="Sessions portant un utilisateur connecté (par opposition aux sessions anonymes)."
        >
          <Text
            fz={28}
            fw={700}
            c="teal"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.authenticated}
          </Text>
        </StatCard>
        <StatCard
          label="Anonymes"
          icon={<IconUserOff size={20} color="var(--mantine-color-gray-6)" />}
          info={
            <DocHint
              title="Anonymes"
              version={SESSIONS_DOC}
              summary="Sessions sans utilisateur connecté."
              sections={[
                {
                  label: "Si 0",
                  body: "Aucune session anonyme persistée — normal si la session n'est créée qu'au login (activation par intent).",
                },
              ]}
            />
          }
        >
          <Text
            fz={28}
            fw={700}
            c="dimmed"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.anonymous}
          </Text>
        </StatCard>
        <StatCard
          label="Utilisateurs"
          icon={<IconUsers size={20} color="var(--mantine-color-brand-5)" />}
          hint="Nombre d'utilisateurs distincts ayant au moins une session authentifiée (un même utilisateur peut avoir plusieurs sessions / appareils)."
        >
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {counts.users}
          </Text>
        </StatCard>
      </Grid>

      <Tabs value={tab} onChange={(v) => v && setTab(v)} mt="xs">
        <Tabs.List>
          <Tabs.Tab value="list" leftSection={<IconList size={15} />}>
            Sessions
          </Tabs.Tab>
          <Tabs.Tab value="help" leftSection={<IconHelpCircle size={15} />}>
            Utilisation &amp; aide
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="list" pt="md">
          <DataState loading={loading && !data} error={error} onRetry={reload}>
            <SessionsTable
              sessions={sessions}
              currentUser={currentUser}
              showUser={mode === "all"}
              onRevoke={(s) => setConfirmRevoke(s)}
              onRevokeUser={(id) => setConfirmRevokeUser(id)}
              onBulkRevoke={(s, clear) =>
                setConfirmBulk({ sessions: s, clear })
              }
              revokingRef={revokingRef}
            />
          </DataState>
        </Tabs.Panel>
        <Tabs.Panel value="help" pt="md">
          {tab === "help" && <SessionsHelp />}
        </Tabs.Panel>
      </Tabs>

      {/* Confirmation — révocation d'une session. */}
      <Modal
        opened={confirmRevoke !== null}
        onClose={() => (revokingRef ? undefined : setConfirmRevoke(null))}
        title={
          <Group gap="xs">
            <IconBan size={18} color="var(--mantine-color-red-6)" />
            <Text fw={700}>Révoquer la session ?</Text>
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
                La session <strong>{confirmRevoke.ref}</strong>
                {confirmRevoke.user ? (
                  <>
                    {" "}
                    de <strong>{confirmRevoke.user}</strong>
                  </>
                ) : null}{" "}
                sera <strong>immédiatement</strong> détruite. Le client concerné
                devra se reconnecter. Action irréversible.
                {confirmRevoke.authenticated &&
                confirmRevoke.user === currentUser
                  ? " ⚠ Cette session est la vôtre."
                  : ""}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={revokingRef !== null}
                onClick={() => setConfirmRevoke(null)}
              >
                Annuler
              </Button>
              <Button
                color="red"
                leftSection={<IconBan size={16} />}
                loading={revokingRef === confirmRevoke.ref}
                onClick={doRevoke}
              >
                Révoquer
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Confirmation — logout everywhere d'un utilisateur. */}
      <Modal
        opened={confirmRevokeUser !== null}
        onClose={() => (revokingUser ? undefined : setConfirmRevokeUser(null))}
        title={
          <Group gap="xs">
            <IconLogout size={18} color="var(--mantine-color-red-6)" />
            <Text fw={700}>Déconnecter partout ?</Text>
          </Group>
        }
        centered
      >
        {confirmRevokeUser && (
          <Stack gap="md">
            <Alert
              variant="light"
              color="red"
              icon={<IconAlertTriangle size={16} />}
            >
              <Text size="sm">
                <strong>Toutes</strong> les sessions de{" "}
                <strong>« {confirmRevokeUser} »</strong> seront détruites — tous
                ses appareils/onglets seront déconnectés (logout everywhere).
                C'est la réponse type à une compromission de compte.
                {revokeUserIsSelf
                  ? " ⚠ C'est VOTRE compte : vous serez déconnecté immédiatement."
                  : ""}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={revokingUser}
                onClick={() => setConfirmRevokeUser(null)}
              >
                Annuler
              </Button>
              <Button
                color="red"
                leftSection={<IconLogout size={16} />}
                loading={revokingUser}
                onClick={doRevokeUser}
              >
                Déconnecter tout
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Confirmation — révocation EN MASSE des sessions cochées. */}
      <Modal
        opened={confirmBulk !== null}
        onClose={() => (bulkRevoking ? undefined : setConfirmBulk(null))}
        title={
          <Group gap="xs">
            <IconBan size={18} color="var(--mantine-color-red-6)" />
            <Text fw={700}>Révoquer les sessions sélectionnées ?</Text>
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
                <strong>{confirmBulk.sessions.length}</strong> session(s) seront{" "}
                <strong>immédiatement</strong> détruites — les clients concernés
                devront se reconnecter. Action irréversible.
                {bulkHasSelf
                  ? " ⚠ L'une d'elles est la VÔTRE : vous serez déconnecté."
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
                Révoquer {confirmBulk.sessions.length}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageLayout>
  );
});

export default Sessions;
