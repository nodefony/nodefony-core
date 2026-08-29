import assert from "node:assert/strict";
import path from "node:path";
import type { Kernel } from "nodefony";
import { ormRegistry } from "@nodefony/orm-core";
import { drizzleConfigSchema } from "../../nodefony/config/config";
import type { IDrizzleConfig } from "../../nodefony/interfaces/IDrizzleConfig";
import {
  MIGRATE_URL_ENV,
  resolveCheckMode,
  resolveConnector,
  resolveDdlMode,
  type IMigrationEnv,
} from "../../nodefony/src/migrator/resolve";
import {
  defaultConnectorFilename,
  resolveConnectorTarget,
} from "../../nodefony/src/connectorTarget";
import { DrizzleOrm } from "../../index";

/**
 * Les règles qui décident du DÉCOR d'une commande de migration.
 *
 * Elles ne touchent aucune base et n'ouvrent aucune connexion — c'est
 * délibéré : ce sont les décisions qui se prennent AVANT, et elles doivent être
 * éprouvables sans serveur, sans variable d'environnement à poser, sans kernel.
 *
 * Deux des cas ci-dessous ne sont pas là par prudence. Ils sont là parce que le
 * défaut correspondant a été constaté SUR CETTE APPLICATION, en exécutant la
 * commande pour de vrai — et qu'aucun test antérieur ne l'aurait vu :
 *
 * 1. **la base fantôme** : `filename` est optionnel dans la configuration (son
 *    défaut dépend du kernel). Lu tel quel, il rend `undefined`, le pilote
 *    SQLite retombe sur une base EN MÉMOIRE, et la commande décrit alors une
 *    base que l'application n'utilise pas — en rendant le code du succès ;
 * 2. **le message faux** : un connecteur SQL enregistré hors configuration se
 *    voyait répondre « ne gère pas de migrations de schéma ». Il en gère
 *    parfaitement ; il manque seulement ses coordonnées. Une phrase fausse
 *    publiée est apprise par les scripts qui la lisent.
 */

const DEV: IMigrationEnv = { runtime: "development", nodeEnv: "development" };
const TEST: IMigrationEnv = { runtime: "production", nodeEnv: "test" };
const PROD: IMigrationEnv = { runtime: "production", nodeEnv: "production" };
const INCONNU: IMigrationEnv = { runtime: "production", nodeEnv: undefined };

/** Kernel minimal : seules la racine et le répertoire de données comptent ici. */
function fauxKernel(root: string, varDir?: string): Kernel {
  return {
    path: root,
    varDir: varDir === undefined ? undefined : { path: varDir },
  } as unknown as Kernel;
}

function config(input: unknown = {}): IDrizzleConfig {
  return drizzleConfigSchema.parse(input) as IDrizzleConfig;
}

describe("migrations — le mode de schéma se résout par environnement", () => {
  it("le défaut est `auto` en développement et en test, `none` partout ailleurs", () => {
    assert.equal(resolveDdlMode(undefined, DEV), "auto");
    assert.equal(resolveDdlMode(undefined, TEST), "auto");
    assert.equal(resolveDdlMode(undefined, PROD), "none");
    // Le cas qui compte vraiment : un environnement que personne n'a nommé
    // ne doit PAS hériter du comportement de développement.
    assert.equal(resolveDdlMode(undefined, INCONNU), "none");
  });

  it("`migrate` n'est JAMAIS un défaut — il ne sort que s'il est écrit", () => {
    for (const env of [DEV, TEST, PROD, INCONNU]) {
      assert.notEqual(resolveDdlMode(undefined, env), "migrate");
    }
    assert.equal(resolveDdlMode("migrate", PROD), "migrate");
  });

  it("une valeur écrite gagne toujours sur le défaut", () => {
    assert.equal(resolveDdlMode("none", DEV), "none");
    assert.equal(resolveDdlMode("auto", PROD), "auto");
  });

  it("la sonde retient la mise en service en production, avertit ailleurs", () => {
    assert.equal(resolveCheckMode(undefined, PROD), "fail");
    assert.equal(resolveCheckMode(undefined, INCONNU), "fail");
    assert.equal(resolveCheckMode(undefined, DEV), "warn");
    assert.equal(resolveCheckMode("off", PROD), "off");
  });
});

describe("migrations — la base visée est celle que l'application utilise", () => {
  it("le fichier SQLite par défaut sort du répertoire de données du kernel", () => {
    const k = fauxKernel("/app", "/app/var");
    assert.equal(
      defaultConnectorFilename(k, "default"),
      path.resolve("/app/var/databases/nodefony-drizzle.db"),
    );
    assert.equal(
      defaultConnectorFilename(k, "reporting"),
      path.resolve("/app/var/databases/nodefony-reporting.db"),
    );
  });

  it("sans répertoire de données matérialisé, il retombe sous la racine", () => {
    assert.equal(
      defaultConnectorFilename(fauxKernel("/app"), "default"),
      path.resolve("/app/var/databases/nodefony-drizzle.db"),
    );
  });

  it("🔴 un connecteur SQLite SANS `filename` ne vise JAMAIS `:memory:`", () => {
    // LE test du défaut vécu. Une base en mémoire accepte toutes les
    // migrations, ne garde rien, et rend le code du succès : le pire des faux
    // verts, parce qu'il ressemble exactement à un vrai.
    const cfg = config({ connectors: { default: { dialect: "sqlite" } } });
    const res = resolveConnector(
      "default",
      cfg,
      DEV,
      fauxKernel("/app", "/app/var"),
    );
    assert.equal(res.kind, "ready");
    if (res.kind !== "ready") return;
    assert.notEqual(res.target.filename, ":memory:");
    assert.equal(
      res.target.filename,
      path.resolve("/app/var/databases/nodefony-drizzle.db"),
    );
  });

  it("un `filename` écrit dans la configuration est respecté tel quel", () => {
    const cfg = config({
      connectors: { default: { dialect: "sqlite", filename: ":memory:" } },
    });
    const target = resolveConnectorTarget(
      fauxKernel("/app"),
      "default",
      cfg.connectors.default,
    );
    assert.equal(target.filename, ":memory:");
  });
});

describe("migrations — les trois réponses d'un connecteur restent distinctes", () => {
  it("connecteur déclaré → prêt, avec son dialecte et son mode", () => {
    const cfg = config({
      connectors: { default: { dialect: "postgres", url: "postgres://h/db" } },
    });
    const res = resolveConnector("default", cfg, PROD, fauxKernel("/app"));
    assert.equal(res.kind, "ready");
    if (res.kind !== "ready") return;
    assert.equal(res.dialect, "postgres");
    assert.equal(res.target.url, "postgres://h/db");
    assert.equal(res.ddl, "none");
  });

  it("connecteur introuvable → inconnu, et la liste nomme ce qui existe", () => {
    const cfg = config({ connectors: { default: {}, reporting: {} } });
    const res = resolveConnector("nawak", cfg, DEV, fauxKernel("/app"));
    assert.equal(res.kind, "unknown");
    if (res.kind !== "unknown") return;
    // Un utilisateur qui s'est trompé de nom doit VOIR le sien dans la liste.
    assert.ok(res.known.includes("default"));
    assert.ok(res.known.includes("reporting"));
  });

  it("🔴 un connecteur SQL hors configuration n'est PAS « sans migrations »", () => {
    // Vécu : un banc qui instancie son ORM en direct enregistre un connecteur
    // SQLite que la configuration ne déclare pas. Lui répondre « ne gère pas de
    // migrations » est FAUX — il en gère, il manque ses coordonnées.
    const nom = `banc_${Math.random().toString(36).slice(2, 8)}`;
    const orm = new DrizzleOrm(nom, {
      dialect: "sqlite",
      filename: ":memory:",
    });
    try {
      const res = resolveConnector(nom, config(), DEV, fauxKernel("/app"));
      assert.equal(res.kind, "unsupported");
      if (res.kind !== "unsupported") return;
      assert.equal(res.sqlLike, true, "une base SQLite est une base SQL");
      assert.equal(res.driver, "sqlite");
      assert.ok(res.owner.includes("DrizzleOrm"), res.owner);
    } finally {
      void orm;
      ormRegistry.unregister(nom);
    }
  });
});

describe("migrations — l'URL du travail de migration est lue par eux SEULS", () => {
  const AVANT = process.env[MIGRATE_URL_ENV];
  afterEach(() => {
    if (AVANT === undefined) {
      delete process.env[MIGRATE_URL_ENV];
    } else {
      process.env[MIGRATE_URL_ENV] = AVANT;
    }
  });

  it("elle prime sur l'URL du connecteur quand la commande l'autorise", () => {
    process.env[MIGRATE_URL_ENV] = "postgres://migrator@direct/db";
    const cfg = config({
      connectors: {
        default: { dialect: "postgres", url: "postgres://app@pool/db" },
      },
    });
    const res = resolveConnector("default", cfg, PROD, fauxKernel("/app"), {
      allowMigrateUrl: true,
    });
    assert.equal(res.kind, "ready");
    if (res.kind !== "ready") return;
    assert.equal(res.target.url, "postgres://migrator@direct/db");
    assert.equal(res.fromMigrateUrl, true);
  });

  it("elle est IGNORÉE quand la commande ne l'autorise pas (effacement)", () => {
    // C'est la garde qui empêche la seule combinaison à ne jamais rendre
    // possible : un compte à droits de schéma désignant la cible d'un effacement.
    process.env[MIGRATE_URL_ENV] = "postgres://migrator@prod/db";
    const cfg = config({
      connectors: {
        default: { dialect: "postgres", url: "postgres://app@dev/db" },
      },
    });
    const res = resolveConnector("default", cfg, DEV, fauxKernel("/app"), {
      allowMigrateUrl: false,
    });
    assert.equal(res.kind, "ready");
    if (res.kind !== "ready") return;
    assert.equal(res.target.url, "postgres://app@dev/db");
    assert.equal(res.fromMigrateUrl, false);
  });

  it("🔴 un dialecte qui NE CONCORDE PAS est refusé — jamais ignoré", () => {
    // Le faux succès de déploiement, fermé ici. La variable était ignorée en
    // silence dès que le connecteur était sqlite : un travail de migration
    // posait l'URL de production, la commande migrait une base LOCALE
    // éphémère, rendait « ✓ appliqué » et le code du SUCCÈS — puis les
    // exemplaires démarraient sur une base jamais migrée. Le cas est ordinaire :
    // un job de migration n'a pas besoin de la variable du trafic, donc le
    // connecteur y retombe sur son défaut sqlite.
    process.env[MIGRATE_URL_ENV] = "postgres://migrator@prod/db";
    const cfg = config({ connectors: { default: { dialect: "sqlite" } } });
    const res = resolveConnector(
      "default",
      cfg,
      DEV,
      fauxKernel("/app", "/app/var"),
      { allowMigrateUrl: true },
    );
    assert.equal(res.kind, "url-mismatch");
    if (res.kind !== "url-mismatch") return;
    assert.equal(res.dialect, "sqlite");
    assert.equal(res.urlDialect, "postgres");
  });

  it("un dialecte SQL contre un autre est refusé aussi", () => {
    process.env[MIGRATE_URL_ENV] = "mysql://migrator@prod/db";
    const cfg = config({
      connectors: {
        default: { dialect: "postgres", url: "postgres://app@pool/db" },
      },
    });
    const res = resolveConnector("default", cfg, PROD, fauxKernel("/app"), {
      allowMigrateUrl: true,
    });
    assert.equal(res.kind, "url-mismatch");
    if (res.kind !== "url-mismatch") return;
    assert.equal(res.urlDialect, "mysql");
  });

  it("une URL illisible est refusée SANS jeter — un refus, pas une pile", () => {
    // Au milieu d'un déploiement, une exception non traitée ne dit ni quel
    // connecteur, ni quoi faire.
    process.env[MIGRATE_URL_ENV] = "ceci-nest-pas-une-url";
    const cfg = config({
      connectors: {
        default: { dialect: "postgres", url: "postgres://app@pool/db" },
      },
    });
    const res = resolveConnector("default", cfg, PROD, fauxKernel("/app"), {
      allowMigrateUrl: true,
    });
    assert.equal(res.kind, "url-mismatch");
    if (res.kind !== "url-mismatch") return;
    assert.equal(res.urlDialect, null);
  });

  it("une base NON SQL (mongodb) est refusée — il n'y a rien à migrer là", () => {
    process.env[MIGRATE_URL_ENV] = "mongodb://migrator@prod/db";
    const cfg = config({
      connectors: {
        default: { dialect: "postgres", url: "postgres://app@pool/db" },
      },
    });
    const res = resolveConnector("default", cfg, PROD, fauxKernel("/app"), {
      allowMigrateUrl: true,
    });
    assert.equal(res.kind, "url-mismatch");
    if (res.kind !== "url-mismatch") return;
    assert.equal(res.urlDialect, null);
  });

  it("🔴 elle est SUIVIE en sqlite quand elle désigne bien une base sqlite", () => {
    // Le pendant du refus : un usage légitime ne doit pas être puni. Une base
    // de migration sqlite distincte de celle du trafic est parfaitement sensée
    // — un banc, une reprise, une vérification hors ligne.
    process.env[MIGRATE_URL_ENV] = "sqlite:/tmp/migration-cible.db";
    const cfg = config({ connectors: { default: { dialect: "sqlite" } } });
    const res = resolveConnector(
      "default",
      cfg,
      DEV,
      fauxKernel("/app", "/app/var"),
      { allowMigrateUrl: true },
    );
    assert.equal(res.kind, "ready");
    if (res.kind !== "ready") return;
    assert.equal(res.fromMigrateUrl, true);
    assert.equal(res.target.filename, "/tmp/migration-cible.db");
  });

  it("absente, le connecteur SQLite garde sa base par défaut", () => {
    delete process.env[MIGRATE_URL_ENV];
    const cfg = config({ connectors: { default: { dialect: "sqlite" } } });
    const res = resolveConnector(
      "default",
      cfg,
      DEV,
      fauxKernel("/app", "/app/var"),
      { allowMigrateUrl: true },
    );
    assert.equal(res.kind, "ready");
    if (res.kind !== "ready") return;
    assert.equal(res.fromMigrateUrl, false);
    assert.equal(
      res.target.filename,
      path.resolve("/app/var/databases/nodefony-drizzle.db"),
    );
  });
});
