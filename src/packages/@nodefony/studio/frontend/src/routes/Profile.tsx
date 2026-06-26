/**
 * Page **Profil** (self-service du compte courant, P6.15). Accessible à TOUT
 * utilisateur authentifié (pas seulement un admin) — c'est SON compte :
 *
 *  - identité (identifiant, rôle actif, dates) ;
 *  - mes rôles en **lecture seule** (un utilisateur ne change jamais ses propres
 *    rôles : c'est une décision d'administration → anti élévation de privilège) ;
 *  - mes connexions externes (comptes OAuth liés), SANS aucun jeton ;
 *  - **ZONE DANGER** : changer MON mot de passe, avec re-authentification du mot
 *    de passe actuel.
 *
 * Tout est scopé CÔTÉ SERVEUR à l'identité de l'appelant (anti-IDOR) : aucun id
 * n'est transmis, le data plane (`/nodefony/user/api/me*`) agit sur l'appelant.
 * Les mutations passent en **POST HTTP** (pipeline CSRF — la Socket est GET-only).
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
import {
  PROFILE_ME_ENDPOINT,
  PROFILE_PASSWORD_ENDPOINT,
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

  // Statut du compte — toujours connu (issu du DTO), à l'inverse des dates
  // (remontées par le store) et du rôle actif (souvent null) que l'on masque.
  const statusLabel = data?.locked
    ? "Verrouillé"
    : data && !data.enabled
      ? "Désactivé"
      : "Actif";
  const statusColor = data?.locked
    ? "red"
    : data && !data.enabled
      ? "gray"
      : "teal";

  // ── Formulaire « changer mon mot de passe » ──
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
      title="Profil"
      subtitle={`Mon compte — ${identifier}`}
      icon={<IconUser size={26} />}
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
                {/* Statut = valeur RICHE (badge) → Group manuel, PAS KeyValue
                    (qui rend dans un <p> → <div> imbriqué interdit). */}
                {data && (
                  <Group justify="space-between" wrap="nowrap">
                    <Text size="sm" c="dimmed">
                      Statut
                    </Text>
                    <Badge color={statusColor} variant="light">
                      {statusLabel}
                    </Badge>
                  </Group>
                )}
                {/* Champs masqués s'ils sont inconnus (pas de « — » trompeur) :
                    rôle actif = profil de session (souvent absent), dates =
                    remontées par le store. */}
                {currentRole && <KeyValue k="Rôle actif" v={currentRole} />}
                {data?.createdAt != null && (
                  <KeyValue k="Créé le" v={fmtProfileDate(data.createdAt)} />
                )}
                {data?.updatedAt != null && (
                  <KeyValue k="Modifié le" v={fmtProfileDate(data.updatedAt)} />
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
                    <Badge key={r} variant="light" color="brand" size="lg">
                      {r}
                    </Badge>
                  ))}
                </Group>
              )}
            </Card>
          </Grid.Col>

          {/* Connexions externes (OAuth) */}
          <Grid.Col span={12}>
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
          </Grid.Col>
        </Grid>
      </DataState>

      {/* 2FA TOTP — sécurité forte recommandée (compte à mot de passe uniquement :
          c'est le 2ᵉ facteur du login mot de passe). */}
      {hasPassword && <TwoFactorCard />}

      {/* Passkeys / empreintes — login sans mot de passe (tout compte, y c. OAuth). */}
      <PasskeyCard />

      {/* Mot de passe : ZONE DANGER (changer) si compte local ; sinon info OAuth. */}
      {hasPassword ? (
        <Card
          withBorder
          padding="lg"
          radius="md"
          mt="md"
          style={{ borderColor: "var(--mantine-color-red-5)" }}
        >
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="light" color="red" size="md">
              <IconLock size={18} />
            </ThemeIcon>
            <Title order={4} c="red">
              Zone danger — changer mon mot de passe
            </Title>
          </Group>
          <Text size="sm" c="dimmed" mb="md">
            Votre mot de passe actuel est exigé (re-authentification). Le
            nouveau doit faire au moins {MIN_PASSWORD_LENGTH} caractères et être
            différent de l'actuel. Changer votre mot de passe ne déconnecte pas
            vos autres sessions — utilisez « Sessions » pour cela.
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
            {/* Zone d'erreur à hauteur RÉSERVÉE (anti layout shift, cf retex Login). */}
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
        <Card withBorder padding="lg" radius="md" mt="md">
          <Group gap="xs" mb="xs">
            <ThemeIcon variant="light" size="md">
              <IconLock size={18} />
            </ThemeIcon>
            <Title order={4}>Mot de passe</Title>
          </Group>
          <Text size="sm" c="dimmed">
            Vous êtes connecté via un fournisseur externe (OAuth) — aucun mot de
            passe local n'est défini sur ce compte (rien à saisir pour vous
            connecter). La définition d'un mot de passe local, avec
            re-authentification via votre fournisseur, sera proposée
            prochainement.
          </Text>
        </Card>
      )}
    </PageLayout>
  );
});

export default Profile;
