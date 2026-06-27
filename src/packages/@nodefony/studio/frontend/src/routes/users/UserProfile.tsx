/**
 * Page profil **ADMIN** d'un utilisateur (`/nodefony/users/:id`, P6.15). Un
 * administrateur gère le compte d'un AUTRE utilisateur, en 3 onglets :
 *
 *  - **Profil** : avatar + identité d'affichage (claims OIDC) + rôles ;
 *  - **Sécurité** : reset du mot de passe + 2FA (désactiver) + passkeys (révoquer) ;
 *  - **Zone danger** : activer/désactiver, verrouiller, supprimer le compte.
 *
 * Garde-fous **anti-lockout** appliqués CÔTÉ SERVEUR (409) et reflétés en UI
 * (actions désactivées sur soi-même). Mutations = HTTP (CSRF) ; data plane
 * identité `@nodefony/user` + facteurs forts `@nodefony/security`.
 */
import { useCallback, useState } from "react";
import { observer } from "mobx-react-lite";
import { useParams, useNavigate } from "react-router-dom";
import {
  Tabs,
  Card,
  Grid,
  Stack,
  Group,
  Title,
  Text,
  Badge,
  Button,
  TagsInput,
  PasswordInput,
  ThemeIcon,
  Switch,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconArrowLeft,
  IconRefresh,
  IconUser,
  IconShieldLock,
  IconAlertTriangle,
  IconKey,
  IconLock,
  IconTrash,
  IconDeviceFloppy,
  IconPlugConnected,
} from "@tabler/icons-react";

import { useStore, useAuth, useNotifications } from "../../stores";
import { useResource } from "../../hooks";
import { PageLayout, DataState, KeyValue } from "../../components/ui";
import { StickyTabsList } from "../../components/ui/PageLayout";
import { fmtDate } from "./usersModel";
import { StatusBadge } from "./usersFormat";
import { UserAvatar } from "./AvatarUpload";
import { ProfileFields } from "./ProfileFields";
import { AdminTwoFactorCard } from "./AdminTwoFactorCard";
import { AdminPasskeyCard } from "./AdminPasskeyCard";
import {
  userEndpoint,
  userPasswordEndpoint,
  describeUserAdminError,
  type AdminUserDetail,
  type UserProfileData,
} from "./userAdminModel";

/** Rôles standard proposés en autocomplétion (le serveur valide ; saisie libre tolérée). */
const KNOWN_ROLES = [
  "ROLE_USER",
  "ROLE_DEV",
  "ROLE_ADMIN",
  "ROLE_SUPERVISOR",
  "ROLE_AUDITOR",
  "ROLE_NODEFONY_ADMIN",
];
const MIN_PASSWORD_LENGTH = 8;

// ── Carte IDENTITÉ (onglet Profil) ───────────────────────────────────────────
function IdentityCard({ detail }: { detail: AdminUserDetail }) {
  return (
    <Card withBorder padding="lg" radius="md" h="100%">
      <Group gap="xs" mb="md">
        <ThemeIcon variant="light" size="md">
          <IconUser size={18} />
        </ThemeIcon>
        <Title order={4}>Identité</Title>
      </Group>
      <Stack gap="xs">
        <KeyValue k="Identifiant" v={detail.identifier} mono />
        <KeyValue k="Identifiant technique" v={detail.id} mono />
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm" c="dimmed">
            Statut
          </Text>
          <StatusBadge enabled={detail.enabled} locked={detail.locked} />
        </Group>
        {detail.currentRole && (
          <KeyValue k="Rôle actif" v={detail.currentRole} />
        )}
        {detail.createdAt != null && (
          <KeyValue k="Créé le" v={fmtDate(detail.createdAt)} />
        )}
        {detail.updatedAt != null && (
          <KeyValue k="Modifié le" v={fmtDate(detail.updatedAt)} />
        )}
      </Stack>
    </Card>
  );
}

// ── Carte CONNEXIONS EXTERNES (onglet Profil) ────────────────────────────────
function ExternalConnectionsCard({
  providers,
}: {
  providers: AdminUserDetail["socialProviders"];
}) {
  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="xs" mb="md">
        <ThemeIcon variant="light" size="md">
          <IconPlugConnected size={18} />
        </ThemeIcon>
        <Title order={4}>Connexions externes</Title>
      </Group>
      {providers.length === 0 ? (
        <Text c="dimmed" size="sm">
          Aucun compte externe lié — connexion par mot de passe.
        </Text>
      ) : (
        <Stack gap="xs">
          {providers.map((p) => (
            <Group
              key={`${p.provider}:${p.providerId}`}
              justify="space-between"
            >
              <Group gap="xs">
                <Badge variant="light">{p.provider}</Badge>
                <Text size="sm" c="dimmed" ff="monospace">
                  {p.providerId}
                </Text>
              </Group>
              <Text size="xs" c="dimmed">
                {p.createdAt != null ? fmtDate(p.createdAt) : "—"}
              </Text>
            </Group>
          ))}
        </Stack>
      )}
    </Card>
  );
}

// ── Carte ROLES (onglet Profil) ──────────────────────────────────────────────
function RolesCard({
  initial,
  isSelf,
  saving,
  onSave,
}: {
  initial: string[];
  isSelf: boolean;
  saving: boolean;
  onSave: (roles: string[]) => void;
}) {
  const [roles, setRoles] = useState<string[]>(initial);
  const dirty = JSON.stringify(roles) !== JSON.stringify(initial);
  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="xs" mb="md">
        <ThemeIcon variant="light" size="md">
          <IconShieldLock size={18} />
        </ThemeIcon>
        <Title order={4}>Rôles</Title>
      </Group>
      <TagsInput
        label="Rôles attribués"
        description="Déterminent les accès. Un rôle inconnu reste sans effet."
        data={KNOWN_ROLES}
        value={roles}
        onChange={setRoles}
        clearable
      />
      {isSelf && (
        <Text size="xs" c="dimmed" mt="xs">
          Vous ne pouvez pas retirer votre propre rôle d'administrateur.
        </Text>
      )}
      <Group justify="flex-end" mt="md">
        <Button
          leftSection={<IconDeviceFloppy size={16} />}
          loading={saving}
          disabled={!dirty}
          onClick={() => onSave(roles)}
        >
          Enregistrer les rôles
        </Button>
      </Group>
    </Card>
  );
}

// ── Carte reset MOT DE PASSE (onglet Sécurité) ───────────────────────────────
function PasswordResetCard({ userId }: { userId: string }) {
  const store = useStore();
  const notifications = useNotifications();
  const [pwd, setPwd] = useState("");
  const [saving, setSaving] = useState(false);

  const reset = async (): Promise<void> => {
    setSaving(true);
    try {
      await store.api.postAbsolute<{ ok: true }>(userPasswordEndpoint(userId), {
        plainPassword: pwd,
      });
      notifications.notify("success", "Mot de passe réinitialisé.", {
        source: "api",
      });
      setPwd("");
    } catch (e) {
      notifications.notify("error", describeUserAdminError(e), {
        source: "api",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card withBorder padding="lg" radius="md">
      <Group gap="xs" mb="xs">
        <ThemeIcon variant="light" size="md">
          <IconKey size={18} />
        </ThemeIcon>
        <Title order={4}>Mot de passe</Title>
      </Group>
      <Text size="sm" c="dimmed" mb="md">
        Réinitialisation FORCÉE (l'ancien mot de passe n'est pas requis — c'est
        une action d'administration). Communiquez le nouveau mot de passe à
        l'utilisateur par un canal sûr ; il pourra le changer ensuite.
      </Text>
      <Group align="flex-end" maw={460}>
        <PasswordInput
          flex={1}
          label="Nouveau mot de passe"
          value={pwd}
          onChange={(e) => setPwd(e.currentTarget.value)}
          autoComplete="new-password"
          leftSection={<IconLock size={16} />}
        />
        <Button
          loading={saving}
          disabled={pwd.length < MIN_PASSWORD_LENGTH}
          onClick={reset}
        >
          Réinitialiser
        </Button>
      </Group>
    </Card>
  );
}

// ── Onglet ZONE DANGER ───────────────────────────────────────────────────────
function DangerZone({
  detail,
  isSelf,
  busy,
  onPatch,
  onDelete,
}: {
  detail: AdminUserDetail;
  isSelf: boolean;
  busy: boolean;
  onPatch: (patch: { enabled?: boolean; locked?: boolean }) => void;
  onDelete: () => void;
}) {
  const selfNote = "Indisponible sur votre propre compte (anti-verrouillage).";
  return (
    <Card
      withBorder
      padding="lg"
      radius="md"
      style={{ borderColor: "var(--mantine-color-red-5)" }}
    >
      <Group gap="xs" mb="xs">
        <ThemeIcon variant="light" color="red" size="md">
          <IconAlertTriangle size={18} />
        </ThemeIcon>
        <Title order={4} c="red">
          Zone danger
        </Title>
      </Group>
      <Stack gap="lg" mt="sm">
        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text fw={500} size="sm">
              Compte {detail.enabled ? "actif" : "désactivé"}
            </Text>
            <Text size="xs" c="dimmed">
              Désactiver révoque immédiatement l'accès (sessions et jetons
              éjectés). {isSelf ? selfNote : ""}
            </Text>
          </div>
          <Switch
            checked={detail.enabled}
            disabled={isSelf || busy}
            onChange={(e) => onPatch({ enabled: e.currentTarget.checked })}
            aria-label="Activer ou désactiver le compte"
          />
        </Group>

        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text fw={500} size="sm">
              Compte {detail.locked ? "verrouillé" : "déverrouillé"}
            </Text>
            <Text size="xs" c="dimmed">
              Le verrouillage bloque la connexion sans supprimer le compte.{" "}
              {isSelf ? selfNote : ""}
            </Text>
          </div>
          <Switch
            checked={detail.locked}
            disabled={isSelf || busy}
            onChange={(e) => onPatch({ locked: e.currentTarget.checked })}
            aria-label="Verrouiller ou déverrouiller le compte"
          />
        </Group>

        <Group justify="space-between" wrap="nowrap">
          <div>
            <Text fw={500} size="sm" c="red">
              Supprimer le compte
            </Text>
            <Text size="xs" c="dimmed">
              Action définitive. {isSelf ? selfNote : ""}
            </Text>
          </div>
          <Button
            color="red"
            variant="light"
            leftSection={<IconTrash size={16} />}
            disabled={isSelf || busy}
            onClick={onDelete}
          >
            Supprimer
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────
export const UserProfile = observer(() => {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const store = useStore();
  const auth = useAuth();
  const notifications = useNotifications();

  const fetcher = useCallback(
    () => store.api.getAbsolute<AdminUserDetail>(userEndpoint(id)),
    [store, id],
  );
  const { data, loading, error, reload } = useResource(fetcher);
  const [busy, setBusy] = useState(false);
  const [savingRoles, setSavingRoles] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  const isSelf = !!data && auth.user?.username === data.identifier;

  const patchUser = async (
    patch: { roles?: string[]; enabled?: boolean; locked?: boolean },
    okMsg: string,
  ): Promise<void> => {
    setBusy(true);
    try {
      await store.api.patchAbsolute<AdminUserDetail>(userEndpoint(id), patch);
      notifications.notify("success", okMsg, { source: "api" });
      reload();
    } catch (e) {
      notifications.notify("error", describeUserAdminError(e), {
        source: "api",
      });
    } finally {
      setBusy(false);
    }
  };

  const saveProfile = async (profile: UserProfileData): Promise<void> => {
    setSavingProfile(true);
    try {
      await store.api.patchAbsolute<AdminUserDetail>(userEndpoint(id), {
        profile,
      });
      notifications.notify("success", "Profil enregistré.", { source: "api" });
      reload();
    } catch (e) {
      notifications.notify("error", describeUserAdminError(e), {
        source: "api",
      });
    } finally {
      setSavingProfile(false);
    }
  };

  const saveRoles = async (roles: string[]): Promise<void> => {
    setSavingRoles(true);
    await patchUser({ roles }, "Rôles enregistrés.");
    setSavingRoles(false);
  };

  const confirmDelete = (): void => {
    if (!data) return;
    modals.openConfirmModal({
      title: "Supprimer définitivement ce compte ?",
      centered: true,
      children: (
        <Text size="sm">
          Le compte « {data.identifier} » et ses accès seront supprimés. Cette
          action est irréversible.
        </Text>
      ),
      labels: { confirm: "Supprimer", cancel: "Annuler" },
      confirmProps: { color: "red" },
      onConfirm: async () => {
        setBusy(true);
        try {
          await store.api.deleteAbsolute<{ ok: true }>(userEndpoint(id));
          notifications.notify("success", "Compte supprimé.", {
            source: "api",
          });
          navigate("/nodefony/users");
        } catch (e) {
          notifications.notify("error", describeUserAdminError(e), {
            source: "api",
          });
          setBusy(false);
        }
      },
    });
  };

  const subtitle = data
    ? `${data.roles.length} rôle(s) · ${data.enabled ? "actif" : "désactivé"}${data.locked ? " · verrouillé" : ""}`
    : id;

  return (
    <PageLayout
      title={data?.identifier ?? "Utilisateur"}
      subtitle={subtitle}
      icon={
        data ? (
          <UserAvatar
            profile={data.profile}
            identifier={data.identifier}
            size={34}
          />
        ) : (
          <IconUser size={26} />
        )
      }
      actions={
        <Group gap="xs">
          <Button
            variant="default"
            leftSection={<IconArrowLeft size={16} />}
            onClick={() => navigate("/nodefony/users")}
          >
            Utilisateurs
          </Button>
          <Button
            variant="light"
            leftSection={<IconRefresh size={16} />}
            loading={loading}
            onClick={reload}
          >
            Recharger
          </Button>
        </Group>
      }
    >
      <DataState loading={loading && !data} error={error} onRetry={reload}>
        {data && (
          <Tabs defaultValue="profile" keepMounted={false}>
            <StickyTabsList>
              <Tabs.Tab value="profile" leftSection={<IconUser size={16} />}>
                Profil
              </Tabs.Tab>
              <Tabs.Tab
                value="security"
                leftSection={<IconShieldLock size={16} />}
              >
                Sécurité
              </Tabs.Tab>
              <Tabs.Tab
                value="danger"
                leftSection={<IconAlertTriangle size={16} />}
                color="red"
              >
                Zone danger
              </Tabs.Tab>
            </StickyTabsList>

            <Tabs.Panel value="profile" pt="md">
              <Stack gap="md">
                <ProfileFields
                  profile={data.profile}
                  identifier={data.identifier}
                  onSubmit={saveProfile}
                  saving={savingProfile}
                />
                <Grid>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <IdentityCard detail={data} />
                  </Grid.Col>
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <RolesCard
                      initial={data.roles}
                      isSelf={isSelf}
                      saving={savingRoles}
                      onSave={saveRoles}
                    />
                  </Grid.Col>
                </Grid>
                <ExternalConnectionsCard providers={data.socialProviders} />
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="security" pt="md">
              <Stack gap="md">
                <PasswordResetCard userId={id} />
                <AdminTwoFactorCard userId={id} />
                <AdminPasskeyCard userId={id} />
              </Stack>
            </Tabs.Panel>

            <Tabs.Panel value="danger" pt="md">
              <DangerZone
                detail={data}
                isSelf={isSelf}
                busy={busy}
                onPatch={(patch) =>
                  patchUser(
                    patch,
                    patch.enabled === false
                      ? "Compte désactivé."
                      : patch.enabled === true
                        ? "Compte réactivé."
                        : patch.locked
                          ? "Compte verrouillé."
                          : "Compte déverrouillé.",
                  )
                }
                onDelete={confirmDelete}
              />
            </Tabs.Panel>
          </Tabs>
        )}
      </DataState>
    </PageLayout>
  );
});

export default UserProfile;
