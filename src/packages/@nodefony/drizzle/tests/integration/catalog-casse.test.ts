import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SqlDialect } from "../../nodefony/config/config";
import {
  openMigrationDriver,
  sameColumnName,
  type IMigrationDriver,
} from "../../nodefony/src/migrator/index";
import { compareSchema } from "../../nodefony/src/migrator/schemaDiff";

/**
 * La casse d'un nom : le lecteur de catalogue doit répondre comme le MOTEUR.
 *
 * ## Ce que ce banc refuse de supposer
 *
 * Il serait facile d'écrire « SQLite ignore la casse, PostgreSQL non » et de
 * l'asserter. Ce serait recopier dans le test la règle qu'on vient d'écrire
 * dans le produit : les deux diraient la même chose, et le jour où la règle est
 * fausse, elles la répéteraient ensemble. MySQL le montre bien — sa sensibilité
 * dépend de `lower_case_table_names`, donc de la MACHINE, pas du dialecte.
 *
 * Alors ce banc DEMANDE au moteur. Pour chaque cible, il crée une table en
 * minuscules, tente un `SELECT` sur la même en casse mélangée, et compare ce
 * que le serveur en a fait à ce que le lecteur affirme. **Le verdict attendu
 * n'est écrit nulle part : il est constaté.**
 *
 * ## Pourquoi ça compte
 *
 * Sur une base ADOPTÉE — créée hors Nodefony, donc dont personne n'a choisi la
 * casse —, une table `users` face à un code qui déclare `Users` était vue
 * ABSENTE en SQLite et PRÉSENTE en MySQL. Le premier verdict retient la mise en
 * service du pod : une table d'entité manquante est bloquante.
 *
 * GATE : SQLite tourne toujours ; les deux autres exigent leur URL d'infra.
 */
const PG_URL = process.env.NF_PG_URL;
const MYSQL_URL = process.env.NF_MYSQL_URL;

/** Table du banc, écrite en minuscules — c'est la base « héritée ». */
const TABLE = "casse_table";

/** La MÊME, en casse mélangée : ce que le code déclarerait. */
const TABLE_DECLAREE = "Casse_Table";

/** Colonne du banc, en minuscules. */
const COLONNE = "monchamp";

/** La MÊME, en casse mélangée. */
const COLONNE_DECLAREE = "monChamp";

interface ICible {
  dialect: SqlDialect;
  label: string;
  actif: boolean;
  /** Ouvre un pilote sur une base à soi, et rend de quoi la libérer. */
  ouvrir(): Promise<{ pilote: IMigrationDriver; liberer(): Promise<void> }>;
}

/**
 * Cite un identifiant dans le dialecte visé.
 *
 * ⚠️ Hors mode ANSI_QUOTES, `"x"` est une CHAÎNE en MySQL, pas un identifiant :
 * un banc écrit aux guillemets doubles y échoue en erreur de syntaxe, et fait
 * accuser le produit.
 *
 * @param nom - identifiant à citer.
 * @param dialect - dialecte du serveur.
 * @returns l'identifiant cité.
 */
const citer = (nom: string, dialect: SqlDialect): string =>
  dialect === "mysql" ? `\`${nom}\`` : `"${nom}"`;

const CIBLES: ICible[] = [
  {
    dialect: "sqlite",
    label: "(sqlite)",
    actif: true,
    ouvrir: async () => {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "nf-casse-"));
      const filename = path.join(dir, "banc.db");
      const pilote = await openMigrationDriver({ dialect: "sqlite", filename });
      return {
        pilote,
        liberer: async () => {
          await pilote.close();
          await fs.rm(dir, { recursive: true, force: true });
        },
      };
    },
  },
  {
    dialect: "postgres",
    label: "(postgres)",
    actif: Boolean(PG_URL),
    // Un schéma dédié, détruit et recréé : les autres suites travaillent dans
    // `public`, et ce banc y créerait une table à un nom qu'elles ne prévoient
    // pas.
    ouvrir: async () => {
      const url = new URL(PG_URL as string);
      url.searchParams.set("options", "-c search_path=nf_casse");
      const admin = await openMigrationDriver({
        dialect: "postgres",
        url: PG_URL as string,
      });
      try {
        await admin.exec("DROP SCHEMA IF EXISTS nf_casse CASCADE");
        await admin.exec("CREATE SCHEMA nf_casse");
      } finally {
        await admin.close();
      }
      const pilote = await openMigrationDriver({
        dialect: "postgres",
        url: url.toString(),
      });
      return {
        pilote,
        liberer: async () => {
          await pilote.close();
          const net = await openMigrationDriver({
            dialect: "postgres",
            url: PG_URL as string,
          });
          try {
            await net.exec("DROP SCHEMA IF EXISTS nf_casse CASCADE");
          } finally {
            await net.close();
          }
        },
      };
    },
  },
  {
    dialect: "mysql",
    label: "(mysql)",
    actif: Boolean(MYSQL_URL),
    // 🔴 Pas de schéma dédié, et ce n'est pas un choix : l'utilisateur
    // applicatif n'a pas le droit de créer une base (`ERROR 1044`). L'isolation
    // se fait donc par suppression de LA table de ce banc — son nom lui est
    // propre, aucune autre suite ne le porte.
    ouvrir: async () => {
      const pilote = await openMigrationDriver({
        dialect: "mysql",
        url: MYSQL_URL as string,
      });
      const vider = () =>
        pilote.exec(`DROP TABLE IF EXISTS ${citer(TABLE, "mysql")}`);
      await vider();
      return {
        pilote,
        liberer: async () => {
          await vider().catch(() => undefined);
          await pilote.close();
        },
      };
    },
  },
];

/**
 * Le moteur résout-il ce nom de table ?
 *
 * CONSTATÉ par un `SELECT` réel, jamais déduit du dialecte : c'est tout l'objet
 * de ce banc.
 *
 * @param pilote - pilote ouvert sur la base du cas.
 * @param nom - nom de table à lire.
 * @param dialect - dialecte, pour la citation.
 * @returns `true` si la requête a abouti.
 */
async function moteurResoutLaTable(
  pilote: IMigrationDriver,
  nom: string,
  dialect: SqlDialect,
): Promise<boolean> {
  try {
    await pilote.query(`SELECT 1 FROM ${citer(nom, dialect)}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Le moteur résout-il ce nom de colonne ?
 *
 * @param pilote - pilote ouvert sur la base du cas.
 * @param colonne - nom de colonne à lire.
 * @param dialect - dialecte, pour la citation.
 * @returns `true` si la requête a abouti.
 */
async function moteurResoutLaColonne(
  pilote: IMigrationDriver,
  colonne: string,
  dialect: SqlDialect,
): Promise<boolean> {
  try {
    await pilote.query(
      `SELECT ${citer(colonne, dialect)} FROM ${citer(TABLE, dialect)}`,
    );
    return true;
  } catch {
    return false;
  }
}

describe("catalogue — la casse d'un nom", () => {
  for (const cible of CIBLES) {
    const cas = cible.actif ? describe : describe.skip;

    cas(`le lecteur répond comme le moteur ${cible.label}`, () => {
      it("🔴 une TABLE dont la casse diffère du code", async () => {
        const { pilote, liberer } = await cible.ouvrir();
        try {
          await pilote.exec(
            `CREATE TABLE ${citer(TABLE, cible.dialect)} ` +
              `(${citer(COLONNE, cible.dialect)} varchar(64))`,
          );

          // Ce que le SERVEUR en fait — constaté, pas supposé.
          const moteur = await moteurResoutLaTable(
            pilote,
            TABLE_DECLAREE,
            cible.dialect,
          );
          // Ce que le LECTEUR en dit.
          const lecteur = await pilote.tableExists(TABLE_DECLAREE);

          assert.equal(
            lecteur,
            moteur,
            `le lecteur dit « ${lecteur} » là où le moteur dit « ${moteur} » ` +
              `pour « ${TABLE_DECLAREE} » face à « ${TABLE} » — un pod serait ` +
              `retenu, ou laissé partir, sur un écart que le serveur ne voit pas pareil`,
          );

          // La table écrite EXACTEMENT comme en base est toujours trouvée :
          // sans cette ligne, un lecteur qui rendrait toujours `false`
          // passerait le cas précédent sur PostgreSQL.
          assert.equal(
            await pilote.tableExists(TABLE),
            true,
            "le lecteur ne voit plus la table sous son propre nom",
          );

          // 🔴 Aucune règle SYNCHRONE n'est assertée ici, et c'est le fond de
          // l'affaire : la sensibilité des noms de TABLES dépend de la machine
          // (`lower_case_table_names` vaut 0 sur ce serveur MySQL, donc
          // sensible ; 1 ou 2 ailleurs). C'est ce banc qui l'a montré, en
          // faisant tomber une première version du produit qui la déduisait du
          // seul dialecte. La seule réponse juste est celle du catalogue.
        } finally {
          await liberer();
        }
      }, 120_000);

      it("🔴 une COLONNE dont la casse diffère — même règle que la table", async () => {
        const { pilote, liberer } = await cible.ouvrir();
        try {
          await pilote.exec(
            `CREATE TABLE ${citer(TABLE, cible.dialect)} ` +
              `(${citer(COLONNE, cible.dialect)} varchar(64))`,
          );

          const moteur = await moteurResoutLaColonne(
            pilote,
            COLONNE_DECLAREE,
            cible.dialect,
          );

          // La comparaison de schéma est le VRAI consommateur : c'est elle qui
          // retient un pod. On l'interroge sur la table telle qu'elle est en
          // base, pour n'éprouver ici que la colonne.
          const ecarts = await compareSchema(pilote, [
            {
              table: TABLE,
              columns: [
                {
                  name: COLONNE_DECLAREE,
                  type: "varchar(64)",
                  nullable: true,
                  primaryKey: false,
                },
              ],
            },
          ]);
          const vueParLaComparaison =
            ecarts.additive.length === 0 && ecarts.blocking.length === 0;

          assert.equal(
            vueParLaComparaison,
            moteur,
            `la comparaison dit « ${vueParLaComparaison} » là où le moteur dit ` +
              `« ${moteur} » pour la colonne « ${COLONNE_DECLAREE} » face à ` +
              `« ${COLONNE} » — un pod serait retenu, ou laissé partir, sur un ` +
              `écart que le serveur ne voit pas pareil`,
          );

          // Pour les COLONNES — et pour elles seules — la règle synchrone du
          // produit est confrontée au serveur : c'est ce qui autorise
          // `compareSchema` à trancher sans requête supplémentaire.
          assert.equal(
            sameColumnName(cible.dialect, COLONNE_DECLAREE, COLONNE),
            moteur,
            "sameColumnName s'écarte de ce que le moteur a montré",
          );
        } finally {
          await liberer();
        }
      }, 120_000);
    });
  }
});
