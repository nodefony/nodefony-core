import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Badge,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconClockHour4,
  IconFingerprint,
  IconKey,
  IconLock,
  IconLogin,
  IconUser,
  IconWifiOff,
} from "@tabler/icons-react";
import { useNavigate, useLocation } from "react-router-dom";
import { AuthLayout } from "../layouts/AuthLayout";
import { type ConnectionStep } from "../components/ConnectionStepper";
import { useAuth, useConnection, useStore } from "../stores";

/** Dernier identifiant utilisé (UX « rebonjour ») — username SEUL, jamais de
 *  secret. Sûr à persister (équivalent d'un « remember username »). */
const LAST_USER_KEY = "nf.studio.lastUser";
/** Cooldown par défaut (s) si le serveur n'indique pas de `Retry-After` sur un 429. */
const DEFAULT_THROTTLE_S = 30;

/** Libellé affiché sur le bouton pendant chaque étape de la connexion. */
const STEP_LABEL: Record<ConnectionStep, string> = {
  ping: "Vérification du serveur…",
  auth: "Authentification…",
  user: "Chargement du profil…",
  realtime: "Connexion temps réel…",
  done: "Prêt",
};

function readLastUser(): string {
  try {
    return localStorage.getItem(LAST_USER_KEY) ?? "";
  } catch {
    return "";
  }
}

/** Lit un délai de ré-essai (s) depuis le corps d'erreur d'un 429, si présent. */
function retryAfterSeconds(e: unknown): number | null {
  const body = (e as { body?: unknown })?.body;
  if (body && typeof body === "object") {
    const b = body as {
      retryAfter?: unknown;
      error?: { retryAfter?: unknown };
    };
    const v = b.retryAfter ?? b.error?.retryAfter;
    if (typeof v === "number" && v > 0) return Math.ceil(v);
  }
  return null;
}

type ErrKind = "credentials" | "throttle" | "network" | "server" | "unknown";
interface ClassifiedError {
  kind: ErrKind;
  message: string;
  retryAfter?: number;
}

/**
 * Classe une erreur de connexion en catégorie ACTIONNABLE (best practice UX +
 * sécu). Distingue : throttle (429), réseau (aucun statut HTTP = fetch échoué),
 * serveur (5xx), identifiants (401/403 à l'auth → message GÉNÉRIQUE anti-
 * énumération), et inconnu.
 */
function classifyError(e: unknown, phaseStep: ConnectionStep): ClassifiedError {
  const status = (e as { status?: number })?.status;
  if (status === 429) {
    return {
      kind: "throttle",
      message: "",
      retryAfter: retryAfterSeconds(e) ?? DEFAULT_THROTTLE_S,
    };
  }
  if (status === undefined) {
    return {
      kind: "network",
      message:
        "Impossible de joindre le serveur. Vérifiez votre connexion réseau.",
    };
  }
  if (status >= 500) {
    return {
      kind: "server",
      message: "Le serveur a rencontré une erreur. Réessayez dans un instant.",
    };
  }
  if (phaseStep === "auth" && (status === 401 || status === 403)) {
    return {
      kind: "credentials",
      message: "Identifiant ou mot de passe incorrect.",
    };
  }
  return {
    kind: "unknown",
    message:
      e instanceof Error && e.message
        ? e.message
        : "Une erreur est survenue. Réessayez.",
  };
}

/**
 * Méthodes de connexion alternatives (P6) — rendues aux DEUX étapes (identifiant
 * ET mot de passe) pour rester visibles même en « rebonjour » (où l'on démarre
 * directement à l'étape mot de passe). Passkey = **WebAuthn (J9, ACTIF)** :
 * biométrie/clé sans énumération. SSO Keycloak = OIDC via `arctic` (« bientôt »).
 */
function AltLoginMethods({
  onPasskey,
  busy,
  disabled,
}: {
  onPasskey: () => void;
  busy: boolean;
  disabled: boolean;
}) {
  return (
    <>
      <Divider label="ou" labelPosition="center" my={4} />
      <Button
        size="md"
        fullWidth
        variant="default"
        disabled
        leftSection={<IconKey size={18} />}
        rightSection={
          <Badge size="xs" variant="light" color="gray">
            bientôt
          </Badge>
        }
      >
        Continuer avec Keycloak (SSO)
      </Button>
      <Button
        size="md"
        fullWidth
        variant="default"
        onClick={onPasskey}
        loading={busy}
        disabled={disabled}
        leftSection={<IconFingerprint size={18} />}
      >
        Passkey / empreinte digitale
      </Button>
      <Text size="xs" c="dimmed" ta="center">
        Connexion sans mot de passe (WebAuthn / FIDO2) — biométrie ou clé de
        sécurité. SSO (OIDC) bientôt.
      </Text>
    </>
  );
}

/**
 * Page Login — flow **identifier-first** (2 étapes), version SÛRE :
 *   1. Identifiant (+ mémorisation du dernier ; seams SSO/Passkey).
 *   2. Mot de passe → ping → auth → profil → realtime → redirect.
 *
 * 🔒 ANTI-ÉNUMÉRATION (OWASP) : l'étape 1 ne touche JAMAIS le serveur. Échec
 * d'auth → message **générique**.
 *
 * Ergonomie (best practice) : **aucun changement de vue** — le formulaire reste
 * affiché pendant la connexion (champs désactivés, bouton *loading* libellé par
 * étape) ET en cas d'erreur (alerte inline `role="alert"`, focus rendu au champ,
 * effacée à la frappe). Le **429 (throttle)** n'est pas réessayable tout de
 * suite : countdown + bouton désactivé. Une socket pas prête ne bloque pas le
 * login (elle se rétablit en fond).
 */
export const Login = observer(() => {
  const navigate = useNavigate();
  const loc = useLocation();
  const auth = useAuth();
  const conn = useConnection();
  const store = useStore();

  const lastUser = useMemo(readLastUser, []);
  const initialUser = lastUser || (import.meta.env.DEV ? "admin" : "");

  const [phase, setPhase] = useState<"identifier" | "password">(
    lastUser ? "password" : "identifier",
  );
  const [identifier, setIdentifier] = useState(initialUser);

  const [step, setStep] = useState<ConnectionStep>("ping");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errKind, setErrKind] = useState<ErrKind | null>(null);

  // Throttle (429) : on bloque le ré-essai jusqu'à `cooldownUntil`. Un interval
  // ne tourne QUE pendant le cooldown (countdown), jamais en permanence.
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (cooldownUntil === null) return;
    const id = window.setInterval(() => {
      if (Date.now() >= cooldownUntil) setCooldownUntil(null);
      else forceTick((n) => n + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, [cooldownUntil]);
  const cooldownLeft = cooldownUntil
    ? Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000))
    : 0;
  const throttled = cooldownLeft > 0;

  // Liveness publique : ping `/health` au montage (route bypassFirewall — Zero
  // Trust protège les DONNÉES, pas la sonde). `null` = vérification en cours.
  const [serverUp, setServerUp] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void store.api
      .get("/health")
      .then(() => alive && setServerUp(true))
      .catch(() => alive && setServerUp(false));
    return () => {
      alive = false;
    };
  }, [store]);

  const idRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  // Pas de `validate` Mantine : l'erreur native s'affiche SOUS le champ et
  // pousse le formulaire (saut). On valide à la main et on route le message vers
  // la ZONE RÉSERVÉE (comme les erreurs d'auth) → 0 mouvement.
  const passwordForm = useForm({ initialValues: { password: "" } });

  // Autofocus sur le champ pertinent (y compris APRÈS une erreur : `busy`
  // repasse false → on refocalise le champ pour re-saisir sans clic).
  useEffect(() => {
    if (busy) return;
    if (phase === "identifier") idRef.current?.focus();
    else pwRef.current?.focus();
  }, [phase, busy]);

  const clearError = (): void => {
    if (error) setError(null);
    if (errKind) setErrKind(null);
  };

  // Étape 1 → 2 : AUCUN appel serveur (anti-énumération).
  const goToPassword = (): void => {
    const id = identifier.trim();
    if (!id) {
      setErrKind("unknown");
      setError("Identifiant requis.");
      idRef.current?.focus();
      return;
    }
    try {
      localStorage.setItem(LAST_USER_KEY, id);
    } catch {
      /* localStorage indispo (mode privé) — non bloquant */
    }
    clearError();
    setPhase("password");
  };

  const backToIdentifier = (): void => {
    clearError();
    passwordForm.reset();
    setPhase("identifier");
  };

  const runFlow = async (password: string): Promise<void> => {
    setBusy(true);
    clearError();
    let phaseStep: ConnectionStep = "ping";
    try {
      phaseStep = "ping";
      setStep("ping");
      await store.api.get("/health");

      phaseStep = "auth";
      setStep("auth");
      await auth.login({ username: identifier.trim(), password });

      phaseStep = "user";
      setStep("user");
      await new Promise((r) => setTimeout(r, 150));

      // Realtime : best-effort. `conn.connect()` avale son timeout (la socket se
      // rétablit en fond) → l'auth réussie ne doit JAMAIS être bloquée par le WS.
      phaseStep = "realtime";
      setStep("realtime");
      await conn.connect();

      setStep("done");
      const from = (loc.state as { from?: string } | null)?.from;
      const deepLink =
        from && from !== "/nodefony" && from !== "/nodefony/login";
      navigate(deepLink ? from : auth.homePath, { replace: true });
    } catch (e) {
      const c = classifyError(e, phaseStep);
      if (c.kind === "throttle") {
        setCooldownUntil(
          Date.now() + (c.retryAfter ?? DEFAULT_THROTTLE_S) * 1000,
        );
        setErrKind("throttle");
        setError(null);
      } else {
        setErrKind(c.kind);
        setError(c.message);
      }
    } finally {
      setBusy(false);
    }
  };

  // Connexion par passkey/empreinte (WebAuthn J9). L'annulation de l'invite
  // biométrique (NotAllowedError/AbortError) est SILENCIEUSE — pas une erreur.
  const runPasskeyFlow = async (): Promise<void> => {
    if (busy || throttled) return;
    setBusy(true);
    clearError();
    try {
      setStep("auth");
      await auth.loginWithPasskey(identifier.trim() || undefined);
      setStep("realtime");
      await conn.connect();
      setStep("done");
      const from = (loc.state as { from?: string } | null)?.from;
      const deepLink =
        from && from !== "/nodefony" && from !== "/nodefony/login";
      navigate(deepLink ? from : auth.homePath, { replace: true });
    } catch (e) {
      if (
        e instanceof Error &&
        (e.name === "NotAllowedError" || e.name === "AbortError")
      ) {
        return; // l'utilisateur a fermé/annulé l'invite — état inchangé
      }
      const c = classifyError(e, "auth");
      if (c.kind === "throttle") {
        setCooldownUntil(
          Date.now() + (c.retryAfter ?? DEFAULT_THROTTLE_S) * 1000,
        );
        setErrKind("throttle");
        setError(null);
      } else {
        setErrKind(c.kind);
        setError(c.message);
      }
    } finally {
      setBusy(false);
    }
  };

  const dotColor =
    serverUp === null
      ? "var(--mantine-color-gray-5)"
      : serverUp
        ? "var(--mantine-color-teal-5)"
        : "var(--mantine-color-red-5)";
  const dotLabel =
    serverUp === null
      ? "Vérification du serveur…"
      : serverUp
        ? "Serveur en ligne"
        : "Serveur injoignable";

  // Métadonnées de l'alerte selon la catégorie d'erreur (icône/couleur/titre).
  const alert = throttled
    ? {
        color: "yellow",
        icon: <IconClockHour4 size={16} />,
        title: "Trop de tentatives",
        body: `Pour votre sécurité, patientez ${cooldownLeft}s avant un nouvel essai.`,
      }
    : error
      ? {
          color:
            errKind === "network"
              ? "orange"
              : errKind === "server"
                ? "red"
                : "red",
          icon:
            errKind === "network" ? (
              <IconWifiOff size={16} />
            ) : errKind === "server" ? (
              <IconAlertTriangle size={16} />
            ) : (
              <IconAlertCircle size={16} />
            ),
          title:
            errKind === "network"
              ? "Connexion impossible"
              : errKind === "server"
                ? "Erreur serveur"
                : "Connexion échouée",
          body: error,
        }
      : null;

  const pwProps = passwordForm.getInputProps("password");

  return (
    <AuthLayout>
      <Stack gap="lg">
        <div>
          <Title order={1} fz={28} fw={700}>
            Connexion
          </Title>
          <Text c="dimmed" size="sm" mt={4}>
            Accédez à la console d'administration Nodefony Studio.
          </Text>
        </div>

        <Stack gap="sm">
          {/* Zone message RÉSERVÉE (hauteur fixe) — le message s'insère ICI,
              entre le sous-titre et le formulaire : vide = place réservée (0
              saut de l'œil ni des champs), erreur = note affichée juste là où
              le regard est. role=alert, s'efface à la frappe. */}
          <Box mih={64}>
            {alert && (
              <Group
                role="alert"
                gap="sm"
                wrap="nowrap"
                align="flex-start"
                p="sm"
                style={{
                  borderRadius: 8,
                  background: `var(--mantine-color-${alert.color}-light)`,
                  borderInlineStart: `3px solid var(--mantine-color-${alert.color}-6)`,
                }}
              >
                <Box
                  style={{
                    color: `var(--mantine-color-${alert.color}-7)`,
                    lineHeight: 0,
                    marginTop: 2,
                  }}
                >
                  {alert.icon}
                </Box>
                <Text size="sm" c={`${alert.color}.8`}>
                  {alert.body}
                </Text>
              </Group>
            )}
          </Box>
          {phase === "identifier" ? (
            /* ── Étape 1 : identifiant (0 appel serveur) ── */
            <form
              onSubmit={(e) => {
                e.preventDefault();
                goToPassword();
              }}
            >
              <Stack gap="md">
                <TextInput
                  ref={idRef}
                  size="md"
                  label="Identifiant"
                  placeholder="admin"
                  leftSection={<IconUser size={16} />}
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.currentTarget.value);
                    clearError();
                  }}
                />
                <Button
                  type="submit"
                  size="md"
                  fullWidth
                  color="brand"
                  rightSection={<IconArrowRight size={18} />}
                >
                  Continuer
                </Button>

                <AltLoginMethods
                  onPasskey={runPasskeyFlow}
                  busy={busy}
                  disabled={throttled}
                />
              </Stack>
            </form>
          ) : (
            /* ── Étape 2 : mot de passe (identifiant connu, changeable) ── */
            <form
              onSubmit={passwordForm.onSubmit((v) => {
                if (busy || throttled) return;
                if (!v.password) {
                  setErrKind("unknown");
                  setError("Mot de passe requis.");
                  pwRef.current?.focus();
                  return;
                }
                void runFlow(v.password);
              })}
            >
              <Stack gap="md">
                <Paper withBorder radius="md" p="xs">
                  <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                      <ThemeIcon
                        size={34}
                        radius="xl"
                        variant="light"
                        color="brand"
                      >
                        <IconUser size={18} />
                      </ThemeIcon>
                      <div style={{ minWidth: 0 }}>
                        <Text size="sm" fw={600} truncate>
                          {identifier}
                        </Text>
                        <Text size="xs" c="dimmed">
                          Compte
                        </Text>
                      </div>
                    </Group>
                    <Button
                      variant="subtle"
                      size="xs"
                      onClick={backToIdentifier}
                      disabled={busy}
                    >
                      Changer
                    </Button>
                  </Group>
                </Paper>
                <PasswordInput
                  {...pwProps}
                  ref={pwRef}
                  size="md"
                  label="Mot de passe"
                  placeholder="••••••••"
                  leftSection={<IconLock size={16} />}
                  autoComplete="current-password"
                  disabled={busy}
                  onChange={(ev) => {
                    pwProps.onChange(ev);
                    clearError();
                  }}
                />
                <Button
                  type="submit"
                  size="md"
                  fullWidth
                  color="brand"
                  loading={busy}
                  disabled={throttled}
                  leftSection={busy ? undefined : <IconLogin size={18} />}
                >
                  {busy
                    ? STEP_LABEL[step]
                    : throttled
                      ? `Réessayez dans ${cooldownLeft}s`
                      : "Se connecter"}
                </Button>
                <AltLoginMethods
                  onPasskey={runPasskeyFlow}
                  busy={busy}
                  disabled={throttled}
                />
              </Stack>
            </form>
          )}
        </Stack>

        {/* Pied : état du serveur (liveness) + rappel des identifiants en dev. */}
        <Group justify="space-between" mt="xs">
          <Group gap={7}>
            <Box
              w={8}
              h={8}
              style={{ borderRadius: "50%", background: dotColor }}
              aria-hidden
            />
            <Text size="xs" c="dimmed">
              {dotLabel}
            </Text>
          </Group>
          {import.meta.env.DEV && (
            <Text size="xs" c="dimmed">
              dev : admin / secret
            </Text>
          )}
        </Group>
      </Stack>
    </AuthLayout>
  );
});
