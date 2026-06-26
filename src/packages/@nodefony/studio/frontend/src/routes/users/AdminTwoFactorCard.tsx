import { useCallback, useState } from "react";
import {
  Card,
  Group,
  Title,
  Text,
  Button,
  Badge,
  ThemeIcon,
  Modal,
  Stack,
} from "@mantine/core";
import { IconShieldLock, IconShieldOff } from "@tabler/icons-react";
import { useStore, useNotifications } from "../../stores";
import { useResource } from "../../hooks";
import {
  userTotpEndpoint,
  userTotpDisableEndpoint,
  describeUserAdminError,
  type AdminTotpStatus,
} from "./userAdminModel";

/**
 * Carte 2FA TOTP en mode **ADMIN** (cible = `userId`, pas l'appelant). Périmètre
 * RESET only : lecture du statut + **désactivation** (reset, ex. appareil perdu).
 * PAS d'activation cross-user (le secret se scanne sur l'appareil du user → seul
 * lui peut l'armer). Désactivation confirmée + tracée dans l'audit côté serveur.
 */
export function AdminTwoFactorCard({ userId }: { userId: string }) {
  const store = useStore();
  const notifications = useNotifications();
  const fetcher = useCallback(
    () => store.api.getAbsolute<AdminTotpStatus>(userTotpEndpoint(userId)),
    [store, userId],
  );
  const { data, reload } = useResource(fetcher);
  const [confirm, setConfirm] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const enabled = data?.enabled ?? false;
  const remaining = data?.recoveryCodesRemaining ?? 0;

  const disable = async (): Promise<void> => {
    setDisabling(true);
    try {
      await store.api.postAbsolute<{ ok: true }>(
        userTotpDisableEndpoint(userId),
      );
      notifications.notify("success", "2FA de l'utilisateur désactivée.", {
        source: "api",
      });
      setConfirm(false);
      reload();
    } catch (e) {
      notifications.notify("error", describeUserAdminError(e), {
        source: "api",
      });
    } finally {
      setDisabling(false);
    }
  };

  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="xs" mb="xs">
        <ThemeIcon variant="light" color="brand" size="md">
          <IconShieldLock size={18} />
        </ThemeIcon>
        <Title order={4}>Double authentification (2FA)</Title>
        <Badge color={enabled ? "teal" : "gray"} variant="light">
          {enabled ? "Activée" : "Désactivée"}
        </Badge>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        {enabled
          ? `2FA active — ${remaining} code(s) de récupération restant(s). Vous pouvez la réinitialiser (ex. appareil perdu) ; l'utilisateur devra ensuite la réactiver lui-même.`
          : "2FA non activée. Seul l'utilisateur peut l'activer (scan d'un QR code sur son appareil) — un administrateur ne peut que la désactiver."}
      </Text>
      <Group justify="flex-end">
        <Button
          color="red"
          variant="light"
          leftSection={<IconShieldOff size={16} />}
          disabled={!enabled}
          onClick={() => setConfirm(true)}
        >
          Désactiver la 2FA
        </Button>
      </Group>

      <Modal
        opened={confirm}
        onClose={() => setConfirm(false)}
        title="Désactiver la 2FA de cet utilisateur ?"
        centered
      >
        <Stack gap="md">
          <Text size="sm">
            Le second facteur sera retiré : l'utilisateur se connectera avec son
            seul mot de passe jusqu'à ce qu'il réactive la 2FA. Action tracée
            dans le journal d'audit.
          </Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirm(false)}>
              Annuler
            </Button>
            <Button color="red" loading={disabling} onClick={disable}>
              Désactiver
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Card>
  );
}

export default AdminTwoFactorCard;
