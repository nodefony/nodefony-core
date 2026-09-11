import assert from "node:assert";
import { describe, it } from "vitest";

import type { IRepository } from "@nodefony/orm-core";

import type { <%= it.pascal %>Row } from "../nodefony/entity/<%= it.pascal %>";
import { <%= it.serviceClass %> } from "../nodefony/service/<%= it.serviceClass %>";

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
    const appels: unknown[][] = [];
    const faux = {
      find: async (...args: unknown[]): Promise<<%= it.pascal %>Row[]> => {
        appels.push(args);
        return [];
      },
    } as unknown as IRepository<<%= it.pascal %>Row>;

    const service = new <%= it.serviceClass %>(faux);
    const rendu = await service.find(undefined, { limit: 10 });

    assert.deepStrictEqual(rendu, []);
    assert.strictEqual(appels.length, 1, "le dépôt n'a pas été appelé");
  });
});
