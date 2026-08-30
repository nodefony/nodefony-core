import assert from "node:assert/strict";
import { migrationHash, normalizeSql } from "../../nodefony/src/migrator/hash";
import { splitStatements } from "../../nodefony/src/migrator/sources";
import {
  FORMAT_MARKER,
  STATEMENT_BREAKPOINT,
} from "../../nodefony/src/migrator/types";

/**
 * Ce que devient un fichier de migration **entre le disque et le pilote**.
 *
 * Un fichier de migration voyage : il est écrit sur une machine, commité,
 * récupéré sur une autre, parfois par un outil qui le réécrit. Trois choses
 * changent en chemin sans que personne ne l'ait voulu — les fins de ligne, la
 * marque d'ordre des octets, et l'encodage du texte. Chacune peut soit faire
 * refuser un fichier parfaitement valide, soit faire diverger son empreinte et
 * arrêter toutes les migrations d'une équipe.
 *
 * Ces cas se prouvent **sans base** : ce sont des fonctions pures. Les mettre
 * ici plutôt que dans un banc à serveur, c'est la différence entre trois
 * millisecondes et trois minutes — donc entre un contrôle qu'on lance et un
 * contrôle qu'on saute.
 */
describe("@nodefony/drizzle — fichiers de migration (lecture et empreinte)", () => {
  /** Marque d'ordre des octets, telle que Windows la pose en tête de fichier. */
  const BOM = "﻿";

  const CORPS = [
    FORMAT_MARKER,
    "CREATE TABLE nf_widget (id text PRIMARY KEY);",
    STATEMENT_BREAKPOINT,
    "CREATE INDEX nf_widget_id ON nf_widget (id);",
  ].join("\n");

  describe("normalisation — ce que le voyage a changé ne compte pas", () => {
    it("retire la marque d'ordre des octets posée par un éditeur Windows", () => {
      assert.equal(normalizeSql(`${BOM}${CORPS}`), CORPS);
    });

    it("ramène les fins de ligne Windows en LF", () => {
      assert.equal(normalizeSql(CORPS.replace(/\n/g, "\r\n")), CORPS);
    });

    it("🔴 l'empreinte est la MÊME sous les quatre formes du même fichier", () => {
      // C'est l'assertion qui protège une équipe entière : une base migrée
      // depuis une image Linux et un poste Windows qui relit le dépôt doivent
      // s'accorder. Sinon toute migration s'arrête sur une dérive d'empreinte
      // que personne n'a provoquée, et le geste proposé (ré-aligner) grave
      // l'accident dans l'historique.
      const crlf = CORPS.replace(/\n/g, "\r\n");
      const empreintes = new Set([
        migrationHash(CORPS),
        migrationHash(`${BOM}${CORPS}`),
        migrationHash(crlf),
        migrationHash(`${BOM}${crlf}`),
      ]);
      assert.equal(
        empreintes.size,
        1,
        `quatre représentations du même fichier ont donné ${empreintes.size} empreintes`,
      );
    });

    it("une modification RÉELLE du SQL change bien l'empreinte", () => {
      // Le pendant du cas précédent : à force de normaliser, on finit par ne
      // plus rien détecter. Le garde-fou doit rester entier.
      assert.notEqual(
        migrationHash(CORPS),
        migrationHash(CORPS.replace("nf_widget", "nf_gadget")),
      );
    });

    it("l'empreinte annonce son algorithme — la seule porte de sortie", () => {
      assert.match(migrationHash(CORPS), /^sha256:[0-9a-f]{64}$/);
    });

    it("une marque d'ordre des octets AILLEURS qu'en tête n'est pas touchée", () => {
      // Elle n'est plus un artefact d'encodage : c'est du contenu, et le
      // contenu ne se réécrit pas en silence.
      const milieu = `${FORMAT_MARKER}\nSELECT '${BOM}';`;
      assert.equal(normalizeSql(milieu), milieu);
    });
  });

  describe("découpe — un commentaire n'est un commentaire qu'hors chaîne", () => {
    it("retire les lignes de commentaire, marqueur de format compris", () => {
      const statements = splitStatements(normalizeSql(CORPS), "sqlite");
      assert.equal(statements.length, 2);
      assert.ok(statements[0]?.startsWith("CREATE TABLE"));
      assert.ok(statements[1]?.startsWith("CREATE INDEX"));
    });

    it("🔴 garde une ligne à deux tirets qui vit DANS une chaîne littérale", () => {
      // `orm:generate --custom` existe pour écrire du SQL libre : vues,
      // déclencheurs, remplissages. Un texte multi-ligne dont une ligne
      // commence par deux tirets est alors de la DONNÉE. La retirer change
      // silencieusement ce qui est inséré — le pire des défauts, celui qui ne
      // lève aucune erreur.
      const sql = [
        FORMAT_MARKER,
        "INSERT INTO nf_note (corps) VALUES ('premiere",
        "-- ceci est du texte, pas un commentaire",
        "derniere');",
      ].join("\n");
      const [statement] = splitStatements(normalizeSql(sql), "sqlite");
      assert.ok(statement);
      assert.match(statement, /ceci est du texte/);
      assert.match(statement, /premiere/);
      assert.match(statement, /derniere/);
    });

    it("l'apostrophe doublée referme puis rouvre correctement", () => {
      // `'l''auteur'` est UNE chaîne close : la ligne suivante est donc bien un
      // commentaire, et doit disparaître.
      const sql = [
        FORMAT_MARKER,
        "INSERT INTO nf_note (corps) VALUES ('l''auteur');",
        "-- vrai commentaire",
        STATEMENT_BREAKPOINT,
        "SELECT 1;",
      ].join("\n");
      const statements = splitStatements(normalizeSql(sql), "sqlite");
      assert.equal(statements.length, 2);
      assert.doesNotMatch(statements[0] as string, /vrai commentaire/);
    });

    it("un fichier qui ne porte QUE des commentaires ne rend aucun statement", () => {
      // Un statement vide envoyé au pilote est refusé par certains drivers ;
      // c'est ce que la découpe existe pour éviter.
      const sql = [FORMAT_MARKER, "-- rien à faire ici"].join("\n");
      assert.deepEqual(splitStatements(normalizeSql(sql), "sqlite"), []);
    });

    it("un fichier VIDE ne rend aucun statement, et ne jette pas", () => {
      assert.deepEqual(splitStatements(normalizeSql(""), "sqlite"), []);
    });

    it("un point-virgule DANS une chaîne ne coupe rien", () => {
      // La découpe se fait sur le marqueur de drizzle-kit, jamais sur `;` —
      // c'est ce qui rend un remplissage textuel sûr. On le VERROUILLE ici :
      // découper sur `;` serait une « simplification » tentante.
      const sql = [
        FORMAT_MARKER,
        "INSERT INTO nf_note (corps) VALUES ('un; deux; trois');",
      ].join("\n");
      assert.equal(splitStatements(normalizeSql(sql), "sqlite").length, 1);
    });

    it("garde le texte non ASCII intact — accents, idéogrammes, emoji", () => {
      // La chaîne traverse `readFile(utf8)` → normalisation → découpe → pilote.
      // Un seul maillon qui travaille en octets et l'insertion part tronquée.
      const texte = "héros · 日本語 · 🚀";
      const sql = [
        FORMAT_MARKER,
        `INSERT INTO nf_note (corps) VALUES ('${texte}');`,
      ].join("\n");
      const [statement] = splitStatements(normalizeSql(sql), "sqlite");
      assert.ok(statement?.includes(texte));
    });
  });
});
