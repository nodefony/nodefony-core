/**
 * La barre de débogage MANIPULÉE — pas relue.
 *
 * Le défaut que ces cas ferment est celui qu'on subissait à chaque usage : le
 * bandeau ENTIER écoutait le clic, si bien que viser une métrique, le nom de
 * l'application ou une puce refermait le panneau qu'on venait d'ouvrir. Trois
 * contrôles y survivaient en arrêtant la propagation — un `stopPropagation` par
 * contrôle ajouté étant le signe qu'on lutte contre son propre écouteur.
 *
 * Ces cas tiennent aussi ce qui n'était pas atteignable autrement qu'à la
 * souris : les contrôles sont de vrais boutons, le replieur porte son état
 * `aria-expanded`, et une entrée de journal s'ouvre au clavier.
 *
 * Aucun réseau : la socket est un double, et rien n'est publié.
 *
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { DebugBar } from "../client/debugbar/DebugBar";
import type { RealtimeClient } from "../client/realtime/RealtimeClient";

/** Socket double — la barre s'y abonne, elle ne reçoit rien. */
const fakeClient = (): RealtimeClient =>
  ({
    state: "disconnected",
    on: () => () => {},
    off: () => {},
    onState: () => () => {},
    onIdentity: () => () => {},
    onNotice: () => () => {},
    onStats: () => () => {},
    onReconnect: () => () => {},
    subscribe: () => {},
    unsubscribe: () => {},
    connect: () => Promise.resolve(),
    disconnect: () => {},
    request: () => Promise.resolve({}),
    getStats: () => [],
    channel: () => ({
      on: () => () => {},
      send: () => {},
      open: () => {},
      close: () => {},
    }),
  }) as unknown as RealtimeClient;

let bar: DebugBar | null = null;

/** Le Shadow DOM de la barre montée — c'est là que tout vit. */
const shadow = (): ShadowRoot => {
  const host = document.getElementById("nodefony-debugbar");
  if (!host?.shadowRoot) throw new Error("barre non montée");
  return host.shadowRoot;
};
const q = (sel: string): HTMLElement => {
  const el = shadow().querySelector(sel);
  if (!el) throw new Error(`introuvable : ${sel}`);
  return el as HTMLElement;
};
const isOpen = (): boolean => q(".bar").classList.contains("open");

beforeEach(() => {
  bar = new DebugBar({ client: fakeClient(), network: false, open: true });
  bar.mount();
});
afterEach(() => {
  bar?.unmount?.();
  bar = null;
  document.getElementById("nodefony-debugbar")?.remove();
  try {
    localStorage.clear();
  } catch {
    /* jsdom sans stockage */
  }
});

describe("bandeau — le clic ne referme plus ce qu'on regarde", () => {
  it("cliquer le NOM de l'application laisse le panneau ouvert", () => {
    expect(isOpen()).toBe(true);
    q(".brand").click();
    expect(isOpen()).toBe(true);
  });

  it("cliquer le badge d'environnement laisse le panneau ouvert", () => {
    q(".env-badge").click();
    expect(isOpen()).toBe(true);
  });

  it("cliquer une métrique OUVRE son onglet au lieu de replier", () => {
    q(".tab[data-tab='logs']").click();
    expect(q(".tab[data-tab='logs']").classList.contains("active")).toBe(true);
    // La métrique « rt » mène à l'onglet Realtime.
    q(".metric[data-goto='realtime']").click();
    expect(isOpen()).toBe(true);
    expect(q(".tab[data-tab='realtime']").classList.contains("active")).toBe(
      true,
    );
  });

  it("une puce de compteur mène à son onglet", () => {
    q(".chip.goto[data-goto='logs']").click();
    expect(isOpen()).toBe(true);
    expect(q(".tab[data-tab='logs']").classList.contains("active")).toBe(true);
  });

  it("un raccourci depuis le bandeau DÉPLIE si le panneau était replié", () => {
    q("[data-el='btnToggle']").click();
    expect(isOpen()).toBe(false);
    q(".chip.goto[data-goto='logs']").click();
    expect(isOpen()).toBe(true);
  });
});

describe("contrôles — de vrais boutons, avec leur état", () => {
  it("seul le replieur bascule le panneau, et il annonce son état", () => {
    const btn = q("[data-el='btnToggle']");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    btn.click();
    expect(isOpen()).toBe(false);
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    expect(btn.getAttribute("aria-label")).toContain("Déplier");
    btn.click();
    expect(isOpen()).toBe(true);
    expect(btn.getAttribute("aria-label")).toContain("Replier");
  });

  it("tous les contrôles du bandeau sont des boutons nommés", () => {
    for (const key of ["btnLive", "btnSide", "btnMin", "btnToggle"]) {
      const el = q(`[data-el='${key}']`);
      expect(el.tagName, key).toBe("BUTTON");
      const nom = el.getAttribute("aria-label") ?? el.textContent ?? "";
      expect(nom.trim().length, `${key} sans nom accessible`).toBeGreaterThan(
        0,
      );
    }
  });

  it("chaque indicateur du bandeau porte une aide", () => {
    for (const sel of [".brand", ".env-badge", ".branch", ".rt-pill"]) {
      expect(q(sel).getAttribute("data-tip"), sel).toBeTruthy();
    }
    for (const el of shadow().querySelectorAll(
      ".strip .metric, .strip .chip",
    )) {
      expect(el.getAttribute("data-tip"), el.className).toBeTruthy();
    }
  });

  it("réduire en pastille ne passe plus par un arrêt de propagation", () => {
    // L'état réduit se lit sur l'affichage, pas sur une classe : la barre se
    // masque et la pastille prend sa place (`applyChrome`).
    expect(q(".minbar").style.display).not.toBe("flex");
    q("[data-el='btnMin']").click();
    expect(q(".bar").style.display).toBe("none");
    expect(q(".minbar").style.display).toBe("flex");
  });
});
