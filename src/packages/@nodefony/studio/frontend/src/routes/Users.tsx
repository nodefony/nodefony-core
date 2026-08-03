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
import { useNavigate } from "react-router";
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
import { useResource, useFacetCards } from "../hooks";
import { useIsAdmin, STUDIO_ROLES } from "../auth/roles";
import { RoleGate } from "../auth/RoleGate";
import {
  PageLayout,
  StatCard,
  DocHint,
  fmtFacet,
  pickFilters,
} from "../components/ui";
import {
  ADMIN_ROLE,
  USERS_DOC,
  deleteUserEndpoint,
  USERS_STATUS_ENDPOINT,
  USERS_STATS_ENDPOINT,
  describeUsersError,
  type UserCounts,
  type UserSummary,
  type UsersStatus,
} from "./users/usersModel";
import { UsersTable } from "./users/UsersTable";
import { UsersHelp } from "./users/UsersHelp";
import { CreateUserModal } from "./users/CreateUserModal";
import { BrickStoreChip } from "./stores/BrickStoreChip";

export const Users = observer(() => {
  const store = useStore();
  const auth = useAuth();
  const notifications = useNotifications();
  const currentUser = auth.user?.username ?? null;
  const isAdmin = useIsAdmin();
  const navigate = useNavigate();

  const [tab, setTab] = useState<string>("list");
  const [createOpen, setCreateOpen] = useState(false);
  // Suppression en masse : les comptes cochés + le `clearSelection` du DataGrid.
  const [confirmBulk, setConfirmBulk] = useState<{
    users: UserSummary[];
    clear: () => void;
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // La liste n'est plus chargée ICI : la table la demande page par page au
  // serveur (`<DataGrid mode="server">`). Le parent n'en garde qu'un compteur
  // de version, changé après chaque mutation pour forcer le rechargement de la
  // page affichée — et les comptes de la page courante, seule chose qu'il
  // puisse encore affirmer sur l'annuaire.
  const [reloadKey, setReloadKey] = useState(0);
  const [pageUsers, setPageUsers] = useState<UserSummary[]>([]);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);
  // Les filtres vivent ICI parce que les cartes de tête les suivent : afficher
  // « 1 240 comptes » au-dessus d'un tableau filtré sur « verrouillés » serait
  // deux vérités contradictoires dans le même écran.
  const [filters, setFilters] = useState<Record<string, string>>({});

  // Compte RÉEL de comptes côté serveur (`count()` du dépôt) — endpoint ADMIN,
  // donc jamais sollicité pour un utilisateur ordinaire (403 inutile). C'est la
  // seule source du total au-delà de la fenêtre : la liste est plafonnée, et son
  // `total` retombe sur la taille de la page quand le backend ne sait pas compter.
  const statusFetcher = useCallback(
    (): Promise<UsersStatus | null> =>
      isAdmin
        ? store.api.getAbsolute<UsersStatus>(USERS_STATUS_ENDPOINT)
        : Promise.resolve(null),
    [store, isAdmin],
  );
  const { data: status } = useResource(statusFetcher);

  // Compteurs de tête : le SERVEUR les pose sur l'annuaire entier. Les calculer
  // ici décrirait la page affichée en ayant l'air de décrire l'annuaire. Un
  // non-administrateur n'y a pas droit (403) : ses cartes affichent alors « — »,
  // qui dit « je ne sais pas » — le comptage local aurait dit « il n'y en a
  // que 25 », ce qui est faux.
  //
  // Les compteurs suivent la sélection, mais seulement par ce que l'endpoint de
  // comptage DÉCLARE accepter : il refuse (400) la dimension qu'il décompose —
  // lui demander `?enabled=true` reviendrait à lui faire écraser sa propre
  // ventilation « activés / désactivés ».
  const statsCaps = store.admin.pageCapabilities(USERS_STATS_ENDPOINT);
  const statsFilters = pickFilters(filters, statsCaps?.filters);
  const statsSignal = JSON.stringify(statsFilters);
  const statsFetcher = useCallback((): Promise<UserCounts | null> => {
    if (!isAdmin) return Promise.resolve(null);
    const params = new URLSearchParams(statsFilters);
    const qs = params.toString();
    return store.api.getAbsolute<UserCounts>(
      qs ? `${USERS_STATS_ENDPOINT}?${qs}` : USERS_STATS_ENDPOINT,
    );
    // `statsSignal` est la dépendance réelle : `statsFilters` est un objet
    // recréé à chaque rendu, qui relancerait la requête en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, isAdmin, statsSignal]);
  const { data: serverCounts, reload: reloadCounts } =
    useResource(statsFetcher);
  // Les cartes deviennent cliquables — le filtre posé est celui-là même qui a
  // produit le nombre affiché, parce qu'il vient du serveur et non d'ici.
  const facetCard = useFacetCards(statsCaps, filters, setFilters);
  const counts = useMemo<UserCounts>(
    () =>
      serverCounts ?? {
        total: null,
        active: null,
        disabled: null,
        locked: null,
        admins: null,
        social: null,
      },
    [serverCounts],
  );
  // Total affiché : le compte des facettes serveur s'il existe, sinon le
  // `count` du statut — jamais une taille de page. L'aide de la carte dit laquelle.
  const serverCount = counts.total ?? status?.count ?? null;

  // Suggestions de rôles : rôles connus de Studio ∪ ceux portés par les comptes
  // de la page AFFICHÉE. Le parent n'a plus l'annuaire entier — et ne fait donc
  // plus croire que cette liste est exhaustive ; la saisie reste libre.
  const roleSuggestions = useMemo(() => {
    const set = new Set<string>(STUDIO_ROLES);
    for (const u of pageUsers) for (const r of u.roles) set.add(r);
    return [...set].sort();
  }, [pageUsers]);

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
      reloadCounts();
    } catch (e) {
      notifications.notify("error", describeUsersError(e), { source: "api" });
    } finally {
      setBulkDeleting(false);
    }
  }

  const bulkHasSelf =
    confirmBulk?.users.some((u) => u.identifier === currentUser) ?? false;
  const bulkAdmins =
    confirmBulk?.users.filter((u) => u.roles.includes(ADMIN_ROLE)).length ?? 0;

  const subtitle = `${fmtFacet(serverCount)} compte(s) · ${fmtFacet(counts.admins)} admin(s)`;

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
            onClick={() => {
              reload();
              reloadCounts();
            }}
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
          <BrickStoreChip brick="user" />
        </Group>
      </Group>

      {/* Plus de bandeau « fenêtre plafonnée » : il n'y a plus de fenêtre. La
          table demande la page qu'elle affiche, l'annuaire entier est
          atteignable page après page, et les cartes ci-dessous comptent sur
          l'annuaire entier — pas sur ce qui est chargé. */}

      <Grid>
        <StatCard
          label="Total"
          {...facetCard(
            "total",
            "l'annuaire entier (retire les filtres de facette)",
          )}
          icon={<IconUsers size={20} color="var(--mantine-color-brand-5)" />}
          hint={
            !isAdmin
              ? "Le total de l'annuaire est réservé aux administrateurs — « — » signifie « je ne sais pas », pas « aucun compte »."
              : serverCount === null
                ? "Le dépôt d'utilisateurs branché ne sait pas compter ses lignes — aucun total n'est affiché plutôt qu'un chiffre inventé."
                : `Total de l'annuaire, compté par le serveur : ${serverCount} comptes. La table les parcourt page par page.`
          }
        >
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtFacet(serverCount)}
          </Text>
        </StatCard>
        <StatCard
          label="Actifs"
          {...facetCard(
            "active",
            "les comptes actifs (activés et non verrouillés)",
          )}
          icon={<IconUserCheck size={20} color="var(--mantine-color-teal-6)" />}
          hint="Comptes activés et non verrouillés (peuvent s'authentifier)."
        >
          <Text
            fz={28}
            fw={700}
            c="teal"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {fmtFacet(counts.active)}
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
            {fmtFacet(counts.admins)}
          </Text>
        </StatCard>
        <StatCard
          label="Comptes sociaux"
          {...facetCard("social", "les comptes liés à un fournisseur externe")}
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
            {fmtFacet(counts.social)}
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
          {/* Plus de `DataState` ici : le chargement et l'erreur appartiennent
              désormais au grid, qui recharge à chaque page, tri ou filtre — un
              état de page englobant aurait masqué la table entière à chaque
              tour de page. */}
          <UsersTable
            filters={filters}
            onFiltersChange={setFilters}
            onEdit={(u) => navigate(`/nodefony/users/${u.id}`)}
            onBulkDelete={(u, clear) => setConfirmBulk({ users: u, clear })}
            reloadKey={reloadKey}
            onLoaded={setPageUsers}
          />
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
