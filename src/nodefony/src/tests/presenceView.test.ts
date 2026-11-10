import { describe, expect, it } from "vitest";
import {
  EMPTY_PRESENCE,
  isPresenceFrame,
  PresenceView,
} from "../realtime/presenceView";
import type { RealtimePresenceFrame } from "../realtime/RealtimeEventMap";

/**
 * Lecteur et vue PURS de la trame `realtime:presence` (ADR-0025 P2 bis, P3, #760
 * étape 3) — la seule implémentation, partagée par la socket du navigateur, ses
 * liaisons et le kit de test du serveur.
 */

const head = { channel: "room:1", count: 0, unnamed: 0 };
const list = (
  version: number,
  members: (string | number)[],
  extra: object = {},
): RealtimePresenceFrame => ({
  ...head,
  version,
  count: members.length / 2,
  members,
  ...extra,
});
const delta = (
  version: number,
  changes: { set?: (string | number)[]; gone?: string[] },
  count: number,
  extra: object = {},
): RealtimePresenceFrame => ({ ...head, version, count, changes, ...extra });

const tabsOf = (view: PresenceView): Record<string, number> =>
  Object.fromEntries(
    [...view.snapshot().members].map(([id, e]) => [id, e.tabs]),
  );

describe("isPresenceFrame — lecteur à liste fermée", () => {
  it("reconnaît les trois formes : liste, changements, nombres seuls", () => {
    expect(isPresenceFrame(list(3, ["a", 1, "b", 2]))).toBe(true);
    expect(isPresenceFrame(delta(4, { set: ["c", 1], gone: ["a"] }, 2))).toBe(
      true,
    );
    expect(isPresenceFrame({ ...head, version: 0 })).toBe(true);
    expect(isPresenceFrame(list(1, [], { partial: true }))).toBe(true);
    // Un champ inconnu est toléré : un serveur plus récent l'ajoute sans casser.
    expect(isPresenceFrame(list(1, ["a", 1], { futur: 1 }))).toBe(true);
  });

  it("🔴 refuse toute forme fausse d'un champ connu", () => {
    for (const bad of [
      null,
      [],
      "x",
      { ...head }, // version absente
      { ...head, version: -1 },
      { ...head, version: 1.5 },
      { ...head, version: 2 ** 53 },
      { ...head, version: 1, count: "1" },
      { ...head, version: 1, unnamed: -1 },
      { ...head, version: 1, channel: 1 },
      { ...head, version: 1, partial: false },
      list(1, ["a"]), // longueur impaire
      list(1, ["a", 0]), // onglets < 1
      list(1, ["a", 1.5]),
      list(1, [1, 1]), // identité non texte
      { ...list(1, ["a", 1]), changes: {} }, // les deux à la fois
      delta(1, { set: ["a"] }, 1),
      { ...head, version: 1, changes: { gone: [1] } },
      { ...head, version: 1, changes: [] },
      { ...head, version: 1, states: {} }, // états sans liste
      list(1, ["a", 1], { states: { a: 1 } }),
    ])
      expect(isPresenceFrame(bad), JSON.stringify(bad)).toBe(false);
  });

  it("n'accepte que des champs PROPRES : rien d'hérité ne passe", () => {
    const inherited = Object.create({ channel: "room:1", version: 1 });
    Object.assign(inherited, { count: 0, unnamed: 0 });
    expect(isPresenceFrame(inherited)).toBe(false);
  });
});

describe("PresenceView — la règle applied / gap / stale appliquée à une Map", () => {
  it("avant toute trame : vide, ready=false — « pas encore reçu » ≠ « vide »", () => {
    const view = new PresenceView("room:1");
    expect(view.snapshot()).to.deep.equal(EMPTY_PRESENCE);
    expect(view.snapshot().ready).toBe(false);
    view.apply(list(0, []));
    expect(view.snapshot().ready).toBe(true);
    expect(view.snapshot().members.size).toBe(0);
  });

  it("une liste remplace la vue et fonde la référence ; les changements suivants s'appliquent", () => {
    const view = new PresenceView("room:1");
    expect(view.apply(list(5, ["a", 1, "b", 2]))).toBe("applied");
    expect(view.reference).toBe(5);
    expect(view.apply(delta(6, { set: ["c", 1], gone: ["a"] }, 2))).toBe(
      "applied",
    );
    expect(tabsOf(view)).to.deep.equal({ b: 2, c: 1 });
    expect(view.snapshot().count).toBe(2);
    expect(view.reference).toBe(6);
  });

  it("🔴 trou de version : RIEN d'appliqué, vue figée (partial), tout changement suivant rend gap", () => {
    const view = new PresenceView("room:1");
    view.apply(list(5, ["a", 1]));
    expect(view.apply(delta(7, { set: ["z", 1] }, 2))).toBe("gap");
    expect(tabsOf(view)).to.deep.equal({ a: 1 });
    expect(view.synced).toBe(false);
    expect(view.snapshot().partial).toBe(true);
    // Le numéro « attendu » de l'ancienne référence ne passe plus.
    expect(view.apply(delta(6, { set: ["y", 1] }, 2))).toBe("gap");
    expect(tabsOf(view)).to.deep.equal({ a: 1 });
    // La liste referme le trou.
    expect(view.apply(list(9, ["a", 1, "z", 1]))).toBe("applied");
    expect(view.snapshot().partial).toBe(false);
  });

  it("🔴 déjà vu : jeté (stale), la vue ne bouge pas", () => {
    const view = new PresenceView("room:1");
    view.apply(list(5, ["a", 1]));
    view.apply(delta(6, { set: ["b", 1] }, 2));
    const before = view.snapshot();
    expect(view.apply(delta(6, { gone: ["b"] }, 1))).toBe("stale");
    expect(view.apply(delta(3, { gone: ["a"] }, 0))).toBe("stale");
    expect(view.snapshot()).toBe(before);
  });

  it("une liste non demandée est acceptée à tout moment, même plus ANCIENNE (RFC 5262 §4)", () => {
    const view = new PresenceView("room:1");
    view.apply(list(8, ["a", 1]));
    // Reconnecté sur un autre pod : sa version est autre, sa liste fait foi.
    expect(view.apply(list(2, ["b", 1]))).toBe("applied");
    expect(tabsOf(view)).to.deep.equal({ b: 1 });
    expect(view.reference).toBe(2);
  });

  it("nombres seuls : complète, vide la liste nommée, garde count/unnamed", () => {
    const view = new PresenceView("room:1");
    view.apply(list(1, ["a", 1]));
    view.apply({ ...head, version: 1, count: 1500, unnamed: 3 });
    const snap = view.snapshot();
    expect(snap.members.size).toBe(0);
    expect(snap.count).toBe(1500);
    expect(snap.unnamed).toBe(3);
  });

  it("unsync : la vue reste affichée, figée, et le changement attendu rend gap", () => {
    const view = new PresenceView("room:1");
    view.apply(list(1, ["a", 1]));
    expect(view.unsync()).toBe(true);
    expect(view.unsync()).toBe(false);
    expect(tabsOf(view)).to.deep.equal({ a: 1 });
    expect(view.snapshot().partial).toBe(true);
    expect(view.apply(delta(2, { set: ["b", 1] }, 2))).toBe("gap");
  });

  it("partial du serveur et `unnamed` repris de la trame", () => {
    const view = new PresenceView("room:1");
    view.apply(list(1, ["a", 1], { partial: true, unnamed: 4 }));
    expect(view.snapshot().partial).toBe(true);
    expect(view.snapshot().unnamed).toBe(4);
    view.apply(delta(2, {}, 1));
    expect(view.snapshot().partial).toBe(false);
  });

  it("instantané immuable : le même objet tant que rien ne change, jamais modifié après coup (copie à l'écriture)", () => {
    const view = new PresenceView("room:1");
    view.apply(list(1, ["a", 1]));
    const s1 = view.snapshot();
    expect(view.snapshot()).toBe(s1);
    view.apply(delta(2, { set: ["b", 1] }, 2));
    const s2 = view.snapshot();
    expect(s2).not.toBe(s1);
    expect([...s1.members.keys()]).to.deep.equal(["a"]);
    expect([...s2.members.keys()]).to.deep.equal(["a", "b"]);
    // Entrée inchangée reprise telle quelle (aucune allocation par présent stable).
    expect(s2.members.get("a")).toBe(s1.members.get("a"));
  });

  it("aucune clé héritée : `__proto__` est une identité comme une autre", () => {
    const view = new PresenceView("room:1");
    view.apply(list(1, ["__proto__", 2, "constructor", 1]));
    expect(
      [...view.snapshot().members].map(([id, e]) => [id, e.tabs]),
    ).to.deep.equal([
      ["__proto__", 2],
      ["constructor", 1],
    ]);
    expect(view.snapshot().members.get("toString")).toBe(undefined);
  });

  it("états : portés par l'entrée de l'identité qui en a", () => {
    const view = new PresenceView("room:1");
    view.apply(
      list(1, ["a", 2, "b", 1], { states: { a: { t1: { mic: true } } } }),
    );
    expect(view.snapshot().members.get("a")).to.deep.equal({
      tabs: 2,
      states: { t1: { mic: true } },
    });
    expect(view.snapshot().members.get("b")).to.deep.equal({ tabs: 1 });
  });

  it("une trame d'un autre canal est une erreur d'aiguillage", () => {
    const view = new PresenceView("room:1");
    expect(() => view.apply({ ...list(1, []), channel: "room:2" })).toThrow(
      /room:2/,
    );
  });
});
