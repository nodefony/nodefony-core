import assert from "node:assert/strict";
import { normalizeSql } from "../../nodefony/src/migrator/hash";
import { splitStatements } from "../../nodefony/src/migrator/sources";
import {
  FORMAT_MARKER,
  STATEMENT_BREAKPOINT,
} from "../../nodefony/src/migrator/types";
import type { SqlDialect } from "../../nodefony/config/config";

/**
 * La grammaire de chaîne d'une migration est celle de SON moteur.
 *
 * Le découpage doit savoir, ligne par ligne, s'il se trouve DANS une chaîne
 * littérale : c'est ce qui distingue un commentaire d'un texte qui commence
 * par deux tirets, et un séparateur d'instructions d'une donnée qui en porte
 * les caractères. Cette question n'a pas la même réponse selon le moteur —
 * MySQL échappe par contre-oblique, PostgreSQL délimite par `$tag$` — et une
 * grammaire fausse ne lève AUCUNE erreur : elle ampute la donnée insérée, ou
 * coupe une instruction en deux, et la migration s'inscrit en succès avec
 * l'empreinte du fichier entier. Aucun verdict ne peut plus le voir.
 *
 * Ne concerne que les migrations LIBRES (`orm:generate --custom`) — vues,
 * déclencheurs, remplissages : celles qu'on écrit à la main, donc les seules
 * qui portent du texte arbitraire.
 */
describe("@nodefony/drizzle — grammaire de chaîne, par moteur", () => {
  /** Découpe un corps de migration écrit pour un moteur donné. */
  const decoupe = (corps: string[], dialecte: SqlDialect): string[] =>
    splitStatements(
      normalizeSql([FORMAT_MARKER, ...corps].join("\n")),
      dialecte,
    );

  describe("mysql — la contre-oblique échappe l'apostrophe", () => {
    it("garde une ligne de DONNÉE commençant par deux tirets", () => {
      // `\'` n'est pas la fin de la chaîne : elle court jusqu'à la 3ᵉ ligne.
      // Lue avec la grammaire du standard, la chaîne se referme dès `\'`, et
      // la ligne suivante — du texte — est retirée comme un commentaire.
      const statements = decoupe(
        [
          "INSERT INTO nf_note (corps) VALUES ('c\\'est ainsi",
          "-- du texte, pas un commentaire",
          "la fin');",
        ],
        "mysql",
      );
      assert.equal(statements.length, 1);
      assert.match(statements[0] as string, /du texte, pas un commentaire/);
      assert.match(statements[0] as string, /la fin/);
    });

    it("ne coupe pas sur un séparateur porté par la DONNÉE", () => {
      // Même désynchronisation, autre conséquence : le marqueur se retrouve
      // « hors chaîne » et coupe l'instruction en deux moitiés de SQL.
      const statements = decoupe(
        [
          "INSERT INTO nf_note (corps) VALUES ('c\\'est ainsi",
          `on ecrit ${STATEMENT_BREAKPOINT} dans un texte`,
          "la fin');",
        ],
        "mysql",
      );
      assert.equal(statements.length, 1);
      assert.match(statements[0] as string, /la fin/);
    });
  });

  describe("postgres — le corps délimité par des dollars", () => {
    it("garde intact un corps de fonction portant tirets et séparateur", () => {
      // `$$ … $$` est UNE chaîne, sur plusieurs lignes. Tout ce qu'elle porte
      // est du texte : ni le commentaire ni le séparateur n'y ont d'effet.
      const statements = decoupe(
        [
          "CREATE FUNCTION nf_deux() RETURNS int AS $$",
          "-- ce commentaire appartient au corps",
          `  SELECT 2; ${STATEMENT_BREAKPOINT}`,
          "$$ LANGUAGE sql;",
        ],
        "postgres",
      );
      assert.equal(statements.length, 1);
      assert.match(statements[0] as string, /appartient au corps/);
      assert.match(statements[0] as string, /LANGUAGE sql/);
    });

    it("reconnaît un délimiteur NOMMÉ, et lui seul le referme", () => {
      // `$corps$` ne se referme pas sur un `$$` nu croisé en chemin — sans
      // quoi la fin du corps repasserait « hors chaîne » trop tôt.
      const statements = decoupe(
        [
          "CREATE FUNCTION nf_trois() RETURNS text AS $corps$",
          "  SELECT 'un $$ nu ne referme rien';",
          "-- toujours dans le corps",
          "$corps$ LANGUAGE sql;",
        ],
        "postgres",
      );
      assert.equal(statements.length, 1);
      assert.match(statements[0] as string, /toujours dans le corps/);
    });

    it("une chaîne échappée `E'…'` suit la contre-oblique", () => {
      // PostgreSQL n'échappe par contre-oblique QUE dans une chaîne `E'…'`.
      const statements = decoupe(
        [
          "INSERT INTO nf_note (corps) VALUES (E'c\\'est ainsi",
          "-- du texte, pas un commentaire",
          "la fin');",
        ],
        "postgres",
      );
      assert.equal(statements.length, 1);
      assert.match(statements[0] as string, /du texte, pas un commentaire/);
    });
  });

  describe("sqlite — le standard, et rien de plus", () => {
    it("la contre-oblique NE ferme PAS la chaîne : elle est un caractère", () => {
      // Le cas MIROIR de MySQL, et c'est lui qui rend le banc discriminant :
      // appliquer partout la grammaire de MySQL serait aussi faux qu'appliquer
      // partout celle du standard. Ici `'c\'` est une chaîne CLOSE, donc la
      // ligne suivante est un vrai commentaire et doit disparaître.
      const statements = decoupe(
        [
          "INSERT INTO nf_note (corps) VALUES ('c\\');",
          "-- vrai commentaire",
          STATEMENT_BREAKPOINT,
          "SELECT 1;",
        ],
        "sqlite",
      );
      assert.equal(statements.length, 2);
      assert.doesNotMatch(statements[0] as string, /vrai commentaire/);
    });

    it("un couple de dollars n'ouvre AUCUN corps : c'est du SQL ordinaire", () => {
      // Le miroir de PostgreSQL. SQLite accepte le dollar dans un nom, et ne
      // connaît pas le délimiteur `$$` : le lire comme une chaîne ouverte
      // avalerait le séparateur suivant, et fondrait les deux instructions en
      // une seule. Le `$$` est ici HORS chaîne — sans quoi le cas resterait
      // vert quelle que soit la grammaire, donc ne prouverait rien.
      const statements = decoupe(
        ["CREATE TABLE a$$b (id text);", STATEMENT_BREAKPOINT, "SELECT 1;"],
        "sqlite",
      );
      assert.equal(statements.length, 2);
    });
  });
});
