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
import type { NodefonySocket } from "../client/realtime/NodefonySocket";

/** Socket double — la barre s'y abonne, elle ne reçoit rien. */
const fakeClient = (): NodefonySocket =>
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
  }) as unknown as NodefonySocket;

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
  it("cliquer le LOGO ouvre et ferme le panneau — lui seul, pas la bande", () => {
    // Le logo est le premier endroit où l'œil et la souris vont. La bande
    // entière, elle, ne bascule toujours rien (cf. cas suivants).
    const logo = q("[data-el='btnBrand']");
    expect(logo.tagName).toBe("BUTTON");
    expect(isOpen()).toBe(true);
    logo.click();
    expect(isOpen()).toBe(false);
    expect(logo.getAttribute("aria-expanded")).toBe("false");
    logo.click();
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
    expect(btn.getAttribute("aria-label")).toContain("Ouvrir");
    // Le libellé VISIBLE suit : c'est lui qu'on lit, pas l'infobulle.
    expect(btn.textContent).toContain("Ouvrir");
    btn.click();
    expect(isOpen()).toBe(true);
    expect(btn.getAttribute("aria-label")).toContain("Fermer");
    expect(btn.textContent).toContain("Fermer");
  });

  it("tous les contrôles du bandeau sont des boutons nommés, au libellé VISIBLE", () => {
    // Un glyphe seul (« ⇄ », « — », « ▴ ») obligeait à survoler chaque bouton
    // pour savoir ce qu'il fait : chaque contrôle porte un mot lisible.
    for (const key of ["btnMin", "btnToggle"]) {
      const el = q(`[data-el='${key}']`);
      expect(el.tagName, key).toBe("BUTTON");
      const nom = el.getAttribute("aria-label") ?? el.textContent ?? "";
      expect(nom.trim().length, `${key} sans nom accessible`).toBeGreaterThan(
        0,
      );
      const libelle = el.querySelector(".lbl")?.textContent ?? "";
      expect(
        libelle.trim().length,
        `${key} sans libellé visible`,
      ).toBeGreaterThan(2);
    }
    // « Temps réel » : UN contrôle qui dit son état EN TOUTES LETTRES et le
    // bascule. Demander le direct sans socket ouverte, c'est une attente —
    // jamais « arrêté », qui démentirait le clic.
    const rt = q("[data-el='btnLive']");
    expect(rt.tagName).toBe("BUTTON");
    expect(rt.textContent).toContain("Temps réel");
    expect(q("[data-el='rtCtlState']").textContent).toBe("arrêté");
    expect(rt.getAttribute("aria-pressed")).toBe("false");
    rt.click();
    expect(rt.getAttribute("aria-pressed")).toBe("true");
    expect(q("[data-el='rtCtlState']").textContent).toBe("connexion…");
    expect(rt.hasAttribute("aria-label")).toBe(false); // le texte visible EST le nom (WCAG 2.5.3)
  });

  it("le côté de la pastille se choisit dans les réglages, où il a un effet visible", () => {
    // Dans le bandeau, « ⇄ » ne changeait rien à l'écran : il déplace la
    // PASTILLE, qu'on ne voit que barre réduite.
    expect(shadow().querySelector(".strip [data-el='btnSideLeft']")).toBeNull();
    const gauche = q("[data-el='btnSideLeft']");
    const droite = q("[data-el='btnSideRight']");
    expect(droite.getAttribute("aria-pressed")).toBe("true");
    gauche.click();
    expect(gauche.getAttribute("aria-pressed")).toBe("true");
    expect(droite.getAttribute("aria-pressed")).toBe("false");
    expect(q(".minbar").getAttribute("class")).toContain("dock-left");
  });

  it("la pastille est un vrai bouton, qui dit ce qu'il fait", () => {
    const pastille = q(".minbar");
    expect(pastille.tagName).toBe("BUTTON");
    expect(pastille.getAttribute("aria-label")).toContain("Afficher");
    expect(pastille.textContent).toContain("Ouvrir");
  });

  it("chaque indicateur du bandeau porte une aide", () => {
    for (const sel of [".brand", ".env-badge", ".branch", ".rt"]) {
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

describe("connexion — à la demande, jamais au montage", () => {
  /** Socket double qui COMPTE ses ouvertures et rend ses écouteurs de notice. */
  function socketEspion() {
    const notices: Array<(n: { source: string; code?: number }) => void> = [];
    let connexions = 0;
    const client = {
      ...(fakeClient() as unknown as Record<string, unknown>),
      connect: () => {
        connexions++;
        return Promise.resolve();
      },
      onNotice: (h: (n: { source: string; code?: number }) => void) => {
        notices.push(h);
        return () => {};
      },
    } as unknown as NodefonySocket;
    return {
      client,
      connexions: () => connexions,
      notifier: (n: { source: string; code?: number }) =>
        notices.forEach((h) => h(n)),
    };
  }

  function monterAvec(client: NodefonySocket, open: boolean): void {
    bar?.unmount?.();
    document.getElementById("nodefony-debugbar")?.remove();
    bar = new DebugBar({ client, network: false, open });
    bar.mount();
  }

  it("🔴 monter la barre n'ouvre PAS la socket partagée — c'est l'hôte qui décide", () => {
    // Sur l'écran de connexion de la console, la socket partagée est
    // authentifiée : l'ouvrir au montage partait sans session, et le serveur la
    // refusait (1008) à chaque affichage.
    const espion = socketEspion();
    monterAvec(espion.client, false);
    expect(espion.connexions()).toBe(0);
  });

  it("ouvrir le panneau, ou activer le direct, ouvre la socket", () => {
    const espion = socketEspion();
    monterAvec(espion.client, false);
    q("[data-el='btnToggle']").click();
    expect(espion.connexions()).toBe(1);
    const autre = socketEspion();
    monterAvec(autre.client, false);
    q("[data-el='btnLive']").click();
    expect(autre.connexions()).toBe(1);
  });

  it("un refus d'accès (1008) se DIT, au lieu d'un point rouge muet", async () => {
    const espion = socketEspion();
    monterAvec(espion.client, true);
    espion.notifier({ source: "realtime", code: 1008 });
    await new Promise((r) => setTimeout(r, 50));
    expect(q("[data-el='rtCtlState']").textContent).toBe("accès refusé");
    expect(q("[data-el='btnLive']").getAttribute("data-tip")).toContain(
      "administrateur",
    );
  });
});

describe("bande — ce qu'on ne sait pas ne s'affiche pas", () => {
  it("l'environnement transmis au montage s'affiche tout de suite ; la branche inconnue est masquée", () => {
    bar?.unmount?.();
    document.getElementById("nodefony-debugbar")?.remove();
    bar = new DebugBar({
      client: fakeClient(),
      network: false,
      env: "development",
    });
    bar.mount();
    // Le nom se dit en français ; le code reste dans l'infobulle.
    expect(q("[data-el='envBadge']").textContent).toBe("développement");
    expect(q("[data-el='envBadge']").getAttribute("data-tip")).toContain(
      "development",
    );
    expect(q("[data-el='envBadge']").hasAttribute("hidden")).toBe(false);
    // La pastille réduite dit le MÊME mot que la bande — pas « DEVELOPMENT ».
    expect(q("[data-el='mEnv']").textContent).toBe("développement");
    expect(q("[data-el='mEnv']").classList.contains("dev")).toBe(true);
    // Sans mesure du serveur, la branche n'est pas connue : pas de « — ».
    expect(q("[data-el='branch']").hasAttribute("hidden")).toBe(true);
  });

  it("sans environnement connu, pas de badge « env » vide", () => {
    expect(q("[data-el='envBadge']").hasAttribute("hidden")).toBe(true);
  });

  it("le compteur HMR n'apparaît qu'avec un front Vite", () => {
    expect(shadow().querySelector("[data-el='hmrChip']")).toBeNull();
    bar?.unmount?.();
    document.getElementById("nodefony-debugbar")?.remove();
    bar = new DebugBar({
      client: fakeClient(),
      network: false,
      frontend: { framework: "react19", name: "app", viteOrigin: "" },
    });
    bar.mount();
    expect(q("[data-el='hmrChip']").textContent).toBe("0");
  });
});

describe("gabarit — un identifiant d'élément, un seul élément", () => {
  it("aucun `data-el` n'est porté deux fois", () => {
    // `this.el[clé]` ne garde que le DERNIER élément d'une clé : un doublon
    // envoie l'écriture ailleurs, sans erreur. Vécu : le libellé du contrôle
    // « Temps réel » partait dans la ligne « état » du panneau.
    const vus = new Map<string, number>();
    for (const el of shadow().querySelectorAll("[data-el]")) {
      const k = el.getAttribute("data-el") ?? "";
      vus.set(k, (vus.get(k) ?? 0) + 1);
    }
    const doublons = [...vus].filter(([, n]) => n > 1).map(([k]) => k);
    expect(doublons).toEqual([]);
  });
});

describe("feuille de style — ce qui part dans la page", () => {
  it("aucun commentaire de CODE dans la feuille injectée", () => {
    // Les commentaires vivent dans le source TS, entre les morceaux de la
    // chaîne `STYLES`. Un `//` glissé DANS la chaîne devient du CSS invalide,
    // qui fait sauter la règle suivante sans un mot.
    const css = shadow().querySelector("style")?.textContent ?? "";
    expect(css.length).toBeGreaterThan(1000);
    const fautives = css.split("\n").filter((l) => /^\s*\/\//.test(l));
    expect(fautives).toEqual([]);
  });
});
