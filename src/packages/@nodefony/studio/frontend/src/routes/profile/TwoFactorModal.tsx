import { useEffect, useState } from "react";
import {
  Modal,
  Stack,
  Group,
  Text,
  Button,
  ActionIcon,
  PinInput,
  Code,
  CopyButton,
  Alert,
  Paper,
  Center,
  Loader,
  Divider,
  SimpleGrid,
  Box,
} from "@mantine/core";
import { IconCopy, IconCheck, IconAlertTriangle } from "@tabler/icons-react";
import { QRCodeSVG } from "qrcode.react";
import { useStore, useNotifications } from "../../stores";
import {
  TOTP_ENROLL_ENDPOINT,
  TOTP_CONFIRM_ENDPOINT,
  describeTotpError,
  validateTotpCode,
  type TotpEnrollment,
  type TotpActivation,
} from "./totpModel";

/** Découpe le secret base32 en groupes de 4 pour une saisie manuelle lisible. */
function formatSecret(secret: string): string {
  return secret.replace(/(.{4})(?=.)/g, "$1 ");
}

/**
 * Modal d'activation 2FA TOTP **two-phase** (calque `CreateApiKeyModal`) :
 *
 *  1. **Enrôlement** : à l'ouverture, le serveur génère un secret (affiché 1×) →
 *     QR code (`otpauthUri`) + clé base32 copiable + saisie du 1ᵉʳ code.
 *  2. **Codes de récupération** : la confirmation active le 2FA et révèle les
 *     codes de secours — montrés **une seule fois**, jamais re-récupérables.
 *
 * Le secret/les codes ne sont jamais persistés côté client ni re-fetchables.
 */
export function TwoFactorModal({
  opened,
  onClose,
  onActivated,
}: {
  opened: boolean;
  onClose: () => void;
  /** Appelé après activation réussie (rafraîchit le statut de la carte). */
  onActivated: () => void;
}) {
  const store = useStore();
  const notifications = useNotifications();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Démarre l'enrôlement à l'ouverture (secret généré serveur, affiché 1×).
  useEffect(() => {
    if (!opened) return;
    let alive = true;
    setLoading(true);
    setError(null);
    setEnrollment(null);
    setRecoveryCodes(null);
    setCode("");
    store.api
      .postAbsolute<TotpEnrollment>(TOTP_ENROLL_ENDPOINT)
      .then((e) => alive && setEnrollment(e))
      .catch((e) => alive && setError(describeTotpError(e)))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [opened, store]);

  const confirm = async (value: string): Promise<void> => {
    const invalid = validateTotpCode(value);
    if (invalid) {
      setError(invalid);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const act = await store.api.postAbsolute<TotpActivation>(
        TOTP_CONFIRM_ENDPOINT,
        { code: value },
      );
      setRecoveryCodes(act.recoveryCodes);
      notifications.notify("success", "Double authentification activée.", {
        source: "api",
      });
      onActivated();
    } catch (e) {
      setError(describeTotpError(e));
      setCode("");
    } finally {
      setSubmitting(false);
    }
  };

  const close = (): void => {
    setEnrollment(null);
    setRecoveryCodes(null);
    setCode("");
    setError(null);
    onClose();
  };

  const phaseRecovery = recoveryCodes !== null;

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="Activer la double authentification (2FA)"
      size="md"
      centered
      closeOnClickOutside={!phaseRecovery}
    >
      {phaseRecovery ? (
        /* ── Phase 2 : codes de récupération (affichés UNE fois) ── */
        <Stack gap="md">
          <Alert
            color="orange"
            icon={<IconAlertTriangle size={16} />}
            title="Conservez ces codes maintenant"
          >
            Chaque code permet UNE connexion si vous perdez votre application
            d'authentification. Ils ne seront plus jamais affichés.
          </Alert>
          <Paper withBorder p="md" radius="sm">
            <SimpleGrid cols={2} spacing="xs" verticalSpacing="xs">
              {recoveryCodes.map((c) => (
                <Code key={c} fz="sm">
                  {c}
                </Code>
              ))}
            </SimpleGrid>
          </Paper>
          <Group justify="space-between">
            <CopyButton value={recoveryCodes.join("\n")} timeout={2000}>
              {({ copied, copy }) => (
                <Button
                  variant="default"
                  leftSection={
                    copied ? <IconCheck size={16} /> : <IconCopy size={16} />
                  }
                  onClick={copy}
                >
                  {copied ? "Copié" : "Copier les codes"}
                </Button>
              )}
            </CopyButton>
            <Button color="brand" onClick={close}>
              J'ai enregistré mes codes
            </Button>
          </Group>
        </Stack>
      ) : loading ? (
        <Center mih={240}>
          <Loader />
        </Center>
      ) : enrollment ? (
        /* ── Phase 1 : QR + clé + 1ᵉʳ code ── */
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            Scannez ce QR code avec votre application d'authentification (Google
            Authenticator, Authy, 1Password…), ou saisissez la clé manuellement.
          </Text>
          <Center>
            <Paper withBorder p="sm" radius="sm" bg="white">
              <QRCodeSVG value={enrollment.otpauthUri} size={184} />
            </Paper>
          </Center>
          <Group justify="center" gap="xs">
            <Code fz="sm">{formatSecret(enrollment.secretBase32)}</Code>
            <CopyButton value={enrollment.secretBase32} timeout={1500}>
              {({ copied, copy }) => (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  aria-label="Copier la clé"
                  onClick={copy}
                >
                  {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                </ActionIcon>
              )}
            </CopyButton>
          </Group>
          <Divider
            label="puis saisissez le code généré"
            labelPosition="center"
          />
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!submitting) void confirm(code);
            }}
          >
            <Stack gap="sm" align="center">
              <PinInput
                length={6}
                type="number"
                inputType="tel"
                inputMode="numeric"
                oneTimeCode
                autoFocus
                value={code}
                disabled={submitting}
                onChange={setCode}
                onComplete={(v) => {
                  if (!submitting) void confirm(v);
                }}
              />
              <Box mih={22} aria-live="polite">
                {error && (
                  <Group gap={6} c="red">
                    <IconAlertTriangle size={15} />
                    <Text size="sm" role="alert">
                      {error}
                    </Text>
                  </Group>
                )}
              </Box>
              <Button
                type="submit"
                fullWidth
                color="brand"
                loading={submitting}
                disabled={code.length !== 6}
              >
                Activer la 2FA
              </Button>
            </Stack>
          </form>
        </Stack>
      ) : (
        /* Échec de l'enrôlement (2FA indisponible, session expirée…) */
        <Stack gap="md">
          <Alert
            color="red"
            icon={<IconAlertTriangle size={16} />}
            title="Activation impossible"
          >
            {error ?? "Le service 2FA est indisponible."}
          </Alert>
          <Group justify="flex-end">
            <Button variant="default" onClick={close}>
              Fermer
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}

export default TwoFactorModal;
