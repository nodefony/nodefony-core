/// <reference types="node" />
import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    /**
     * URI Mongo PARTAGÉE par tous les bancs d'intégration, ou `null` si l'infra
     * (binaire `mongod` / réseau) est indisponible → les `describe.skipIf` se
     * skippent proprement (jamais d'échec dur quand l'infra manque).
     */
    mongoUri: string | null;
  }
}

/**
 * Provisionne UN SEUL serveur Mongo (ReplSet 1 nœud — supporte CRUD ET
 * transactions) partagé par TOUS les bancs d'intégration mongoose.
 *
 * Pourquoi : chaque fichier spawnait avant son PROPRE `mongod` au `beforeAll`.
 * Sous `npm run test` racine (turbo, tous les workspaces en parallèle), 4-6
 * `mongod` démarrant en même temps saturaient la machine → échecs flaky
 * (timeouts). Un seul serveur partagé supprime cette contention.
 *
 * `NF_MONGO_TEST_URI` (conteneur Mongo CI/Docker) court-circuite le spawn. Un échec
 * de provisioning (offline, binaire absent, ressources) → `mongoUri = null` →
 * suite skippée, pas en échec.
 */
export default async function setup(
  project: TestProject,
): Promise<() => Promise<void>> {
  const external = process.env.NF_MONGO_TEST_URI;
  if (external) {
    project.provide("mongoUri", external);
    return async () => {};
  }
  let replset: MongoMemoryReplSet | undefined;
  try {
    replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    project.provide("mongoUri", replset.getUri());
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(
      `[mongo-test] mongod indisponible → bancs d'intégration skippés : ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    project.provide("mongoUri", null);
  }
  return async () => {
    await replset?.stop();
  };
}
