/**
 * Table des clés API (DataGrid + fiche détail Modal centré). Servie dans les
 * DEUX portées, avec **deux régimes de pagination**, et c'est délibéré :
 *
 *  - **Administration** — le data plane admin (`apikeys`) pagine, trie et filtre
 *    côté serveur, et publie ce qu'il sait faire. La table le lui DEMANDE.
 *  - **Mes clés** — l'endpoint self-service (`keys`, controller framework) rend
 *    l'intégralité du périmètre de l'appelant en un appel : ses propres clés,
 *    une poignée. Le grid les trie en mémoire, et personne ne ment — il n'y a
 *    pas de reste à aller chercher. Le basculer coûterait une pagination scopée
 *    au sujet dans un controller hors broker, pour zéro gain de vérité.
 *
 * La révocation est déléguée au parent (`onRevoke`) qui connaît la portée →
 * choisit le bon endpoint (DELETE self vs POST admin).
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
import { IconKey, IconBan, IconInfoCircle } from "@tabler/icons-react";
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
  API_KEYS_DOC,
  ADMIN_KEYS_ENDPOINT,
  fmtDate,
  fmtExpiry,
  fmtLastUsed,
  keyStatus,
  describeApiKeysError,
  type ApiKey,
} from "./apiKeysModel";
import { KeyStatusBadge, ScopeChips, SubjectChip } from "./apiKeysFormat";

/**
 * Habillage des filtres publiés par `GET apikeys` (`TOKEN_FILTERS`).
 *
 * `status` a remplacé l'ancien `revoked` : « active » et « expirée » n'étaient
 * pas distinguables, alors que la première ouvre l'accès et la seconde ne
 * l'ouvre plus. La console affichait ces deux populations dans des cartes
 * séparées sans pouvoir les demander au serveur.
 */
const KEY_FILTER_LABELS: PageFilterLabels = {
  subjectId: {
    label: "Porteur",
    hint: "Identifiant EXACT du porteur (colonne indexée) — pas une recherche.",
    placeholder: "identifiant exact",
  },
  status: {
    label: "État",
    hint: "Active = utilisable. Expirée = au-delà de son échéance. Révoquée = désactivée à la main. Les trois partitionnent : une clé est dans exactement une case.",
    values: { active: "Actives", expired: "Expirées", revoked: "Révoquées" },
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

export const ApiKeysTable = observer(function ApiKeysTable({
  keys,
  showSubject,
  filters,
  onFiltersChange,
  reloadKey = 0,
  onRevoke,
  onBulkRevoke,
  revokingId,
}: {
  /**
   * Les clés de la portée « Mes clés » — chargées d'un bloc par le parent.
   * Ignoré en portée Administration, où la table les demande page par page.
   */
  keys: ApiKey[];
  /** Portée Administration : pagination serveur + colonne Porteur. */
  showSubject: boolean;
  /** Filtres actifs (Administration) — tenus par la page, ses cartes les suivent. */
  filters: Record<string, string>;
  onFiltersChange: (next: Record<string, string>) => void;
  /** Change de valeur pour recharger la page affichée après une révocation. */
  reloadKey?: number;
  /** Demande la révocation d'une clé (le parent confirme + appelle le bon endpoint). */
  onRevoke: (key: ApiKey) => void;
  /**
   * Révoque en MASSE les clés cochées (le parent confirme + boucle + vide la
   * sélection). **Optionnel** : non fourni = sélection multiple désactivée (mode
   * lecture seule / pas de droit de révoquer) — garde-fou RBAC porté par le parent.
   */
  onBulkRevoke?: (keys: ApiKey[], clearSelection: () => void) => void;
  /** Id de la clé en cours de révocation (spinner sur le bouton). */
  revokingId: string | null;
}) {
  const store = useStore();
  const [selected, setSelected] = useState<ApiKey | null>(null);
  // Les capacités ne sont lues qu'en portée Administration : l'endpoint
  // self-service n'est pas au catalogue admin (c'est un controller framework),
  // et il n'a rien à publier — il rend tout, sans fenêtre.
  const caps = showSubject
    ? store.admin.pageCapabilities(ADMIN_KEYS_ENDPOINT)
    : null;
  const filterSignal = JSON.stringify(filters);

  const loader = useCallback(
    async (q: DataGridServerQuery): Promise<DataGridServerResult<ApiKey>> => {
      const params = toPageParams(q, filters);
      try {
        // Le data plane rend `keys` (rétro-compat) là où le contrat de page dit
        // `items` : on recompose la page avant de la traduire, plutôt que
        // d'apprendre au traducteur un nom propre à une ressource.
        const res = await store.api.getAbsolute<
          Omit<IPage<ApiKey>, "items"> & { keys: ApiKey[] }
        >(`${ADMIN_KEYS_ENDPOINT}?${params}`);
        return fromPage({ ...res, items: res.keys ?? [] });
      } catch (e) {
        throw new Error(describeApiKeysError(e), { cause: e });
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
  // En portée « Mes clés », le tri est fait EN MÉMOIRE sur la réponse entière :
  // toutes les colonnes scalaires sont donc triables, sans rien demander à
  // personne. C'est la seule différence de comportement entre les deux régimes.
  const canSort = (field: string) => !showSubject || sortable.has(field);

  const columns = useMemo<DataGridColumn<ApiKey>[]>(() => {
    const cols: DataGridColumn<ApiKey>[] = [
      {
        key: "name",
        header: "Nom",
        sortable: canSort("name"),
        value: (r) => r.name,
        render: (r) => (
          <Text fw={600} size="sm">
            {r.name}
          </Text>
        ),
        size: 170,
      },
      {
        key: "prefix",
        header: "Préfixe",
        value: (r) => r.prefix ?? "",
        render: (r) =>
          r.prefix ? (
            <Code>{r.prefix}…</Code>
          ) : (
            <Text size="sm" c="dimmed">
              —
            </Text>
          ),
        size: 150,
      },
    ];
    if (showSubject) {
      cols.push({
        // La clé de colonne EST le nom du champ trié : `subject` ne voulait rien
        // dire pour le serveur, qui publie `subjectId`. L'en-tête était
        // cliquable et le tri partait sur un champ inexistant.
        key: "subjectId",
        header: "Porteur",
        sortable: canSort("subjectId"),
        value: (r) => r.subjectId,
        render: (r) => (
          <SubjectChip subjectId={r.subjectId} subjectType={r.subjectType} />
        ),
        size: 170,
      });
    }
    cols.push(
      {
        key: "scopes",
        header: "Scopes",
        value: (r) => r.scopes.join(", "),
        render: (r) => <ScopeChips scopes={r.scopes} />,
        size: 200,
      },
      {
        key: "status",
        header: "Statut",
        // En portée Administration, l'état se filtre par la barre au-dessus
        // (vocabulaire publié). En « Mes clés », le filtre de colonne reste
        // local, sur une liste déjà entièrement chargée.
        filterable: !showSubject,
        filterType: "select",
        value: (r) => keyStatus(r),
        render: (r) => <KeyStatusBadge status={keyStatus(r)} />,
        size: 120,
      },
      {
        key: "lastUsedAt",
        header: "Dernière utilisation",
        sortable: canSort("lastUsedAt"),
        value: (r) => r.lastUsedAt ?? 0,
        render: (r) => (
          <Text size="sm" c={r.lastUsedAt === null ? "dimmed" : undefined}>
            {fmtLastUsed(r.lastUsedAt)}
          </Text>
        ),
        size: 160,
      },
      {
        key: "expiresAt",
        header: "Expiration",
        sortable: canSort("expiresAt"),
        value: (r) => r.expiresAt ?? Number.MAX_SAFE_INTEGER,
        render: (r) => (
          <Text size="sm" c={r.expiresAt === null ? "dimmed" : undefined}>
            {fmtExpiry(r.expiresAt)}
          </Text>
        ),
        size: 150,
      },
    );
    return cols;
    // `canSort` dérive de `showSubject` + `sortable` : les deux suffisent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSubject, sortable]);

  const selectedStatus = selected ? keyStatus(selected) : null;

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {showSubject
            ? "Toutes les clés, tous porteurs. Clic sur une ligne pour le détail."
            : `${keys.length} clé(s). Clic sur une ligne pour le détail.`}
        </Text>
        <DocHint
          title="Clés API personnelles (PAT)"
          version={API_KEYS_DOC}
          summary="Un jeton d'accès personnel (Personal Access Token) authentifie un script/une machine avec les droits frais de son porteur. Présenté en en-tête Authorization: Bearer."
          sections={[
            {
              label: "Sécurité",
              body: "Seul le hash (sha256) du secret est stocké : le secret en clair n'est montré qu'à la création, jamais ré-affiché. Révocable à tout moment ; un préfixe public permet de la repérer sans révéler le secret.",
            },
            {
              label: "Statut",
              body: "« Active » = utilisable. « Expirée » = au-delà de sa date (rejetée). « Révoquée » = désactivée manuellement (conservée un temps pour l'audit).",
            },
            {
              label: "Scopes",
              body: "Capacités accordées (sous-ensemble des droits du porteur). Aucun scope = la clé porte tous les droits frais du porteur.",
            },
          ]}
        />
      </Group>

      {!showSubject && keys.length === 0 && (
        <Alert
          variant="light"
          color="gray"
          icon={<IconKey size={18} />}
          title="Aucune clé"
        >
          Vous n'avez aucune clé API. Créez-en une avec « Nouvelle clé ».
        </Alert>
      )}

      {showSubject && (
        <PageFilters
          spec={caps?.filters ?? null}
          value={filters}
          onChange={onFiltersChange}
          labels={KEY_FILTER_LABELS}
        />
      )}

      <DataGrid
        {...(showSubject
          ? ({ mode: "server", loader } as const)
          : ({ mode: "client", data: keys } as const))}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => setSelected(r)}
        dimRow={(r) => keyStatus(r) !== "active"}
        initialSort={canSort("name") ? { key: "name", dir: "asc" } : undefined}
        // Le store de jetons ne relaie `q` à personne : en Administration, la
        // barre ne cherchait que dans les lignes déjà chargées. Les filtres
        // « Porteur » et « État » ci-dessus, eux, interrogent le serveur.
        // En « Mes clés » (liste entière en mémoire), la recherche est honnête.
        searchable={showSubject ? (caps?.search ?? false) : true}
        searchPlaceholder="Rechercher (nom, préfixe, porteur, scope…)"
        resetPageSignal={filterSignal}
        pageSize={25}
        persist={{
          key: showSubject ? "studio.apikeys.admin" : "studio.apikeys.mine",
          storage: "session",
        }}
        emptyMessage="Aucune clé ne correspond."
        selectable={onBulkRevoke !== undefined}
        bulkActions={
          onBulkRevoke
            ? (rows, clear) => {
                // Ne révoque que les clés ENCORE actives (une clé déjà révoquée
                // ou expirée est un no-op côté back ; on n'affiche pas un compteur
                // trompeur). Sélection sans clé active → bouton désactivé.
                const revocable = rows.filter((r) => keyStatus(r) === "active");
                return (
                  <Button
                    color="red"
                    size="xs"
                    variant="light"
                    leftSection={<IconBan size={14} />}
                    disabled={revocable.length === 0}
                    onClick={() => onBulkRevoke(revocable, clear)}
                  >
                    Révoquer {revocable.length} clé
                    {revocable.length > 1 ? "s" : ""}
                  </Button>
                );
              }
            : undefined
        }
      />

      <Modal
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <Group gap="xs">
              <Text fw={700}>Clé « {selected.name} »</Text>
              <KeyStatusBadge status={keyStatus(selected)} />
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
            <Field k="Identifiant">
              <Code>{selected.id}</Code>
            </Field>
            <Field k="Préfixe public">
              {selected.prefix ? (
                <Code>{selected.prefix}…</Code>
              ) : (
                <Text size="sm" c="dimmed">
                  —
                </Text>
              )}
            </Field>
            {showSubject && (
              <Field k="Porteur">
                <SubjectChip
                  subjectId={selected.subjectId}
                  subjectType={selected.subjectType}
                />
              </Field>
            )}
            {selected.tenantId && (
              <Field k="Tenant">
                <Code>{selected.tenantId}</Code>
              </Field>
            )}
            <Field k="Scopes">
              <ScopeChips scopes={selected.scopes} />
            </Field>
            <Field k="Créée le">
              <Text size="sm">{fmtDate(selected.createdAt)}</Text>
            </Field>
            <Field k="Expiration">
              <Text size="sm">
                {selected.expiresAt === null
                  ? "Sans expiration"
                  : `${fmtExpiry(selected.expiresAt)} (${fmtDate(selected.expiresAt)})`}
              </Text>
            </Field>
            <Field k="Dernière utilisation">
              <Text size="sm">
                {selected.lastUsedAt === null
                  ? "Jamais utilisée"
                  : `${fmtLastUsed(selected.lastUsedAt)} (${fmtDate(selected.lastUsedAt)})`}
              </Text>
            </Field>
            {selected.revokedAt !== null && (
              <Field k="Révoquée le">
                <Text size="sm">{fmtDate(selected.revokedAt)}</Text>
              </Field>
            )}

            <Alert
              variant="light"
              color="gray"
              icon={<IconInfoCircle size={16} />}
              mt="xs"
            >
              <Text size="xs">
                Le secret n'est pas affichable : seul son empreinte (sha256) est
                stockée. {showSubject ? "Révoquer" : "Révoquer"} une clé est
                immédiat et définitif — un script qui l'utilise sera rejeté
                (401).
              </Text>
            </Alert>

            {selectedStatus !== "revoked" && (
              <Group justify="flex-end" mt="xs">
                <Button
                  color="red"
                  variant="light"
                  leftSection={<IconBan size={16} />}
                  loading={revokingId === selected.id}
                  // Fermer le détail AVANT d'ouvrir la confirmation : 2 modals
                  // empilées masqueraient la validation (bug vécu).
                  onClick={() => {
                    const k = selected;
                    setSelected(null);
                    onRevoke(k);
                  }}
                >
                  Révoquer cette clé
                </Button>
              </Group>
            )}
          </Stack>
        )}
      </Modal>
    </Stack>
  );
});
