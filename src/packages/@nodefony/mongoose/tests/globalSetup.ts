/// <reference types="node" />
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
  // Le dossier de données est À NOUS, et supprimé dans tous les cas. Laissé à
  // mongodb-memory-server, un démarrage RATÉ (délai dépassé sur un runner
  // chargé) abandonne son `mongo-mem-*` : `create()` lève avant de rendre
  // l'instance, et même un `stop()` ne le retire pas — la garde des temporaires
  // le nomme alors et fait échouer la passe (vu en forge Windows).
  const dbPath = mkdtempSync(path.join(os.tmpdir(), "nf-mongo-"));
  const removeDbPath = (): void =>
    rmSync(dbPath, { recursive: true, force: true });
  const replset = new MongoMemoryReplSet({
    replSet: { count: 1 },
    instanceOpts: [{ dbPath }],
  });
  try {
    await replset.start();
    project.provide("mongoUri", replset.getUri());
  } catch (error) {
    console.warn(
      `[mongo-test] mongod indisponible → bancs d'intégration skippés : ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    await replset.stop().catch(() => false);
    removeDbPath();
    project.provide("mongoUri", null);
    return async () => {};
  }
  return async () => {
    await replset.stop({ doCleanup: true, force: true });
    removeDbPath();
  };
}
