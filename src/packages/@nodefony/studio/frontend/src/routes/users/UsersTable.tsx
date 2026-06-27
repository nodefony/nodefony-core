/**
 * Table des utilisateurs (DataGrid réutilisable). **Clic sur une ligne → ouvre la
 * page de gestion du compte** (`/nodefony/users/{id}` via `onEdit`) : c'est là que
 * se font le détail, l'édition (profil/rôles), les facteurs forts et la zone
 * danger. La suppression EN MASSE (cases à cocher) reste déléguée au parent
 * (confirmation anti-lockout + endpoint HTTP CSRF). **Jamais** le hash (absent du DTO).
 */
import { useMemo } from "react";
import { Stack, Group, Text, Alert, Button } from "@mantine/core";
import { IconUsers, IconTrash } from "@tabler/icons-react";

import { DataGrid, DocHint, type DataGridColumn } from "../../components/ui";
import { USERS_DOC, fmtDate, fmtSince, type UserSummary } from "./usersModel";
import {
  StatusBadge,
  RoleBadges,
  ProviderChips,
  TenantChip,
} from "./usersFormat";

export function UsersTable({
  users,
  onEdit,
  onBulkDelete,
}: {
  users: UserSummary[];
  /** Clic sur une ligne → ouvre la page de gestion du compte. */
  onEdit: (user: UserSummary) => void;
  /** Supprime en MASSE les comptes cochés (le parent confirme + boucle + vide la sélection). */
  onBulkDelete: (users: UserSummary[], clearSelection: () => void) => void;
}) {
  const columns = useMemo<DataGridColumn<UserSummary>[]>(
    () => [
      {
        key: "identifier",
        header: "Identifiant",
        sortable: true,
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
        filterable: true,
        filterType: "select",
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
        sortable: true,
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
        sortable: true,
        value: (r) => r.updatedAt ?? 0,
        render: (r) => (
          <Text size="sm" c={r.updatedAt === null ? "dimmed" : undefined}>
            {fmtSince(r.updatedAt)}
          </Text>
        ),
        size: 150,
      },
    ],
    [],
  );

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {users.length} utilisateur(s). Clic sur une ligne pour gérer le
          compte.
        </Text>
        <DocHint
          title="Utilisateurs"
          version={USERS_DOC}
          summary="Les comptes utilisateurs du serveur (source d'identité du firewall). Clic sur une ligne pour ouvrir la page de gestion du compte (profil, sécurité, zone danger)."
          sections={[
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

      {users.length === 0 && (
        <Alert
          variant="light"
          color="gray"
          icon={<IconUsers size={18} />}
          title="Aucun utilisateur"
        >
          Aucun compte utilisateur n'est enregistré actuellement.
        </Alert>
      )}

      <DataGrid
        mode="client"
        data={users}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => onEdit(r)}
        initialSort={{ key: "identifier", dir: "asc" }}
        searchable
        searchPlaceholder="Rechercher (identifiant, rôle, connexion…)"
        pageSize={25}
        persist={{ key: "studio.users", storage: "session" }}
        emptyMessage="Aucun utilisateur."
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
}
