/**
 * **Un ORM déclaré au mauvais rang condamne les magasins durables — en silence.**
 *
 * `@nodefony/security` fabrique ses magasins à son propre démarrage. Un ORM
 * déclaré APRÈS lui dans `modules` n'est pas encore connecté à cet instant :
 * sessions, jetons, passkeys, audit et second facteur retombent en mémoire, et
 * le serveur sert quand même du trafic. Constaté en bootant réellement sur
 * MongoDB — aucune suite ne pouvait le voir, les bancs montant l'ORM à la main.
 *
 * Le décor est PUREMENT déclaratif : l'ordre et les déclarations sont injectés,
 * donc ces cas tournent sans paquet installé, sans disque et sans noyau.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import fs from "node:fs";
import path from "node:path";
import { withoutComments } from "../kernel/checks/sourceText";
import {
  extractManifestModuleOrder,
  parseStoreManifest,
  findStoreOrderFault,
  storeOrderFaultMessage,
  type IStoreManifestEntry,
} from "../kernel/storeManifest";

/** Raccourci de décor : une entrée de manifeste et ce que son paquet déclare. */
function entree(
  name: string,
  nodefony?: Record<string, unknown>,
): IStoreManifestEntry {
  return { name, manifest: parseStoreManifest(nodefony ? { nodefony } : {}) };
}

const ORM_SQL = { storeKind: "durable", stores: ["session", "tokens"] };
const ORM_MONGO = { storeKind: "durable", stores: ["session", "audit"] };
const CACHE = { storeKind: "cache", stores: ["session", "idempotency"] };
const CONSUMER = { consumesStores: true };

describe("parseStoreManifest — ce qu'un paquet DÉCLARE de ses magasins", () => {
  it("rend null quand le paquet ne dit rien des magasins", () => {
    assert.isNull(parseStoreManifest({ name: "@nodefony/http" }));
    assert.isNull(parseStoreManifest({ nodefony: { other: 1 } }));
    assert.isNull(parseStoreManifest(null));
    assert.isNull(parseStoreManifest("pas un objet"));
  });

  it("lit un fournisseur durable, ses briques et sa nature", () => {
    const m = parseStoreManifest({ nodefony: ORM_SQL });
    assert.isTrue(m?.provides);
    assert.strictEqual(m?.storeKind, "durable");
    assert.deepEqual(m?.stores, ["session", "tokens"]);
    assert.isFalse(m?.consumesStores);
  });

  it("`durable` est le DÉFAUT — un adaptateur qui oublie sa nature n'est pas pris pour un cache", () => {
    const m = parseStoreManifest({ nodefony: { stores: ["session"] } });
    assert.strictEqual(m?.storeKind, "durable");
  });

  it("écarte les entrées de `stores` qui ne sont pas des chaînes", () => {
    const m = parseStoreManifest({
      nodefony: { stores: ["session", 42, null, "audit"] },
    });
    assert.deepEqual(m?.stores, ["session", "audit"]);
  });

  it("lit un consommateur, qui ne fournit rien", () => {
    const m = parseStoreManifest({ nodefony: CONSUMER });
    assert.isTrue(m?.consumesStores);
    assert.isFalse(m?.provides);
    assert.deepEqual(m?.stores, []);
  });
});

describe("findStoreOrderFault — la garde d'ordre du manifeste", () => {
  it("accepte l'ordre du dépôt : les ORM en tête, le consommateur après", () => {
    assert.isNull(
      findStoreOrderFault([
        entree("@nodefony/drizzle", ORM_SQL),
        entree("@nodefony/mongoose", ORM_MONGO),
        entree("@nodefony/http"),
        entree("@nodefony/framework"),
        entree("@nodefony/security", CONSUMER),
      ]),
    );
  });

  it("🔴 REFUSE un ORM déclaré après le consommateur — le cas vécu sur MongoDB", () => {
    const fault = findStoreOrderFault([
      entree("@nodefony/http"),
      entree("@nodefony/security", CONSUMER),
      entree("@nodefony/mongoose", ORM_MONGO),
    ]);
    assert.isNotNull(fault);
    assert.strictEqual(fault?.provider, "@nodefony/mongoose");
    assert.strictEqual(fault?.consumer, "@nodefony/security");
    // Les rangs sont rendus 0-indexés : c'est le message qui les humanise.
    assert.strictEqual(fault?.providerIndex, 2);
    assert.strictEqual(fault?.consumerIndex, 1);
  });

  it("laisse passer un fournisseur de CACHE après le consommateur — Redis y vit, et y fonctionne", () => {
    assert.isNull(
      findStoreOrderFault([
        entree("@nodefony/drizzle", ORM_SQL),
        entree("@nodefony/security", CONSUMER),
        entree("@nodefony/redis", CACHE),
      ]),
    );
  });

  it("sans consommateur, aucun rang n'est fautif — un ORM seul se déclare où il veut", () => {
    assert.isNull(
      findStoreOrderFault([
        entree("@nodefony/http"),
        entree("@nodefony/drizzle", ORM_SQL),
      ]),
    );
  });

  it("désigne le PREMIER consommateur : c'est lui qui fixe la limite", () => {
    const fault = findStoreOrderFault([
      entree("@nodefony/security", CONSUMER),
      entree("@nodefony/user", CONSUMER),
      entree("@nodefony/drizzle", ORM_SQL),
    ]);
    assert.strictEqual(fault?.consumer, "@nodefony/security");
  });

  it("un module gaté ne figure pas dans les entrées — donc ne peut pas être fautif", () => {
    // `resolveModuleEntries` filtre AVANT : l'ORM absent de la liste (infra non
    // déclarée) ne doit pas faire refuser un manifeste qui ne le charge pas.
    assert.isNull(
      findStoreOrderFault([
        entree("@nodefony/http"),
        entree("@nodefony/security", CONSUMER),
      ]),
    );
  });
});

describe("storeOrderFaultMessage — le refus doit dire le GESTE qui répare", () => {
  it("nomme les deux modules, leurs rangs humains, le coût et le remède", () => {
    const fault = findStoreOrderFault([
      entree("@nodefony/security", CONSUMER),
      entree("@nodefony/mongoose", ORM_MONGO),
    ]);
    const msg = storeOrderFaultMessage(fault!);
    // Neutre : aucun verbe de décision — c'est l'appelant qui tranche.
    assert.notInclude(msg, "refusé");
    assert.include(msg, "@nodefony/mongoose");
    assert.include(msg, "@nodefony/security");
    // Rangs HUMAINS (1-indexés) : un message qui parle en base 0 envoie compter
    // les lignes du manifeste de travers.
    assert.include(msg, "rang 2");
    assert.include(msg, "rang 1");
    assert.include(msg, "MÉMOIRE");
    assert.include(msg, "Remède");
    assert.include(msg, "AVANT");
  });
});

describe("extractManifestModuleOrder — lire l'ordre SANS booter", () => {
  it("rend les paquets du bloc `modules`, dans l'ordre", () => {
    const src = `
      export default defineConfig((ctx) => ({
        modules: [
          "@nodefony/drizzle",
          use("@nodefony/http", httpConfig(ctx), { policy: "mandatory" }),
          { name: "@nodefony/test", policy: "dev" },
          "@nodefony/security",
        ],
      }));`;
    assert.deepEqual(extractManifestModuleOrder(src), [
      "@nodefony/drizzle",
      "@nodefony/http",
      "@nodefony/test",
      "@nodefony/security",
    ]);
  });

  it("🔴 ignore les imports de TÊTE — sinon un ORM importé passerait pour déclaré en premier", () => {
    // Le défaut que borne le parcours par crochets équilibrés : lu sur le
    // fichier entier, cet ORM ouvrirait la liste et l'ordre paraîtrait sain.
    const src = `
      import { drizzleConfig } from "@nodefony/drizzle";
      export default defineConfig(() => ({
        modules: ["@nodefony/security", "@nodefony/drizzle"],
      }));`;
    assert.deepEqual(extractManifestModuleOrder(src), [
      "@nodefony/security",
      "@nodefony/drizzle",
    ]);
  });

  it("écarte ce qui n'a pas la forme d'un nom de paquet npm", () => {
    const src = `modules: [use("@nodefony/http", { policy: "mandatory" }), "Bearer realm=x"]`;
    assert.deepEqual(extractManifestModuleOrder(src), ["@nodefony/http"]);
  });

  it("rend une liste vide quand il n'y a pas de bloc `modules`", () => {
    assert.deepEqual(extractManifestModuleOrder("export default {};"), []);
  });

  it("⭐ le manifeste RÉEL de ce dépôt : les ORM précèdent le consommateur", () => {
    // Le décor est le produit, pas un gabarit : c'est la seule façon de voir
    // l'extracteur mordre sur la forme qu'il rencontrera vraiment.
    const racine = path.resolve(__dirname, "../../../..");
    const manifeste = withoutComments(
      fs.readFileSync(path.join(racine, "nodefony.config.ts"), "utf8"),
    );
    const ordre = extractManifestModuleOrder(manifeste);
    const rang = (n: string) => ordre.indexOf(n);
    assert.isAbove(
      rang("@nodefony/security"),
      -1,
      `security absent de ${String(ordre)}`,
    );
    assert.isAbove(
      rang("@nodefony/drizzle"),
      -1,
      `drizzle absent de ${String(ordre)}`,
    );
    assert.isAbove(
      rang("@nodefony/mongoose"),
      -1,
      `mongoose absent de ${String(ordre)}`,
    );
    assert.isBelow(rang("@nodefony/drizzle"), rang("@nodefony/security"));
    assert.isBelow(rang("@nodefony/mongoose"), rang("@nodefony/security"));
  });
});
