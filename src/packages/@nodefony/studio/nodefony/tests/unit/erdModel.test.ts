/// <reference types="node" />
/**
 * Unit — modèle du schéma ERD de la console (`routes/orm/erdModel.ts`).
 *
 * Trois lecteurs comptent les mêmes liens : le compteur de l'en-tête, la carte
 * des domaines et le dessin. Ils lisent tous `canonicalLinks` ; ces tests
 * tiennent la règle (une arête par clé étrangère physique, même déclarée des
 * deux côtés) et ce qu'en tirent la carte et le domaine ouvert.
 */
import { describe, it, expect } from "vitest";
import {
  type EntityNode,
  type RelationInfo,
  NONE,
  canonicalLinks,
  keyColumns,
  domainMap,
  domainScope,
} from "../../../frontend/src/routes/orm/erdModel";

const col = (name: string, primaryKey = false) => ({
  name,
  type: "integer",
  primaryKey,
  nullable: false,
  unique: false,
});

const entity = (
  name: string,
  domain: string,
  relations: RelationInfo[] = [],
  extra: string[] = [],
): EntityNode => ({
  name,
  connector: "default",
  module: "app",
  domain,
  columns: [
    col("rowid", true),
    ...relations
      .filter((r) => r.type === "many-to-one")
      .map((r) => col(r.foreignKey ?? "")),
    ...extra.map((c) => col(c)),
  ],
  relations,
});

const n1 = (target: string, foreignKey: string): RelationInfo => ({
  type: "many-to-one",
  target,
  field: foreignKey,
  foreignKey,
});

// facture → tiers (déclaré des DEUX côtés), ligne → facture, note isolée,
// user hors domaine visé par facture, et une table sans domaine ni module.
const schema: EntityNode[] = [
  entity(
    "facture",
    "facturation",
    [n1("tiers", "fk_soc"), n1("user", "fk_user")],
    ["ref", "total"],
  ),
  entity("ligne", "facturation", [n1("facture", "fk_facture")], ["qty"]),
  entity("note", "facturation", [], ["texte"]),
  {
    ...entity("tiers", "tiers"),
    relations: [
      {
        type: "one-to-many",
        target: "facture",
        field: "factures",
        foreignKey: "fk_soc",
      },
    ],
  },
  entity("user", "utilisateurs"),
  { ...entity("orphan", ""), module: "" },
];

describe("canonicalLinks — une arête par clé étrangère physique", () => {
  it("une FK déclarée des deux côtés n'est comptée qu'une fois, dans le sens FK → PK", () => {
    const links = canonicalLinks(schema);
    expect(links.map((l) => l.id).sort()).toEqual([
      "facture.fk_soc>tiers",
      "facture.fk_user>user",
      "ligne.fk_facture>facture",
    ]);
  });

  it("une relation dont la cible sort du périmètre est ignorée", () => {
    const scope = schema.filter((e) => e.name !== "user");
    expect(canonicalLinks(scope).some((l) => l.target === "user")).toBe(false);
  });

  it("un plusieurs-à-plusieurs déclaré des deux côtés reste une seule arête", () => {
    const m2m = (target: string): RelationInfo => ({
      type: "many-to-many",
      target,
      field: target,
    });
    const links = canonicalLinks([
      entity("a", "x", [m2m("b")]),
      entity("b", "x", [m2m("a")]),
    ]);
    expect(links).toHaveLength(1);
    expect(links[0]?.kind).toBe("many-to-many");
  });
});

describe("keyColumns — la boîte compacte ne garde que les clés", () => {
  it("clé primaire et clés étrangères portées, dans l'ordre de la table", () => {
    const facture = schema[0] as EntityNode;
    expect(keyColumns(facture).map((c) => c.name)).toEqual([
      "rowid",
      "fk_soc",
      "fk_user",
    ]);
  });
});

describe("domainMap — la carte des domaines", () => {
  const map = domainMap(schema);

  it("un lien par paire de domaines, pondéré par ses clés ; les liens internes n'y sont pas", () => {
    const pairs = map.links.map((l) => `${l.source}|${l.target}|${l.weight}`);
    expect(pairs.sort()).toEqual([
      "facturation|tiers|1",
      "facturation|utilisateurs|1",
    ]);
  });

  it("compte les tables et les tables sans aucun lien de chaque domaine", () => {
    const f = map.domains.find((d) => d.key === "facturation");
    expect(f).toMatchObject({ tables: 3, isolated: 1 });
  });

  it("le groupe vide porte la clé NONE et le libellé « — »", () => {
    expect(map.domains.find((d) => d.key === NONE)).toMatchObject({
      label: "—",
      tables: 1,
      isolated: 1,
    });
  });
});

describe("domainScope — un domaine ouvert et ses voisines", () => {
  it("les voisines d'autres domaines reliées par une clé, dans les deux sens", () => {
    const { members, ghosts } = domainScope(schema, "facturation");
    expect(members.map((e) => e.name).sort()).toEqual([
      "facture",
      "ligne",
      "note",
    ]);
    expect(ghosts.map((e) => e.name).sort()).toEqual(["tiers", "user"]);
  });

  it("un domaine VISÉ trouve aussi la table qui le vise", () => {
    expect(domainScope(schema, "tiers").ghosts.map((e) => e.name)).toEqual([
      "facture",
    ]);
  });
});
