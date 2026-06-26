import { useCallback, useState } from "react";
import {
  Card,
  Group,
  Title,
  Text,
  Button,
  Badge,
  ThemeIcon,
} from "@mantine/core";
import { IconShieldLock, IconShieldOff } from "@tabler/icons-react";
import { useStore, useNotifications } from "../../stores";
import { useResource } from "../../hooks";
import { TwoFactorModal } from "./TwoFactorModal";
import {
  TOTP_STATUS_ENDPOINT,
  TOTP_DISABLE_ENDPOINT,
  describeTotpError,
  type TotpStatus,
} from "./totpModel";

/**
 * Carte 2FA self-service de la page Profil — statut + activation (modal QR) /
 * désactivation. Le sujet est TOUJOURS l'utilisateur courant (anti-IDOR côté
 * serveur via la session BFF). Rendue uniquement pour un compte à mot de passe
 * (le 2FA est le 2ᵉ facteur du login mot de passe — un compte OAuth-only ne
 * passe jamais par ce flux).
 */
export function TwoFactorCard() {
  const store = useStore();
  const notifications = useNotifications();
  const fetcher = useCallback(
    () => store.api.getAbsolute<TotpStatus>(TOTP_STATUS_ENDPOINT),
    [store],
  );
  const { data, reload } = useResource(fetcher);
  const [modalOpen, setModalOpen] = useState(false);
  const [disabling, setDisabling] = useState(false);

  const enabled = data?.enabled ?? false;
  const remaining = data?.recoveryCodesRemaining ?? 0;

  const disable = async (): Promise<void> => {
    setDisabling(true);
    try {
      await store.api.postAbsolute<{ ok: true }>(TOTP_DISABLE_ENDPOINT);
      notifications.notify("success", "Double authentification désactivée.", {
        source: "api",
      });
      reload();
    } catch (e) {
      notifications.notify("error", describeTotpError(e), { source: "api" });
    } finally {
      setDisabling(false);
    }
  };

  return (
    <Card withBorder padding="lg" radius="md" mt="md">
      <Group gap="xs" mb="xs">
        <ThemeIcon variant="light" color="brand" size="md">
          <IconShieldLock size={18} />
        </ThemeIcon>
        <Title order={4}>Authentification à deux facteurs (2FA)</Title>
        {enabled && (
          <Badge color="teal" variant="light">
            Activée
          </Badge>
        )}
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Ajoutez une seconde vérification à la connexion : un code temporaire
        généré par votre application d'authentification (TOTP, RFC 6238).{" "}
        {enabled
          ? `${remaining} code(s) de récupération restant(s).`
          : "Recommandé — protège votre compte même si votre mot de passe est compromis."}
      </Text>
      <Group justify="flex-end">
        {enabled ? (
          <Button
            color="red"
            variant="light"
            leftSection={<IconShieldOff size={16} />}
            loading={disabling}
            onClick={disable}
          >
            Désactiver la 2FA
          </Button>
        ) : (
          <Button
            color="brand"
            leftSection={<IconShieldLock size={16} />}
            onClick={() => setModalOpen(true)}
          >
            Activer la 2FA
          </Button>
        )}
      </Group>
      <TwoFactorModal
        opened={modalOpen}
        onClose={() => setModalOpen(false)}
        onActivated={reload}
      />
    </Card>
  );
}

export default TwoFactorCard;
