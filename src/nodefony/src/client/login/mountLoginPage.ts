import {
  NodefonyLogin,
  type LoginStep,
  type NodefonyLoginError,
  type NodefonyLoginState,
} from "../auth/NodefonyLogin";
import { safeRedirectPath } from "../../runtime/safeRedirect";

/**
 * Textes que le script écrit lui-même dans la page. Tout le reste (libellés,
 * titres, boutons) vient du gabarit rendu par le serveur.
 */
export interface ILoginPageMessages {
  /** Refus du serveur (401/403) : UN message, quel que soit le motif. */
  readonly credentials: string;
  /** Trop d'essais : `{s}` est remplacé par les secondes restantes. */
  readonly throttled: string;
  /** Fin du blocage. */
  readonly throttleOver: string;
  readonly network: string;
  readonly server: string;
  readonly unsupported: string;
  /** Sous-titre de l'étape du second facteur. */
  readonly mfaSubtitle: string;
  readonly revealShow: string;
  readonly revealHide: string;
}

/** Textes par défaut, en français. */
export const DEFAULT_LOGIN_PAGE_MESSAGES: ILoginPageMessages = {
  credentials: "Identifiant ou mot de passe incorrect.",
  throttled: "Trop d'essais. Réessayez dans {s} s.",
  throttleOver: "Vous pouvez réessayer.",
  network: "Le serveur ne répond pas. Vérifiez votre connexion.",
  server: "Le serveur n'a pas pu ouvrir la session. Réessayez plus tard.",
  unsupported: "Ce navigateur ne sait pas se connecter de cette façon.",
  mfaSubtitle: "Un second facteur protège ce compte",
  revealShow: "Afficher le mot de passe",
  revealHide: "Masquer le mot de passe",
};

/** Réglages de {@link mountLoginPage} — tous facultatifs. */
export interface IMountLoginPageOptions {
  /** Déroulé à conduire ; défaut : un `NodefonyLogin` sur la même origine. */
  readonly login?: NodefonyLogin;
  /**
   * Page où aller une fois connecté. Défaut : l'attribut `data-from` de
   * l'élément `[data-nf-login]`, puis le paramètre `?from=` de l'adresse.
   * Toujours revalidée par `safeRedirectPath` — une valeur refusée retombe sur `/`.
   */
  readonly from?: string;
  /** Navigation finale ; défaut : `location.replace` (la page de connexion sort de l'historique). */
  readonly navigate?: (url: string) => void;
  readonly messages?: Partial<ILoginPageMessages>;
}

const STEPS: readonly LoginStep[] = [
  "identifier",
  "password",
  "mfa",
  "authenticated",
];

const SECOND_MS = 1000;

/**
 * Branche le déroulé de connexion sur le balisage de la page par défaut
 * (`nodefony/login.css`) : étapes `[data-step]`, onglets `[data-tab]`, zone
 * de message `[data-message]`, fournisseurs `[data-alt]`, passkey
 * `[data-passkey]`, bascule du mot de passe `[data-reveal]`, code à chiffres
 * `.nf-otp`.
 *
 * Le script n'écrit que du texte (`textContent`), jamais de balisage : ce que
 * le serveur renvoie ne peut pas devenir du HTML.
 *
 * @param doc - document qui porte la page
 * @param options - réglages facultatifs (déroulé, destination, textes)
 * @returns la fonction qui détache tout : écouteurs, abonnement, minuteur
 */
export function mountLoginPage(
  doc: Document,
  options: IMountLoginPageOptions = {},
): () => void {
  const messages = { ...DEFAULT_LOGIN_PAGE_MESSAGES, ...options.messages };
  const view = doc.defaultView;
  const username = doc.querySelector<HTMLInputElement>(
    '[data-step="identifier"] input[name="username"]',
  );
  const login =
    options.login ?? new NodefonyLogin({ identifier: username?.value ?? "" });
  const destination = safeRedirectPath(
    options.from ??
      doc.querySelector<HTMLElement>("[data-nf-login]")?.dataset.from ??
      new URLSearchParams(view?.location.search ?? "").get("from"),
  );
  const navigate =
    options.navigate ??
    ((url: string): void => {
      view?.location.replace(url);
    });

  const message = doc.querySelector<HTMLElement>("[data-message]");
  const alt = doc.querySelector<HTMLElement>("[data-alt]");
  const subtitle = doc.getElementById("nf-sub");
  const subtitleDefault = subtitle?.textContent ?? "";
  const otp = Array.from(
    doc.querySelectorAll<HTMLInputElement>('[data-step="mfa"] .nf-otp input'),
  );
  const passkey = doc.querySelector<HTMLElement>("[data-passkey]");
  if (passkey !== null) passkey.hidden = !login.getState().passkeyAvailable;

  let shownStep: LoginStep | null = null;
  let shownError: NodefonyLoginError | null = null;
  let countdown: ReturnType<typeof setInterval> | null = null;
  let left = false;

  const stopCountdown = (): void => {
    if (countdown === null) return;
    clearInterval(countdown);
    countdown = null;
  };

  const alert = (code: string, text: string): HTMLElement => {
    const p = doc.createElement("p");
    p.className = "nf-alert";
    p.setAttribute("role", "alert");
    const chip = doc.createElement("span");
    chip.className = "code";
    chip.textContent = code;
    const body = doc.createElement("span");
    body.textContent = text;
    p.append(chip, body);
    message?.replaceChildren(p);
    return body;
  };

  const showError = (error: NodefonyLoginError | null): void => {
    stopCountdown();
    if (error === null || error.kind === "cancelled") {
      // L'utilisateur a refermé l'invite lui-même : rien à lui apprendre.
      message?.replaceChildren();
      return;
    }
    const code = error.status === null ? "—" : String(error.status);
    if (error.kind !== "throttled" || error.retryAt === null) {
      alert(code, messages[error.kind === "throttled" ? "server" : error.kind]);
      return;
    }
    const retryAt = error.retryAt;
    const remaining = (): number =>
      Math.max(0, Math.ceil((retryAt - Date.now()) / SECOND_MS));
    const text = alert(
      code,
      messages.throttled.replace("{s}", String(remaining())),
    );
    countdown = setInterval(() => {
      const s = remaining();
      text.textContent =
        s > 0
          ? messages.throttled.replace("{s}", String(s))
          : messages.throttleOver;
      if (s === 0) stopCountdown();
    }, SECOND_MS);
  };

  const showStep = (state: NodefonyLoginState): void => {
    const at = STEPS.indexOf(state.step);
    for (const step of STEPS) {
      const section = doc.querySelector<HTMLElement>(`[data-step="${step}"]`);
      if (section !== null) section.hidden = step !== state.step;
    }
    for (const tab of doc.querySelectorAll<HTMLElement>("[data-tab]")) {
      const i = STEPS.findIndex((step) => step === tab.dataset.tab);
      if (i === at) tab.setAttribute("aria-current", "step");
      else tab.removeAttribute("aria-current");
      tab.classList.toggle("done", i < at);
      if (tab.dataset.tab === "mfa") tab.hidden = at < STEPS.indexOf("mfa");
    }
    if (alt !== null)
      alt.hidden = state.step === "mfa" || state.step === "authenticated";
    if (subtitle !== null)
      subtitle.textContent =
        state.step === "mfa" ? messages.mfaSubtitle : subtitleDefault;
    for (const who of doc.querySelectorAll<HTMLElement>(".nf-account .who"))
      who.textContent = state.identifier;
    for (const avatar of doc.querySelectorAll<HTMLElement>(
      ".nf-account .nf-avatar",
    ))
      avatar.textContent = state.identifier.charAt(0).toUpperCase();
    if (state.step === "authenticated") {
      for (const dest of doc.querySelectorAll<HTMLElement>(".nf-done .dest"))
        dest.textContent = `→ ${destination}`;
      navigate(destination);
      return;
    }
    if (state.step === "mfa") for (const input of otp) input.value = "";
    doc
      .querySelector<HTMLInputElement>(`[data-step="${state.step}"] input`)
      ?.focus();
  };

  const render = (state: NodefonyLoginState): void => {
    if (left) return;
    if (state.step !== shownStep) {
      shownStep = state.step;
      showStep(state);
    }
    // Un état neuf à chaque changement, mais la MÊME erreur tant qu'elle dure :
    // ne pas relancer le compte à rebours à chaque frappe.
    if (state.error !== shownError) {
      shownError = state.error;
      showError(state.error);
    }
    for (const form of doc.querySelectorAll<HTMLFormElement>(
      "form[data-step]",
    )) {
      form.setAttribute("aria-busy", String(state.pending));
      for (const button of form.querySelectorAll<HTMLButtonElement>(
        'button[type="submit"]',
      ))
        button.disabled = state.pending;
    }
  };

  const onSubmit = (event: Event): void => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement)) return;
    const step = form.dataset.step;
    if (step === undefined) return;
    event.preventDefault();
    if (step === "identifier") {
      login.submitIdentifier(username?.value ?? "");
    } else if (step === "password") {
      const password = form.querySelector<HTMLInputElement>(
        'input[name="password"]',
      );
      void login.submitPassword(password?.value ?? "");
      if (password !== null) password.value = "";
    } else if (step === "mfa") {
      void login.submitMfaCode(otp.map((input) => input.value).join(""));
    }
  };

  const onClick = (event: Event): void => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const control = target.closest<HTMLElement>("button, a");
    if (control === null) return;
    if (control.dataset.go === "identifier") {
      login.back();
    } else if (control.hasAttribute("data-passkey")) {
      void login.loginWithPasskey();
    } else if (control.hasAttribute("data-reveal")) {
      const input = control.parentElement?.querySelector("input");
      if (input === null || input === undefined) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      control.setAttribute("aria-pressed", String(show));
      control.setAttribute(
        "aria-label",
        show ? messages.revealHide : messages.revealShow,
      );
    }
  };

  const onOtpInput = (event: Event): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const i = otp.indexOf(input);
    if (i === -1) return;
    input.value = input.value.replace(/\D/gu, "").slice(-1);
    if (input.value !== "" && i < otp.length - 1) otp[i + 1]?.focus();
  };

  const onOtpKeydown = (event: KeyboardEvent): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    const i = otp.indexOf(input);
    if (i > 0 && event.key === "Backspace" && input.value === "")
      otp[i - 1]?.focus();
  };

  const onOtpPaste = (event: ClipboardEvent): void => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || !otp.includes(input)) return;
    const pasted = event.clipboardData?.getData("text") ?? "";
    const digits = pasted.replace(/\D/gu, "").slice(0, otp.length);
    if (digits.length < 2) return;
    event.preventDefault();
    otp.forEach((box, k) => {
      box.value = digits.charAt(k);
    });
    otp[Math.min(digits.length, otp.length - 1)]?.focus();
  };

  doc.addEventListener("submit", onSubmit);
  doc.addEventListener("click", onClick);
  doc.addEventListener("input", onOtpInput);
  doc.addEventListener("keydown", onOtpKeydown);
  doc.addEventListener("paste", onOtpPaste);
  const unsubscribe = login.subscribe(render);
  render(login.getState());

  return () => {
    left = true;
    stopCountdown();
    unsubscribe();
    doc.removeEventListener("submit", onSubmit);
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("input", onOtpInput);
    doc.removeEventListener("keydown", onOtpKeydown);
    doc.removeEventListener("paste", onOtpPaste);
  };
}
