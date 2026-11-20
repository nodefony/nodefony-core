import { describe, it, expect } from "vitest";
import {
  afterReleaseReminders,
  chooseNextTicket,
  newestStableVersion,
  isOpenItem,
  sortMilestones,
  openItemsOf,
  versionsToRelease,
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

describe("ce qui reste à faire — isOpenItem", () => {
  // Vécu : #797 fermé à la main (base `release/*`, pas de `Closes`) gardait
  // « In Progress » au tableau, et la reprise le proposait comme prochain ticket.
  it("un ticket FERMÉ n'est plus à faire, même resté « In Progress »", () => {
    expect(isOpenItem({ state: "CLOSED", status: "In Progress" })).toBe(false);
  });

  it("un ticket OUVERT reste à faire même « Done » — l'état fait foi (revue #796, B5)", () => {
    expect(isOpenItem({ state: "OPEN", status: "Done" })).toBe(true);
    // Sans état (brouillon du tableau), le statut décide.
    expect(isOpenItem({ status: "Done" })).toBe(false);
    expect(isOpenItem({ status: "Todo" })).toBe(true);
    expect(isOpenItem({ state: "OPEN", status: "In Progress" })).toBe(true);
    expect(isOpenItem({ state: "OPEN", status: null })).toBe(true);
  });

  it("la reprise ne propose pas le ticket fermé", () => {
    const items = [
      {
        number: 797,
        ordre: 1.01,
        milestone: "10.0.0-alpha",
        state: "CLOSED",
        status: "In Progress",
      },
      {
        number: 802,
        ordre: 1.02,
        milestone: "10.0.0-alpha",
        state: "OPEN",
        status: "In Progress",
      },
    ];
    expect(
      chooseNextTicket(items.filter(isOpenItem), JALONS).ticket.number,
    ).toBe(802);
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

  it("à échéance égale, place la pré-version AVANT la version finale", () => {
    // Vécu : `10.0.0-beta` et `10.0.0` échus le même jour — la comparaison de
    // chaînes rangeait `10.0.0` d'abord, et la reprise sautait tout le lot beta.
    const memeJour = [
      { title: "10.0.0", dueOn: "2026-11-15" },
      { title: "10.0.0-beta", dueOn: "2026-11-15" },
      { title: "10.1.0", dueOn: "2026-11-15" },
      { title: "10.0.0-alpha", dueOn: "2026-11-15" },
    ];
    expect(sortMilestones(memeJour).map((m) => m.title)).toEqual([
      "10.0.0-alpha",
      "10.0.0-beta",
      "10.0.0",
      "10.1.0",
    ]);
  });

  it("classe les items d'un jalon par ordre puis par numéro", () => {
    expect(openItemsOf(OUVERTS, "10.0.0-alpha").map((i) => i.number)).toEqual([
      274, 271,
    ]);
  });
});

describe("versionsToRelease — un lot soldé réclame sa publication", () => {
  const ferme = (extra) => ({ state: "CLOSED", status: "Done", ...extra });
  const ouvert = (extra) => ({ state: "OPEN", status: "Todo", ...extra });

  it("signale un lot dont tous les tickets sont fermés et la version non étiquetée", () => {
    const items = [
      ferme({ milestone: "10.0.x", labels: ["10.0.1"] }),
      ferme({ milestone: "10.0.x", labels: ["10.0.1"] }),
      ouvert({ milestone: "10.0.x", labels: ["10.0.2"] }),
    ];
    expect(versionsToRelease(items, ["v10.0.0"])).toEqual([
      { version: "10.0.1", closed: 2 },
    ]);
  });

  it("se tait tant qu'un ticket du lot reste ouvert", () => {
    const items = [
      ferme({ labels: ["10.0.1"] }),
      ouvert({ labels: ["10.0.1"] }),
    ];
    expect(versionsToRelease(items, [])).toEqual([]);
  });

  it("compte livré un ticket fermé resté « In Progress » — même règle que la reprise, `isOpenItem`", () => {
    // Vécu : #797 et #801 fermés à la main, restés « In Progress » au tableau.
    const items = [
      { state: "CLOSED", status: "In Progress", labels: ["10.0.1"] },
    ];
    expect(versionsToRelease(items, [])).toEqual([
      { version: "10.0.1", closed: 1 },
    ]);
  });

  it("se tait quand la version est étiquetée", () => {
    expect(
      versionsToRelease([ferme({ labels: ["10.0.1"] })], ["v10.0.1"]),
    ).toEqual([]);
  });

  it("lit aussi un jalon au nom de version, et ignore un jalon de maintenance", () => {
    const items = [
      ferme({ milestone: "10.1.0" }),
      ferme({ milestone: "10.0.x" }),
    ];
    expect(versionsToRelease(items, ["v10.0.0"])).toEqual([
      { version: "10.1.0", closed: 1 },
    ]);
  });

  it("un canal de pré-version est sorti dès une pré-version numérotée, ou par sa version finale", () => {
    const items = [
      ferme({ milestone: "10.0.0-alpha" }),
      ferme({ milestone: "10.0.0-beta" }),
      ferme({ milestone: "11.0.0-beta" }),
    ];
    expect(versionsToRelease(items, ["v10.0.0", "v11.0.0-beta.1"])).toEqual([]);
    expect(versionsToRelease(items, ["v10.0.0-alpha.9"])).toEqual([
      { version: "10.0.0-beta", closed: 1 },
      { version: "11.0.0-beta", closed: 1 },
    ]);
  });

  // Décision de la revue « normes » (#796) : un Epic ouvert qui porte le label du
  // lot le BLOQUE — un Epic se ferme quand ses enfants sont livrés, pas avant.
  it("un Epic ouvert au label du lot le bloque", () => {
    const items = [
      ferme({ labels: ["10.0.1"] }),
      ouvert({ labels: ["10.0.1", "Epic"] }),
    ];
    expect(versionsToRelease(items, [])).toEqual([]);
  });

  it("un lot sans aucun ticket fermé ne réclame rien", () => {
    expect(versionsToRelease([], [])).toEqual([]);
  });
});

describe("après une publication — afterReleaseReminders", () => {
  const TAGS = [
    "v10.0.0-beta.9",
    "v10.0.0",
    "v10.0.1",
    "v10.1.0-beta.1",
    "v9.9.10",
  ];

  it("la plus haute version FINALE, toutes lignes ou une seule", () => {
    expect(newestStableVersion(TAGS)).toBe("10.0.1");
    expect(newestStableVersion(TAGS, "10.0")).toBe("10.0.1");
    expect(newestStableVersion(TAGS, "9.9")).toBe("9.9.10");
    expect(newestStableVersion(TAGS, "10.1")).toBe(null);
    expect(newestStableVersion(["v10.0.9", "v10.0.10"])).toBe("10.0.10");
  });

  const m = (extra) => ({
    branch: "release/10.0.x",
    version: "10.0.1",
    inBranch: true,
    inDev: true,
    ...extra,
  });

  it("rien à dire quand tout est fait", () => {
    expect(
      afterReleaseReminders({
        newestStable: "10.0.1",
        latest: "10.0.1",
        maintenance: [m()],
      }),
    ).toEqual([]);
  });

  // Vécu (revue de #796) : --promouvoir laissait l'estampille « partir avec le
  // prochain push ordinaire » — il n'y en a plus en travail par PR.
  it("l'estampille absente de la branche de maintenance, avant la fusion arrière", () => {
    const [line, ...rest] = afterReleaseReminders({
      newestStable: "10.0.1",
      latest: "10.0.1",
      maintenance: [m({ inBranch: false, inDev: false })],
    });
    expect(line).toContain("git push origin release/10.0.x");
    expect(rest).toEqual([]);
  });

  it("la fusion arrière due nomme release-sync", () => {
    expect(
      afterReleaseReminders({
        newestStable: "10.0.1",
        latest: "10.0.1",
        maintenance: [m({ inDev: false })],
      })[0],
    ).toContain("release-sync.mjs");
  });

  it("npm latest en retard sur la dernière version étiquetée", () => {
    const [line] = afterReleaseReminders({
      newestStable: "10.0.1",
      latest: "10.0.0",
      maintenance: [],
    });
    expect(line).toContain("npm latest = 10.0.0");
  });

  // PIÈGE : hors ligne, l'étiquette npm n'est pas lue — se taire, pas accuser.
  it("se tait sur npm quand latest n'a pas été lue, ou est en avance", () => {
    for (const latest of [null, "10.0.2"])
      expect(
        afterReleaseReminders({
          newestStable: "10.0.1",
          latest,
          maintenance: [],
        }),
      ).toEqual([]);
  });
});
