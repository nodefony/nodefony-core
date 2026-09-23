import { describe, it, expect<% if (it.dialect === "sqlite") { %>, beforeAll, afterAll<% } %> } from "vitest";
<% if (it.dialect === "sqlite") { %>import { DrizzleOrm<% if (it.relationTargets.length) { %>, seedEntityRow<% } %> } from "@nodefony/drizzle";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import { <%= it.pascal %>Entity } from "../nodefony/entity/<%= it.pascal %>";
<% } %>import { <%= it.camel %>Sample } from "../nodefony/entity/<%= it.pascal %>";
import type { <%= it.pascal %>Row } from "../nodefony/entity/<%= it.pascal %>";
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
<% if (it.mongo) { %> * ⚠️ **La couche DONNÉES n'est pas éprouvée ici, et c'est délibéré.** Cette entité
 * est un document MongoDB : il n'existe pas de MongoDB en mémoire qui s'installe
 * sans rien. C'est la suite e2e (`npm run test:e2e`) qui l'éprouve, sur VOTRE
 * serveur : c'est là que se voient un index unique absent, ou une référence qui
 * ne se charge pas par `?include=`.
<% } else { %> * ⚠️ **La couche DONNÉES n'est pas éprouvée ici, et c'est délibéré.** Cette entité est
 * écrite pour <%= it.dialect %> : son schéma n'existe que dans ce dialecte, et l'ORM
 * refuse de le monter ailleurs — une base en mémoire ne peut donc pas la recevoir.
 * C'est la suite e2e (`npm run test:e2e`) qui l'éprouve, sur VOTRE serveur, avec les
 * types réels : c'est là que se voient un `char(3)` sorti en 255 ou une clé étrangère
 * dont le type ne correspond pas à la clé visée.
<% } %> */
<% } %>
<% if (it.relationParents.length) { %>/**
 * Identifiants des lignes **parentes**.
 *
 * Une relation est une vraie clé étrangère : la base REFUSE un identifiant qui ne
 * désigne rien. L'échantillon lit donc ce qui a été semé — et le test éprouve la
 * contrainte au lieu de la contourner.
 *
 * Il reste VIDE hors base en mémoire : sur un autre dialecte, ce fichier n'éprouve
 * que le contrat de validation, qui se moque de l'existence du parent.
 */
const parents: Record<string, string | number> = {};

<% } %>/** L'échantillon de l'entité — une seule fabrique pour les deux tests et la doc. */
const sample = (n: number): Partial<<%= it.pascal %>Row> =>
  <%= it.camel %>Sample(n<% if (it.relationParents.length) { %>, parents<% } %>);

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
<% if (it.relationTargets.length) { %>    // Les lignes parentes existent AVANT toute insertion : `seedEntityRow` lit les
    // colonnes obligatoires de la table visée et y pose une ligne valide, quels
    // que soient ses champs. Sans elle, toute création échouerait sur un
    // « FOREIGN KEY constraint failed » — la contrainte fait son travail.
<% it.relationTargets.forEach(function (target) { %>    parents.<%= target %> = await seedEntityRow(orm, { ...<%= target %>Entity, connector: ORM });
<% }) %><% } %>  });

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
