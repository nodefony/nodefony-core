/**
 * Table des utilisateurs (DataGrid réutilisable + fiche détail Modal centré).
 * **Jamais** le hash de mot de passe (le DTO back ne le porte pas). Les actions
 * destructives (supprimer un compte, supprimer N comptes) sont déléguées au
 * parent (`onDelete`/`onBulkDelete`) qui confirme (anti-lockout) puis appelle
 * l'endpoint HTTP (pipeline CSRF).
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
import {
  IconUsers,
  IconTrash,
  IconEdit,
  IconInfoCircle,
  IconShieldCheck,
} from "@tabler/icons-react";

import { DataGrid, DocHint, type DataGridColumn } from "../../components/ui";
import {
  ADMIN_ROLE,
  USERS_DOC,
  fmtDate,
  fmtSince,
  type UserSummary,
} from "./usersModel";
import {
  StatusBadge,
  RoleBadges,
  ProviderChips,
  TenantChip,
} from "./usersFormat";

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

export function UsersTable({
  users,
  currentUser,
  onEdit,
  onDelete,
  onBulkDelete,
  deletingId,
}: {
  users: UserSummary[];
  /** Identifiant de l'admin courant (garde-fou « c'est vous » sur suppression). */
  currentUser: string | null;
  /** Demande l'édition d'UN utilisateur (le parent ouvre la modal d'édition). */
  onEdit: (user: UserSummary) => void;
  /** Demande la suppression d'UN utilisateur (le parent confirme + appelle l'endpoint). */
  onDelete: (user: UserSummary) => void;
  /** Supprime en MASSE les comptes cochés (le parent confirme + boucle + vide la sélection). */
  onBulkDelete: (users: UserSummary[], clearSelection: () => void) => void;
  /** Id de l'utilisateur en cours de suppression (spinner sur le bouton). */
  deletingId: string | null;
}) {
  const [selected, setSelected] = useState<UserSummary | null>(null);

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

  const isSelf =
    selected !== null &&
    currentUser !== null &&
    selected.identifier === currentUser;
  const isAdmin = selected !== null && selected.roles.includes(ADMIN_ROLE);

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {users.length} utilisateur(s). Clic sur une ligne pour le détail.
        </Text>
        <DocHint
          title="Utilisateurs"
          version={USERS_DOC}
          summary="Les comptes utilisateurs du serveur (source d'identité du firewall). Cette console liste les comptes et permet de les supprimer."
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
        onRowClick={(r) => setSelected(r)}
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

      <Modal
        opened={selected !== null}
        onClose={() => setSelected(null)}
        title={
          selected ? (
            <Group gap="xs">
              <Text fw={700} style={{ wordBreak: "break-all" }}>
                {selected.identifier}
              </Text>
              <StatusBadge
                enabled={selected.enabled}
                locked={selected.locked}
              />
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
              <Text size="sm" fw={600} style={{ wordBreak: "break-all" }}>
                {selected.identifier}
              </Text>
            </Field>
            <Field k="Identifiant technique">
              <Code>{selected.id}</Code>
            </Field>
            <Field k="Rôles">
              <RoleBadges roles={selected.roles} max={6} />
            </Field>
            <Field k="Profil actif">
              {selected.currentRole ? (
                <Code>{selected.currentRole}</Code>
              ) : (
                <Text size="sm" c="dimmed">
                  —
                </Text>
              )}
            </Field>
            <Field k="Connexion">
              <ProviderChips providers={selected.socialProviders} />
            </Field>
            <Field k="Tenant">
              <TenantChip tenantId={selected.tenantId} />
            </Field>
            <Field k="Créé le">
              <Text size="sm">{fmtDate(selected.createdAt)}</Text>
            </Field>
            <Field k="Dernière mise à jour">
              <Text size="sm">
                {selected.updatedAt === null
                  ? "—"
                  : `${fmtSince(selected.updatedAt)} (${fmtDate(selected.updatedAt)})`}
              </Text>
            </Field>

            <Alert
              variant="light"
              color={isSelf || isAdmin ? "orange" : "gray"}
              icon={
                isAdmin ? (
                  <IconShieldCheck size={16} />
                ) : (
                  <IconInfoCircle size={16} />
                )
              }
              mt="xs"
            >
              <Text size="xs">
                Supprimer un compte est immédiat et définitif — ses sessions et
                jetons (PAT) sont révoqués en cascade. Le hash de mot de passe
                n'est jamais exposé.
                {isSelf
                  ? " ⚠ C'est VOTRE compte : le serveur refusera la suppression (garde-fou)."
                  : isAdmin
                    ? " Ce compte est administrateur : le serveur refusera de supprimer le dernier admin actif."
                    : ""}
              </Text>
            </Alert>

            {/* Fermer le détail AVANT d'ouvrir la confirmation : 2 modals
                empilées masqueraient la validation (bug vécu sur API Keys). */}
            <Group justify="flex-end" mt="xs">
              <Button
                variant="light"
                leftSection={<IconEdit size={16} />}
                onClick={() => {
                  const u = selected;
                  setSelected(null);
                  onEdit(u);
                }}
              >
                Modifier
              </Button>
              <Button
                color="red"
                variant="light"
                leftSection={<IconTrash size={16} />}
                loading={deletingId === selected.id}
                onClick={() => {
                  const u = selected;
                  setSelected(null);
                  onDelete(u);
                }}
              >
                Supprimer ce compte
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>
    </Stack>
  );
}
