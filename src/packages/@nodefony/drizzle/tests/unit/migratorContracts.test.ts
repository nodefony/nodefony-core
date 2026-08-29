import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  FORMAT_MARKER,
  HISTORY_TABLE,
  MYSQL_LOCK_NAME_SQL,
  MYSQL_LOCK_PREFIX,
  PG_LOCK_KEY,
  migrationHash,
  orderSources,
  splitStatements,
  type IMigrationSource,
} from "../../nodefony/src/migrator/index";
import { toDollarParams } from "../../nodefony/src/migrator/drivers/postgresDriver";

/**
 * Les contrats GRAVÉS de l'applicateur — ceux qu'on ne peut plus changer.
 *
 * Chacun de ces tests existe pour CASSER si quelqu'un touche à une identité
 * qui a déjà voyagé chez un utilisateur : le nom d'un verrou, celui d'une
 * table, la forme d'une empreinte, le marqueur d'un format de fichier. Ce n'est
 * pas de la rigidité gratuite — une base de production ne se renomme pas, et
 * deux versions du framework qui ne s'excluent plus se paient pendant un
 * déploiement, le seul moment qui compte.
 */
describe("Applicateur de migrations — contrats gravés", () => {
  it("dérive la clé du verrou PostgreSQL par une RÈGLE, pas par un choix", () => {
    // Recalculée sur place : une identité « gravée » dont la valeur serait
    // tirée au hasard d'un commit ne serait pas vérifiable.
    const derived = createHash("sha256")
      .update("nodefony:migrations")
      .digest()
      .readBigInt64BE(0);
    assert.equal(PG_LOCK_KEY, derived);
    assert.equal(PG_LOCK_KEY.toString(), "9131242216657117845");
  });

  it("qualifie le verrou MySQL par la base, et tient dans la limite du serveur", () => {
    // `GET_LOCK` est global au SERVEUR : sans `DATABASE()`, deux applications
    // sans rapport sur la même instance se sérialiseraient en silence.
    assert.equal(
      MYSQL_LOCK_NAME_SQL,
      "IF(CHAR_LENGTH(DATABASE()) <= 44, " +
        "CONCAT('nodefony:migrations:', DATABASE()), " +
        "CONCAT('nodefony:migrations:#', LEFT(SHA2(DATABASE(), 256), 32)))",
    );
    // MySQL borne un nom de verrou à 64 caractères. Les deux branches y entrent :
    assert.equal(MYSQL_LOCK_PREFIX.length + 44, 64);
    assert.equal(MYSQL_LOCK_PREFIX.length + 1 + 32, 53);
  });

  it("ne qualifie JAMAIS la table d'historique d'un schéma", () => {
    // `public.nodefony_migrations` exclurait à vie l'isolation PostgreSQL par
    // schéma sur une base mutualisée.
    assert.equal(HISTORY_TABLE, "nodefony_migrations");
    assert.ok(!HISTORY_TABLE.includes("."));
  });

  it("écrit une empreinte préfixée de son algorithme", () => {
    const hash = migrationHash("CREATE TABLE a (id TEXT);\n");
    assert.match(hash, /^sha256:[0-9a-f]{64}$/);
  });

  it("hache le contenu NORMALISÉ — les fins de ligne ne comptent pas", () => {
    const lf = "CREATE TABLE a (id TEXT);\nCREATE TABLE b (id TEXT);\n";
    assert.equal(migrationHash(lf), migrationHash(lf.replace(/\n/g, "\r\n")));
    // …mais toute autre modification, elle, compte toujours.
    assert.notEqual(migrationHash(lf), migrationHash(`${lf}-- ajout\n`));
  });

  it("grave le marqueur de format que les fichiers doivent porter", () => {
    assert.equal(FORMAT_MARKER, "-- nodefony:migration format=1");
  });

  it("découpe sur le séparateur de drizzle-kit et jette les commentaires seuls", () => {
    const statements = splitStatements(
      `${FORMAT_MARKER}\nCREATE TABLE a (id TEXT);\n` +
        `--> statement-breakpoint\nCREATE TABLE b (id TEXT);\n` +
        `--> statement-breakpoint\n-- rien que du commentaire\n`,
    );
    assert.deepEqual(statements, [
      "CREATE TABLE a (id TEXT);",
      "CREATE TABLE b (id TEXT);",
    ]);
  });

  it("🔴 le séparateur écrit DANS un commentaire n'en est pas un", () => {
    // Vécu, et le produit se le faisait à lui-même : le gabarit que
    // `orm:generate --custom` écrit porte la phrase « Séparer les instructions
    // par --> statement-breakpoint ». Découper AVANT de retirer les
    // commentaires coupait cette ligne en deux, et le fragment de droite —
    // qui ne commence plus par deux tirets — partait au pilote comme une
    // instruction. Toute migration libre écrite en suivant l'aide du produit
    // échouait, et l'historique gardait la trace d'une migration `failed`.
    const statements = splitStatements(
      `${FORMAT_MARKER}\n` +
        `-- Séparer les instructions par « --> statement-breakpoint ».\n` +
        `ALTER TABLE a DROP COLUMN b;\n`,
    );
    assert.deepEqual(statements, ["ALTER TABLE a DROP COLUMN b;"]);
  });

  it("le séparateur COLLÉ en fin d'instruction reste un séparateur", () => {
    // C'est la forme que drizzle-kit écrit réellement — le séparateur n'est pas
    // seul sur sa ligne. Le reconnaître « ligne entière » serait plus simple et
    // ferait fusionner toutes les instructions d'une migration du framework.
    assert.deepEqual(
      splitStatements(
        `CREATE INDEX i ON t (a);--> statement-breakpoint\nCREATE INDEX j ON t (b);\n`,
      ),
      ["CREATE INDEX i ON t (a);", "CREATE INDEX j ON t (b);"],
    );
  });

  it("le séparateur écrit dans une VALEUR est de la donnée, pas une coupure", () => {
    // `--custom` sert à écrire du SQL libre, remplissages compris. Un texte qui
    // contient les mots du séparateur ne doit pas couper l'instruction en deux
    // moitiés — le pilote recevrait du SQL tronqué, et la donnée serait fausse.
    assert.deepEqual(
      splitStatements(
        `INSERT INTO note (corps) VALUES ('avant --> statement-breakpoint apres');\n`,
      ),
      [
        "INSERT INTO note (corps) VALUES ('avant --> statement-breakpoint apres');",
      ],
    );
  });

  it("ordonne les sources par rang, le nom départageant", () => {
    const sources: IMigrationSource[] = [
      { name: "app", dir: "/app", rank: 1_000_000 },
      { name: "vendor-b", dir: "/b", rank: 10 },
      { name: "vendor-a", dir: "/a", rank: 10 },
      { name: "framework", dir: "/fw", rank: 0 },
    ];
    assert.deepEqual(
      orderSources(sources).map((s) => s.name),
      ["framework", "vendor-a", "vendor-b", "app"],
    );
  });

  it("traduit les paramètres du dialecte commun vers PostgreSQL", () => {
    assert.equal(
      toDollarParams("SELECT a FROM t WHERE b = ? AND c = ?::text"),
      "SELECT a FROM t WHERE b = $1 AND c = $2::text",
    );
  });
});
