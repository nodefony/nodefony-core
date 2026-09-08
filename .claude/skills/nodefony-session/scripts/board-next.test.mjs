import { describe, it, expect } from "vitest";
import {
  chooseNextTicket,
  sortMilestones,
  openItemsOf,
} from "./board-next.mjs";

/**
 * Le décor est celui du 2026-09-08, à l'identique — c'est lui qui a produit le
 * faux verdict : la reprise a annoncé #175 (jalon `beta`) comme « la prochaine
 * chose » alors que neuf tickets `alpha` restaient ouverts. #175 portait l'ordre
 * 2, #274 l'ordre 1.4 : le tri global les départageait BIEN, et c'est par cette
 * chance que l'empreinte nommait le bon. Le décor ci-dessous retire la chance en
 * donnant au ticket `beta` le rang le plus petit du tableau.
 */
const JALONS = [
  { title: "10.0.0-alpha", dueOn: "2026-09-19" },
  { title: "10.0.0-beta", dueOn: "2026-10-14" },
  { title: "10.0.0", dueOn: "2026-11-15" },
  { title: "10.2.0", dueOn: null },
];

const OUVERTS = [
  {
    number: 175,
    ordre: 0.5,
    milestone: "10.0.0-beta",
    title: "publier la beta",
  },
  {
    number: 274,
    ordre: 1.4,
    milestone: "10.0.0-alpha",
    title: "gate de langue",
  },
  {
    number: 271,
    ordre: 4.3,
    milestone: "10.0.0-alpha",
    title: "studio fournisseurs",
  },
  { number: 900, ordre: 0.1, milestone: "10.2.0", title: "très loin" },
];

describe("le prochain ticket vient du jalon COURANT", () => {
  it("ignore un ticket mieux classé d'un jalon ultérieur", () => {
    const choix = chooseNextTicket(OUVERTS, JALONS);
    expect(choix.milestone).toBe("10.0.0-alpha");
    expect(choix.ticket.number).toBe(274);
  });

  it("passe au jalon suivant quand le courant n'a plus rien d'ouvert", () => {
    const sansAlpha = OUVERTS.filter((i) => i.milestone !== "10.0.0-alpha");
    const choix = chooseNextTicket(sansAlpha, JALONS);
    expect(choix.milestone).toBe("10.0.0-beta");
    expect(choix.ticket.number).toBe(175);
  });

  it("rend null sur un tableau sans rien d'ouvert", () => {
    expect(chooseNextTicket([], JALONS)).toBe(null);
  });

  // Un ticket sans jalon ne peut porter aucune livraison : il ne doit jamais
  // être annoncé comme la prochaine chose tant qu'un jalon a du travail.
  it("ne propose pas un ticket sans jalon devant le jalon courant", () => {
    const avecOrphelin = [
      { number: 999, ordre: 0.01, milestone: null, title: "orphelin" },
      ...OUVERTS,
    ];
    expect(chooseNextTicket(avecOrphelin, JALONS).ticket.number).toBe(274);
  });
});

describe("les fonctions d'appui", () => {
  it("ordonne les jalons par échéance, sans échéance en dernier", () => {
    expect(sortMilestones(JALONS).map((m) => m.title)).toEqual([
      "10.0.0-alpha",
      "10.0.0-beta",
      "10.0.0",
      "10.2.0",
    ]);
  });

  it("classe les items d'un jalon par ordre puis par numéro", () => {
    expect(openItemsOf(OUVERTS, "10.0.0-alpha").map((i) => i.number)).toEqual([
      274, 271,
    ]);
  });
});
