import { describe, it, expect<% if (it.dialect === "sqlite") { %>, beforeAll, afterAll<% } %> } from "vitest";
<% if (it.dialect === "sqlite") { %>import { DrizzleOrm } from "@nodefony/drizzle";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { <%= it.pascal %>Entity } from "../nodefony/entity/<%= it.pascal %>";
<% } %>import type { <%= it.pascal %>Row } from "../nodefony/entity/<%= it.pascal %>";
import { create<%= it.pascal %>Schema } from "../nodefony/entity/<%= it.pascal %>.schema";
<% if (it.dialect === "sqlite") { it.relationTargets.forEach(function (target) { %>import { <%= target %>Entity } from "../nodefony/entity/<%= target %>";
<% }) } %>
<% if (it.dialect === "sqlite") { %>/**
 * L'entité, sur une vraie base — en mémoire, donc sans rien installer.
 *
 * Ce que ces tests protègent : le schéma tient la route (la table se crée, les données
 * font l'aller-retour) et le contrat d'entrée refuse ce qu'il doit refuser. Ils tournent
 * sans serveur : c'est la couche données, seule.
 */

const ORM = "test-<%= it.kebab %>";
<% } else { %>/**
 * L'entité — son CONTRAT d'entrée, sans serveur.
 *
 * Ce que ces tests protègent : le schéma de validation refuse ce qu'il doit refuser.
 * Ils tournent partout, sans rien installer.
 *
 * ⚠️ **La couche DONNÉES n'est pas éprouvée ici, et c'est délibéré.** Cette entité est
 * écrite pour <%= it.dialect %> : son schéma n'existe que dans ce dialecte, et l'ORM
 * refuse de le monter ailleurs — une base en mémoire ne peut donc pas la recevoir.
 * C'est la suite e2e (`npm run test:e2e`) qui l'éprouve, sur VOTRE serveur, avec les
 * types réels : c'est là que se voient un `char(3)` sorti en 255 ou une clé étrangère
 * dont le type ne correspond pas à la clé visée.
 */
<% } %>
/**
 * Échantillon **variable** — indispensable dès qu'un champ est unique : deux insertions
 * du même objet violeraient la contrainte, et le test échouerait sur lui-même.
 */
const sample = (n: number): Partial<<%= it.pascal %>Row> => (<%= it.sampleFactory %>);

describe("<%= it.pascal %> — entité", () => {
<% if (it.dialect === "sqlite") { %>  let orm: DrizzleOrm;

  beforeAll(async () => {
    entityRegistry.register({ ...<%= it.pascal %>Entity, connector: ORM });
<% if (it.relationTargets.length) { %>    // Les cibles des relations sont enregistrées AVEC l'entité : l'ORM résout les
    // relations déclarées au moment de se connecter, et lève si l'une d'elles
    // pointe une entité qu'il ne connaît pas. C'est volontaire — une relation
    // vers une entité absente est une panne au boot, pas un détail de test.
<% it.relationTargets.forEach(function (target) { %>    entityRegistry.register({ ...<%= target %>Entity, connector: ORM });
<% }) %><% } %>    orm = new DrizzleOrm(ORM, { filename: ":memory:" });
    await orm.connect();
  });

  afterAll(async () => {
    await orm.disconnect();
    entityRegistry.unregister("<%= it.pascal %>", ORM);
<% it.relationTargets.forEach(function (target) { %>    entityRegistry.unregister("<%= target %>", ORM);
<% }) %>    ormRegistry.unregister(ORM);
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

<% } %>  it("le contrat d'entrée refuse un corps vide", () => {
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
