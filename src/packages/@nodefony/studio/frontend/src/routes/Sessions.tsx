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
  IconList,
  IconRefresh,
  IconUserCheck,
  IconUserOff,
  IconUsers,
  IconHelpCircle,
  IconBan,
  IconLogout,
  IconAlertTriangle,
} from "@tabler/icons-react";
import { hasRole } from "nodefony/roles";

import { useStore, useAuth, useNotifications } from "../stores";
import { useResource, useFacetCards } from "../hooks";
import {
  PageLayout,
  StatCard,
  DocHint,
  fmtFacet,
  toStatsParams,
} from "../components/ui";
import {
  ADMIN_ROLE,
  SESSIONS_DOC,
  revokeSessionEndpoint,
  revokeSessionMineEndpoint,
  revokeUserSessionsEndpoint,
  describeSessionsError,
  SESSIONS_STATUS_ENDPOINT,
  SESSIONS_STATS_ENDPOINT,
  type SessionCounts,
  type SessionSummary,
  type SessionsStatus,
} from "./sessions/sessionsModel";
import { SessionsTable } from "./sessions/SessionsTable";
import { SessionsHelp } from "./sessions/SessionsHelp";
import { SessionPolicyBadge } from "./sessions/sessionsFormat";
import { BrickStoreChip } from "./stores/BrickStoreChip";

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
  // Filtres serveur — le champ « utilisateur » maison a disparu : c'est
  // maintenant le vocabulaire PUBLIÉ par l'endpoint qui décide de ce qui est
  // filtrable, rendu par la barre générique. Il vivait ici avec son propre
  // debounce, sa propre validation et sa propre idée de ce que le serveur
  // acceptait — trois copies de règles que le catalogue porte désormais seul.
  const [filters, setFilters] = useState<Record<string, string>>({});
  // Rechargement de la page affichée après une mutation (révocation).
  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey((n) => n + 1), []);
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

  // La liste n'est plus chargée ici : la table la demande page par page, à
  // l'endpoint que dicte la portée — `sessions/mine` (scopé serveur, PAS de
  // ?user= : anti-IDOR) ou l'énumération d'administration.

  // Politique de session (garde-fou de révocation + délais d'expiration) =
  // endpoint ADMIN → on ne le sollicite QUE pour un admin, sinon on provoque un
  // 403 inutile dans la console d'un utilisateur ordinaire.
  const statusFetcher = useCallback(
    (): Promise<SessionsStatus | null> =>
      isAdmin
        ? store.api.getAbsolute<SessionsStatus>(SESSIONS_STATUS_ENDPOINT)
        : Promise.resolve(null),
    [store, isAdmin],
  );
  const { data: status } = useResource(statusFetcher);

  // Révocation : endpoint scopé self (anti-IDOR) en mode « mine », endpoint admin
  // en mode « all » — le mode pilote la cible des mutations.
  const revokeOneEndpoint =
    mode === "mine" ? revokeSessionMineEndpoint : revokeSessionEndpoint;

  // Compteurs de tête : le SERVEUR les pose sur la collection entière, avec les
  // mêmes filtres que la liste — mais seulement ceux que l'endpoint de comptage
  // DÉCLARE accepter (il refuse la dimension qu'il décompose). Le mode « Mes
  // sessions » n'en a aucun : ses compteurs sont réservés aux admins, et ses
  // cartes affichent « — », qui dit « je ne sais pas » plutôt qu'un chiffre
  // décrivant la seule page chargée.
  // Aucune recherche ici : ni la liste ni les compteurs ne la déclarent (aucun
  // store de sessions ne relaie `q`), donc le grid n'affiche pas de barre et le
  // composeur n'a rien à transmettre.
  const statsCaps = store.admin.pageCapabilities(SESSIONS_STATS_ENDPOINT);
  const statsSignal = toStatsParams(filters, statsCaps).toString();
  const statsFetcher = useCallback((): Promise<SessionCounts | null> => {
    if (mode !== "all" || !isAdmin) return Promise.resolve(null);
    return store.api.getAbsolute<SessionCounts>(
      statsSignal
        ? `${SESSIONS_STATS_ENDPOINT}?${statsSignal}`
        : SESSIONS_STATS_ENDPOINT,
    );
  }, [store, mode, isAdmin, statsSignal]);
  const { data: serverCounts, reload: reloadCounts } =
    useResource(statsFetcher);
  // Cartes cliquables : le filtre posé vient du serveur, donc il sélectionne
  // exactement la population comptée. « Utilisateurs » n'en est pas : c'est une
  // agrégation (utilisateurs DISTINCTS), pas un COUNT filtré — sa carte reste
  // un nombre, faute de filtre qui la sélectionne.
  const facetCard = useFacetCards(statsCaps, filters, setFilters);

  const counts = useMemo<SessionCounts>(
    () =>
      serverCounts ?? {
        total: null,
        authenticated: null,
        anonymous: null,
        users: null,
      },
    [serverCounts],
  );

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
      reloadCounts(); // une session révoquée change les compteurs, pas que la liste
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
      reloadCounts();
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
      reloadCounts();
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
      ? "Mes sessions — mes appareils et onglets connectés"
      : `Toutes les sessions — ${fmtFacet(counts.total)} · ${fmtFacet(counts.authenticated)} authentifiée(s)`;

  return (
    <PageLayout
      title="Sessions"
      subtitle={subtitle}
      icon={<IconList size={26} />}
      actions={
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
              Vue gouvernance — actions auditées.
            </Text>
          )}
          <BrickStoreChip brick="session" />
          {status && (
            <SessionPolicyBadge
              revocationHardened={status.revocationHardened}
              idleTimeoutS={status.idleTimeoutS}
              absoluteTimeoutS={status.absoluteTimeoutS}
            />
          )}
        </Group>
      </Group>

      {/* Plus de bandeau « fenêtre plafonnée » : il n'y a plus de fenêtre. Le
          parc entier est atteignable page après page, et les cartes ci-dessous
          comptent dessus — pas sur les lignes affichées. */}

      <Grid>
        <StatCard
          label="Total"
          {...facetCard(
            "total",
            "toutes les sessions (retire les filtres de facette)",
          )}
          icon={<IconList size={20} color="var(--mantine-color-brand-5)" />}
          hint="Nombre TOTAL de sessions persistées (authentifiées + anonymes), compté par le serveur sur l'ensemble — pas sur les lignes affichées. « — » = le backend ne sait pas compter (store à curseur)."
        >
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtFacet(counts.total)}
          </Text>
        </StatCard>
        <StatCard
          label="Authentifiées"
          {...facetCard(
            "authenticated",
            "les sessions portant un utilisateur connecté",
          )}
          icon={<IconUserCheck size={20} color="var(--mantine-color-teal-6)" />}
          hint="Sessions portant un utilisateur connecté (par opposition aux sessions anonymes)."
        >
          <Text
            fz={28}
            fw={700}
            c="teal"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {fmtFacet(counts.authenticated)}
          </Text>
        </StatCard>
        <StatCard
          label="Anonymes"
          {...facetCard("anonymous", "les sessions sans utilisateur connecté")}
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
            {fmtFacet(counts.anonymous)}
          </Text>
        </StatCard>
        <StatCard
          label="Utilisateurs"
          icon={<IconUsers size={20} color="var(--mantine-color-brand-5)" />}
          hint="Nombre d'utilisateurs DISTINCTS ayant au moins une session (un même utilisateur peut en avoir plusieurs — plusieurs appareils). « 400 sessions » n'est pas « 400 personnes ». « — » = le backend ne sait pas dédupliquer."
        >
          <Text fz={28} fw={700} style={{ fontVariantNumeric: "tabular-nums" }}>
            {fmtFacet(counts.users)}
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
          {/* Le chargement et l'erreur appartiennent au grid, qui recharge à
              chaque page, tri ou filtre — un état englobant masquerait la table
              entière à chaque tour de page. */}
          <SessionsTable
            mode={mode}
            filters={filters}
            onFiltersChange={setFilters}
            currentUser={currentUser}
            onRevoke={(s) => setConfirmRevoke(s)}
            onRevokeUser={(id) => setConfirmRevokeUser(id)}
            onBulkRevoke={(s, clear) => setConfirmBulk({ sessions: s, clear })}
            revokingRef={revokingRef}
            reloadKey={reloadKey}
          />
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
