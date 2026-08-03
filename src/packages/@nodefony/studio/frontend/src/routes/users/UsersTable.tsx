/**
 * Table des utilisateurs — **pagination, tri et filtres côté SERVEUR**. Clic sur
 * une ligne → ouvre la page de gestion du compte (`/nodefony/users/{id}` via
 * `onEdit`) : c'est là que se font le détail, l'édition (profil/rôles), les
 * facteurs forts et la zone danger. La suppression EN MASSE (cases à cocher)
 * reste déléguée au parent (confirmation anti-lockout + endpoint HTTP CSRF).
 * **Jamais** le hash (absent du DTO).
 *
 * Ce que la table n'invente plus : **ce qui est triable, filtrable et
 * cherchable est DEMANDÉ au serveur** (`AdminStore.pageCapabilities`), parce que
 * la réponse dépend de l'annuaire branché — celui en mémoire ne connaît ni
 * `createdAt` ni `updatedAt`, une base SQL oui. Une en-tête cliquable codée en
 * dur répondrait `400` selon le déploiement.
 */
import { useCallback, useMemo } from "react";
import { observer } from "mobx-react-lite";
import { Stack, Group, Text, Button } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
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
  USERS_DOC,
  USERS_LIST_ENDPOINT,
  fmtDate,
  fmtSince,
  describeUsersError,
  type UserSummary,
} from "./usersModel";
import {
  StatusBadge,
  RoleBadges,
  ProviderChips,
  TenantChip,
} from "./usersFormat";

/**
 * Habillage des filtres que `GET /nodefony/user/api/users` publie
 * (`USER_FILTERS`, côté `@nodefony/user`) — libellés et aides seulement.
 *
 * La LISTE, elle, vient du serveur : ajouter un filtre au contrat le fait
 * apparaître ici sans toucher à ce fichier (sous son nom technique tant qu'on
 * ne lui a pas écrit de libellé). L'inverse — une liste tenue à la main —
 * aurait fait disparaître en silence toute capacité nouvelle.
 */
const USER_FILTER_LABELS: PageFilterLabels = {
  role: {
    label: "Rôle",
    hint: "Comptes portant CE rôle exactement (ex. ROLE_NODEFONY_ADMIN). Correspondance stricte, pas une recherche.",
    placeholder: "ROLE_…",
  },
  enabled: {
    label: "Activation",
    hint: "Activé = le compte peut s'authentifier. Un compte peut être activé ET verrouillé : les deux filtres sont indépendants.",
    values: { true: "Activés", false: "Désactivés" },
  },
  locked: {
    label: "Verrouillage",
    hint: "Verrouillé par la défense anti-force brute — distinct d'une désactivation, qui est une décision d'administration.",
    values: { true: "Verrouillés", false: "Non verrouillés" },
  },
  hasSocial: {
    label: "Connexion",
    hint: "Comptes liés à au moins un fournisseur externe (OAuth : Google, GitHub, Keycloak…).",
    values: { true: "Sociaux", false: "Locaux" },
  },
};

export const UsersTable = observer(function UsersTable({
  filters,
  onFiltersChange,
  onEdit,
  onBulkDelete,
  reloadKey = 0,
  onLoaded,
}: {
  /**
   * Filtres actifs — tenus par la PAGE, parce que les cartes de tête doivent
   * décrire la même sélection que le tableau. Deux états séparés auraient
   * affiché un total « toutes ressources » au-dessus d'une liste filtrée.
   */
  filters: Record<string, string>;
  onFiltersChange: (next: Record<string, string>) => void;
  /** Clic sur une ligne → ouvre la page de gestion du compte. */
  onEdit: (user: UserSummary) => void;
  /** Supprime en MASSE les comptes cochés (le parent confirme + boucle + vide la sélection). */
  onBulkDelete: (users: UserSummary[], clearSelection: () => void) => void;
  /**
   * Change de valeur pour forcer un rechargement de la page courante — après
   * une mutation faite par le parent (création, suppression en masse).
   */
  reloadKey?: number;
  /**
   * Remonte les comptes de la page courante. Le parent n'a plus l'annuaire
   * entier : il ne peut suggérer que ce qui est SOUS LES YEUX, et c'est la
   * seule chose honnête qu'il puisse dire.
   */
  onLoaded?: (users: UserSummary[]) => void;
}) {
  const store = useStore();
  // Ce que l'annuaire BRANCHÉ déclare savoir faire. `null` tant que le
  // catalogue admin n'est pas chargé → ni tri, ni filtre, ni recherche : le
  // seul défaut qui ne promet rien qu'on ne puisse tenir.
  const caps = store.admin.pageCapabilities(USERS_LIST_ENDPOINT);
  // Signature stable des filtres : le grid revient page 1 quand elle change
  // (sinon on demande la page 7 d'un résultat qui n'a plus que 2 pages).
  const filterSignal = JSON.stringify(filters);

  const loader = useCallback(
    async (
      q: DataGridServerQuery,
    ): Promise<DataGridServerResult<UserSummary>> => {
      const params = toPageParams(q, filters);
      try {
        const page = await store.api.getAbsolute<IPage<UserSummary>>(
          `${USERS_LIST_ENDPOINT}?${params}`,
        );
        onLoaded?.(page.items);
        return fromPage(page);
      } catch (e) {
        throw new Error(describeUsersError(e), { cause: e });
      }
      // `reloadKey` n'est pas lu dans le corps : il est là pour CHANGER
      // l'identité du loader, ce qui déclenche le rechargement du grid.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [store, filterSignal, reloadKey, onLoaded],
  );

  const sortable = useMemo(
    () => new Set(caps?.sortable ?? []),
    [caps?.sortable],
  );

  const columns = useMemo<DataGridColumn<UserSummary>[]>(
    () => [
      {
        key: "identifier",
        header: "Identifiant",
        sortable: sortable.has("identifier"),
        value: (r) => r.identifier,
        render: (r) => (
          <Text fw={600} size="sm" style={{ wordBreak: "break-all" }}>
            {r.identifier}
          </Text>
        ),
        size: 200,
      },
      {
        key: "roles",
        header: "Rôles",
        value: (r) => r.roles.join(" "),
        render: (r) => <RoleBadges roles={r.roles} />,
        size: 240,
      },
      {
        key: "status",
        header: "État",
        // Non triable et non filtrable PAR CONSTRUCTION : cette colonne mêle
        // deux propriétés distinctes (`enabled` et `locked`), qui se filtrent
        // séparément dans la barre au-dessus. Un filtre de colonne ici aurait
        // demandé au serveur un « état » qui n'existe pas dans son vocabulaire.
        value: (r) =>
          r.locked ? "Verrouillé" : r.enabled ? "Actif" : "Désactivé",
        render: (r) => <StatusBadge enabled={r.enabled} locked={r.locked} />,
        size: 130,
      },
      {
        key: "provider",
        header: "Connexion",
        value: (r) =>
          r.socialProviders.length > 0
            ? r.socialProviders.map((p) => p.provider).join(" ")
            : "local",
        render: (r) => <ProviderChips providers={r.socialProviders} />,
        size: 150,
      },
      {
        key: "tenant",
        header: "Tenant",
        value: (r) => r.tenantId ?? "global",
        render: (r) => <TenantChip tenantId={r.tenantId} />,
        size: 120,
      },
      {
        key: "createdAt",
        header: "Créé",
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
        header: "Dernière maj",
        sortable: sortable.has("updatedAt"),
        value: (r) => r.updatedAt ?? 0,
        render: (r) => (
          <Text size="sm" c={r.updatedAt === null ? "dimmed" : undefined}>
            {fmtSince(r.updatedAt)}
          </Text>
        ),
        size: 150,
      },
    ],
    [sortable],
  );

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          Clic sur une ligne pour gérer le compte.
        </Text>
        <DocHint
          title="Utilisateurs"
          version={USERS_DOC}
          summary="Les comptes utilisateurs du serveur (source d'identité du firewall). La table lit l'annuaire page par page : tri, filtres et recherche sont exécutés par le serveur, jamais sur un extrait chargé d'avance."
          sections={[
            {
              label: "Ce qui est proposé",
              body: caps
                ? `Le serveur déclare savoir trier sur ${caps.sortable.length} champ(s) et filtrer sur ${Object.keys(caps.filters).length}. Ce qu'il ne déclare pas n'est pas offert : une en-tête cliquable qui répondrait 400 serait pire qu'une en-tête inerte.`
                : "Les capacités de l'annuaire ne sont pas encore connues (catalogue d'administration en cours de chargement) : ni tri ni filtre ne sont proposés tant qu'on ne sait pas ce que le serveur honore.",
            },
            {
              label: "Redaction",
              body: "Le hash de mot de passe n'est JAMAIS exposé : le DTO d'administration ne porte que l'identité, les rôles et l'état. Les liens sociaux (OAuth) sont montrés sans jeton.",
            },
            {
              label: "Garde-fous anti-verrouillage",
              body: "Le serveur refuse de supprimer votre propre compte ou le dernier administrateur actif (sinon plus personne ne pourrait administrer). Ces refus reviennent en erreur explicite (409).",
            },
            {
              label: "Tenant",
              body: "La colonne Tenant prépare le multi-tenant (P17) : aujourd'hui « global » (mono-tenant), demain l'organisation porteuse du compte.",
            },
          ]}
        />
      </Group>

      <PageFilters
        spec={caps?.filters ?? null}
        value={filters}
        onChange={onFiltersChange}
        labels={USER_FILTER_LABELS}
      />

      <DataGrid
        mode="server"
        loader={loader}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => onEdit(r)}
        dimRow={(r) => !r.enabled || r.locked}
        initialSort={
          sortable.has("identifier")
            ? { key: "identifier", dir: "asc" }
            : undefined
        }
        // La recherche n'est offerte que si l'annuaire branché la relaie à son
        // dépôt. Sans cette condition, une barre bien visible renverrait
        // l'annuaire ENTIER, lu comme le résultat de la recherche.
        searchable={caps?.search ?? false}
        searchPlaceholder="Rechercher un identifiant…"
        resetPageSignal={filterSignal}
        pageSize={25}
        persist={{ key: "studio.users", storage: "session" }}
        emptyMessage="Aucun utilisateur ne correspond."
        selectable
        bulkActions={(rows, clear) => (
          <Button
            color="red"
            size="xs"
            variant="light"
            leftSection={<IconTrash size={14} />}
            onClick={() => onBulkDelete(rows, clear)}
          >
            Supprimer {rows.length} compte{rows.length > 1 ? "s" : ""}
          </Button>
        )}
      />
    </Stack>
  );
});
