/**
 * Table des clés API (DataGrid réutilisable + fiche détail Modal centré). Servie
 * dans les DEUX modes : « mes clés » (utilisateur) et Administration (colonne
 * Porteur via `showSubject`). La révocation est déléguée au parent (`onRevoke`)
 * qui connaît le mode → choisit le bon endpoint (DELETE self vs POST admin).
 */
import { useMemo, useState } from "react";
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

import { DataGrid, DocHint, type DataGridColumn } from "../../components/ui";
import {
  API_KEYS_DOC,
  fmtDate,
  fmtExpiry,
  fmtLastUsed,
  keyStatus,
  type ApiKey,
} from "./apiKeysModel";
import { KeyStatusBadge, ScopeChips, SubjectChip } from "./apiKeysFormat";

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

export function ApiKeysTable({
  keys,
  showSubject,
  onRevoke,
  onBulkRevoke,
  revokingId,
}: {
  keys: ApiKey[];
  /** Mode Administration : affiche la colonne Porteur. */
  showSubject: boolean;
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
  const [selected, setSelected] = useState<ApiKey | null>(null);

  const columns = useMemo<DataGridColumn<ApiKey>[]>(() => {
    const cols: DataGridColumn<ApiKey>[] = [
      {
        key: "name",
        header: "Nom",
        sortable: true,
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
        key: "subject",
        header: "Porteur",
        sortable: true,
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
        filterable: true,
        filterType: "select",
        value: (r) => keyStatus(r),
        render: (r) => <KeyStatusBadge status={keyStatus(r)} />,
        size: 120,
      },
      {
        key: "lastUsedAt",
        header: "Dernière utilisation",
        sortable: true,
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
        sortable: true,
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
  }, [showSubject]);

  const selectedStatus = selected ? keyStatus(selected) : null;

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {keys.length} clé(s){showSubject ? ", tous porteurs" : ""}. Clic sur
          une ligne pour le détail.
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

      {keys.length === 0 && (
        <Alert
          variant="light"
          color="gray"
          icon={<IconKey size={18} />}
          title="Aucune clé"
        >
          {showSubject
            ? "Aucune clé API n'existe dans le système."
            : "Vous n'avez aucune clé API. Créez-en une avec « Nouvelle clé »."}
        </Alert>
      )}

      <DataGrid
        mode="client"
        data={keys}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => setSelected(r)}
        initialSort={{ key: "name", dir: "asc" }}
        searchable
        searchPlaceholder="Rechercher (nom, préfixe, porteur, scope…)"
        pageSize={25}
        persist={{
          key: showSubject ? "studio.apikeys.admin" : "studio.apikeys.mine",
          storage: "session",
        }}
        emptyMessage="Aucune clé."
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
}
