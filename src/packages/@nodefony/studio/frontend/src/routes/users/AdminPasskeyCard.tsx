import { useCallback, useState } from "react";
import {
  Card,
  Group,
  Title,
  Text,
  Button,
  ThemeIcon,
  Stack,
  Badge,
  Modal,
} from "@mantine/core";
import { IconFingerprint, IconTrash } from "@tabler/icons-react";
import { useStore, useNotifications } from "../../stores";
import { useResource } from "../../hooks";
import { fmtProfileDate } from "../profile/profileModel";
import {
  userPasskeysEndpoint,
  userPasskeyEndpoint,
  describeUserAdminError,
  type AdminCredentialView,
} from "./userAdminModel";

/**
 * Carte Passkeys en mode **ADMIN** (cible = `userId`). Périmètre RESET only :
 * lister + **révoquer** les clés d'un autre utilisateur (ex. appareil perdu).
 * PAS d'ajout cross-user (la passkey exige l'authenticator du user → seul lui
 * peut en ajouter). Révocation confirmée + tracée dans l'audit ; owner-scopée
 * côté serveur (404 si la clé n'appartient pas à cet utilisateur).
 */
export function AdminPasskeyCard({ userId }: { userId: string }) {
  const store = useStore();
  const notifications = useNotifications();
  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<{ credentials: AdminCredentialView[] }>(
        userPasskeysEndpoint(userId),
      ),
    [store, userId],
  );
  const { data, reload } = useResource(fetcher);
  const credentials = data?.credentials ?? [];
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const revoke = async (id: string): Promise<void> => {
    setRemoving(true);
    try {
      await store.api.deleteAbsolute<{ ok: true }>(
        userPasskeyEndpoint(userId, id),
      );
      notifications.notify("success", "Passkey révoquée.", { source: "api" });
      setConfirmId(null);
      reload();
    } catch (e) {
      notifications.notify("error", describeUserAdminError(e), {
        source: "api",
      });
    } finally {
      setRemoving(false);
    }
  };

  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="xs" mb="xs">
        <ThemeIcon variant="light" color="brand" size="md">
          <IconFingerprint size={18} />
        </ThemeIcon>
        <Title order={4}>Passkeys & clés de sécurité</Title>
        {credentials.length > 0 && (
          <Badge variant="light" color="brand">
            {credentials.length}
          </Badge>
        )}
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Clés d'accès de l'utilisateur (Touch ID, Windows Hello, FIDO2). Un
        administrateur peut en révoquer (ex. appareil perdu ou volé) ; seul
        l'utilisateur peut en ajouter depuis son appareil.
      </Text>

      {credentials.length === 0 ? (
        <Text size="sm" c="dimmed">
          Aucune passkey enregistrée.
        </Text>
      ) : (
        <Stack gap="xs">
          {credentials.map((c) => (
            <Group key={c.id} justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <ThemeIcon variant="light" color="gray" size="md">
                  <IconFingerprint size={16} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500}>
                      {c.nickname ?? `Passkey ···${c.id.slice(-8)}`}
                    </Text>
                    {c.backupState && (
                      <Badge size="xs" variant="light" color="teal">
                        synchronisée
                      </Badge>
                    )}
                  </Group>
                  <Text size="xs" c="dimmed">
                    Ajoutée le {fmtProfileDate(c.createdAt)}
                    {c.lastUsedAt
                      ? ` · utilisée le ${fmtProfileDate(c.lastUsedAt)}`
                      : " · jamais utilisée"}
                  </Text>
                </div>
              </Group>
              <Button
                color="red"
                variant="subtle"
                size="xs"
                leftSection={<IconTrash size={14} />}
                onClick={() => setConfirmId(c.id)}
              >
                Révoquer
              </Button>
            </Group>
          ))}
        </Stack>
      )}

      <Modal
        opened={confirmId !== null}
        onClose={() => setConfirmId(null)}
        title="Révoquer cette passkey ?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            L'utilisateur ne pourra plus se connecter avec cette clé. Action
            tracée dans le journal d'audit.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirmId(null)}>
              Annuler
            </Button>
            <Button
              color="red"
              loading={removing}
              onClick={() => confirmId && revoke(confirmId)}
            >
              Révoquer
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

export default AdminPasskeyCard;
