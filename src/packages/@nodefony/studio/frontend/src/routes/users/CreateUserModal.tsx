/**
 * Modal de **création d'un compte utilisateur** (gouvernance, `ROLE_NODEFONY_ADMIN`).
 *
 * Formulaire simple (≠ API Keys : pas de secret révélé) : identifiant requis,
 * mot de passe **optionnel** (compte social/passkey ou à définir plus tard),
 * rôles suggérés (saisie libre tolérée — le RBAC serveur tranche). La création
 * passe en POST HTTP (mutation → pipeline complet, CSRF — la Socket reste GET-only).
 *
 * Sécurité : le mot de passe saisi n'est jamais loggé ; à la fermeture l'état est
 * purgé. La redaction du retour (jamais de hash) est garantie côté serveur.
 */
import { useState } from "react";
import {
  Modal,
  Stack,
  Group,
  Text,
  TextInput,
  PasswordInput,
  TagsInput,
  Button,
  Alert,
  Box,
} from "@mantine/core";
import { IconUserPlus, IconAlertTriangle } from "@tabler/icons-react";

import { useStore, useNotifications } from "../../stores";
import {
  USERS_LIST_ENDPOINT,
  describeUsersError,
  type CreateUserInput,
  type UserSummary,
} from "./usersModel";

export function CreateUserModal({
  opened,
  onClose,
  roleSuggestions,
  onCreated,
}: {
  opened: boolean;
  onClose: () => void;
  /** Rôles proposés en autocomplétion (suggestions, pas une contrainte). */
  roleSuggestions: string[];
  /** Appelé après une création réussie (recharge la liste). */
  onCreated: () => void;
}) {
  const store = useStore();
  const notifications = useNotifications();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [roles, setRoles] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset(): void {
    setIdentifier("");
    setPassword("");
    setRoles([]);
    setError(null);
    setSubmitting(false);
  }

  function handleClose(): void {
    reset();
    onClose();
  }

  async function submit(): Promise<void> {
    setError(null);
    const id = identifier.trim();
    if (id.length === 0) {
      setError("Renseignez un identifiant (email ou login).");
      return;
    }
    setSubmitting(true);
    try {
      const body: CreateUserInput = { identifier: id };
      if (password) body.plainPassword = password;
      if (roles.length > 0) body.roles = roles;
      const created = await store.api.postAbsolute<UserSummary>(
        USERS_LIST_ENDPOINT,
        body,
      );
      notifications.notify(
        "success",
        `Compte « ${created.identifier} » créé.`,
        {
          source: "api",
        },
      );
      reset();
      onClose();
      onCreated();
    } catch (e) {
      const status = (e as { status?: number } | null)?.status;
      setError(
        status === 409
          ? "Un compte avec cet identifiant existe déjà."
          : describeUsersError(e),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => (submitting ? undefined : handleClose())}
      title={
        <Group gap="xs">
          <IconUserPlus size={18} />
          <Text fw={700}>Nouvel utilisateur</Text>
        </Group>
      }
      centered
      size="lg"
    >
      <Stack gap="md">
        <Box mih={44}>
          {error && (
            <Alert
              role="alert"
              variant="light"
              color="red"
              icon={<IconAlertTriangle size={16} />}
            >
              {error}
            </Alert>
          )}
        </Box>

        <TextInput
          label="Identifiant"
          description="Email ou login — la clé de connexion du compte."
          placeholder="alice@example.com"
          required
          value={identifier}
          maxLength={200}
          onChange={(e) => {
            setIdentifier(e.currentTarget.value);
            if (error) setError(null);
          }}
          data-autofocus
        />

        <PasswordInput
          label="Mot de passe (optionnel)"
          description="Laissez vide pour un compte sans mot de passe (connexion sociale / passkey, ou à définir plus tard via « Modifier »)."
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
        />

        <TagsInput
          label="Rôles (optionnel)"
          description="Suggestions des rôles connus ; vous pouvez en saisir d'autres. Vide = compte de base."
          placeholder="ROLE_USER…"
          data={roleSuggestions}
          value={roles}
          onChange={setRoles}
          clearable
        />

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={handleClose}>
            Annuler
          </Button>
          <Button
            leftSection={<IconUserPlus size={16} />}
            loading={submitting}
            onClick={submit}
          >
            Créer le compte
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
