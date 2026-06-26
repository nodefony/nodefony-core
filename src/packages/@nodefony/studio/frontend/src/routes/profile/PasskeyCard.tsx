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
} from "@mantine/core";
import { IconFingerprint, IconTrash } from "@tabler/icons-react";
import { useStore, useAuth, useNotifications } from "../../stores";
import { useResource } from "../../hooks";
import { fmtProfileDate } from "./profileModel";

const WEBAUTHN_CREDENTIALS_ENDPOINT =
  "/nodefony/security/api/webauthn/credentials";

/** Vue miroir d'une passkey (DTO redacté serveur — jamais la clé publique). */
interface PasskeySummary {
  id: string;
  transports: string[];
  backupState: boolean;
  createdAt: number;
  lastUsedAt: number | null;
}

/** Traduit une erreur WebAuthn (navigateur ou serveur) en message FR. */
function describePasskeyError(e: unknown): string {
  if (e instanceof Error) {
    // rpId WebAuthn refuse une adresse IP (ex. 127.0.0.1) → ouvrir via localhost.
    if (e.name === "SecurityError") {
      return "Passkey indisponible sur cette adresse. Ouvrez Studio via https://localhost:5152 (une IP comme 127.0.0.1 est refusée).";
    }
    if (e.name === "InvalidStateError") {
      return "Cette empreinte est déjà enregistrée sur ce compte.";
    }
  }
  const status = (e as { status?: number }).status;
  if (status === 401) return "Session expirée — reconnectez-vous.";
  if (status === 404) return "Passkey introuvable (déjà supprimée ?).";
  return "Opération échouée. Réessayez.";
}

/**
 * Carte self-service **Passkeys / empreintes** (WebAuthn, P6 J9) de la page
 * Profil — **lister / ajouter / supprimer** ses clés d'accès (Touch ID, Windows
 * Hello, clé FIDO2), liées au compte courant. Tout est scopé CÔTÉ SERVEUR à
 * l'identité de l'appelant (anti-IDOR : on ne supprime jamais la clé d'autrui).
 *
 * Ajout = défi serveur → invite biométrique du navigateur → vérification
 * (`AuthService.registerPasskey`). Suppression = `DELETE …/credentials/{id}`.
 */
export function PasskeyCard() {
  const store = useStore();
  const auth = useAuth();
  const notifications = useNotifications();
  const fetcher = useCallback(
    () =>
      store.api.getAbsolute<{ credentials: PasskeySummary[] }>(
        WEBAUTHN_CREDENTIALS_ENDPOINT,
      ),
    [store],
  );
  const { data, reload } = useResource(fetcher);
  const credentials = data?.credentials ?? [];
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const addPasskey = async (): Promise<void> => {
    setAdding(true);
    try {
      await auth.registerPasskey();
      notifications.notify("success", "Empreinte / passkey ajoutée.", {
        source: "api",
      });
      reload();
    } catch (e) {
      // L'utilisateur a fermé/annulé l'invite biométrique → état inchangé.
      if (
        e instanceof Error &&
        (e.name === "NotAllowedError" || e.name === "AbortError")
      ) {
        return;
      }
      notifications.notify("error", describePasskeyError(e), { source: "api" });
    } finally {
      setAdding(false);
    }
  };

  const removePasskey = async (id: string): Promise<void> => {
    setRemoving(id);
    try {
      await store.api.deleteAbsolute<{ ok: true }>(
        `${WEBAUTHN_CREDENTIALS_ENDPOINT}/${encodeURIComponent(id)}`,
      );
      notifications.notify("success", "Passkey supprimée.", { source: "api" });
      reload();
    } catch (e) {
      notifications.notify("error", describePasskeyError(e), { source: "api" });
    } finally {
      setRemoving(null);
    }
  };

  return (
    <Card withBorder padding="lg" radius="md" mt="md">
      <Group gap="xs" mb="xs">
        <ThemeIcon variant="light" color="brand" size="md">
          <IconFingerprint size={18} />
        </ThemeIcon>
        <Title order={4}>Empreintes & clés de sécurité (passkeys)</Title>
        {credentials.length > 0 && (
          <Badge variant="light" color="brand">
            {credentials.length}
          </Badge>
        )}
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Connectez-vous sans mot de passe (Touch ID, Windows Hello, clé FIDO2) —
        plus rapide et résistant à l'hameçonnage. La clé privée ne quitte jamais
        votre appareil.
      </Text>

      {credentials.length === 0 ? (
        <Text size="sm" c="dimmed" mb="md">
          Aucune passkey enregistrée pour l'instant.
        </Text>
      ) : (
        <Stack gap="xs" mb="md">
          {credentials.map((c) => (
            <Group key={c.id} justify="space-between" wrap="nowrap">
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <ThemeIcon variant="light" color="gray" size="md">
                  <IconFingerprint size={16} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Group gap={6} wrap="nowrap">
                    <Text size="sm" fw={500}>
                      Passkey ···{c.id.slice(-8)}
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
                loading={removing === c.id}
                onClick={() => removePasskey(c.id)}
              >
                Supprimer
              </Button>
            </Group>
          ))}
        </Stack>
      )}

      <Group justify="flex-end">
        <Button
          color="brand"
          leftSection={<IconFingerprint size={16} />}
          loading={adding}
          onClick={addPasskey}
        >
          Ajouter une empreinte
        </Button>
      </Group>
    </Card>
  );
}

export default PasskeyCard;
