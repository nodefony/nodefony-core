/*
 *   NODEFONY FRAMEWORK UNIT TEST
 *   compareByOrder — le tri en mémoire partagé du contrat de page
 */

import { expect } from "chai";
import { compareByOrder, pickOrder } from "../runtime/pageSort";

interface Row {
  id: string;
  name: string;
  age: number;
  seen?: Date | null;
  active: boolean;
}

const rows = (): Row[] => [
  { id: "c", name: "bob", age: 30, seen: new Date(300), active: true },
  { id: "a", name: "alice", age: 30, seen: new Date(100), active: false },
  { id: "b", name: "carol", age: 25, seen: null, active: true },
];

const read = (r: Row, f: string) => r[f as keyof Row];

const sorted = (order: [string, "ASC" | "DESC"][]): string[] =>
  rows()
    .sort(compareByOrder(order, read))
    .map((r) => r.id);

describe("compareByOrder — un seul champ", () => {
  it("chaînes en ASC puis DESC", () => {
    expect(sorted([["name", "ASC"]])).to.deep.equal(["a", "c", "b"]);
    expect(sorted([["name", "DESC"]])).to.deep.equal(["b", "c", "a"]);
  });

  it("nombres comparés numériquement, pas lexicographiquement", () => {
    const nums = [{ n: 9 }, { n: 100 }, { n: 20 }];
    const out = nums
      .sort(compareByOrder([["n", "ASC"]], (r, f) => r[f as "n"]))
      .map((r) => r.n);
    expect(out, "9 < 20 < 100 — en texte ce serait 100 < 20 < 9").to.deep.equal(
      [9, 20, 100],
    );
  });

  it("dates comparées chronologiquement", () => {
    expect(sorted([["seen", "ASC"]]).slice(0, 2)).to.deep.equal(["a", "c"]);
  });

  it("booléens : false avant true en ASC", () => {
    expect(sorted([["active", "ASC"]])[0]).to.equal("a");
  });
});

describe("compareByOrder — multi-champs", () => {
  it("le second champ ne départage QUE les ex æquo du premier", () => {
    // bob et alice ont le même âge (30) → `name` tranche entre eux ; carol (25)
    // est placée par l'âge seul.
    expect(
      sorted([
        ["age", "ASC"],
        ["name", "ASC"],
      ]),
    ).to.deep.equal(["b", "a", "c"]);
  });

  it("les sens sont indépendants d'un champ à l'autre", () => {
    expect(
      sorted([
        ["age", "DESC"],
        ["name", "DESC"],
      ]),
    ).to.deep.equal(["c", "a", "b"]);
  });
});

describe("compareByOrder — valeurs absentes", () => {
  it("null/undefined finissent en QUEUE, y compris en DESC", () => {
    // `seen` est null pour carol : elle doit rester dernière dans les deux sens
    // — une valeur manquante est indéterminée, pas « la plus grande ».
    expect(sorted([["seen", "ASC"]]).at(-1)).to.equal("b");
    expect(sorted([["seen", "DESC"]]).at(-1)).to.equal("b");
  });

  it("un champ inconnu ne fait pas tomber le tri (tout ex æquo)", () => {
    expect(sorted([["nexistePas", "ASC"]])).to.deep.equal(["c", "a", "b"]);
  });
});

describe("compareByOrder — neutralité", () => {
  it("order vide → comparateur neutre, ordre d'origine préservé", () => {
    expect(sorted([])).to.deep.equal(["c", "a", "b"]);
  });

  it("le comparateur est pur (mêmes arguments, même verdict)", () => {
    const cmp = compareByOrder<Row>([["name", "ASC"]], read);
    const [x, y] = [rows()[0]!, rows()[1]!];
    expect(cmp(x, y)).to.equal(cmp(x, y));
    expect(cmp(x, y)).to.equal(-cmp(y, x));
  });
});

describe("pickOrder — ce qui n'est pas déclaré ne trie pas", () => {
  const ALLOWED = ["name", "age"] as const;
  const FALLBACK: Array<[string, "ASC" | "DESC"]> = [["id", "ASC"]];

  it("absent ou vide → l'ordre par défaut", () => {
    expect(pickOrder(undefined, ALLOWED, FALLBACK)).to.deep.equal(FALLBACK);
    expect(pickOrder([], ALLOWED, FALLBACK)).to.deep.equal(FALLBACK);
  });

  it("ne garde que les champs DÉCLARÉS, dans l'ordre demandé", () => {
    expect(
      pickOrder(
        [
          ["age", "DESC"],
          ["name", "ASC"],
        ],
        ALLOWED,
        FALLBACK,
      ),
    ).to.deep.equal([
      ["age", "DESC"],
      ["name", "ASC"],
    ]);
  });

  it("écarte les champs non déclarés SANS jeter le reste", () => {
    expect(
      pickOrder(
        [
          ["secret", "ASC"],
          ["name", "DESC"],
        ],
        ALLOWED,
        FALLBACK,
      ),
    ).to.deep.equal([["name", "DESC"]]);
  });

  it("rien de recevable → l'ordre par défaut, jamais un ordre vide", () => {
    // C'est ce qui protège le SQL : le nom de colonne y est CONCATÉNÉ, donc un
    // champ inventé ne doit jamais atteindre le `ORDER BY` — et une clause vide
    // rendrait la pagination offset non déterministe.
    const picked = pickOrder(
      [["'; DROP TABLE x --", "ASC"]],
      ALLOWED,
      FALLBACK,
    );
    expect(picked).to.deep.equal(FALLBACK);
    expect(picked.length).to.be.greaterThan(0);
  });

  it("une allowlist VIDE refuse tout (store qui ne déclare rien)", () => {
    expect(pickOrder([["name", "ASC"]], [], FALLBACK)).to.deep.equal(FALLBACK);
  });

  it("ne mute pas l'ordre reçu", () => {
    const input: Array<[string, "ASC" | "DESC"]> = [
      ["name", "ASC"],
      ["secret", "DESC"],
    ];
    pickOrder(input, ALLOWED, FALLBACK);
    expect(input).to.have.lengthOf(2);
  });
});
