// @vitest-environment jsdom
/**
 * Le journal FENÊTRÉE de la barre de debug : un DOM borné quel que soit le
 * tampon, des nœuds recyclés, la plus récente EN HAUT, et une vue qui ne bouge
 * pas sous l'œil quand on descend lire. jsdom ne fait aucune mise en page : la géométrie de
 * l'ascenseur (hauteur visible, défilement) est posée par le test — c'est
 * exactement ce que la vue lit, et rien d'autre.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  FeedView,
  LOG_ROW_H,
  isAtTop,
  visibleWindow,
} from "../client/debugbar/feedView";
import type { FeedLog } from "../client/debugbar/model";

function entree(seq: number, severity = 6): FeedLog {
  return {
    seq,
    severity,
    name: severity <= 3 ? "ERROR" : "INFO",
    text: `message ${seq}`,
    module: "kernel",
    ts: 1_700_000_000_000 + seq,
    uid: seq,
    msgid: "",
    pid: 1,
  };
}
const serie = (from: number, to: number): FeedLog[] => {
  const out: FeedLog[] = [];
  for (let s = from; s <= to; s++) out.push(entree(s));
  return out;
};

/** L'élément attendu, du type attendu — un test qui le trouve absent le DIT. */
function attendu<T extends Element>(
  x: Element | null | undefined,
  type: new () => T,
): T {
  if (!(x instanceof type))
    throw new Error("élément absent ou d'un autre type");
  return x;
}

/** Pose une géométrie d'ascenseur réaliste sur l'élément que jsdom ne mesure pas. */
function geometrie(scroller: HTMLElement, viewportH: number): void {
  let top = 0;
  Object.defineProperty(scroller, "clientHeight", { value: viewportH });
  Object.defineProperty(scroller, "scrollTop", {
    get: () => top,
    set: (v: number) => {
      const max = Math.max(
        0,
        parseFloat(
          attendu(scroller.firstElementChild, HTMLElement).style.height || "0",
        ) - viewportH,
      );
      top = Math.min(Math.max(0, v), max);
    },
  });
}

let root: HTMLElement;
let choisies: Array<FeedLog | null>;
let vue: FeedView;
let ascenseur: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  choisies = [];
  vue = new FeedView(root, {
    onSelect: (e) => choisies.push(e),
    tierOf: (s) => (s <= 3 ? "crit" : "info"),
    formatTime: (ts) => String(ts),
  });
  ascenseur = attendu(root.querySelector(".feedscroll"), HTMLElement);
  geometrie(ascenseur, 220); // 10 lignes visibles
});

const lignes = (): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(".log")].filter((n) => !n.hidden);
const saut = (): HTMLButtonElement =>
  attendu(root.querySelector(".feedjump"), HTMLButtonElement);
/** Une image d'animation — le rendu de la vue y est regroupé. */
const image = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
const defiler = (top: number): void => {
  ascenseur.scrollTop = top;
  ascenseur.dispatchEvent(new Event("scroll"));
};

describe("géométrie — fonctions pures", () => {
  it("la fenêtre couvre l'écran plus une marge, bornée au total", () => {
    expect(visibleWindow(0, 220, 2000, 22, 8)).toEqual({ start: 0, end: 19 });
    expect(visibleWindow(22 * 100, 220, 2000, 22, 8)).toEqual({
      start: 92,
      end: 119,
    });
    expect(visibleWindow(22 * 1995, 220, 2000, 22, 8)).toEqual({
      start: 1987,
      end: 2000,
    });
    expect(visibleWindow(0, 220, 0)).toEqual({ start: 0, end: 0 });
  });

  it("« en haut » tolère une demi-ligne d'arrondi", () => {
    expect(isAtTop(0)).toBe(true);
    expect(isAtTop(10)).toBe(true);
    expect(isAtTop(40)).toBe(false);
  });
});

describe("FeedView — le DOM reste borné, les nœuds sont recyclés", () => {
  it("🔴 2 000 entrées : une trentaine de lignes dans le DOM, pas 2 000", async () => {
    vue.setEntries(serie(1, 2000), -1);
    expect(vue.rowNodes).toBeLessThan(40);
    expect(root.querySelectorAll(".log").length).toBe(vue.rowNodes);
    // En HAUT aussi, et au milieu : en bas, la fin de la fenêtre coïncide avec
    // le total, et une fenêtre non bornée y passerait inaperçue.
    // Le défilement repeint à l'image SUIVANTE : compter avant, c'est mesurer
    // l'état d'avant — et une fenêtre non bornée passerait au vert.
    defiler(0);
    await image();
    expect(vue.rowNodes).toBeLessThan(40);
    defiler(1000 * LOG_ROW_H);
    await image();
    expect(vue.rowNodes).toBeLessThan(40);
  });

  it("de nouvelles entrées réutilisent les MÊMES nœuds — aucun HTML reconstruit", () => {
    vue.setEntries(serie(1, 500), -1);
    const avant = [...root.querySelectorAll(".log")];
    vue.setEntries(serie(1, 520), 20);
    const apres = [...root.querySelectorAll(".log")];
    expect(apres.length).toBe(avant.length);
    apres.forEach((n, i) => expect(n).toBe(avant[i]));
  });

  it("🔴 la plus récente est EN HAUT — visible sans défiler", () => {
    vue.setEntries(serie(1, 300), -1);
    const enTete = lignes().find((n) => n.style.transform.endsWith("(0px)"));
    expect(enTete?.dataset.seq).toBe("300");
    expect(ascenseur.scrollTop).toBe(0);
  });
});

describe("FeedView — rien ne bouge sous l'œil", () => {
  /** La séquence affichée en haut de l'écran — la ligne qu'on lit. */
  const enHautDeLecran = (list: FeedLog[]): number | undefined =>
    list[list.length - 1 - Math.floor(ascenseur.scrollTop / LOG_ROW_H)]?.seq;

  it("en haut, la vue SUIT le flux : la nouvelle s'affiche en tête", () => {
    vue.setEntries(serie(1, 100), -1);
    expect(vue.following).toBe(true);
    vue.setEntries(serie(1, 110), 10);
    expect(ascenseur.scrollTop).toBe(0);
    expect(saut().hidden).toBe(true);
  });

  it("🔴 descendu pour lire : la ligne lue ne bouge plus, et ce qui arrive est compté", () => {
    vue.setEntries(serie(1, 100), -1);
    defiler(40 * LOG_ROW_H); // la ligne 60 est en haut de l'écran
    expect(vue.following).toBe(false);
    expect(enHautDeLecran(serie(1, 100))).toBe(60);
    vue.setEntries(serie(1, 112), 12);
    // Douze nouvelles AU-DESSUS : la vue descend d'autant, la ligne 60 reste.
    expect(enHautDeLecran(serie(1, 112))).toBe(60);
    expect(saut().hidden).toBe(false);
    expect(saut().textContent).toBe("↑ 12 nouvelles");
  });

  it("🔴 le tampon perd ses plus anciennes : la ligne lue reste à sa place", () => {
    vue.setEntries(serie(1, 2000), -1);
    defiler(500 * LOG_ROW_H); // la ligne 1500 est en haut de l'écran
    // Le tampon a avancé de 300 : 1..300 sont partis, 2001..2300 arrivés.
    vue.setEntries(serie(301, 2300), 300);
    expect(enHautDeLecran(serie(301, 2300))).toBe(1500);
  });

  it("🔴 le MÊME tableau, modifié sur place : la ligne lue ne bouge pas", async () => {
    // Le cas du produit : sans filtre, la barre passe le tampon du modèle
    // lui-même, qui reçoit `push` et `splice` sur place. Une vue qui relirait
    // « l'ancienne » liste y trouverait déjà les nouvelles. Les tests qui
    // fabriquent un tableau neuf à chaque appel ne pouvaient pas le voir.
    const tampon = serie(1, 2000);
    vue.setEntries(tampon, -1);
    defiler(500 * LOG_ROW_H);
    await image();
    const lue = enHautDeLecran(tampon);
    for (let s = 2001; s <= 2025; s++) tampon.push(entree(s));
    tampon.splice(0, 25);
    vue.setEntries(tampon, 25);
    expect(enHautDeLecran(tampon)).toBe(lue);
  });

  it("« ↑ nouvelles » ramène au flux, et la vue suit de nouveau", () => {
    vue.setEntries(serie(1, 100), -1);
    defiler(30 * LOG_ROW_H);
    vue.setEntries(serie(1, 105), 5);
    saut().click();
    expect(vue.following).toBe(true);
    expect(saut().hidden).toBe(true);
    expect(ascenseur.scrollTop).toBe(0);
  });

  it("un filtre (jeu remplacé) ramène au flux", () => {
    vue.setEntries(serie(1, 100), -1);
    defiler(30 * LOG_ROW_H);
    vue.setEntries(serie(50, 60), -1);
    expect(vue.following).toBe(true);
    expect(saut().hidden).toBe(true);
  });
});

describe("FeedView — sélection et état vide", () => {
  it("un clic sélectionne l'entrée, un second la relâche", () => {
    vue.setEntries(serie(1, 30), -1);
    const l = attendu(
      lignes().find((n) => n.dataset.seq === "25"),
      HTMLElement,
    );
    l.click();
    expect(choisies.at(-1)?.seq).toBe(25);
    expect(l.classList.contains("sel")).toBe(true);
    l.click();
    expect(choisies.at(-1)).toBeNull();
  });

  it("liste vide : un message, pas une zone muette", () => {
    vue.setEntries([], -1, "aucune entrée ne correspond au filtre.");
    const vide = attendu(root.querySelector(".feedempty"), HTMLElement);
    expect(vide.hidden).toBe(false);
    expect(vide.textContent).toBe("aucune entrée ne correspond au filtre.");
  });
});
