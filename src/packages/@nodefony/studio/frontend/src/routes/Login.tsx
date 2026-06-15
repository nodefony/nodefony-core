import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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
  IconBrandGithub,
  IconBrandGoogle,
  IconClockHour4,
  IconFingerprint,
  IconLock,
  IconLogin,
  IconUser,
  IconWifiOff,
} from "@tabler/icons-react";
import { useNavigate, useLocation } from "react-router-dom";
import { AuthLayout } from "../layouts/AuthLayout";
import { type ConnectionStep } from "../components/ConnectionStepper";
import { useAuth, useConnection, useStore } from "../stores";
import {
  LAST_METHOD_KEY,
  LAST_USER_KEY,
  PENDING_METHOD_KEY,
} from "../stores/AuthStore";

// `LAST_USER_KEY` est défini dans AuthStore (source de vérité du dernier compte
// connecté — mis à jour aussi après login social/passkey, pas seulement mot de passe).
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

/**
 * Métadonnées d'affichage des fournisseurs sociaux connus (libellé + icône de
 * marque). Un fournisseur découvert hors de cette table (ex. `keycloak`) reste
 * affiché via un bouton générique — l'UI ne masque jamais un provider activé.
 */
const SOCIAL_META: Record<
  string,
  { label: string; Icon: typeof IconBrandGoogle }
> = {
  google: { label: "Google", Icon: IconBrandGoogle },
  github: { label: "GitHub", Icon: IconBrandGithub },
};

/**
 * Démarre un flux social : navigation PLEINE PAGE vers `/authorize` (302 → le
 * fournisseur). JAMAIS un `fetch` — le navigateur doit suivre les redirections
 * cross-origin et laisser le serveur poser le cookie de session au callback.
 */
function startSocialLogin(provider: string): void {
  // Mémorise le mode AVANT la redirection pleine page (le composant Login ne
  // repasse pas) → consommé au retour authentifié pour l'icône/action « rebonjour ».
  try {
    localStorage.setItem(PENDING_METHOD_KEY, provider);
  } catch {
    /* localStorage indisponible (mode privé) — non bloquant */
  }
  window.location.assign(`/nodefony/security/api/oauth2/${provider}/authorize`);
}

function readLastUser(): string {
  try {
    return localStorage.getItem(LAST_USER_KEY) ?? "";
  } catch {
    return "";
  }
}

function readLastMethod(): string {
  try {
    return localStorage.getItem(LAST_METHOD_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Icône + libellé du « rebonjour » selon le MODE du dernier login. Garde l'UI
 * COHÉRENTE avec la dernière méthode : un compte social/passkey ne se voit JAMAIS
 * proposer un champ mot de passe.
 */
function loginMethodChip(method: string): {
  Icon: typeof IconUser;
  label: string;
} {
  const social = SOCIAL_META[method];
  if (social) return { Icon: social.Icon, label: `via ${social.label}` };
  if (method === "passkey") return { Icon: IconFingerprint, label: "Passkey" };
  return { Icon: IconUser, label: "Compte" };
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
 * directement à l'étape mot de passe).
 *
 *  - **Social login OAuth 2.0** (`social`) : un bouton par fournisseur ACTIVÉ
 *    côté serveur (Google, GitHub…) — flux *Authorization Code* BFF (redirect).
 *  - **Passkey** = **WebAuthn (J9, ACTIF)** : biométrie/clé, sans énumération.
 */
function AltLoginMethods({
  social,
  onSocial,
  onPasskey,
  busy,
  disabled,
  exclude,
}: {
  social: string[];
  onSocial: (provider: string) => void;
  onPasskey: () => void;
  busy: boolean;
  disabled: boolean;
  /** Mode déjà proposé en action primaire (« rebonjour ») → masqué ici (0 doublon). */
  exclude?: string;
}) {
  // N'affiche QUE les fournisseurs « curés » (brandés dans SOCIAL_META) → exclut
  // les fixtures de dev (ex. `test-oidc` du module test, qui pointe vers un IdP
  // fictif `test-idp.local`) et tout provider non reconnu : 0 bouton mort.
  // `exclude` retire le mode déjà mis en avant (action primaire du rebonjour).
  const visible = social.filter((id) => SOCIAL_META[id] && id !== exclude);
  return (
    <>
      <Divider label="ou" labelPosition="center" my={4} />
      {visible.map((id) => {
        const meta = SOCIAL_META[id];
        if (!meta) return null; // garde TS — filtré au-dessus
        const { label, Icon } = meta;
        return (
          <Button
            key={id}
            size="md"
            fullWidth
            variant="default"
            onClick={() => onSocial(id)}
            disabled={disabled || busy}
            leftSection={<Icon size={18} />}
          >
            Continuer avec {label}
          </Button>
        );
      })}
      {exclude !== "passkey" && (
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
      )}
      <Text size="xs" c="dimmed" ta="center">
        {visible.length > 0
          ? "Connexion via un fournisseur externe (OAuth 2.0) ou sans mot de passe (WebAuthn / FIDO2)."
          : "Connexion sans mot de passe (WebAuthn / FIDO2) — biométrie ou clé de sécurité."}
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
  const lastMethod = useMemo(readLastMethod, []);
  const initialUser = lastUser || (import.meta.env.DEV ? "admin" : "");

  const [phase, setPhase] = useState<"identifier" | "password">(
    lastUser ? "password" : "identifier",
  );
  const [identifier, setIdentifier] = useState(initialUser);
  // Dès que « Changer » est cliqué (on quitte le compte mémorisé), le « rebonjour »
  // method-aware laisse place au login mot de passe classique — sinon un login mdp
  // resterait piégé derrière le bouton social/passkey du dernier mode.
  const [forcePassword, setForcePassword] = useState(false);
  // Compte passkey : révèle le champ mot de passe À LA DEMANDE (« autre choix
  // login/mot de passe »), sans quitter le compte mémorisé ni perdre le bouton passkey.
  const [showPassword, setShowPassword] = useState(false);

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

  // Fournisseurs sociaux activés (OAuth 2.0), découverts côté serveur : l'UI
  // n'affiche QUE des boutons opérationnels (0 bouton mort). Échec/absence du
  // service = liste vide (non bloquant — login classique + Passkey restent).
  const [social, setSocial] = useState<string[]>([]);
  useEffect(() => {
    let alive = true;
    void store.api
      .getAbsolute<{ providers?: string[] }>(
        "/nodefony/security/api/oauth2/providers",
      )
      .then(
        (r) =>
          alive && setSocial(Array.isArray(r?.providers) ? r.providers : []),
      )
      .catch(() => {
        /* social login indisponible → pas de boutons (non bloquant) */
      });
    return () => {
      alive = false;
    };
  }, [store]);

  // Retour d'un échec social (failureRedirect `?error=oauth`) → message dans la
  // zone d'erreur RÉSERVÉE (aucun saut de mise en page).
  useEffect(() => {
    if (new URLSearchParams(loc.search).get("error") === "oauth") {
      setErrKind("credentials");
      setError("La connexion via le fournisseur externe a échoué. Réessayez.");
    }
  }, [loc.search]);

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
    setForcePassword(true); // on quitte le compte mémorisé → login mot de passe classique
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
      // WebAuthn refuse une IP comme rpId (ex. 127.0.0.1) → SecurityError. Ce
      // n'est PAS une panne réseau : message dédié (sinon classifyError l'étiquette
      // « réseau », trompeur).
      if (e instanceof Error && e.name === "SecurityError") {
        setErrKind("unknown");
        setError(
          "Passkey indisponible sur cette adresse. Ouvre Studio via https://localhost:5152 — les passkeys n'acceptent pas une IP comme 127.0.0.1.",
        );
        return;
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

  // « Rebonjour » : un compte SOCIAL (sans mot de passe) → bouton du fournisseur,
  // PAS de champ mot de passe. Un compte mot de passe OU passkey GARDE le champ mot
  // de passe (le passkey est une commodité EN PLUS, pas un remplacement) → le passkey
  // reste proposé dans les alternatives. Après « Changer », on repasse au mot de passe.
  const returningMethod = forcePassword ? "password" : lastMethod;
  const returnSocial = SOCIAL_META[returningMethod];
  const isPasskeyReturn = returningMethod === "passkey";
  const returnChip = loginMethodChip(returningMethod);
  const ReturnIcon = returnChip.Icon;
  // Champ mot de passe : par défaut (compte mot de passe) ; À LA DEMANDE pour un
  // compte passkey (qui possède aussi un mot de passe) ; JAMAIS pour un compte
  // social (il n'en a pas → bouton du fournisseur seulement).
  const showPasswordField = !returnSocial && (!isPasskeyReturn || showPassword);
  const socialLabel = returnSocial
    ? `Continuer avec ${returnSocial.label}`
    : "";

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
                  social={social}
                  onSocial={startSocialLogin}
                  onPasskey={runPasskeyFlow}
                  busy={busy}
                  disabled={throttled}
                />
              </Stack>
            </form>
          ) : (
            /* ── Rebonjour : compte connu — action primaire = DERNIER mode ── */
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
                      <ReturnIcon size={18} />
                    </ThemeIcon>
                    <div style={{ minWidth: 0 }}>
                      <Text size="sm" fw={600} truncate>
                        {identifier}
                      </Text>
                      <Text size="xs" c="dimmed">
                        {returnChip.label}
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

              {showPasswordField ? (
                /* Compte mot de passe (ou passkey ayant choisi « mot de passe »)
                   → champ + « Se connecter ». */
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
                  </Stack>
                </form>
              ) : isPasskeyReturn ? (
                /* Compte passkey : passkey en action PRIMAIRE (dernier mode) + un
                   CHOIX explicite « mot de passe » (le compte en possède un). */
                <Stack gap="xs">
                  <Button
                    size="md"
                    fullWidth
                    color="brand"
                    loading={busy}
                    disabled={throttled}
                    leftSection={<IconFingerprint size={18} />}
                    onClick={runPasskeyFlow}
                  >
                    Continuer avec une passkey
                  </Button>
                  <Button
                    variant="subtle"
                    size="sm"
                    fullWidth
                    leftSection={<IconLock size={16} />}
                    onClick={() => setShowPassword(true)}
                  >
                    Se connecter avec un mot de passe
                  </Button>
                </Stack>
              ) : (
                /* Compte SOCIAL (sans mot de passe) → bouton du fournisseur. */
                <Button
                  size="md"
                  fullWidth
                  color="brand"
                  loading={busy}
                  disabled={throttled}
                  leftSection={<ReturnIcon size={18} />}
                  onClick={() => startSocialLogin(returningMethod)}
                >
                  {socialLabel}
                </Button>
              )}

              <AltLoginMethods
                social={social}
                onSocial={startSocialLogin}
                onPasskey={runPasskeyFlow}
                busy={busy}
                disabled={throttled}
                exclude={showPasswordField ? undefined : returningMethod}
              />
            </Stack>
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
