/**
 * Éprouve le maillon où une donnée du tableau de bord peut disparaître SANS
 * ERREUR : la projection des nœuds GraphQL en items d'empreinte.
 *
 * Vécu : l'empreinte ne portait pas les dates de frise. Rien ne le disait — les
 * items avaient bien un `ordre` et des `jours`, la lecture hors ligne semblait
 * complète, et un calendrier décalé de dix jours restait invisible. Trois
 * points de rupture, tous silencieux : la requête cesse de demander les champs
 * de date, l'indexation oublie que `date` n'arrive ni sous `number` ni sous
 * `name`, ou la projection oublie de recopier les clefs.
 */
import { describe, expect, it } from "vitest";

import {
  ITEMS_QUERY,
  indexFieldValues,
  projectItems,
  renderFrise,
} from "./board-snapshot.mjs";

/** Un nœud d'item tel que GraphQL le rend, dates comprises. */
const noeud = (number, champs, titre = `ticket ${number}`) => ({
  content: {
    number,
    title: titre,
    url: `https://github.com/nodefony/nodefony-core/issues/${number}`,
    state: "OPEN",
    milestone: { title: "10.0.0-alpha" },
    labels: { nodes: [] },
  },
  fieldValues: { nodes: champs },
});

const champNombre = (nom, number) => ({
  __typename: "ProjectV2ItemFieldNumberValue",
  number,
  field: { name: nom },
});
const champChoix = (nom, name) => ({
  __typename: "ProjectV2ItemFieldSingleSelectValue",
  name,
  field: { name: nom },
});
const champDate = (nom, date) => ({
  __typename: "ProjectV2ItemFieldDateValue",
  date,
  field: { name: nom },
});

describe("la requête", () => {
  it("demande les champs de DATE — sans ce fragment, aucune frise ne remonte", () => {
    expect(ITEMS_QUERY).toContain("ProjectV2ItemFieldDateValue");
    expect(ITEMS_QUERY).toContain("date");
  });
});

describe("indexFieldValues", () => {
  it("retient une valeur de date, qui n'arrive ni sous `number` ni sous `name`", () => {
    const f = indexFieldValues(
      noeud(1, [champDate("Début", "2026-09-11"), champDate("Cible", null)]),
    );
    expect(f["Début"]).toBe("2026-09-11");
    // Une date vide reste une clef présente valant `null`, jamais `undefined` :
    // c'est ce qui distingue « pas de cible » de « champ jamais demandé ».
    expect(f.Cible).toBeNull();
  });

  it("indexe côte à côte nombres, choix et dates", () => {
    const f = indexFieldValues(
      noeud(2, [
        champNombre("Ordre", 9.91),
        champChoix("Status", "Todo"),
        champDate("Début", "2026-09-12"),
      ]),
    );
    expect(f).toMatchObject({
      Ordre: 9.91,
      Status: "Todo",
      Début: "2026-09-12",
    });
  });

  it("ignore une valeur sans nom de champ au lieu de casser", () => {
    expect(
      indexFieldValues({ fieldValues: { nodes: [{ number: 3 }] } }),
    ).toEqual({});
    expect(indexFieldValues({})).toEqual({});
  });
});

describe("projectItems", () => {
  it("porte la frise dans l'empreinte", () => {
    const [item] = projectItems([
      noeud(316, [
        champNombre("Ordre", 9.91),
        champDate("Début", "2026-09-11"),
        champDate("Cible", "2026-09-19"),
      ]),
    ]);
    expect(item.debut).toBe("2026-09-11");
    expect(item.cible).toBe("2026-09-19");
  });

  it("rend `null` — et non `undefined` — pour un ticket jamais daté", () => {
    const [item] = projectItems([noeud(42, [champNombre("Jours", 2)])]);
    expect(item.debut).toBeNull();
    expect(item.cible).toBeNull();
    expect(item.jours).toBe(2);
  });

  it("trie par ordre, les non classés en queue", () => {
    const items = projectItems([
      noeud(3, [champNombre("Ordre", 12)]),
      noeud(1, []),
      noeud(2, [champNombre("Ordre", 4)]),
    ]);
    expect(items.map((i) => i.number)).toEqual([2, 3, 1]);
  });

  it("écarte un nœud sans issue (une carte libre du tableau)", () => {
    expect(projectItems([{ content: {} }, noeud(7, [])])).toHaveLength(1);
  });

  it("prend le titre de l'ISSUE, jamais le champ recopié par le tableau", () => {
    const n = noeud(
      9,
      [champChoix("Title", "ancien libellé")],
      "titre courant",
    );
    expect(projectItems([n])[0].title).toBe("titre courant");
  });
});

describe("renderFrise", () => {
  it("abrège la cible quand elle est dans la même année que le départ", () => {
    expect(renderFrise({ debut: "2026-09-11", cible: "2026-09-19" })).toBe(
      "2026-09-11 → 09-19",
    );
  });

  it("garde l'année de la cible quand elle change", () => {
    expect(renderFrise({ debut: "2026-12-28", cible: "2027-01-06" })).toBe(
      "2026-12-28 → 2027-01-06",
    );
  });

  it("dit ce qui manque plutôt que de mentir", () => {
    expect(renderFrise({ debut: "2026-09-11", cible: null })).toBe(
      "2026-09-11 → ?",
    );
    expect(renderFrise({ debut: null, cible: "2026-09-19" })).toBe(
      "? → 2026-09-19",
    );
    expect(renderFrise({ debut: null, cible: null })).toBe("—");
  });
});
