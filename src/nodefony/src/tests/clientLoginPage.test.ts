// @vitest-environment jsdom
/**
 * Le script de la page de connexion (`nodefony/login.js`) EXÉCUTÉ sur le
 * balisage de la page par défaut : le déroulé fait bouger les étapes, la
 * destination passe par la garde anti-redirection ouverte, un message du
 * serveur ne devient jamais du HTML, et démonter détache tout.
 * Les règles du déroulé lui-même sont éprouvées dans `clientNodefonyLogin.test.ts`.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { NodefonyLogin } from "../client/auth/NodefonyLogin";
import {
  mountLoginPage,
  DEFAULT_LOGIN_PAGE_MESSAGES,
} from "../client/login/mountLoginPage";
import { loginFetchBench } from "./fixtures/loginFetch";

// Balisage de `docs/design/login/f03-frontispice.html`, réduit à ce que lit le script.
const PAGE = `
<p class="nf-sub" id="nf-sub">Compte de l'organisation</p>
<ol class="nf-steps">
  <li data-tab="identifier" aria-current="step">Identifiant</li>
  <li data-tab="password">Mot de passe</li>
  <li data-tab="mfa" hidden>Vérification</li>
</ol>
<form data-step="identifier">
  <input id="nf-username" name="username" />
  <button class="nf-btn primary" type="submit">Continuer</button>
</form>
<form data-step="password" hidden>
  <div class="nf-account"><span class="nf-avatar"></span><span class="who"></span>
    <button type="button" class="nf-link" data-go="identifier">Changer</button></div>
  <div class="nf-input"><input id="nf-password" name="password" type="password" />
    <button type="button" class="nf-reveal" data-reveal aria-pressed="false">œil</button></div>
  <button class="nf-btn primary" type="submit">Se connecter</button>
</form>
<form data-step="mfa" hidden>
  <div class="nf-otp"><input /><input /><input /><input /><input /><input /></div>
  <button class="nf-btn primary" type="submit">Vérifier</button>
</form>
<div data-step="authenticated" hidden><div class="nf-done"><span class="dest"></span></div></div>
<div data-alt><button type="button" class="nf-btn" data-passkey>Passkey</button></div>
<div class="nf-message" aria-live="polite" data-message></div>`;

let unmount: (() => void) | null = null;

afterEach(() => {
  unmount?.();
  unmount = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

const $as = <T extends Element>(
  selector: string,
  kind: abstract new () => T,
): T => {
  const el = document.querySelector(selector);
  if (!(el instanceof kind)) throw new Error(`absent : ${selector}`);
  return el;
};

const $ = (selector: string): HTMLElement => $as(selector, HTMLElement);

const submit = (step: string): void => {
  $as(`form[data-step="${step}"]`, HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
};

const flush = async (): Promise<void> => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    }),
  );

function mount(
  fetch: typeof globalThis.fetch,
  from?: string,
): { navigate: ReturnType<typeof vi.fn> } {
  document.body.innerHTML = PAGE;
  const navigate = vi.fn();
  unmount = mountLoginPage(document, {
    login: new NodefonyLogin({ fetch, passkey: null }),
    navigate,
    ...(from === undefined ? {} : { from }),
  });
  return { navigate };
}

describe("page de connexion — le déroulé sur le balisage", () => {
  it("🔴 identifiant → mot de passe → code → session ouverte, puis départ vers `from`", async () => {
    const bench = loginFetchBench();
    const { navigate } = mount(bench.fetch, "/admin/users?tab=2");

    $as("#nf-username", HTMLInputElement).value = "admin";
    submit("identifier");
    expect($('[data-step="password"]').hidden).toBe(false);
    expect($('[data-step="identifier"]').hidden).toBe(true);
    expect($('[data-tab="password"]').getAttribute("aria-current")).toBe(
      "step",
    );
    expect($('[data-tab="identifier"]').classList.contains("done")).toBe(true);
    expect($(".nf-account .who").textContent).toBe("admin");
    expect($(".nf-account .nf-avatar").textContent).toBe("A");

    $as("#nf-password", HTMLInputElement).value = "secret";
    submit("password");
    await flush();
    expect($('[data-step="mfa"]').hidden).toBe(false);
    expect($('[data-tab="mfa"]').hidden).toBe(false);
    expect($("[data-alt]").hidden).toBe(true);
    expect($("#nf-sub").textContent).toBe(
      DEFAULT_LOGIN_PAGE_MESSAGES.mfaSubtitle,
    );
    // Le mot de passe ne reste pas dans le DOM une fois envoyé.
    expect($as("#nf-password", HTMLInputElement).value).toBe("");

    const boxes = document.querySelectorAll<HTMLInputElement>(".nf-otp input");
    "123456".split("").forEach((d, i) => {
      const box = boxes[i];
      if (box !== undefined) box.value = d;
    });
    submit("mfa");
    await flush();
    expect($('[data-step="authenticated"]').hidden).toBe(false);
    expect($(".nf-done .dest").textContent).toBe("→ /admin/users?tab=2");
    expect(navigate).toHaveBeenCalledWith("/admin/users?tab=2");
    expect(bench.calls).toHaveLength(2);
  });

  it("🔴 une destination hors de l'origine retombe sur `/` (CWE-601)", async () => {
    for (const hostile of [
      "//evil.example",
      "/\\evil.example",
      "https://evil.example",
      "javascript:alert(1)",
    ]) {
      const bench = loginFetchBench();
      const { navigate } = mount(bench.fetch, hostile);
      $as("#nf-username", HTMLInputElement).value = "admin";
      submit("identifier");
      submit("password");
      await flush();
      document
        .querySelectorAll<HTMLInputElement>(".nf-otp input")
        .forEach((box, i) => {
          box.value = "123456".charAt(i);
        });
      submit("mfa");
      await flush();
      expect(navigate, hostile).toHaveBeenCalledWith("/");
      unmount?.();
      unmount = null;
    }
  });

  it("🔴 la destination se lit sur `[data-nf-login]` quand le réglage ne la donne pas", async () => {
    const bench = loginFetchBench();
    document.body.innerHTML = `<main data-nf-login data-from="/board">${PAGE}</main>`;
    const navigate = vi.fn();
    unmount = mountLoginPage(document, {
      login: new NodefonyLogin({ fetch: bench.fetch, passkey: null }),
      navigate,
    });
    $as("#nf-username", HTMLInputElement).value = "admin";
    submit("identifier");
    submit("password");
    await flush();
    document
      .querySelectorAll<HTMLInputElement>(".nf-otp input")
      .forEach((box, i) => {
        box.value = "123456".charAt(i);
      });
    submit("mfa");
    await flush();
    expect(navigate).toHaveBeenCalledWith("/board");
  });

  it("🔴 un refus affiche UN message fixe, jamais le texte du serveur, et jamais en HTML", async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const { navigate } = mount(() => json(401, { error: hostile }));
    $as("#nf-username", HTMLInputElement).value = hostile;
    submit("identifier");
    submit("password");
    await flush();
    const alert = $("[data-message] .nf-alert");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toBe(
      `401${DEFAULT_LOGIN_PAGE_MESSAGES.credentials}`,
    );
    // L'identifiant saisi est affiché comme TEXTE.
    expect($(".nf-account .who").textContent).toBe(hostile);
    expect(document.querySelector("img")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("🔴 trop d'essais : compte à rebours, puis « vous pouvez réessayer », minuteur arrêté", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    mount(() =>
      json(429, { error: "Too many attempts" }, { "retry-after": "3" }),
    );
    $as("#nf-username", HTMLInputElement).value = "admin";
    submit("identifier");
    submit("password");
    await flush();
    const text = (): string =>
      $("[data-message] .nf-alert span:last-child").textContent ?? "";
    expect(text()).toBe(
      DEFAULT_LOGIN_PAGE_MESSAGES.throttled.replace("{s}", "3"),
    );
    vi.advanceTimersByTime(1000);
    expect(text()).toBe(
      DEFAULT_LOGIN_PAGE_MESSAGES.throttled.replace("{s}", "2"),
    );
    vi.advanceTimersByTime(2000);
    expect(text()).toBe(DEFAULT_LOGIN_PAGE_MESSAGES.throttleOver);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("🔴 démonter détache tout : plus d'envoi, plus de minuteur", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    const calls: string[] = [];
    mount((input) => {
      calls.push(typeof input === "string" ? input : "requête");
      return json(429, {}, { "retry-after": "30" });
    });
    $as("#nf-username", HTMLInputElement).value = "admin";
    submit("identifier");
    submit("password");
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    unmount?.();
    unmount = null;
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(31_000);
    submit("password");
    await flush();
    expect(calls).toHaveLength(1);
  });

  it("🔴 pendant l'envoi, les boutons d'envoi sont désactivés", async () => {
    let release: (r: Response) => void = () => undefined;
    mount(() => new Promise<Response>((r) => (release = r)));
    $as("#nf-username", HTMLInputElement).value = "admin";
    submit("identifier");
    submit("password");
    const button = $as(
      'form[data-step="password"] button[type="submit"]',
      HTMLButtonElement,
    );
    expect(button.disabled).toBe(true);
    expect($('form[data-step="password"]').getAttribute("aria-busy")).toBe(
      "true",
    );
    release(new Response("{}", { status: 401 }));
    await flush();
    expect(button.disabled).toBe(false);
  });

  it("« Changer » ramène à l'identifiant ; l'œil bascule le mot de passe ; la passkey se cache si absente", () => {
    mount(loginFetchBench().fetch);
    expect($("[data-passkey]").hidden).toBe(true);
    $as("#nf-username", HTMLInputElement).value = "admin";
    submit("identifier");
    $("[data-reveal]").click();
    expect($as("#nf-password", HTMLInputElement).type).toBe("text");
    expect($("[data-reveal]").getAttribute("aria-pressed")).toBe("true");
    expect($("[data-reveal]").getAttribute("aria-label")).toBe(
      DEFAULT_LOGIN_PAGE_MESSAGES.revealHide,
    );
    $('[data-go="identifier"]').click();
    expect($('[data-step="identifier"]').hidden).toBe(false);
  });

  it("le code se colle d'un bloc dans les six cases", () => {
    mount(loginFetchBench().fetch);
    const boxes = Array.from(
      document.querySelectorAll<HTMLInputElement>(".nf-otp input"),
    );
    const first = boxes[0];
    if (first === undefined) throw new Error("cases absentes");
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", {
      value: { getData: () => "12 34 56" },
    });
    first.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(boxes.map((b) => b.value).join("")).toBe("123456");
  });

  it("🔴 `?from=` hostile lu dans l'ADRESSE retombe sur `/` (CWE-601)", async () => {
    const bench = loginFetchBench();
    window.history.replaceState(null, "", "/login?from=%2F%2Fevil.example");
    try {
      document.body.innerHTML = PAGE;
      const navigate = vi.fn();
      unmount = mountLoginPage(document, {
        login: new NodefonyLogin({ fetch: bench.fetch, passkey: null }),
        navigate,
      });
      $as("#nf-username", HTMLInputElement).value = "admin";
      submit("identifier");
      submit("password");
      await flush();
      document
        .querySelectorAll<HTMLInputElement>(".nf-otp input")
        .forEach((box, i) => {
          box.value = "123456".charAt(i);
        });
      submit("mfa");
      await flush();
      expect(navigate).toHaveBeenCalledWith("/");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });

  it("une case du code n'accepte qu'un chiffre", () => {
    mount(loginFetchBench().fetch);
    const box = $as(".nf-otp input", HTMLInputElement);
    box.value = "a<7";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    expect(box.value).toBe("7");
  });

  it("une passkey refermée par l'utilisateur n'affiche aucune erreur", async () => {
    document.body.innerHTML = PAGE;
    const cancelled = new DOMException("refermée", "NotAllowedError");
    unmount = mountLoginPage(document, {
      login: new NodefonyLogin({
        fetch: () => json(200, { challenge: "x" }),
        passkey: { sign: () => Promise.reject(cancelled) },
      }),
      navigate: vi.fn(),
    });
    expect($("[data-passkey]").hidden).toBe(false);
    $("[data-passkey]").click();
    await flush();
    expect($("[data-message]").childElementCount).toBe(0);
  });
});
