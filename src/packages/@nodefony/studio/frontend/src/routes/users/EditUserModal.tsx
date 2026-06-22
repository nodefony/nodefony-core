/**
 * Modal de **modification d'un compte utilisateur** (gouvernance, `ROLE_NODEFONY_ADMIN`).
 *
 * Deux actions INDÉPENDANTES dans la même fenêtre :
 *  1. **Rôles & état** — `roles` / `enabled` / `locked` → PATCH (n'envoie que ce
 *     qui change ; bouton inactif si rien n'a bougé).
 *  2. **Mot de passe** — réinitialisation → POST dédié (le hash n'est jamais lu
 *     ni renvoyé).
 *
 * Les **garde-fous anti-lockout** sont appliqués CÔTÉ SERVEUR (refus 409 : pas
 * d'auto-déchéance admin, pas de déchéance/désactivation du dernier admin actif).
 * Le front se contente d'AVERTIR (l'enforcement n'est jamais côté client).
 * Mutations en HTTP (pipeline CSRF — la Socket reste GET-only).
 */
import { useEffect, useState } from "react";
import {
  Modal,
  Stack,
  Group,
  Text,
  Code,
  TagsInput,
  Switch,
  PasswordInput,
  Button,
  Alert,
  Box,
  Divider,
} from "@mantine/core";
import {
  IconEdit,
  IconAlertTriangle,
  IconKey,
  IconDeviceFloppy,
  IconShieldCheck,
} from "@tabler/icons-react";

import { useStore, useNotifications } from "../../stores";
import { ROLE_NODEFONY_ADMIN } from "../../auth/roles";
import {
  userEndpoint,
  userPasswordEndpoint,
  describeUsersError,
  type UserSummary,
  type UpdateUserInput,
} from "./usersModel";

/** Égalité d'ensembles de rôles (ordre indifférent) — pour la détection « modifié ». */
function sameRoleSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((r) => s.has(r));
}

export function EditUserModal({
  user,
  currentUser,
  roleSuggestions,
  onClose,
  onSaved,
}: {
  /** Compte à éditer (`null` = modal fermée). */
  user: UserSummary | null;
  /** Identifiant de l'admin courant (avertissements anti-lockout « c'est vous »). */
  currentUser: string | null;
  /** Rôles proposés en autocomplétion (suggestions, pas une contrainte). */
  roleSuggestions: string[];
  onClose: () => void;
  /** Appelé après une mutation réussie (recharge la liste). */
  onSaved: () => void;
}) {
  const store = useStore();
  const notifications = useNotifications();

  const [roles, setRoles] = useState<string[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [locked, setLocked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pwd, setPwd] = useState("");
  const [pwdSaving, setPwdSaving] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);

  // Synchronise l'état local quand le modal s'ouvre sur un (nouveau) compte.
  useEffect(() => {
    if (!user) return;
    setRoles(user.roles);
    setEnabled(user.enabled);
    setLocked(user.locked);
    setError(null);
    setPwd("");
    setPwdError(null);
  }, [user]);

  const isSelf =
    user !== null && currentUser !== null && user.identifier === currentUser;
  const wasAdmin = user?.roles.includes(ROLE_NODEFONY_ADMIN) ?? false;
  const willBeAdmin = roles.includes(ROLE_NODEFONY_ADMIN);
  const selfLosesAdmin = isSelf && wasAdmin && !willBeAdmin;
  const selfDisables = isSelf && (!enabled || locked);

  const dirty =
    user !== null &&
    (enabled !== user.enabled ||
      locked !== user.locked ||
      !sameRoleSet(roles, user.roles));

  async function save(): Promise<void> {
    if (!user) return;
    setError(null);
    const body: UpdateUserInput = {};
    if (!sameRoleSet(roles, user.roles)) body.roles = roles;
    if (enabled !== user.enabled) body.enabled = enabled;
    if (locked !== user.locked) body.locked = locked;
    if (Object.keys(body).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await store.api.patchAbsolute(userEndpoint(user.id), body);
      notifications.notify(
        "success",
        `Compte « ${user.identifier} » mis à jour.`,
        { source: "api" },
      );
      onClose();
      onSaved();
    } catch (e) {
      setError(describeUsersError(e));
    } finally {
      setSaving(false);
    }
  }

  async function changePassword(): Promise<void> {
    if (!user) return;
    setPwdError(null);
    if (pwd.length === 0) return;
    setPwdSaving(true);
    try {
      await store.api.postAbsolute(userPasswordEndpoint(user.id), {
        plainPassword: pwd,
      });
      notifications.notify(
        "success",
        `Mot de passe de « ${user.identifier} » réinitialisé.`,
        { source: "api" },
      );
      setPwd("");
    } catch (e) {
      setPwdError(describeUsersError(e));
    } finally {
      setPwdSaving(false);
    }
  }

  const busy = saving || pwdSaving;

  return (
    <Modal
      opened={user !== null}
      onClose={() => (busy ? undefined : onClose())}
      title={
        <Group gap="xs">
          <IconEdit size={18} />
          <Text fw={700}>Modifier le compte</Text>
        </Group>
      }
      centered
      size="lg"
    >
      {user && (
        <Stack gap="md">
          <Group gap="xs">
            <Text size="sm" c="dimmed">
              Compte
            </Text>
            <Code style={{ wordBreak: "break-all" }}>{user.identifier}</Code>
          </Group>

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

          <TagsInput
            label="Rôles"
            description="Suggestions des rôles connus ; vous pouvez en saisir d'autres. Le RBAC serveur tranche."
            data={roleSuggestions}
            value={roles}
            onChange={(v) => {
              setRoles(v);
              if (error) setError(null);
            }}
            clearable
          />

          <Group gap="xl">
            <Switch
              label="Compte actif"
              checked={enabled}
              onChange={(e) => setEnabled(e.currentTarget.checked)}
            />
            <Switch
              label="Verrouillé"
              checked={locked}
              onChange={(e) => setLocked(e.currentTarget.checked)}
            />
          </Group>

          {(selfLosesAdmin || selfDisables || wasAdmin) && (
            <Alert
              variant="light"
              color="orange"
              icon={<IconShieldCheck size={16} />}
            >
              <Text size="xs">
                {selfLosesAdmin
                  ? "⚠ Vous retirez VOTRE rôle administrateur : le serveur refusera (auto-déchéance). "
                  : ""}
                {selfDisables
                  ? "⚠ Vous désactivez/verrouillez VOTRE compte : le serveur refusera (garde-fou). "
                  : ""}
                {wasAdmin && !selfLosesAdmin
                  ? "Ce compte est administrateur : le serveur refuse de déchoir, désactiver ou verrouiller le dernier admin actif."
                  : ""}
              </Text>
            </Alert>
          )}

          <Group justify="flex-end">
            <Button variant="default" disabled={busy} onClick={onClose}>
              Fermer
            </Button>
            <Button
              leftSection={<IconDeviceFloppy size={16} />}
              loading={saving}
              disabled={!dirty}
              onClick={save}
            >
              Enregistrer
            </Button>
          </Group>

          <Divider label="Mot de passe" labelPosition="center" />

          <Box mih={44}>
            {pwdError && (
              <Alert
                role="alert"
                variant="light"
                color="red"
                icon={<IconAlertTriangle size={16} />}
              >
                {pwdError}
              </Alert>
            )}
          </Box>

          <Group align="flex-end" gap="sm" wrap="nowrap">
            <PasswordInput
              style={{ flex: 1 }}
              label="Nouveau mot de passe"
              description="Réinitialise le mot de passe du compte (l'utilisateur pourra se connecter avec)."
              placeholder="••••••••"
              value={pwd}
              onChange={(e) => {
                setPwd(e.currentTarget.value);
                if (pwdError) setPwdError(null);
              }}
            />
            <Button
              variant="light"
              leftSection={<IconKey size={16} />}
              loading={pwdSaving}
              disabled={pwd.length === 0}
              onClick={changePassword}
            >
              Réinitialiser
            </Button>
          </Group>
        </Stack>
      )}
    </Modal>
  );
}
