import assert from "node:assert";

import {
  resolveInfra,
  resolveAutoStore,
  readStoreLocation,
  parseDatabaseUrl,
  sqliteFilenameFromUrl,
  type IInfra,
} from "../config/index";
import { resolveQueryDriver } from "../syslog/drivers/builtinLogDrivers";

const NO_ROLES: IInfra = {
  database: null,
  cache: null,
  logs: null,
  forceStore: null,
};

describe("config — infra (modèle « infra déclarée », Phase 0.8)", () => {
  describe("resolveInfra", () => {
    it("env vide → aucune infra déclarée", () => {
      const roles = resolveInfra({});
      assert.deepStrictEqual(roles, NO_ROLES);
    });

    it("NF_DATABASE_URL sqlite → infra database sql/sqlite", () => {
      const roles = resolveInfra({
        NF_DATABASE_URL: "sqlite:./nodefony/databases/app.db",
      });
      assert.strictEqual(roles.database?.family, "sql");
      assert.strictEqual(roles.database?.dialect, "sqlite");
      assert.strictEqual(roles.database?.scheme, "sqlite");
    });

    it("postgres:// et postgresql:// → dialecte postgres", () => {
      for (const url of ["postgres://u:p@h:5432/db", "postgresql://h/db"]) {
        const roles = resolveInfra({ NF_DATABASE_URL: url });
        assert.strictEqual(roles.database?.dialect, "postgres");
      }
    });

    it("mongodb:// et mongodb+srv:// → famille mongo, dialecte null", () => {
      for (const url of ["mongodb://h:27017/db", "mongodb+srv://cluster/db"]) {
        const roles = resolveInfra({ NF_DATABASE_URL: url });
        assert.strictEqual(roles.database?.family, "mongo");
        assert.strictEqual(roles.database?.dialect, null);
      }
    });

    it("alias plateforme : NF_DATABASE_URL prioritaire sur DATABASE_URL", () => {
      const roles = resolveInfra({
        NF_DATABASE_URL: "postgres://nf/db",
        DATABASE_URL: "mysql://platform/db",
      });
      assert.strictEqual(roles.database?.dialect, "postgres");
      const fallback = resolveInfra({ DATABASE_URL: "mysql://platform/db" });
      assert.strictEqual(fallback.database?.dialect, "mysql");
    });

    it("NF_REDIS_URL / REDIS_URL → infra cache (NF_ prioritaire)", () => {
      const roles = resolveInfra({
        NF_REDIS_URL: "redis://nf:6379",
        REDIS_URL: "redis://platform:6379",
      });
      assert.strictEqual(roles.cache?.url, "redis://nf:6379");
      const fallback = resolveInfra({ REDIS_URL: "redis://platform:6379" });
      assert.strictEqual(fallback.cache?.url, "redis://platform:6379");
    });

    it("URLs logs → infra logs (les deux possibles)", () => {
      const roles = resolveInfra({
        NF_LOKI_URL: "http://loki:3100",
        NF_OPENSEARCH_URL: "http://os:9200",
      });
      assert.strictEqual(roles.logs?.lokiUrl, "http://loki:3100");
      assert.strictEqual(roles.logs?.opensearchUrl, "http://os:9200");
    });

    it("valeur vide = non déclarée (pas d'infra fantôme)", () => {
      const roles = resolveInfra({ NF_DATABASE_URL: "", NF_REDIS_URL: "" });
      assert.deepStrictEqual(roles, NO_ROLES);
    });

    it("scheme non supporté → throw fail-loud (jamais de repli sqlite)", () => {
      assert.throws(
        () => resolveInfra({ NF_DATABASE_URL: "oracle://h/db" }),
        /non supporté/,
      );
      assert.throws(() => parseDatabaseUrl("pasduneurl"), /non supporté/);
    });

    it("NF_STORE → forceStore (override global) ; absent → null", () => {
      assert.strictEqual(
        resolveInfra({ NF_STORE: "memory" }).forceStore,
        "memory",
      );
      assert.strictEqual(resolveInfra({}).forceStore, null);
      assert.strictEqual(resolveInfra({ NF_STORE: "" }).forceStore, null);
    });
  });

  describe("sqliteFilenameFromUrl", () => {
    it("formes acceptées", () => {
      assert.strictEqual(sqliteFilenameFromUrl("sqlite::memory:"), ":memory:");
      assert.strictEqual(sqliteFilenameFromUrl("sqlite:"), ":memory:");
      assert.strictEqual(sqliteFilenameFromUrl("sqlite:./x.db"), "./x.db");
      assert.strictEqual(
        sqliteFilenameFromUrl("sqlite:/abs/x.db"),
        "/abs/x.db",
      );
      assert.strictEqual(
        sqliteFilenameFromUrl("sqlite:///abs/x.db"),
        "/abs/x.db",
      );
    });
  });

  describe("resolveAutoStore", () => {
    const roles = (over: Partial<IInfra>): IInfra => ({
      ...NO_ROLES,
      ...over,
    });
    const DB_SQL = roles({
      database: {
        url: "postgres://h/db",
        scheme: "postgres",
        family: "sql",
        dialect: "postgres",
      },
    });
    const DB_MONGO = roles({
      database: {
        url: "mongodb://h/db",
        scheme: "mongodb",
        family: "mongo",
        dialect: null,
      },
    });
    const CACHE = roles({ cache: { url: "redis://h:6379" } });

    it("durable + infra database sql → drizzle", () => {
      const r = resolveAutoStore("durable", DB_SQL, ["memory", "drizzle"]);
      assert.strictEqual(r.store, "drizzle");
    });

    it("durable + infra database mongo → mongoose", () => {
      const r = resolveAutoStore("durable", DB_MONGO, ["memory", "mongoose"]);
      assert.strictEqual(r.store, "mongoose");
    });

    it("durable ignore le infra cache (redis ≠ durable)", () => {
      const r = resolveAutoStore("durable", CACHE, ["memory", "redis"]);
      assert.strictEqual(r.store, "memory");
    });

    it("ephemeral préfère cache > database", () => {
      const both = roles({
        cache: { url: "redis://h" },
        database: DB_SQL.database,
      });
      const r = resolveAutoStore("ephemeral", both, [
        "memory",
        "drizzle",
        "redis",
      ]);
      assert.strictEqual(r.store, "redis");
      const noRedis = resolveAutoStore("ephemeral", both, [
        "memory",
        "drizzle",
      ]);
      assert.strictEqual(noRedis.store, "drizzle");
    });

    it("session : cache > database > sqlite local > files", () => {
      // Sans infra ET drizzle chargé → sqlite local (bascule « sqlite défaut »).
      const withDrizzle = resolveAutoStore(
        "session",
        NO_ROLES,
        ["files", "drizzle"],
        "files",
      );
      assert.strictEqual(withDrizzle.store, "drizzle");
      // Sans infra ET drizzle ABSENT → repli fichier (session n'a pas de memory).
      const filesOnly = resolveAutoStore(
        "session",
        NO_ROLES,
        ["files"],
        "files",
      );
      assert.strictEqual(filesOnly.store, "files");
      // Infra database déclarée → drizzle (préférence infra, prioritaire).
      const withDb = resolveAutoStore(
        "session",
        DB_SQL,
        ["files", "drizzle"],
        "files",
      );
      assert.strictEqual(withDb.store, "drizzle");
    });

    it("couverture partielle : backend de l'infra non enregistré → repli ANNONCÉ", () => {
      const r = resolveAutoStore("durable", DB_MONGO, ["memory", "drizzle"]);
      assert.strictEqual(r.store, "memory");
      assert.match(r.reason, /indisponible/);
      assert.match(r.reason, /mongoose/);
    });

    it("SQLITE DÉFAUT : sans infra + drizzle chargé → drizzle (persistant, pas memory)", () => {
      // Le cœur du lot 3b : dev/prod mono-nœud persistent sans config.
      const durable = resolveAutoStore("durable", NO_ROLES, [
        "memory",
        "drizzle",
      ]);
      assert.strictEqual(durable.store, "drizzle");
      assert.match(durable.reason, /local persistant/);
      // ephemeral idem (redis absent) → drizzle avant le repli memory.
      const ephemeral = resolveAutoStore("ephemeral", NO_ROLES, [
        "memory",
        "drizzle",
      ]);
      assert.strictEqual(ephemeral.store, "drizzle");
      // mongoose préféré si c'est le seul backend persistant chargé.
      const mongo = resolveAutoStore("durable", NO_ROLES, [
        "memory",
        "mongoose",
      ]);
      assert.strictEqual(mongo.store, "mongoose");
    });

    it("aucune infra + aucun backend persistant chargé → repli volatil annoncé", () => {
      const r = resolveAutoStore("durable", NO_ROLES, ["memory"]);
      assert.strictEqual(r.store, "memory");
      assert.match(r.reason, /aucune infra/);
      assert.match(r.reason, /volatil/);
    });

    describe("NF_STORE — override global (banc de charge)", () => {
      const FORCE_MEM = roles({ forceStore: "memory" });

      it("force TOUTE brique auto en memory, PRIORITÉ sur l'infra déclarée", () => {
        // Même avec une infra database → memory gagne (le banc veut du volatil pur).
        const withDb = roles({
          database: DB_SQL.database,
          forceStore: "memory",
        });
        const r = resolveAutoStore("durable", withDb, ["memory", "drizzle"]);
        assert.strictEqual(r.store, "memory");
        assert.match(r.reason, /NF_STORE=memory/);
      });

      it("couvre durable / ephemeral / session (toutes natures)", () => {
        for (const kind of ["durable", "ephemeral", "session"] as const) {
          const r = resolveAutoStore(kind, FORCE_MEM, ["memory", "drizzle"]);
          assert.strictEqual(r.store, "memory", `kind=${kind}`);
        }
      });

      describe("run qui n'ouvre AUCUNE connexion (canOpenConnections=false)", () => {
        // Le run déclare `externalServices` ou non ; s'il ne le déclare pas, aucun
        // ORM n'est connecté. Choisir alors un backend connecté produisait un
        // démarrage MORT : la fabrique du store exigeait un ORM connecté
        // (`registerStores.ts:159`) et `nodefony inspect routes` sortait en 1 sans
        // rien écrire sur la sortie d'erreur.

        it("aucune infra déclarée → memory, pas le sqlite local", () => {
          // Le cas exact de la panne : sans infra, la résolution préférait
          // « drizzle local persistant » — parfait pour un serveur, fatal pour une
          // commande qui ne connecte rien.
          const r = resolveAutoStore(
            "durable",
            NO_ROLES,
            ["memory", "drizzle"],
            "memory",
            false,
          );
          assert.strictEqual(r.store, "memory");
        });

        it("une infra DÉCLARÉE ne rouvre PAS la porte", () => {
          // La tentation était de préserver l'infra écrite « pour que l'échec se
          // voie ». Ce qu'on obtient n'est pas un signal : c'est un store qui
          // lève au montage, ou qui dégrade EN SILENCE à l'usage
          // (`DrizzleAuditStore.append` rend la main sans un mot). Fail-OPEN sur
          // des JETONS : une denylist qui ne lit rien accepte un jeton révoqué.
          // Le signal appartient au run qui DÉCLARE le besoin, où l'échec de
          // connexion est fatal.
          for (const infra of [DB_SQL, DB_MONGO]) {
            const r = resolveAutoStore(
              "durable",
              infra,
              ["memory", "drizzle", "mongoose"],
              "memory",
              false,
            );
            assert.strictEqual(r.store, "memory");
          }
        });

        it("une infra cache déclarée n'impose pas redis non plus", () => {
          const r = resolveAutoStore(
            "ephemeral",
            CACHE,
            ["memory", "redis"],
            "memory",
            false,
          );
          assert.strictEqual(r.store, "memory");
        });

        it("un REPLI connecté est neutralisé (porte de derrière)", () => {
          // `provisionUsers` demande `"drizzle"` en repli : sans neutralisation,
          // le filtre ci-dessus serait contourné par le chemin du repli.
          const r = resolveAutoStore(
            "durable",
            NO_ROLES,
            ["memory"],
            "drizzle",
            false,
          );
          assert.strictEqual(r.store, "memory");
        });

        it("NF_STORE ne contourne pas la règle", () => {
          // L'override est prioritaire sur les PRÉFÉRENCES, jamais sur une
          // impossibilité : le backend forcé reste injoignable dans ce run. Un
          // store explicitement demandé, lui, ne passe pas par ici — il échoue
          // franchement à la fabrique, et c'est le comportement voulu.
          const force = roles({ forceStore: "drizzle" });
          const r = resolveAutoStore(
            "durable",
            force,
            ["memory", "drizzle"],
            "memory",
            false,
          );
          assert.strictEqual(r.store, "memory");
        });

        it("la raison NOMME la cause ET le remède — pas seulement le repli", () => {
          // Une raison qui dit « aucun backend persistant chargé » alors que
          // drizzle EST chargé et vient d'être écarté est un mensonge : elle
          // envoie chercher un module absent au lieu du profil du run.
          const r = resolveAutoStore(
            "durable",
            NO_ROLES,
            ["memory", "drizzle"],
            "memory",
            false,
          );
          assert.strictEqual(r.store, "memory");
          assert.match(r.reason, /drizzle/, "le backend écarté est NOMMÉ");
          assert.match(r.reason, /externalServices/, "la cause est nommée");
          assert.match(
            r.reason,
            /CONSOLE_DATA_RUN_PROFILE/,
            "le REMÈDE est nommé — sinon on corrige la mauvaise chose",
          );
        });

        it("NON-RÉGRESSION : un run qui OUVRE des connexions est inchangé", () => {
          // Le garde-fou qui compte. Un serveur déclare `externalServices: true`
          // (`runtimeLauncher.ts:198`) : tout doit se comporter comme avant, sinon
          // cette correction basculerait la PRODUCTION en mémoire volatile.
          // Le défaut du paramètre vaut `true` — les deux formes sont vérifiées.
          assert.strictEqual(
            resolveAutoStore("durable", NO_ROLES, ["memory", "drizzle"]).store,
            "drizzle",
          );
          assert.strictEqual(
            resolveAutoStore(
              "durable",
              NO_ROLES,
              ["memory", "drizzle"],
              "memory",
              true,
            ).store,
            "drizzle",
          );
          assert.strictEqual(
            resolveAutoStore(
              "durable",
              DB_SQL,
              ["memory", "drizzle"],
              "memory",
              true,
            ).store,
            "drizzle",
          );
          assert.strictEqual(
            resolveAutoStore(
              "ephemeral",
              CACHE,
              ["memory", "redis"],
              "memory",
              true,
            ).store,
            "redis",
          );
        });
      });

      it("backend forcé ABSENT de la brique → ignoré, résolution normale (pas de crash)", () => {
        // La brique ne connaît pas "memory" (ex. session sans builtin) → on ignore
        // l'override et on résout normalement (ici drizzle local).
        const r = resolveAutoStore("durable", FORCE_MEM, ["drizzle"]);
        assert.strictEqual(r.store, "drizzle");
      });
    });
  });

  describe("readStoreLocation — emplacement physique lu de l'instance", () => {
    it("store fichier (getter location string) → chemin renvoyé", () => {
      assert.strictEqual(
        readStoreLocation({ location: "/app/var/webauthn/credentials.json" }),
        "/app/var/webauthn/credentials.json",
      );
    });
    it("store mémoire (pas de getter) → undefined", () => {
      assert.strictEqual(readStoreLocation({}), undefined);
    });
    it("location vide → undefined (jamais de chaîne vide affichée)", () => {
      assert.strictEqual(readStoreLocation({ location: "" }), undefined);
    });
    it("location non-string (backend réseau) → undefined", () => {
      assert.strictEqual(readStoreLocation({ location: 5432 }), undefined);
    });
    it("null / undefined → undefined (lecture défensive, jamais de throw)", () => {
      assert.strictEqual(readStoreLocation(null), undefined);
      assert.strictEqual(readStoreLocation(undefined), undefined);
    });
  });

  describe("resolveQueryDriver — dérivation URL ⇒ driver (infra logs)", () => {
    it("explicite respecté même avec URLs déclarées", () => {
      const driver = resolveQueryDriver("memory", false, {
        loki: "http://loki:3100",
      });
      assert.strictEqual(driver, "memory");
    });

    it("auto + 1 URL → driver de la destination", () => {
      assert.strictEqual(
        resolveQueryDriver("auto", false, { loki: "http://loki:3100" }),
        "loki",
      );
      assert.strictEqual(
        resolveQueryDriver(undefined, false, { opensearch: "http://os:9200" }),
        "opensearch",
      );
    });

    it("auto + 2 URLs → throw fail-loud", () => {
      assert.throws(
        () =>
          resolveQueryDriver("auto", false, {
            loki: "http://loki:3100",
            opensearch: "http://os:9200",
          }),
        /ambigu/,
      );
    });

    it("auto sans URL → comportement historique (memory / cluster-file)", () => {
      assert.strictEqual(resolveQueryDriver("auto", false), "memory");
      assert.strictEqual(resolveQueryDriver(undefined, true), "cluster-file");
    });
  });
});
