import assert from "node:assert/strict";
import { DrizzleOrm } from "../../index";
import { entityRegistry, ormRegistry } from "@nodefony/orm-core";
import {
  IDEMPOTENCY_ENTITY_NAME,
  registerIdempotencyEntities,
} from "../../nodefony/entity/idempotencyEntity";
import {
  openMigrationDriver,
  type IMigrationDriver,
} from "../../nodefony/src/migrator/index";
import type { SqlDialect } from "../../nodefony/config/config";

/**
 * Le rattrapage de schéma sur des SERVEURS RÉELS.
 *
 * Le banc SQLite prouve la règle ; il ne prouve pas le dialecte. Trois choses
 * ne se vérifient qu'ici, et chacune a déjà cassé quelque part :
 *
 * - le **type** que le code déclare (`bigint`, `jsonb`, `varchar(512)`…) doit
 *   être accepté tel quel dans un `ALTER TABLE … ADD COLUMN` ;
 * - la lecture du catalogue passe par `information_schema`, dont MySQL et
 *   MariaDB ne rendent pas la casse de la même façon ;
 * - l'ordre tables → rattrapage → index vaut pour les trois chemins de
 *   connexion, pas seulement pour celui que l'on a sous la main.
 *
 * GATE : ne tourne qu'avec les URL d'infra :
 *   docker compose -f docker/docker-compose.yml --profile postgres up -d postgres
 *   docker compose -f docker/docker-compose.yml --profile mariadb up -d mariadb
 *   NF_PG_URL=… NF_MYSQL_URL=… npm test
 */
const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

/**
 * Cite un identifiant dans le dialecte visé.
 *
 * ⚠️ Hors mode ANSI_QUOTES, `"x"` est une CHAÎNE en MySQL et MariaDB, pas un
 * identifiant : un banc écrit avec des guillemets doubles y échoue en erreur de
 * syntaxe, et fait accuser le produit.
 *
 * @param name - identifiant à citer.
 * @param dialect - dialecte du serveur.
 * @returns l'identifiant cité.
 */
const ident = (name: string, dialect: SqlDialect): string =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** Un dialecte à éprouver, et de quoi l'atteindre. */
interface ICible {
  dialect: SqlDialect;
  url: string;
  /** La table d'époque : complète SAUF `response`, qui accepte le vide. */
  ddl: string;
  /** La table amputée d'une colonne OBLIGATOIRE, qu'un index référence. */
  ddlAmputee: string;
}

const CIBLES: ICible[] = [
  {
    dialect: "postgres",
    url: PG_URL ?? "",
    ddl:
      `CREATE TABLE "idempotency_key" (` +
      `"key" text PRIMARY KEY NOT NULL, "fingerprint" text NOT NULL, ` +
      `"state" text NOT NULL, "expiresAt" bigint NOT NULL)`,
    ddlAmputee:
      `CREATE TABLE "idempotency_key" (` +
      `"key" text PRIMARY KEY NOT NULL, "state" text NOT NULL)`,
  },
  {
    dialect: "mysql",
    url: MYSQL_URL ?? "",
    ddl:
      "CREATE TABLE `idempotency_key` (" +
      "`key` varchar(512) NOT NULL, `fingerprint` text NOT NULL, " +
      "`state` text NOT NULL, `expiresAt` bigint NOT NULL, PRIMARY KEY (`key`))",
    ddlAmputee:
      "CREATE TABLE `idempotency_key` (" +
      "`key` varchar(512) NOT NULL, `state` text NOT NULL, PRIMARY KEY (`key`))",
  },
];

for (const cible of CIBLES) {
  describe.skipIf(!cible.url)(
    `Réconciliation du schéma sur un serveur réel (${cible.dialect})`,
    () => {
      const ORM = `banc-reconcile-${cible.dialect}`;
      let orm: DrizzleOrm | null = null;

      /** Ouvre un pilote d'administration sur le serveur du banc. */
      const admin = (): Promise<IMigrationDriver> =>
        openMigrationDriver({ dialect: cible.dialect, url: cible.url });

      /**
       * Efface la table du banc, puis la recrée telle que le SQL l'énonce.
       *
       * @param ddl - la table d'avant, celle que l'ORM va trouver.
       */
      const semer = async (ddl: string): Promise<void> => {
        const driver = await admin();
        try {
          await driver.exec(
            `DROP TABLE IF EXISTS ${ident("idempotency_key", cible.dialect)}`,
          );
          await driver.exec(ddl);
        } finally {
          await driver.close();
        }
      };

      /** Colonnes réellement portées par la table du banc. */
      const colonnes = async (): Promise<string[]> => {
        const driver = await admin();
        try {
          return await driver.columnsOf("idempotency_key");
        } finally {
          await driver.close();
        }
      };

      /** Connecte un ORM en mode dérivé sur le serveur du banc. */
      const connecter = async (): Promise<DrizzleOrm> => {
        const instance = new DrizzleOrm(ORM, {
          dialect: cible.dialect,
          url: cible.url,
        });
        registerIdempotencyEntities(ORM, cible.dialect);
        await instance.connect();
        orm = instance;
        return instance;
      };

      afterEach(async () => {
        await orm?.disconnect();
        orm = null;
        entityRegistry.unregister(IDEMPOTENCY_ENTITY_NAME, ORM);
        ormRegistry.unregister(ORM);
        const driver = await admin();
        try {
          await driver.exec(
            `DROP TABLE IF EXISTS ${ident("idempotency_key", cible.dialect)}`,
          );
        } finally {
          await driver.close();
        }
      });

      it("pose la colonne manquante qui accepte le vide, dans le type du dialecte", async () => {
        await semer(cible.ddl);
        const instance = await connecter();
        assert.ok(
          (await colonnes()).includes("response"),
          "la colonne déclarée nullable doit être posée par un ALTER accepté " +
            "par le serveur, dans le type que le code déclare",
        );
        assert.equal(
          instance.schemaDrift,
          null,
          "après rattrapage il ne reste rien à signaler",
        );
      });

      it("refuse d'inventer une colonne obligatoire — et le démarrage SURVIT", async () => {
        await semer(cible.ddlAmputee);
        const instance = await connecter();
        assert.ok(
          instance.isConnected(),
          "la connexion doit tenir : un index porte sur une colonne absente, " +
            "et c'est ce qui tuait le démarrage avant la passe de rattrapage",
        );
        const drift = instance.schemaDrift;
        assert.ok(drift, "l'écart doit être publié");
        assert.deepEqual(
          drift.blocking.map((gap) => gap.column).sort(),
          ["expiresAt", "fingerprint"],
          "les colonnes obligatoires manquantes sont nommées, jamais posées",
        );
        assert.ok(
          !(await colonnes()).includes("fingerprint"),
          "aucune valeur n'est inventée pour les lignes déjà présentes",
        );
      });

      it("ignore une colonne EN PLUS — les migrations libres restent légitimes", async () => {
        await semer(cible.ddl);
        const driver = await admin();
        try {
          await driver.exec(
            `ALTER TABLE ${ident("idempotency_key", cible.dialect)} ` +
              `ADD COLUMN ${ident("posee_a_la_main", cible.dialect)} text`,
          );
        } finally {
          await driver.close();
        }
        const instance = await connecter();
        assert.equal(
          instance.schemaDrift,
          null,
          "le diff signale ce qui MANQUE, jamais ce qu'il trouve en trop",
        );
      });
    },
  );
}
