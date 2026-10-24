import { observer } from "mobx-react-lite";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Anchor,
  Box,
  Button,
  Divider,
  Group,
  Paper,
  PasswordInput,
  PinInput,
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
  IconLock,
  IconLogin,
  IconShieldLock,
  IconUser,
  IconWifiOff,
} from "@tabler/icons-react";
import {
  ProviderIcon,
  providerIconComponent,
  type ProviderIconComponent,
} from "../components/ProviderIcon";
import { Navigate, useNavigate, useLocation } from "react-router";
import { OAUTH2_CANCELLED_REASON, WEBAUTHN_STATUS_PATH } from "nodefony";
import type {
  NodefonyLoginError,
  NodefonyLoginProvider,
} from "nodefony/client";
import { AuthLayout } from "../layouts/AuthLayout";
import { type ConnectionStep } from "../components/ConnectionStepper";
import { useAuth, useConnection, useStore } from "../stores";
import { ApiError } from "../services/ApiClient";
import { validateTotpCode } from "./profile/totpModel";
import { LAST_METHOD_KEY } from "../stores/AuthStore";

// Le DÉROULÉ (étapes, second facteur, blocage après trop d'essais, classement
// des échecs, fournisseurs, passkey) appartient à `NodefonyLogin`, porté par
// `AuthStore`. Cet écran ne fait que le PEINDRE et dire chaque échec en mots.

/** Libellé affiché sur le bouton pendant chaque étape de la connexion. */
const STEP_LABEL: Record<ConnectionStep, string> = {
  ping: "Vérification du serveur…",
  auth: "Authentification…",
  user: "Chargement du profil…",
  realtime: "Connexion temps réel…",
  done: "Prêt",
};

/**
 * Icônes des marques que l'on sait dessiner. Cette table ne DÉCIDE rien : elle
 * embellit. Tout fournisseur absent reçoit une icône neutre et reste affiché —
 * c'est le serveur, seul à lire la configuration, qui dit ce qui s'affiche.
 *
 * Le libellé n'est ici qu'un repli synchrone pour le « rebonjour », rendu avant
 * que la liste du serveur ne soit arrivée.
 */
// Indexé par le nom d'un fournisseur annoncé par le serveur : peut manquer.
const BRAND_META: Partial<Record<string, { label: string }>> = {
  google: { label: "Google" },
  github: { label: "GitHub" },
};

/**
 * Le dernier login s'est-il fait par un fournisseur externe ?
 *
 * Se répond sans aucune table : `rememberMethod` n'écrit que `password`,
 * `passkey`, ou le NOM du fournisseur. Déduire cela d'une liste de marques
 * connues ferait proposer un champ mot de passe à un compte Keycloak, qui n'en
 * a pas — et la liste du serveur, elle, arrive trop tard pour le premier rendu.
 */
function isSocialMethod(method: string): boolean {
  return method !== "" && method !== "password" && method !== "passkey";
}

/** Destination posée par `AuthGuard` dans l'état de navigation, sinon `undefined`. */
function stateFrom(state: unknown): string | undefined {
  if (typeof state !== "object" || state === null || !("from" in state)) {
    return undefined;
  }
  return typeof state.from === "string" ? state.from : undefined;
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
function loginMethodChip(
  method: string,
  providers: readonly NodefonyLoginProvider[],
): {
  Icon: ProviderIconComponent;
  label: string;
} {
  if (isSocialMethod(method)) {
    // Le libellé du serveur d'abord ; la marque connue tant qu'il n'est pas
    // arrivé ; le nom brut en dernier recours plutôt qu'un « Compte » faux.
    const label =
      providers.find((p) => p.name === method)?.label ??
      BRAND_META[method]?.label ??
      method;
    return { Icon: providerIconComponent(method), label: `via ${label}` };
  }
  if (method === "passkey") return { Icon: IconFingerprint, label: "Passkey" };
  return { Icon: IconUser, label: "Compte" };
}

/** Catégorie d'une alerte : décide de son icône et de sa couleur. */
type AlertKind = "credentials" | "network" | "server" | "unknown";

/** Message d'une erreur propre à l'écran (saisie vide, retour de fournisseur). */
interface ILocalError {
  kind: AlertKind;
  message: string;
}

const NETWORK_MESSAGE =
  "Impossible de joindre le serveur. Vérifiez votre connexion réseau.";
const SERVER_MESSAGE =
  "Le serveur a rencontré une erreur. Réessayez dans un instant.";

/**
 * Dit en mots un échec classé par le déroulé. Le classement est au cœur ; il
 * ne reste ici que la phrase. Les refus restent GÉNÉRIQUES (anti-énumération) ;
 * une erreur locale sans réponse du serveur (`status` nul) porte son propre
 * message — celui de l'agent de passkey, par exemple.
 *
 * @returns `null` pour ce qui ne s'annonce pas en alerte : l'annulation d'une
 *   invite (geste de l'utilisateur), le blocage (il a son compte à rebours)
 */
function describeFlowError(
  error: NodefonyLoginError,
  step: string,
): ILocalError | null {
  switch (error.kind) {
    case "cancelled":
    case "throttled":
      return null;
    case "credentials":
      return {
        kind: "credentials",
        message:
          step === "mfa"
            ? "Code incorrect ou expiré. Réessayez avec le code courant."
            : "Identifiant ou mot de passe incorrect.",
      };
    case "network":
      return { kind: "network", message: NETWORK_MESSAGE };
    case "unsupported":
      return {
        kind: "unknown",
        message: "Ce navigateur ne sait pas utiliser de passkey.",
      };
    case "server":
      return {
        kind: "server",
        message:
          error.status === null && error.message !== ""
            ? error.message
            : SERVER_MESSAGE,
      };
  }
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
  passkey,
  onPasskey,
  busy,
  disabled,
  exclude,
}: {
  social: readonly NodefonyLoginProvider[];
  onSocial: (provider: string) => void;
  /** Passkeys actives côté serveur : sinon le bouton mènerait à un 503. */
  passkey: boolean;
  onPasskey: () => void;
  busy: boolean;
  disabled: boolean;
  /** Mode déjà proposé en action primaire (« rebonjour ») → masqué ici (0 doublon). */
  exclude?: string | undefined;
}) {
  // Affiche TOUT ce que le serveur envoie : lui seul lit la configuration, et
  // c'est lui qui a déjà retiré les fournisseurs déclarés `hidden` (fixtures de
  // développement, entrées réservées à un autre point d'entrée). Filtrer ici
  // sur une table de marques masquerait précisément les fournisseurs qu'une
  // application enregistre elle-même — Keycloak, un OIDC d'entreprise.
  // `exclude` retire le mode déjà mis en avant (action primaire du rebonjour).
  const visible = social.filter((p) => p.name !== exclude);
  const showPasskey = passkey && exclude !== "passkey";
  // Rien à proposer : pas de « ou » suivi du vide.
  if (visible.length === 0 && !showPasskey) return null;
  return (
    <>
      <Divider label="ou" labelPosition="center" my={4} />
      {visible.map(({ name, label }) => {
        return (
          <Button
            key={name}
            size="md"
            fullWidth
            variant="default"
            onClick={() => onSocial(name)}
            disabled={disabled || busy}
            leftSection={<ProviderIcon name={name} size={18} />}
          >
            Continuer avec {label}
          </Button>
        );
      })}
      {showPasskey && (
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
        {visible.length > 0 && showPasskey
          ? "Connexion via un fournisseur externe (OAuth 2.0) ou sans mot de passe (WebAuthn / FIDO2)."
          : visible.length > 0
            ? "Connexion via un fournisseur externe (OAuth 2.0)."
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

  const flow = auth.flowState;
  const phase = auth.formStep;
  const lastMethod = useMemo(readLastMethod, []);

  const [identifier, setIdentifier] = useState(
    () => flow.identifier || (import.meta.env.DEV ? "admin" : ""),
  );
  // Dès que « Changer » est cliqué (on quitte le compte mémorisé), le « rebonjour »
  // method-aware laisse place au login mot de passe classique — sinon un login mdp
  // resterait piégé derrière le bouton social/passkey du dernier mode.
  const [forcePassword, setForcePassword] = useState(false);
  // Compte passkey : révèle le champ mot de passe À LA DEMANDE (« autre choix
  // login/mot de passe »), sans quitter le compte mémorisé ni perdre le bouton passkey.
  const [showPassword, setShowPassword] = useState(false);
  // 2ᵉ facteur (2FA TOTP) : code saisi + bascule vers le code de récupération
  // (TextInput libre) si l'application d'authentification est indisponible.
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);

  // Étapes PROPRES à Studio autour du déroulé : sonde du serveur avant, profil
  // et temps réel après. `busy` les couvre ; le déroulé dit `pending` pour SA
  // requête.
  const [step, setStep] = useState<ConnectionStep>("ping");
  const [busy, setBusy] = useState(false);
  const working = busy || flow.pending;
  const [localError, setLocalError] = useState<ILocalError | null>(null);
  // Échec du déroulé que l'utilisateur a « effacé » en retapant : l'état du
  // déroulé ne se modifie pas d'ici, on retient seulement lequel ne plus montrer.
  const [dismissed, setDismissed] = useState<NodefonyLoginError | null>(null);

  // Blocage (429) : l'échéance est celle du déroulé — qui refuse lui-même toute
  // action d'ici là. Un interval ne tourne QUE pendant le compte à rebours.
  const retryAt = flow.error?.kind === "throttled" ? flow.error.retryAt : null;
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (retryAt === null) return;
    const id = window.setInterval(() => {
      if (Date.now() >= retryAt) window.clearInterval(id);
      forceTick((n) => n + 1);
    }, 500);
    return () => window.clearInterval(id);
  }, [retryAt]);
  const cooldownLeft =
    retryAt === null
      ? 0
      : Math.max(0, Math.ceil((retryAt - Date.now()) / 1000));
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

  // Passkeys actives côté serveur ? `null` tant que la réponse n'est pas
  // arrivée. Échec ou service absent = coupées : un bouton qui répondrait 503
  // ne s'affiche pas. (Le déroulé dit si le NAVIGATEUR sait signer ; le
  // serveur seul sait si le service tourne.)
  const [passkeyEnabled, setPasskeyEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void store.api
      .getAbsolute<{ enabled?: unknown } | null>(WEBAUTHN_STATUS_PATH)
      .then((r) => {
        if (alive) setPasskeyEnabled(r?.enabled === true);
      })
      .catch(() => {
        if (alive) setPasskeyEnabled(false);
      });
    return () => {
      alive = false;
    };
  }, [store]);
  const passkeyOffered = passkeyEnabled === true && flow.passkeyAvailable;

  // Fournisseurs configurés, découverts par le déroulé : l'UI n'affiche QUE des
  // boutons opérationnels. Échec = liste vide (login classique + passkey restent).
  useEffect(() => {
    auth.loadProviders();
  }, [auth]);
  const social = flow.providers ?? [];

  // Retour d'un échec social (`?reason=`, ou `?error=oauth`) → message dans la
  // zone d'erreur RÉSERVÉE (aucun saut de mise en page). SAUF une annulation :
  // `reason=access_denied` (posé par le callback sous un `state` valide) dit
  // que l'utilisateur est revenu de lui-même choisir une autre méthode — lui
  // annoncer un échec serait faux.
  useEffect(() => {
    const query = new URLSearchParams(loc.search);
    const reason = query.get("reason");
    // `reason` est posé par le callback sur TOUT échec ; `error=oauth` reste lu
    // pour une adresse d'échec configurée qui le porte encore.
    if (
      (reason !== null || query.get("error") === "oauth") &&
      reason !== OAUTH2_CANCELLED_REASON
    ) {
      setLocalError({
        kind: "credentials",
        message: "La connexion via le fournisseur externe a échoué. Réessayez.",
      });
    }
  }, [loc.search]);

  const idRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);
  // Pas de `validate` Mantine : l'erreur native s'affiche SOUS le champ et
  // pousse le formulaire (saut). On valide à la main et on route le message vers
  // la ZONE RÉSERVÉE (comme les erreurs d'auth) → 0 mouvement.
  const passwordForm = useForm({ initialValues: { password: "" } });

  // Autofocus sur le champ pertinent (y compris APRÈS une erreur : `working`
  // repasse false → on refocalise le champ pour re-saisir sans clic).
  useEffect(() => {
    if (working) return;
    if (phase === "identifier") idRef.current?.focus();
    else if (phase === "password") pwRef.current?.focus();
  }, [phase, working]);

  const clearError = (): void => {
    if (localError) setLocalError(null);
    if (flow.error !== null && flow.error !== dismissed) {
      setDismissed(flow.error);
    }
  };

  // Étape 1 → 2 : AUCUN appel serveur (anti-énumération).
  const goToPassword = (): void => {
    if (!identifier.trim()) {
      setLocalError({ kind: "unknown", message: "Identifiant requis." });
      idRef.current?.focus();
      return;
    }
    clearError();
    auth.submitIdentifier(identifier);
  };

  const backToIdentifier = (): void => {
    clearError();
    passwordForm.reset();
    setForcePassword(true); // on quitte le compte mémorisé → login mot de passe classique
    setIdentifier(flow.identifier);
    auth.changeAccount();
  };

  // Fin de connexion COMMUNE (après auth réussie, mot de passe OU 2ᵉ facteur) :
  // profil → realtime (best-effort) → redirection.
  const completeAndRedirect = async (): Promise<void> => {
    setStep("user");
    await new Promise((r) => setTimeout(r, 150));
    // Realtime : best-effort. `conn.connect()` avale son timeout (la socket se
    // rétablit en fond) → l'auth réussie ne doit JAMAIS être bloquée par le WS.
    setStep("realtime");
    await conn.connect();
    setStep("done");
    const from = stateFrom(loc.state);
    const deepLink = from && from !== "/nodefony" && from !== "/nodefony/login";
    void navigate(deepLink ? from : auth.homePath, { replace: true });
  };

  const runFlow = async (password: string): Promise<void> => {
    setBusy(true);
    clearError();
    try {
      // Sonde propre à Studio : un serveur absent se dit AVANT d'envoyer le
      // mot de passe, et le bouton nomme l'étape.
      setStep("ping");
      try {
        await store.api.get("/health");
      } catch (e) {
        setLocalError(
          e instanceof ApiError && e.status >= 500
            ? { kind: "server", message: SERVER_MESSAGE }
            : { kind: "network", message: NETWORK_MESSAGE },
        );
        return;
      }
      setStep("auth");
      const state = await auth.submitPassword(password);
      if (state.step === "mfa") {
        // 2FA : mot de passe validé mais session NON ouverte → saisie du code.
        setCode("");
        setUseRecovery(false);
        return;
      }
      if (state.step === "authenticated") await completeAndRedirect();
    } finally {
      setBusy(false);
    }
  };

  // Vérifie le 2ᵉ facteur (code TOTP ou code de récupération) puis enchaîne la
  // fin de connexion. Sur échec, on reste à l'étape `mfa` (ressaisie possible) —
  // le défi serveur n'est consommé qu'au succès.
  const runMfaFlow = async (value: string): Promise<void> => {
    if (working || throttled) return;
    setBusy(true);
    clearError();
    try {
      setStep("auth");
      const state = await auth.completeMfa(value);
      if (state.step === "authenticated") await completeAndRedirect();
      else if (state.error?.kind !== "throttled") setCode("");
    } finally {
      setBusy(false);
    }
  };

  // Connexion par passkey/empreinte. L'annulation de l'invite est classée
  // `cancelled` par le déroulé, et reste SILENCIEUSE — pas une erreur.
  const runPasskeyFlow = async (): Promise<void> => {
    if (working || throttled) return;
    setBusy(true);
    clearError();
    try {
      setStep("auth");
      // Aucun identifiant transmis : le défi est découvrable et le navigateur
      // propose les passkeys du site (le serveur refuse tout ciblage anonyme).
      const state = await auth.loginWithPasskey();
      if (state.step !== "authenticated") return;
      setStep("realtime");
      await conn.connect();
      setStep("done");
      const from = stateFrom(loc.state);
      const deepLink =
        from && from !== "/nodefony" && from !== "/nodefony/login";
      void navigate(deepLink ? from : auth.homePath, { replace: true });
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

  // L'échec à montrer : celui de l'écran d'abord (saisie, retour de
  // fournisseur), sinon celui du déroulé tant qu'il n'a pas été effacé.
  const shown =
    localError ??
    (flow.error !== null && flow.error !== dismissed
      ? describeFlowError(flow.error, phase)
      : null);

  // Métadonnées de l'alerte selon la catégorie d'erreur (icône/couleur/titre).
  const alert = throttled
    ? {
        color: "yellow",
        icon: <IconClockHour4 size={16} />,
        title: "Trop de tentatives",
        body: `Pour votre sécurité, patientez ${cooldownLeft}s avant un nouvel essai.`,
      }
    : shown
      ? {
          color: shown.kind === "network" ? "orange" : "red",
          icon:
            shown.kind === "network" ? (
              <IconWifiOff size={16} />
            ) : shown.kind === "server" ? (
              <IconAlertTriangle size={16} />
            ) : (
              <IconAlertCircle size={16} />
            ),
          title:
            shown.kind === "network"
              ? "Connexion impossible"
              : shown.kind === "server"
                ? "Erreur serveur"
                : "Connexion échouée",
          body: shown.message,
        }
      : null;

  const pwProps = passwordForm.getInputProps("password");

  // « Rebonjour » : un compte SOCIAL (sans mot de passe) → bouton du fournisseur,
  // PAS de champ mot de passe. Un compte mot de passe OU passkey GARDE le champ mot
  // de passe (le passkey est une commodité EN PLUS, pas un remplacement) → le passkey
  // reste proposé dans les alternatives. Après « Changer », on repasse au mot de passe.
  const returningMethod = forcePassword ? "password" : lastMethod;
  // « Est-ce un compte social ? » se décide sur la MÉTHODE mémorisée, pas sur la
  // liste des marques connues ni sur celle du serveur : la première ignorait
  // Keycloak, la seconde arrive après le premier rendu. Se tromper ici affiche
  // un champ mot de passe à un compte qui n'en possède aucun.
  const isSocialReturn = isSocialMethod(returningMethod);
  // Passkeys coupées depuis la dernière visite : retour au mot de passe. Tant
  // que la réponse manque (`null`), le rebonjour garde la passkey en avant.
  const isPasskeyReturn =
    returningMethod === "passkey" && passkeyEnabled !== false;
  const returnChip = loginMethodChip(returningMethod, social);
  const ReturnIcon = returnChip.Icon;
  // Champ mot de passe : par défaut (compte mot de passe) ; À LA DEMANDE pour un
  // compte passkey (qui possède aussi un mot de passe) ; JAMAIS pour un compte
  // social (il n'en a pas → bouton du fournisseur seulement).
  const showPasswordField =
    !isSocialReturn && (!isPasskeyReturn || showPassword);
  const socialLabel = isSocialReturn
    ? `Continuer avec ${returnChip.label.replace(/^via /, "")}`
    : "";

  // Session encore INCONNUE (vérification en cours) : rien à proposer — et
  // surtout pas le formulaire, qui s'afficherait une demi-seconde avant la
  // redirection d'un utilisateur déjà connecté (vécu). La page reste au fond
  // du thème le temps de la réponse.
  if (auth.status === "idle" || auth.status === "loading")
    return (
      <Box
        mih="100dvh"
        aria-busy="true"
        aria-label="Vérification de la session"
      />
    );
  // Session DÉJÀ ouverte (ici, ou sur la page de connexion par défaut : même
  // cookie) → l'écran de connexion n'a rien à proposer, on file à la console,
  // AU RENDU : un effet laissait passer une image du formulaire. Pas pendant
  // une soumission : `completeAndRedirect` conduit alors la suite (profil,
  // temps réel) et redirige lui-même.
  if (auth.status === "authenticated" && !busy) {
    const from = stateFrom(loc.state);
    const deepLink = from && from !== "/nodefony" && from !== "/nodefony/login";
    return <Navigate to={deepLink ? from : auth.homePath} replace />;
  }

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
          {phase === "mfa" ? (
            /* ── 2ᵉ facteur : code TOTP (ou code de récupération) ── */
            <Stack gap="md">
              <Group gap="sm" wrap="nowrap">
                <ThemeIcon size={34} radius="xl" variant="light" color="brand">
                  <IconShieldLock size={18} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Text size="sm" fw={600}>
                    Vérification en deux étapes
                  </Text>
                  <Text size="xs" c="dimmed">
                    {useRecovery
                      ? "Saisissez un de vos codes de récupération."
                      : "Saisissez le code de votre application d'authentification."}
                  </Text>
                </div>
              </Group>
              {useRecovery ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const v = code.trim();
                    const err = validateTotpCode(v);
                    if (err) {
                      setLocalError({ kind: "unknown", message: err });
                      return;
                    }
                    void runMfaFlow(v);
                  }}
                >
                  <Stack gap="md">
                    <TextInput
                      size="md"
                      label="Code de récupération"
                      placeholder="XXXXX-XXXXX"
                      autoComplete="one-time-code"
                      value={code}
                      disabled={working}
                      onChange={(e) => {
                        setCode(e.currentTarget.value);
                        clearError();
                      }}
                    />
                    <Button
                      type="submit"
                      size="md"
                      fullWidth
                      color="brand"
                      loading={working}
                      disabled={throttled}
                      leftSection={
                        working ? undefined : <IconLogin size={18} />
                      }
                    >
                      {working
                        ? STEP_LABEL[step]
                        : throttled
                          ? `Réessayez dans ${cooldownLeft}s`
                          : "Vérifier"}
                    </Button>
                  </Stack>
                </form>
              ) : (
                <Stack gap="md">
                  <Group justify="center" w="100%">
                    <PinInput
                      length={6}
                      type="number"
                      inputType="tel"
                      inputMode="numeric"
                      oneTimeCode
                      // oxlint-disable-next-line jsx-a11y/no-autofocus -- étape du code, atteinte après validation du mot de passe : le focus suit le parcours
                      autoFocus
                      size="lg"
                      gap="md"
                      styles={{ input: { textAlign: "center" } }}
                      aria-label="Code à 6 chiffres"
                      value={code}
                      disabled={working}
                      onChange={setCode}
                      onComplete={(v) => {
                        if (!working && !throttled) void runMfaFlow(v);
                      }}
                    />
                  </Group>
                  <Button
                    fullWidth
                    size="md"
                    color="brand"
                    loading={working}
                    disabled={throttled || code.length !== 6}
                    leftSection={working ? undefined : <IconLogin size={18} />}
                    onClick={() => {
                      if (!working && !throttled) void runMfaFlow(code);
                    }}
                  >
                    {working
                      ? STEP_LABEL[step]
                      : throttled
                        ? `Réessayez dans ${cooldownLeft}s`
                        : "Vérifier"}
                  </Button>
                </Stack>
              )}
              <Group justify="space-between">
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  c="dimmed"
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    setCode("");
                    clearError();
                  }}
                >
                  {useRecovery
                    ? "Utiliser le code de l'application"
                    : "Utiliser un code de récupération"}
                </Anchor>
                <Anchor
                  component="button"
                  type="button"
                  size="xs"
                  c="dimmed"
                  onClick={() => {
                    clearError();
                    setCode("");
                    setUseRecovery(false);
                    auth.cancelMfa();
                  }}
                >
                  Annuler
                </Anchor>
              </Group>
            </Stack>
          ) : phase === "identifier" ? (
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
                  // Un identifiant n'est pas une phrase : ni majuscule imposée
                  // par le clavier mobile, ni correcteur.
                  autoCapitalize="none"
                  spellCheck={false}
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
                  onSocial={(name) => auth.startProvider(name)}
                  passkey={passkeyOffered}
                  onPasskey={() => void runPasskeyFlow()}
                  busy={working}
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
                        {flow.identifier}
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
                    disabled={working}
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
                    if (working || throttled) return;
                    if (!v.password) {
                      setLocalError({
                        kind: "unknown",
                        message: "Mot de passe requis.",
                      });
                      pwRef.current?.focus();
                      return;
                    }
                    void runFlow(v.password);
                  })}
                >
                  <Stack gap="md">
                    {/* Compte affiché plus haut, en champ masqué : le gestionnaire
                        de mots de passe rattache le secret à CE compte (HTML,
                        jeton « username »). */}
                    <input
                      type="text"
                      name="username"
                      autoComplete="username"
                      value={flow.identifier}
                      readOnly
                      hidden
                      tabIndex={-1}
                    />
                    <PasswordInput
                      {...pwProps}
                      ref={pwRef}
                      size="md"
                      label="Mot de passe"
                      placeholder="••••••••"
                      leftSection={<IconLock size={16} />}
                      autoComplete="current-password"
                      disabled={working}
                      onChange={(ev) => {
                        // Même geste que `pwProps.onChange` (typé `any` par Mantine) :
                        // `getInputProps` appelle `setFieldValue(…, { forceUpdate: false })`.
                        passwordForm.setFieldValue(
                          "password",
                          ev.currentTarget.value,
                          { forceUpdate: false },
                        );
                        clearError();
                      }}
                    />
                    <Button
                      type="submit"
                      size="md"
                      fullWidth
                      color="brand"
                      loading={working}
                      disabled={throttled}
                      leftSection={
                        working ? undefined : <IconLogin size={18} />
                      }
                    >
                      {working
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
                    loading={working}
                    disabled={throttled}
                    leftSection={<IconFingerprint size={18} />}
                    onClick={() => void runPasskeyFlow()}
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
                  loading={working}
                  disabled={throttled}
                  leftSection={<ReturnIcon size={18} />}
                  onClick={() => auth.startProvider(returningMethod)}
                >
                  {socialLabel}
                </Button>
              )}

              <AltLoginMethods
                social={social}
                onSocial={(name) => auth.startProvider(name)}
                passkey={passkeyOffered}
                onPasskey={() => void runPasskeyFlow()}
                busy={working}
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
              dev : admin / secret-de-dev-42
            </Text>
          )}
        </Group>
      </Stack>
    </AuthLayout>
  );
});
