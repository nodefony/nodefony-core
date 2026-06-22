/**
 * Console **Users** (P6.15) — administration des comptes utilisateurs du serveur
 * (gouvernance, `ROLE_NODEFONY_ADMIN`). Calquée sur la console Sessions : liste +
 * suppression unitaire/en masse, KPIs, badge « où on écrit » (driver du store).
 *
 * Le data plane back `@nodefony/user` (DTO redacté, jamais le hash) est monté par
 * `@nodefony/security` sous `/nodefony/user/api/users*` (RBAC ADMIN). Les
 * mutations passent en **DELETE HTTP** (pipeline CSRF — la Socket reste GET-only).
 *
 * **Garde-fous anti-lockout** : l'enforcement réel est côté serveur (refus 409 de
 * supprimer son propre compte / le dernier admin). Côté front, on AVERTIT dans la
 * confirmation si la sélection contient l'utilisateur courant, et on affiche les
 * échecs par item (le serveur peut refuser certaines suppressions du lot).
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
  IconUsers,
  IconUserPlus,
  IconRefresh,
  IconUserCheck,
  IconShieldCheck,
  IconPlugConnected,
  IconList,
  IconHelpCircle,
  IconTrash,
  IconAlertTriangle,
} from "@tabler/icons-react";

import { useStore, useAuth, useNotifications } from "../stores";
import { useResource } from "../hooks";
import { useIsAdmin, STUDIO_ROLES } from "../auth/roles";
import { RoleGate } from "../auth/RoleGate";
import { PageLayout, StatCard, DataState, DocHint } from "../components/ui";
import {
  ADMIN_ROLE,
  USERS_DOC,
  USERS_LIST_WINDOW,
  usersListEndpoint,
  deleteUserEndpoint,
  USERS_STATUS_ENDPOINT,
  countUsers,
  describeUsersError,
  type UserSummary,
  type UserListResponse,
  type UsersStatus,
} from "./users/usersModel";
import { UsersTable } from "./users/UsersTable";
import { UsersHelp } from "./users/UsersHelp";
import { CreateUserModal } from "./users/CreateUserModal";
import { EditUserModal } from "./users/EditUserModal";
import { StorageBadge } from "./users/usersFormat";

export const Users = observer(() => {
  const store = useStore();
  const auth = useAuth();
  const notifications = useNotifications();
  const currentUser = auth.user?.username ?? null;
  const isAdmin = useIsAdmin();

  const [tab, setTab] = useState<string>("list");
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<UserSummary | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Suppression en masse : les comptes cochés + le `clearSelection` du DataGrid.
  const [confirmBulk, setConfirmBulk] = useState<{
    users: UserSummary[];
    clear: () => void;
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetcher = useCallback(async (): Promise<UserListResponse> => {
    try {
      return await store.api.getAbsolute<UserListResponse>(
        usersListEndpoint({ limit: USERS_LIST_WINDOW }),
      );
    } catch (e) {
      throw new Error(describeUsersError(e));
    }
  }, [store]);
  const { data, loading, error, reload } = useResource(fetcher);

  // Statut « où on écrit » : driver de persistance + nb de comptes.
  const statusFetcher = useCallback(
    () => store.api.getAbsolute<UsersStatus>(USERS_STATUS_ENDPOINT),
    [store],
  );
  const { data: status } = useResource(statusFetcher);

  const users = useMemo(() => data?.items ?? [], [data]);
  const total = data?.total ?? users.length;
  const truncated = total > users.length;
  const counts = useMemo(() => countUsers(users), [users]);

  // Suggestions de rôles : rôles connus de Studio ∪ ceux déjà portés par les
  // comptes chargés (autocomplétion honnête ; la saisie reste libre).
  const roleSuggestions = useMemo(() => {
    const set = new Set<string>(STUDIO_ROLES);
    for (const u of users) for (const r of u.roles) set.add(r);
    return [...set].sort();
  }, [users]);

  async function doDelete(): Promise<void> {
    if (!confirmDelete) return;
    const user = confirmDelete;
    setDeletingId(user.id);
    try {
      await store.api.deleteAbsolute(deleteUserEndpoint(user.id));
      notifications.notify(
        "success",
        `Utilisateur « ${user.identifier} » supprimé.`,
        { source: "api" },
      );
      setConfirmDelete(null);
      reload();
    } catch (e) {
      notifications.notify("error", describeUsersError(e), { source: "api" });
    } finally {
      setDeletingId(null);
    }
  }

  // Supprime en masse : boucle sur l'endpoint unitaire (idempotent, ordre libre)
  // — 0 endpoint batch côté back, feedback agrégé réussis/échecs. Les garde-fous
  // anti-lockout du serveur peuvent refuser certains items (409) → comptés.
  async function doBulkDelete(): Promise<void> {
    if (!confirmBulk) return;
    const { users: targets, clear } = confirmBulk;
    setBulkDeleting(true);
    try {
      const results = await Promise.allSettled(
        targets.map((u) => store.api.deleteAbsolute(deleteUserEndpoint(u.id))),
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      const failed = results.length - ok;
      notifications.notify(
        failed === 0 ? "success" : "warning",
        failed === 0
          ? `${ok} compte(s) supprimé(s).`
          : `${ok} supprimé(s), ${failed} refusé(s) (garde-fou : dernier admin / votre compte).`,
        { source: "api" },
      );
      clear();
      setConfirmBulk(null);
      reload();
    } catch (e) {
      notifications.notify("error", describeUsersError(e), { source: "api" });
    } finally {
      setBulkDeleting(false);
    }
  }

  const deleteIsSelf =
    confirmDelete !== null && confirmDelete.identifier === currentUser;
  const bulkHasSelf =
    confirmBulk?.users.some((u) => u.identifier === currentUser) ?? false;
  const bulkAdmins =
    confirmBulk?.users.filter((u) => u.roles.includes(ADMIN_ROLE)).length ?? 0;

  const subtitle = `${counts.total}${truncated ? ` sur ${total}` : ""} compte(s) · ${counts.admins} admin(s)`;

  return (
    <PageLayout
      title="Users"
      subtitle={subtitle}
      icon={<IconUsers size={26} />}
      actions={
        <Group gap="sm" wrap="nowrap">
          <RoleGate admin>
            <Button
              leftSection={<IconUserPlus size={16} />}
              onClick={() => setCreateOpen(true)}
            >
              Nouvel utilisateur
            </Button>
          </RoleGate>
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
      {/* Portée — gouvernance admin (réserve multi-tenant via la colonne Tenant). */}
      <Group gap="md" align="center" wrap="wrap">
        <Group gap="xs" align="center">
          <Text size="sm" fw={600}>
            Comptes du serveur
          </Text>
          <DocHint
            title="Administration des utilisateurs"
            version={USERS_DOC}
            summary="Vue gouvernance des comptes utilisateurs (source d'identité du firewall). Suppression auditée, protégée par des garde-fous anti-verrouillage."
            sections={[
              {
                label: "RBAC",
                body: "L'administration des utilisateurs est réservée aux administrateurs (ROLE_NODEFONY_ADMIN). L'affichage Studio est un gating ; l'enforcement réel est côté firewall serveur.",
              },
              {
                label: "Tenant (P17)",
                body: "La colonne Tenant prépare le multi-tenant : la même vue scopée à une organisation (le champ tenantId existe déjà sur chaque compte).",
              },
            ]}
          />
          {isAdmin && (
            <Text size="xs" c="dimmed">
              Vue gouvernance — suppression auditée.
            </Text>
          )}
          {status?.enabled && (
            <StorageBadge
              driver={status.driver}
              store={status.store}
              count={status.count}
            />
          )}
        </Group>
      </Group>

      {truncated && (
        <Alert
          variant="light"
          color="yellow"
          icon={<IconAlertTriangle size={16} />}
        >
          <Text size="sm">
            {total} comptes au total — seuls les {users.length} premiers sont
            affichés (fenêtre plafonnée à {USERS_LIST_WINDOW}). Affinez la
            recherche pour cibler.
          </Text>
        </Alert>
      )}

      <Grid>
        <StatCard
          label="Total"
          icon={<IconUsers size={20} color="var(--mantine-color-brand-5)" />}
          hint="Nombre de comptes utilisateurs dans la fenêtre chargée."
        >
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {counts.total}
          </Text>
        </StatCard>
        <StatCard
          label="Actifs"
          icon={<IconUserCheck size={20} color="var(--mantine-color-teal-6)" />}
          hint="Comptes activés et non verrouillés (peuvent s'authentifier)."
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
          label="Administrateurs"
          icon={
            <IconShieldCheck size={20} color="var(--mantine-color-red-6)" />
          }
          info={
            <DocHint
              title="Administrateurs"
              version={USERS_DOC}
              summary="Comptes portant ROLE_NODEFONY_ADMIN."
              sections={[
                {
                  label: "Garde-fou",
                  body: "Le serveur refuse de supprimer ou déchoir le dernier administrateur actif — sinon l'administration deviendrait inaccessible.",
                },
              ]}
            />
          }
        >
          <Text
            fz={28}
            fw={700}
            c="red"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.admins}
          </Text>
        </StatCard>
        <StatCard
          label="Comptes sociaux"
          icon={
            <IconPlugConnected size={20} color="var(--mantine-color-grape-6)" />
          }
          hint="Comptes liés à un fournisseur externe (OAuth — Google, GitHub, Keycloak…)."
        >
          <Text
            fz={28}
            fw={700}
            c="grape"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {counts.social}
          </Text>
        </StatCard>
      </Grid>

      <Tabs value={tab} onChange={(v) => v && setTab(v)} mt="xs">
        <Tabs.List>
          <Tabs.Tab value="list" leftSection={<IconList size={15} />}>
            Utilisateurs
          </Tabs.Tab>
          <Tabs.Tab value="help" leftSection={<IconHelpCircle size={15} />}>
            Utilisation &amp; aide
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="list" pt="md">
          <DataState loading={loading && !data} error={error} onRetry={reload}>
            <UsersTable
              users={users}
              currentUser={currentUser}
              onEdit={(u) => setEditing(u)}
              onDelete={(u) => setConfirmDelete(u)}
              onBulkDelete={(u, clear) => setConfirmBulk({ users: u, clear })}
              deletingId={deletingId}
            />
          </DataState>
        </Tabs.Panel>
        <Tabs.Panel value="help" pt="md">
          {tab === "help" && <UsersHelp />}
        </Tabs.Panel>
      </Tabs>

      {/* Création / édition (gouvernance admin). */}
      <CreateUserModal
        opened={createOpen}
        onClose={() => setCreateOpen(false)}
        roleSuggestions={roleSuggestions}
        onCreated={reload}
      />
      <EditUserModal
        user={editing}
        currentUser={currentUser}
        roleSuggestions={roleSuggestions}
        onClose={() => setEditing(null)}
        onSaved={reload}
      />

      {/* Confirmation — suppression d'un compte. */}
      <Modal
        opened={confirmDelete !== null}
        onClose={() => (deletingId ? undefined : setConfirmDelete(null))}
        title={
          <Group gap="xs">
            <IconTrash size={18} color="var(--mantine-color-red-6)" />
            <Text fw={700}>Supprimer le compte ?</Text>
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
                Le compte <strong>{confirmDelete.identifier}</strong> sera{" "}
                <strong>immédiatement</strong> supprimé — ses sessions et jetons
                seront révoqués en cascade. Action irréversible.
                {deleteIsSelf
                  ? " ⚠ C'est VOTRE compte : le serveur refusera (garde-fou anti-verrouillage)."
                  : confirmDelete.roles.includes(ADMIN_ROLE)
                    ? " Ce compte est administrateur : le serveur refusera s'il s'agit du dernier admin actif."
                    : ""}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={deletingId !== null}
                onClick={() => setConfirmDelete(null)}
              >
                Annuler
              </Button>
              <Button
                color="red"
                leftSection={<IconTrash size={16} />}
                loading={deletingId === confirmDelete.id}
                onClick={doDelete}
              >
                Supprimer
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      {/* Confirmation — suppression EN MASSE des comptes cochés. */}
      <Modal
        opened={confirmBulk !== null}
        onClose={() => (bulkDeleting ? undefined : setConfirmBulk(null))}
        title={
          <Group gap="xs">
            <IconTrash size={18} color="var(--mantine-color-red-6)" />
            <Text fw={700}>Supprimer les comptes sélectionnés ?</Text>
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
                <strong>{confirmBulk.users.length}</strong> compte(s) seront{" "}
                <strong>immédiatement</strong> supprimés — sessions et jetons
                révoqués en cascade. Action irréversible.
                {bulkHasSelf
                  ? " ⚠ VOTRE compte est dans la sélection : le serveur le refusera (garde-fou)."
                  : ""}
                {bulkAdmins > 0
                  ? ` ${bulkAdmins} administrateur(s) sélectionné(s) : le dernier admin actif ne pourra pas être supprimé.`
                  : ""}
              </Text>
            </Alert>
            <Group justify="flex-end">
              <Button
                variant="default"
                disabled={bulkDeleting}
                onClick={() => setConfirmBulk(null)}
              >
                Annuler
              </Button>
              <Button
                color="red"
                leftSection={<IconTrash size={16} />}
                loading={bulkDeleting}
                onClick={doBulkDelete}
              >
                Supprimer {confirmBulk.users.length}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </PageLayout>
  );
});

export default Users;
