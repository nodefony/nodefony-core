/**
 * Table des sessions actives — **pagination, tri et filtres côté SERVEUR**
 * (DataGrid + fiche détail Modal centré). La référence publique (`sess_…`) est
 * affichée — **jamais** l'id de session brut. Les actions destructives (révoquer
 * une session, déconnecter tout un utilisateur) sont déléguées au parent
 * (`onRevoke`/`onRevokeUser`) qui confirme puis appelle le bon endpoint HTTP
 * (pipeline CSRF — la Socket reste GET-only).
 *
 * C'est la ressource où l'écart entre backends est le plus franc, et donc celle
 * où **deviner** coûtait le plus cher : le store Redis énumère par `SCAN` et ne
 * trie RIEN, là où mémoire, SQL et Mongo trient sur `updatedAt`. Cinq en-têtes
 * étaient cliquables ; le serveur n'en honore que deux. Ce que la table propose
 * vient donc du catalogue (`AdminStore.pageCapabilities`), jamais d'ici.
 */
import { useCallback, useMemo, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Stack,
  Group,
  Code,
  Text,
  Modal,
  Alert,
  Box,
  Button,
} from "@mantine/core";
import { IconBan, IconLogout, IconInfoCircle } from "@tabler/icons-react";
import type { IPage } from "nodefony";

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
import {
  SESSIONS_DOC,
  SESSIONS_LIST_ENDPOINT,
  SESSIONS_MINE_ENDPOINT,
  fmtDate,
  fmtSince,
  describeSessionsError,
  type SessionSummary,
} from "./sessionsModel";
import { AuthBadge, TenantChip, ClientChip } from "./sessionsFormat";

/**
 * Habillage des filtres publiés par `GET sessions/list` (`SESSION_FILTERS`).
 *
 * En portée « Mes sessions », le serveur publie une spec **vide** : rien ne
 * s'affiche, et c'est le fond du self-service — le périmètre est décidé par
 * l'identité de l'appelant, pas choisi par lui (anti-IDOR).
 */
const SESSION_FILTER_LABELS: PageFilterLabels = {
  user: {
    label: "Utilisateur",
    hint: "Identifiant EXACT du porteur de la session (pas une recherche : le store compare à l'identique, sur une colonne indexée).",
    placeholder: "identifiant exact",
  },
};

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

export const SessionsTable = observer(function SessionsTable({
  mode,
  filters,
  onFiltersChange,
  currentUser,
  onRevoke,
  onRevokeUser,
  onBulkRevoke,
  revokingRef,
  reloadKey = 0,
}: {
  /**
   * Portée. `"all"` interroge l'énumération d'administration, `"mine"`
   * l'endpoint self-service scopé CÔTÉ SERVEUR à l'appelant — deux surfaces
   * distinctes, jamais un `?user=<moi>` qui serait un IDOR déguisé.
   */
  mode: "all" | "mine";
  /** Filtres actifs — tenus par la page, qui en fait suivre ses cartes de tête. */
  filters: Record<string, string>;
  onFiltersChange: (next: Record<string, string>) => void;
  /** Identifiant de l'admin courant (garde-fou « c'est vous » sur logout-everywhere). */
  currentUser: string | null;
  /** Demande la révocation d'UNE session (le parent confirme + appelle l'endpoint). */
  onRevoke: (session: SessionSummary) => void;
  /** Demande la déconnexion de TOUTES les sessions d'un utilisateur. */
  onRevokeUser: (identifier: string) => void;
  /** Révoque en MASSE les sessions cochées (le parent confirme + boucle + vide la sélection). */
  onBulkRevoke: (
    sessions: SessionSummary[],
    clearSelection: () => void,
  ) => void;
  /** Référence de la session en cours de révocation (spinner sur le bouton). */
  revokingRef: string | null;
  /**
   * Change de valeur pour recharger la page courante après une mutation faite
   * par le parent (révocation unitaire, en masse, logout everywhere).
   */
  reloadKey?: number;
}) {
  const store = useStore();
  const [selected, setSelected] = useState<SessionSummary | null>(null);
  const showUser = mode === "all";
  const endpoint = showUser ? SESSIONS_LIST_ENDPOINT : SESSIONS_MINE_ENDPOINT;
  const caps = store.admin.pageCapabilities(endpoint);
  const filterSignal = JSON.stringify(filters);

  const loader = useCallback(
    async (
      q: DataGridServerQuery,
    ): Promise<DataGridServerResult<SessionSummary>> => {
      const params = toPageParams(q, filters);
      try {
        const page = await store.api.getAbsolute<IPage<SessionSummary>>(
          `${endpoint}?${params}`,
        );
        return fromPage(page);
      } catch (e) {
        throw new Error(describeSessionsError(e), { cause: e });
      }
      // `reloadKey` change l'identité du loader → le grid recharge sa page.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [store, endpoint, filterSignal, reloadKey],
  );

  const sortable = useMemo(
    () => new Set(caps?.sortable ?? []),
    [caps?.sortable],
  );

  const columns = useMemo<DataGridColumn<SessionSummary>[]>(() => {
    const cols: DataGridColumn<SessionSummary>[] = [
      {
        key: "ref",
        header: "Référence",
        // Non triable : `ref` est un HMAC calculé à l'affichage, pas une
        // colonne du store — le champ trié serait `id`, que l'on n'expose
        // justement jamais. Trier ici aurait produit un ordre au hasard.
        value: (r) => r.ref,
        render: (r) => <Code>{r.ref}</Code>,
        size: 150,
      },
    ];
    if (showUser) {
      cols.push({
        key: "user",
        header: "Utilisateur",
        sortable: sortable.has("user"),
        value: (r) => r.user || "",
        render: (r) =>
          r.user ? (
            <Text fw={600} size="sm">
              {r.user}
            </Text>
          ) : (
            <Text size="sm" c="dimmed" fs="italic">
              anonyme
            </Text>
          ),
        size: 160,
      });
    }
    cols.push(
      {
        key: "auth",
        header: "Statut",
        // Ni triable ni filtrable : « authentifiée » est une propriété DÉRIVÉE
        // (`user` non vide) que le contrat de liste n'expose pas en filtre — le
        // vocabulaire publié n'a que `user`. Un filtre ici demanderait au
        // serveur un paramètre qu'il refuse (400).
        value: (r) => (r.authenticated ? "Authentifiée" : "Anonyme"),
        render: (r) => <AuthBadge authenticated={r.authenticated} />,
        size: 130,
      },
      {
        key: "tenant",
        header: "Tenant",
        value: (r) => r.tenantId ?? "global",
        render: (r) => <TenantChip tenantId={r.tenantId} />,
        size: 120,
      },
      {
        key: "ip",
        header: "IP",
        sortable: sortable.has("ip"),
        value: (r) => r.ip ?? "",
        render: (r) =>
          r.ip ? (
            <Code>{r.ip}</Code>
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          ),
        size: 140,
      },
      {
        key: "client",
        header: "Client",
        value: (r) => r.ua ?? "",
        render: (r) => <ClientChip ua={r.ua} />,
        size: 190,
      },
      {
        key: "createdAt",
        header: "Créée",
        sortable: sortable.has("createdAt"),
        value: (r) => r.createdAt ?? 0,
        render: (r) => (
          <Text size="sm" c={r.createdAt === null ? "dimmed" : undefined}>
            {fmtDate(r.createdAt)}
          </Text>
        ),
        size: 170,
      },
      {
        key: "updatedAt",
        header: "Dernière activité",
        sortable: sortable.has("updatedAt"),
        value: (r) => r.updatedAt ?? 0,
        render: (r) => (
          <Text size="sm" c={r.updatedAt === null ? "dimmed" : undefined}>
            {fmtSince(r.updatedAt)}
          </Text>
        ),
        size: 150,
      },
    );
    return cols;
  }, [showUser, sortable]);

  const isSelf =
    selected !== null &&
    selected.authenticated &&
    currentUser !== null &&
    selected.user === currentUser;

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          Clic sur une ligne pour le détail.
        </Text>
        <DocHint
          title="Sessions actives"
          version={SESSIONS_DOC}
          summary="Une session relie un navigateur (ou un client) au serveur via un cookie opaque (auth web BFF). Cette console lit les sessions persistées page par page — le serveur pagine, trie et filtre."
          sections={[
            {
              label: "Ce qui est proposé",
              body: caps
                ? `Le store de sessions branché déclare savoir trier sur ${caps.sortable.length} champ(s)${caps.sortable.length ? ` (${caps.sortable.join(", ")})` : ""}. Un store à curseur (Redis, SCAN) n'en déclare aucun : les en-têtes restent alors inertes plutôt que de répondre 400.`
                : "Les capacités du store ne sont pas encore connues (catalogue d'administration en cours de chargement) : ni tri ni filtre ne sont proposés tant qu'on ignore ce que le serveur honore.",
            },
            {
              label: "Référence (sess_…)",
              body: "L'id de session brut (= la valeur du cookie) n'est JAMAIS exposé : le posséder suffirait à usurper la session. On affiche une référence HMAC non réversible, comme « appareils connectés » chez GitHub/Google. C'est aussi pourquoi la colonne ne se trie pas : elle n'existe pas dans le store.",
            },
            {
              label: "Révocation",
              body: "Révoquer une session la détruit immédiatement : la prochaine requête du client sera traitée comme anonyme (re-login requis). « Déconnecter toutes les sessions » d'un utilisateur = logout everywhere (réponse à compromission).",
            },
            {
              label: "Tenant",
              body: "La colonne Tenant prépare le multi-tenant (P17) : aujourd'hui « global » (mono-tenant), demain l'organisation porteuse de la session.",
            },
          ]}
        />
      </Group>

      <PageFilters
        spec={caps?.filters ?? null}
        value={filters}
        onChange={onFiltersChange}
        labels={SESSION_FILTER_LABELS}
      />

      <DataGrid
        mode="server"
        loader={loader}
        columns={columns}
        getRowId={(r) => r.ref}
        onRowClick={(r) => setSelected(r)}
        initialSort={
          sortable.has("updatedAt")
            ? { key: "updatedAt", dir: "desc" }
            : undefined
        }
        // Aucun store de sessions ne relaie `q` : la barre de recherche
        // parcourait les 200 lignes chargées et ne trouvait rien au-delà.
        // Le filtre « Utilisateur » ci-dessus, lui, interroge le serveur.
        searchable={caps?.search ?? false}
        resetPageSignal={filterSignal}
        pageSize={25}
        persist={{ key: `studio.sessions.${mode}`, storage: "session" }}
        emptyMessage="Aucune session ne correspond."
        selectable
        bulkActions={(rows, clear) => (
          <Button
            color="red"
            size="xs"
            variant="light"
            leftSection={<IconBan size={14} />}
            onClick={() => onBulkRevoke(rows, clear)}
          >
            Révoquer {rows.length} session{rows.length > 1 ? "s" : ""}
          </Button>
        )}
      />

      <Modal
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <Group gap="xs">
              <Text fw={700}>Session {selected.ref}</Text>
              <AuthBadge authenticated={selected.authenticated} />
            </Group>
          ) : (
            ""
          )
        }
        centered
        size="lg"
      >
        {selected && (
          <Stack gap="sm">
            <Field k="Référence publique">
              <Code>{selected.ref}</Code>
            </Field>
            <Field k="Utilisateur">
              {selected.user ? (
                <Text size="sm" fw={600}>
                  {selected.user}
                </Text>
              ) : (
                <Text size="sm" c="dimmed" fs="italic">
                  anonyme
                </Text>
              )}
            </Field>
            <Field k="Tenant">
              <TenantChip tenantId={selected.tenantId} />
            </Field>
            <Field k="Adresse IP">
              {selected.ip ? (
                <Code>{selected.ip}</Code>
              ) : (
                <Text size="sm" c="dimmed">
                  non capturée
                </Text>
              )}
            </Field>
            <Field k="Client">
              <ClientChip ua={selected.ua} />
            </Field>
            {selected.ua && (
              <Field k="User-Agent">
                <Text size="xs" c="dimmed" style={{ wordBreak: "break-word" }}>
                  {selected.ua}
                </Text>
              </Field>
            )}
            <Field k="Créée le">
              <Text size="sm">{fmtDate(selected.createdAt)}</Text>
            </Field>
            <Field k="Dernière activité">
              <Text size="sm">
                {selected.updatedAt === null
                  ? "—"
                  : `${fmtSince(selected.updatedAt)} (${fmtDate(selected.updatedAt)})`}
              </Text>
            </Field>

            <Alert
              variant="light"
              color="gray"
              icon={<IconInfoCircle size={16} />}
              mt="xs"
            >
              <Text size="xs">
                Révoquer une session est immédiat et définitif — le client
                concerné devra se reconnecter. L'id de session brut n'est jamais
                exposé : seule la référence HMAC ci-dessus l'est.
                {isSelf
                  ? " ⚠ Cette session vous appartient : la révoquer (ou vous déconnecter partout) vous déconnectera."
                  : ""}
              </Text>
            </Alert>

            {/* Fermer le détail AVANT d'ouvrir la confirmation : 2 modals
                empilées masqueraient la validation (bug vécu sur API Keys). */}
            <Group justify="space-between" mt="xs">
              {/* « Logout everywhere » = action de GOUVERNANCE (endpoint admin
                  revoke-user) → réservée au mode Administration. En self-service
                  (« Mes sessions »), un user ne révoque QUE session par session. */}
              {showUser && selected.authenticated && selected.user ? (
                <Button
                  color="red"
                  variant="subtle"
                  leftSection={<IconLogout size={16} />}
                  onClick={() => {
                    const u = selected.user;
                    setSelected(null);
                    onRevokeUser(u);
                  }}
                >
                  Déconnecter tout {selected.user}
                </Button>
              ) : (
                <span />
              )}
              <Button
                color="red"
                variant="light"
                leftSection={<IconBan size={16} />}
                loading={revokingRef === selected.ref}
                onClick={() => {
                  const s = selected;
                  setSelected(null);
                  onRevoke(s);
                }}
              >
                Révoquer cette session
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
});
