// @vitest-environment jsdom
/**
 * Le flux FENÊTRÉ de la barre de debug : un DOM borné quel que soit le
 * flux, des nœuds recyclés, la plus récente EN HAUT, et une vue qui ne bouge
 * pas sous l'œil quand on descend lire. La vue suit des CLÉS, pas un ordre :
 * une requête dépliée insère des lignes sous elle, et l'ancre de lecture comme
 * la sélection doivent y survivre. jsdom ne fait aucune mise en page : la
 * géométrie de l'ascenseur (hauteur visible, défilement) est posée par le
 * test — c'est exactement ce que la vue lit, et rien d'autre.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  FeedView,
  ROW_H,
  isAtTop,
  visibleWindow,
} from "../client/debugbar/feedView";

/** Une ligne de test : la vue ne connaît que sa clé et ce que l'hôte y écrit. */
interface ILigne {
  seq: number;
}

const entree = (seq: number): ILigne => ({ seq });
/** Le flux tel que la vue le reçoit : la plus récente EN TÊTE. */
const serie = (from: number, to: number): ILigne[] => {
  const out: ILigne[] = [];
  for (let s = to; s >= from; s--) out.push(entree(s));
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
let choisies: Array<ILigne | null>;
let actions: string[];
let vue: FeedView<ILigne>;
let ascenseur: HTMLElement;

beforeEach(() => {
  document.body.innerHTML = "";
  root = document.createElement("div");
  document.body.append(root);
  choisies = [];
  actions = [];
  vue = new FeedView<ILigne>(
    root,
    {
      keyOf: (l) => `k${l.seq}`,
      fill: (row, l) => {
        row.className = "ligne";
        row.innerHTML = `<span data-act="toggle">›</span><span>${l.seq}</span>`;
      },
      onSelect: (l) => choisies.push(l),
      onAction: (l, act) => actions.push(`${act}:${l.seq}`),
    },
    "flux de test",
  );
  ascenseur = attendu(root.querySelector(".feedscroll"), HTMLElement);
  geometrie(ascenseur, 240); // 10 lignes visibles
});

const lignes = (): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>(".row")].filter((n) => !n.hidden);
const ligneDe = (seq: number): HTMLElement =>
  attendu(
    lignes().find((n) => n.dataset.key === `k${seq}`),
    HTMLElement,
  );
const saut = (): HTMLButtonElement =>
  attendu(root.querySelector(".feedjump"), HTMLButtonElement);
/** Une image d'animation — le rendu de la vue y est regroupé. */
const image = (): Promise<void> => new Promise((r) => setTimeout(r, 40));
const defiler = (top: number): void => {
  ascenseur.scrollTop = top;
  ascenseur.dispatchEvent(new Event("scroll"));
};
/** La séquence affichée en haut de l'écran — la ligne qu'on lit. */
const enHautDeLecran = (list: readonly ILigne[]): number | undefined =>
  list[Math.floor(ascenseur.scrollTop / ROW_H)]?.seq;

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

  it("une ligne fait au moins 24 px — c'est une cible de pointeur", () => {
    expect(ROW_H).toBeGreaterThanOrEqual(24);
  });
});

describe("FeedView — le DOM reste borné, les nœuds sont recyclés", () => {
  it("🔴 2 000 lignes : une trentaine de nœuds dans le DOM, pas 2 000", async () => {
    vue.setEntries(serie(1, 2000), true, "");
    expect(vue.rowNodes).toBeLessThan(40);
    expect(root.querySelectorAll(".row").length).toBe(vue.rowNodes);
    // En HAUT aussi, et au milieu : en bas, la fin de la fenêtre coïncide avec
    // le total, et une fenêtre non bornée y passerait inaperçue.
    // Le défilement repeint à l'image SUIVANTE : compter avant, c'est mesurer
    // l'état d'avant — et une fenêtre non bornée passerait au vert.
    defiler(0);
    await image();
    expect(vue.rowNodes).toBeLessThan(40);
    defiler(1000 * ROW_H);
    await image();
    expect(vue.rowNodes).toBeLessThan(40);
  });

  it("de nouvelles lignes réutilisent les MÊMES nœuds", () => {
    vue.setEntries(serie(1, 500), true, "");
    const avant = [...root.querySelectorAll(".row")];
    vue.setEntries(serie(1, 520), false, "");
    const apres = [...root.querySelectorAll(".row")];
    expect(apres.length).toBe(avant.length);
    apres.forEach((n, i) => expect(n).toBe(avant[i]));
  });

  it("🔴 la plus récente est EN HAUT — visible sans défiler", () => {
    vue.setEntries(serie(1, 300), true, "");
    const enTete = lignes().find((n) => n.style.transform.endsWith("(0px)"));
    expect(enTete?.dataset.key).toBe("k300");
    expect(ascenseur.scrollTop).toBe(0);
  });

  it("la vue pose position, zébrure et sélection APRÈS le rendu de l'hôte", () => {
    vue.setEntries(serie(1, 30), true, "");
    const l = ligneDe(29); // deuxième ligne → zébrée
    expect(l.classList.contains("ligne")).toBe(true);
    expect(l.classList.contains("row")).toBe(true);
    expect(l.classList.contains("odd")).toBe(true);
    expect(l.getAttribute("role")).toBe("treeitem");
  });
});

describe("FeedView — rien ne bouge sous l'œil", () => {
  it("en haut, la vue SUIT le flux : la nouvelle s'affiche en tête", () => {
    vue.setEntries(serie(1, 100), true, "");
    expect(vue.following).toBe(true);
    vue.setEntries(serie(1, 110), false, "");
    expect(ascenseur.scrollTop).toBe(0);
    expect(saut().hidden).toBe(true);
  });

  it("🔴 descendu pour lire : la ligne lue ne bouge plus, et ce qui arrive est compté", () => {
    vue.setEntries(serie(1, 100), true, "");
    defiler(40 * ROW_H); // la ligne 60 est en haut de l'écran
    expect(vue.following).toBe(false);
    expect(enHautDeLecran(serie(1, 100))).toBe(60);
    vue.setEntries(serie(1, 112), false, "");
    // Douze nouvelles AU-DESSUS : la vue descend d'autant, la ligne 60 reste.
    expect(enHautDeLecran(serie(1, 112))).toBe(60);
    expect(saut().hidden).toBe(false);
    expect(saut().textContent).toBe("↑ 12 nouvelles");
  });

  it("🔴 le flux perd ses plus anciennes : la ligne lue reste à sa place", () => {
    vue.setEntries(serie(1, 2000), true, "");
    defiler(500 * ROW_H); // la ligne 1500 est en haut de l'écran
    // Le flux a avancé de 300 : 1..300 sont partis, 2001..2300 arrivés.
    vue.setEntries(serie(301, 2300), false, "");
    expect(enHautDeLecran(serie(301, 2300))).toBe(1500);
  });

  it("🔴 le MÊME tableau, modifié sur place : la ligne lue ne bouge pas", async () => {
    // Une vue qui relirait « l'ancienne » liste y trouverait déjà les
    // nouvelles : l'ancre est une CLÉ relevée au rendu, pas un index relu.
    const flux = serie(1, 2000);
    vue.setEntries(flux, true, "");
    defiler(500 * ROW_H);
    await image();
    const lue = enHautDeLecran(flux);
    for (let s = 2001; s <= 2025; s++) flux.unshift(entree(s));
    flux.splice(-25, 25);
    vue.setEntries(flux, false, "");
    expect(enHautDeLecran(flux)).toBe(lue);
  });

  it("🔴 une ligne INSÉRÉE sous la lecture (requête dépliée) ne déplace pas la ligne lue", () => {
    // L'ordre n'est plus monotone : la dichotomie sur une séquence croissante
    // ne pouvait pas retrouver une ligne dans ce flux.
    const flux = serie(1, 100);
    vue.setEntries(flux, true, "");
    defiler(40 * ROW_H);
    const lue = enHautDeLecran(flux);
    const deplie = [...flux];
    deplie.splice(45, 0, entree(9001), entree(9002), entree(9003));
    vue.setEntries(deplie, false, "");
    expect(enHautDeLecran(deplie)).toBe(lue);
    expect(saut().hidden).toBe(true);
  });

  it("« ↑ nouvelles » ramène au flux, et la vue suit de nouveau", () => {
    vue.setEntries(serie(1, 100), true, "");
    defiler(30 * ROW_H);
    vue.setEntries(serie(1, 105), false, "");
    saut().click();
    expect(vue.following).toBe(true);
    expect(saut().hidden).toBe(true);
    expect(ascenseur.scrollTop).toBe(0);
  });

  it("un filtre (jeu remplacé) ramène au flux", () => {
    vue.setEntries(serie(1, 100), true, "");
    defiler(30 * ROW_H);
    vue.setEntries(serie(50, 60), true, "");
    expect(vue.following).toBe(true);
    expect(saut().hidden).toBe(true);
  });
});

describe("FeedView — un tampon lu à l'envers, sans copie", () => {
  it("🔴 la plus récente en DERNIER dans le tampon s'affiche EN HAUT", () => {
    const tampon = [entree(1), entree(2), entree(3)];
    vue.setEntries(tampon, true, "", true);
    const enTete = lignes().find((n) => n.style.transform.endsWith("(0px)"));
    expect(enTete?.dataset.key).toBe("k3");
  });

  it("la sélection retrouve sa ligne dans un tampon lu à l'envers", () => {
    vue.setEntries(serie(1, 30).reverse(), true, "", true);
    ligneDe(25).click();
    expect(choisies.at(-1)?.seq).toBe(25);
  });
});

describe("FeedView — sélection, actions et état vide", () => {
  it("un clic sélectionne la ligne, un second la relâche", () => {
    vue.setEntries(serie(1, 30), true, "");
    const l = ligneDe(25);
    l.click();
    expect(choisies.at(-1)?.seq).toBe(25);
    expect(l.classList.contains("sel")).toBe(true);
    expect(l.getAttribute("aria-selected")).toBe("true");
    l.click();
    expect(choisies.at(-1)).toBeNull();
  });

  it("🔴 la sélection SUIT sa clé quand des lignes arrivent au-dessus", () => {
    vue.setEntries(serie(1, 30), true, "");
    ligneDe(25).click();
    vue.setEntries(serie(1, 32), false, "");
    expect(ligneDe(25).classList.contains("sel")).toBe(true);
    expect(lignes().filter((n) => n.classList.contains("sel"))).toHaveLength(1);
  });

  it("un clic sur un élément `[data-act]` est une ACTION, pas une sélection", () => {
    vue.setEntries(serie(1, 30), true, "");
    attendu(ligneDe(20).querySelector("[data-act]"), HTMLElement).click();
    expect(actions).toEqual(["toggle:20"]);
    expect(choisies).toEqual([]);
  });

  it("→ et ← au clavier déplient et replient la ligne qui a le focus", () => {
    vue.setEntries(serie(1, 30), true, "");
    const l = ligneDe(20);
    l.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    l.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
    );
    expect(actions).toEqual(["expand:20", "collapse:20"]);
  });

  it("liste vide : un message, pas une zone muette", () => {
    vue.setEntries([], true, "aucune entrée ne correspond au filtre.");
    const vide = attendu(root.querySelector(".feedempty"), HTMLElement);
    expect(vide.hidden).toBe(false);
    expect(vide.textContent).toBe("aucune entrée ne correspond au filtre.");
  });
});
