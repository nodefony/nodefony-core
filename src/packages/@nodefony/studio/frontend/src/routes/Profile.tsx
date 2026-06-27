/**
 * Page **Profil** (self-service du compte courant, P6.15). Accessible à TOUT
 * utilisateur authentifié — c'est SON compte. **Même structure à onglets que la
 * page admin** (`/nodefony/users/:id`) pour la cohérence :
 *
 *  - **Profil** : avatar + identité d'affichage (claims OIDC, éditables) +
 *    rôles en LECTURE SEULE (on ne change jamais ses propres rôles : décision
 *    d'administration, anti élévation de privilège) + connexions externes.
 *  - **Sécurité** : 2FA (TOTP), passkeys, et changer MON mot de passe (re-auth).
 *
 * Tout est scopé CÔTÉ SERVEUR à l'identité de l'appelant (anti-IDOR) : aucun id
 * n'est transmis, le data plane (`/nodefony/user/api/me*`) agit sur l'appelant.
 * Mutations en **POST HTTP** (pipeline CSRF — la Socket est GET-only).
 */
import { useCallback, useState } from "react";
import { observer } from "mobx-react-lite";
import {
  Stack,
  Grid,
  Group,
  Card,
  Text,
  Title,
  Badge,
  Button,
  PasswordInput,
  ThemeIcon,
  Tabs,
} from "@mantine/core";
import {
  IconUser,
  IconRefresh,
  IconShieldLock,
  IconKey,
  IconLock,
  IconAlertTriangle,
  IconPlugConnected,
} from "@tabler/icons-react";

import { useStore, useAuth, useNotifications } from "../stores";
import { useResource } from "../hooks";
import { PageLayout, DataState, KeyValue, DocHint } from "../components/ui";
import { StickyTabsList } from "../components/ui/PageLayout";
import {
  PROFILE_ME_ENDPOINT,
  PROFILE_PASSWORD_ENDPOINT,
  PROFILE_UPDATE_ENDPOINT,
  PROFILE_DOC,
  MIN_PASSWORD_LENGTH,
  validatePasswordChange,
  describeProfileError,
  fmtProfileDate,
  type ProfileSummary,
  type ChangePasswordInput,
} from "./profile/profileModel";
import { TwoFactorCard } from "./profile/TwoFactorCard";
import { PasskeyCard } from "./profile/PasskeyCard";
import { ProfileFields } from "./users/ProfileFields";
import { StatusBadge } from "./users/usersFormat";
import { UserAvatar } from "./users/AvatarUpload";
import type { UserProfileData } from "./users/userAdminModel";

export const Profile = observer(() => {
  const store = useStore();
  const auth = useAuth();
  const notifications = useNotifications();

  // Source de vérité = le serveur (GET me, redacté) ; on tombe sur l'auth context
  // (identité résolue au login) le temps du 1er paint ou si l'endpoint échoue.
  const fetcher = useCallback(
    () => store.api.getAbsolute<ProfileSummary>(PROFILE_ME_ENDPOINT),
    [store],
  );
  const { data, loading, error, reload } = useResource(fetcher);

  const identifier = data?.identifier ?? auth.user?.username ?? "—";
  const roles = data?.roles ?? auth.roles;
  const currentRole = data?.currentRole ?? null;
  const social = data?.socialProviders ?? [];
  // Compte OAuth-only (password: null) → pas de « mot de passe actuel » à fournir :
  // la re-auth est impossible → on propose l'info, jamais le formulaire de changement.
  const hasPassword = data?.hasPassword ?? true;

  // ── Édition de MON profil (avatar + claims OIDC) → POST me/profile ──
  const [savingProfile, setSavingProfile] = useState(false);
  const saveSelfProfile = async (profile: UserProfileData): Promise<void> => {
    setSavingProfile(true);
    try {
      await store.api.postAbsolute<ProfileSummary>(
        PROFILE_UPDATE_ENDPOINT,
        profile,
      );
      notifications.notify("success", "Profil enregistré.", { source: "api" });
      reload();
    } catch (e) {
      notifications.notify("error", describeProfileError(e), { source: "api" });
    } finally {
      setSavingProfile(false);
    }
  };

  // ── Changer MON mot de passe (re-auth du mot de passe actuel) ──
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function clearError(): void {
    if (formError) setFormError(null);
  }

  async function changePassword(): Promise<void> {
    const invalid = validatePasswordChange(current, next, confirm);
    if (invalid) {
      setFormError(invalid);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      await store.api.postAbsolute<{ ok: true }>(PROFILE_PASSWORD_ENDPOINT, {
        currentPassword: current,
        newPassword: next,
      } satisfies ChangePasswordInput);
      notifications.notify("success", "Mot de passe changé.", {
        source: "api",
      });
      setCurrent("");
      setNext("");
      setConfirm("");
    } catch (e) {
      notifications.notify("error", describeProfileError(e), { source: "api" });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageLayout
      title="Mon compte"
      subtitle={identifier}
      icon={
        data ? (
          <UserAvatar
            profile={data.profile}
            identifier={identifier}
            size={34}
          />
        ) : (
          <IconUser size={26} />
        )
      }
      actions={
        <Button
          variant="light"
          leftSection={<IconRefresh size={16} />}
          loading={loading}
          onClick={reload}
        >
          Recharger
        </Button>
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
            </StickyTabsList>

            {/* ───────────────────────── Onglet PROFIL ───────────────────────── */}
            <Tabs.Panel value="profile" pt="md">
              <Stack gap="md">
                <ProfileFields
                  profile={data.profile}
                  identifier={identifier}
                  onSubmit={saveSelfProfile}
                  saving={savingProfile}
                />

                <Grid>
                  {/* Identité */}
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Card withBorder padding="lg" radius="md" h="100%">
                      <Group gap="xs" mb="md">
                        <ThemeIcon variant="light" size="md">
                          <IconUser size={18} />
                        </ThemeIcon>
                        <Title order={4}>Identité</Title>
                      </Group>
                      <Stack gap="xs">
                        <KeyValue k="Identifiant" v={identifier} mono />
                        <Group justify="space-between" wrap="nowrap">
                          <Text size="sm" c="dimmed">
                            Statut
                          </Text>
                          <StatusBadge
                            enabled={data.enabled}
                            locked={data.locked}
                          />
                        </Group>
                        {currentRole && (
                          <KeyValue k="Rôle actif" v={currentRole} />
                        )}
                        {data.createdAt != null && (
                          <KeyValue
                            k="Créé le"
                            v={fmtProfileDate(data.createdAt)}
                          />
                        )}
                        {data.updatedAt != null && (
                          <KeyValue
                            k="Modifié le"
                            v={fmtProfileDate(data.updatedAt)}
                          />
                        )}
                      </Stack>
                    </Card>
                  </Grid.Col>

                  {/* Mes rôles — lecture seule */}
                  <Grid.Col span={{ base: 12, md: 6 }}>
                    <Card withBorder padding="lg" radius="md" h="100%">
                      <Group gap="xs" mb="md">
                        <ThemeIcon variant="light" size="md">
                          <IconShieldLock size={18} />
                        </ThemeIcon>
                        <Title order={4}>Mes rôles</Title>
                        <DocHint
                          title="Mes rôles"
                          version={PROFILE_DOC}
                          summary="Les rôles déterminent ce à quoi vous avez accès dans Studio et l'API."
                          sections={[
                            {
                              label: "Lecture seule",
                              body: "Vous ne pouvez pas modifier vos propres rôles : c'est une décision d'administration (un administrateur les gère depuis la console Users). Cela empêche une élévation de privilège par soi-même.",
                            },
                          ]}
                        />
                      </Group>
                      {roles.length === 0 ? (
                        <Text c="dimmed" size="sm">
                          Aucun rôle attribué.
                        </Text>
                      ) : (
                        <Group gap="xs">
                          {roles.map((r) => (
                            <Badge
                              key={r}
                              variant="light"
                              color="brand"
                              size="lg"
                            >
                              {r}
                            </Badge>
                          ))}
                        </Group>
                      )}
                    </Card>
                  </Grid.Col>
                </Grid>

                {/* Connexions externes (OAuth) */}
                <Card withBorder padding="lg" radius="md">
                  <Group gap="xs" mb="md">
                    <ThemeIcon variant="light" size="md">
                      <IconPlugConnected size={18} />
                    </ThemeIcon>
                    <Title order={4}>Connexions externes</Title>
                  </Group>
                  {social.length === 0 ? (
                    <Text c="dimmed" size="sm">
                      Aucun compte externe lié — connexion par mot de passe.
                    </Text>
                  ) : (
                    <Stack gap="xs">
                      {social.map((p) => (
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
                            {fmtProfileDate(p.createdAt)}
                          </Text>
                        </Group>
                      ))}
                    </Stack>
                  )}
                </Card>
              </Stack>
            </Tabs.Panel>

            {/* ──────────────────────── Onglet SÉCURITÉ ──────────────────────── */}
            <Tabs.Panel value="security" pt="md">
              <Stack gap="md">
                {/* 2FA TOTP — 2ᵉ facteur du login mot de passe. */}
                {hasPassword && <TwoFactorCard />}

                {/* Passkeys — login sans mot de passe (tout compte). */}
                <PasskeyCard />

                {/* Changer MON mot de passe (compte local) ou info OAuth. */}
                {hasPassword ? (
                  <Card
                    withBorder
                    padding="lg"
                    radius="md"
                    style={{ borderColor: "var(--mantine-color-red-5)" }}
                  >
                    <Group gap="xs" mb="xs">
                      <ThemeIcon variant="light" color="red" size="md">
                        <IconLock size={18} />
                      </ThemeIcon>
                      <Title order={4} c="red">
                        Changer mon mot de passe
                      </Title>
                    </Group>
                    <Text size="sm" c="dimmed" mb="md">
                      Votre mot de passe actuel est exigé (re-authentification).
                      Le nouveau doit faire au moins {MIN_PASSWORD_LENGTH}{" "}
                      caractères et être différent de l'actuel. Changer votre
                      mot de passe ne déconnecte pas vos autres sessions —
                      utilisez « Sessions ».
                    </Text>
                    <Stack gap="sm" maw={460}>
                      <PasswordInput
                        label="Mot de passe actuel"
                        value={current}
                        onChange={(e) => {
                          setCurrent(e.currentTarget.value);
                          clearError();
                        }}
                        autoComplete="current-password"
                        leftSection={<IconKey size={16} />}
                      />
                      <PasswordInput
                        label="Nouveau mot de passe"
                        value={next}
                        onChange={(e) => {
                          setNext(e.currentTarget.value);
                          clearError();
                        }}
                        autoComplete="new-password"
                        leftSection={<IconLock size={16} />}
                      />
                      <PasswordInput
                        label="Confirmer le nouveau mot de passe"
                        value={confirm}
                        onChange={(e) => {
                          setConfirm(e.currentTarget.value);
                          clearError();
                        }}
                        autoComplete="new-password"
                        leftSection={<IconLock size={16} />}
                      />
                      <div style={{ minHeight: 22 }} aria-live="polite">
                        {formError && (
                          <Group gap={6} c="red">
                            <IconAlertTriangle size={15} />
                            <Text size="sm" role="alert">
                              {formError}
                            </Text>
                          </Group>
                        )}
                      </div>
                      <Group justify="flex-end">
                        <Button
                          color="red"
                          leftSection={<IconLock size={16} />}
                          loading={submitting}
                          disabled={!current || !next || !confirm}
                          onClick={changePassword}
                        >
                          Changer le mot de passe
                        </Button>
                      </Group>
                    </Stack>
                  </Card>
                ) : (
                  <Card withBorder padding="lg" radius="md">
                    <Group gap="xs" mb="xs">
                      <ThemeIcon variant="light" size="md">
                        <IconLock size={18} />
                      </ThemeIcon>
                      <Title order={4}>Mot de passe</Title>
                    </Group>
                    <Text size="sm" c="dimmed">
                      Vous êtes connecté via un fournisseur externe (OAuth) —
                      aucun mot de passe local n'est défini sur ce compte. La
                      définition d'un mot de passe local sera proposée
                      prochainement.
                    </Text>
                  </Card>
                )}
              </Stack>
            </Tabs.Panel>
          </Tabs>
        )}
      </DataState>
    </PageLayout>
  );
});

export default Profile;
