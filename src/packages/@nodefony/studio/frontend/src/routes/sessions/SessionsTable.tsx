/**
 * Table des sessions actives (DataGrid réutilisable + fiche détail Modal centré).
 * La référence publique (`sess_…`) est affichée — **jamais** l'id de session brut.
 * Les actions destructives (révoquer une session, déconnecter tout un utilisateur)
 * sont déléguées au parent (`onRevoke`/`onRevokeUser`) qui confirme puis appelle
 * le bon endpoint HTTP (pipeline CSRF — la Socket reste GET-only).
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
  IconList,
  IconBan,
  IconLogout,
  IconInfoCircle,
} from "@tabler/icons-react";

import {
  DataGrid,
  DocHint,
  TABS_PANEL_HEIGHT,
  type DataGridColumn,
} from "../../components/ui";
import {
  SESSIONS_DOC,
  fmtDate,
  fmtSince,
  type SessionSummary,
} from "./sessionsModel";
import { AuthBadge, TenantChip, ClientChip } from "./sessionsFormat";

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

export function SessionsTable({
  sessions,
  currentUser,
  showUser,
  onRevoke,
  onRevokeUser,
  onBulkRevoke,
  revokingRef,
}: {
  sessions: SessionSummary[];
  /** Identifiant de l'admin courant (garde-fou « c'est vous » sur logout-everywhere). */
  currentUser: string | null;
  /** Mode Administration : affiche la colonne Utilisateur (cachée en « Mes sessions »). */
  showUser: boolean;
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
}) {
  const [selected, setSelected] = useState<SessionSummary | null>(null);

  const columns = useMemo<DataGridColumn<SessionSummary>[]>(() => {
    const cols: DataGridColumn<SessionSummary>[] = [
      {
        key: "ref",
        header: "Référence",
        sortable: true,
        value: (r) => r.ref,
        render: (r) => <Code>{r.ref}</Code>,
        size: 150,
      },
    ];
    if (showUser) {
      cols.push({
        key: "user",
        header: "Utilisateur",
        sortable: true,
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
        filterable: true,
        filterType: "select",
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
        sortable: true,
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
        header: "Dernière activité",
        sortable: true,
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
  }, [showUser]);

  const isSelf =
    selected !== null &&
    selected.authenticated &&
    currentUser !== null &&
    selected.user === currentUser;

  return (
    <Stack gap="md">
      <Group gap="xs">
        <Text size="sm" c="dimmed">
          {sessions.length} session(s). Clic sur une ligne pour le détail.
        </Text>
        <DocHint
          title="Sessions actives"
          version={SESSIONS_DOC}
          summary="Une session relie un navigateur (ou un client) au serveur via un cookie opaque (auth web BFF). Cette console liste les sessions persistées et permet de les révoquer."
          sections={[
            {
              label: "Référence (sess_…)",
              body: "L'id de session brut (= la valeur du cookie) n'est JAMAIS exposé : le posséder suffirait à usurper la session. On affiche une référence HMAC non réversible, comme « appareils connectés » chez GitHub/Google.",
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

      {sessions.length === 0 && (
        <Alert
          variant="light"
          color="gray"
          icon={<IconList size={18} />}
          title="Aucune session"
        >
          Aucune session active n'est persistée actuellement.
        </Alert>
      )}

      <DataGrid
        mode="client"
        data={sessions}
        columns={columns}
        getRowId={(r) => r.ref}
        onRowClick={(r) => setSelected(r)}
        initialSort={{ key: "updatedAt", dir: "desc" }}
        searchable
        searchPlaceholder="Rechercher (utilisateur, référence, IP, client…)"
        pageSize={25}
        height={TABS_PANEL_HEIGHT}
        persist={{ key: "studio.sessions", storage: "session" }}
        emptyMessage="Aucune session."
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
              {selected.authenticated && selected.user ? (
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
}
