import assert from "node:assert";
import { describe, it } from "vitest";

import type { IRepository } from "@nodefony/orm-core";

import type { <%= it.pascal %>Row } from "../nodefony/entity/<%= it.pascal %>";
import { <%= it.serviceClass %> } from "../nodefony/service/<%= it.serviceClass %>";

/** Appelé par un test qui n'aurait pas dû toucher à cette méthode du dépôt. */
const unexpected = (method: string) => (): never => {
  throw new Error(`le dépôt factice n'attend pas d'appel à ${method}()`);
};

/**
 * Un dépôt qui IMPLÉMENTE le contrat complet, sans conversion : `find` note ses
 * arguments, toute autre méthode échoue — un test qui en appelle une autre
 * l'apprend tout de suite, au lieu de lire un résultat inventé.
 */
class RecordingRepository implements IRepository<<%= it.pascal %>Row> {
  readonly calls: unknown[][] = [];

  async find(...args: unknown[]): Promise<<%= it.pascal %>Row[]> {
    this.calls.push(args);
    return [];
  }

  findOne = unexpected("findOne");
  create = unexpected("create");
  createMany = unexpected("createMany");
  updateOne = unexpected("updateOne");
  upsert = unexpected("upsert");
  updateMany = unexpected("updateMany");
  increment = unexpected("increment");
  delete = unexpected("delete");
  deleteOne = unexpected("deleteOne");
  findOneAndDelete = unexpected("findOneAndDelete");
  count = unexpected("count");
  countDistinct = unexpected("countDistinct");
  exists = unexpected("exists");
  withTransaction = unexpected("withTransaction");
}

/**
 * Ce que ce test PROUVE, et pourquoi il tient en dix lignes : le service reçoit
 * son dépôt par le CONSTRUCTEUR, donc il s'interroge sans base, sans connecteur
 * ouvert et sans kernel démarré. C'est la propriété qui justifie le patron —
 * aller chercher le registre ORM depuis chaque méthode la ferait disparaître, et
 * plus rien ici ne serait éprouvable sans infrastructure.
 *
 * Il n'assied AUCUNE assertion sur les colonnes : elles t'appartiennent, et un
 * test écrit dessus serait rouge au premier champ ajouté. Les tests de l'entité
 * (`tests/<%= it.kebab %>.test.ts`) couvrent la table elle-même, sur une base
 * sqlite en mémoire.
 */
describe("<%= it.serviceClass %>", () => {
  it("délègue la lecture au dépôt reçu au constructeur — aucune base requise", async () => {
    const faux = new RecordingRepository();

    const service = new <%= it.serviceClass %>(faux);
    const rendu = await service.find(undefined, { limit: 10 });

    assert.deepStrictEqual(rendu, []);
    assert.strictEqual(faux.calls.length, 1, "le dépôt n'a pas été appelé");
  });
});
