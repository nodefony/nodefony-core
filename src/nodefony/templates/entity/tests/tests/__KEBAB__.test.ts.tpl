import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { DrizzleOrm } from "@nodefony/drizzle";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { <%= it.pascal %>Entity } from "../nodefony/entity/<%= it.pascal %>";
import type { <%= it.pascal %>Row } from "../nodefony/entity/<%= it.pascal %>";
import { create<%= it.pascal %>Schema } from "../nodefony/entity/<%= it.pascal %>.schema";

/**
 * L'entité, sur une vraie base — en mémoire, donc sans rien installer.
 *
 * Ce que ces tests protègent : le schéma tient la route (la table se crée, les données
 * font l'aller-retour) et le contrat d'entrée refuse ce qu'il doit refuser. Ils tournent
 * sans serveur : c'est la couche données, seule.
 */

const ORM = "test-<%= it.kebab %>";

/**
 * Échantillon **variable** — indispensable dès qu'un champ est unique : deux insertions
 * du même objet violeraient la contrainte, et le test échouerait sur lui-même.
 */
const sample = (n: number): Partial<<%= it.pascal %>Row> => (<%= it.sampleFactory %>);

describe("<%= it.pascal %> — entité", () => {
  let orm: DrizzleOrm;

  beforeAll(async () => {
    entityRegistry.register({ ...<%= it.pascal %>Entity, connector: ORM });
    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("<%= it.pascal %>", ORM);
    ormRegistry.unregister(ORM);
  });

  it("crée la table et fait l'aller-retour d'un enregistrement", async () => {
    const repo = orm.getRepository<<%= it.pascal %>Row>("<%= it.pascal %>");
    const created = await repo.create(sample(1));

    expect(created.id).toBeTruthy();
    const found = await repo.findOne({ id: created.id });
    expect(found).not.toBeNull();
  });

  it("compte ce qu'on y met", async () => {
    const repo = orm.getRepository<<%= it.pascal %>Row>("<%= it.pascal %>");
    const before = await repo.count();
    await repo.create(sample(2));
    expect(await repo.count()).toBe(before + 1);
  });

  it("le contrat d'entrée refuse un corps vide", () => {
    // Le service appelle ce même schéma : un rejet devient un 422 côté HTTP et WS.
    expect(() => create<%= it.pascal %>Schema.parse({})).toThrow();
  });

  it("le contrat d'entrée retire les champs inconnus (anti-promotion)", () => {
    const parsed = create<%= it.pascal %>Schema.parse({
      ...sample(3),
      role: "admin",
    });
    expect(parsed).not.toHaveProperty("role");
  });
});
