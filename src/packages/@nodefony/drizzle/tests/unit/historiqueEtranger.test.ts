import assert from "node:assert/strict";
import { colonneHistoriqueAbsente } from "../../nodefony/src/migrator/history";
import { verifierLesDonnees } from "../../nodefony/src/migrator/destructive";

/**
 * Ce que cette suite protège : le message rendu quand la table d'historique
 * d'une base n'est pas celle du framework.
 *
 * Instruit sur un transcript du banc de découvrabilité. L'agent avait SUIVI le
 * conseil — éprouver la migration sur une copie plutôt que sur la base réelle.
 * Son « cp » a visé le mauvais chemin et échoué en silence ; il a donc fabriqué
 * la copie au client SQL, avec une table d'historique inventée. La migration y
 * a échoué sur « no such column: source », que le fourre-tout des pannes a
 * habillé de deux causes FAUSSES — « la base n'a pas répondu », « les droits
 * manquent ». Sans issue, il a détruit la base réelle.
 */
describe("une table d'historique qui n'est pas la nôtre", () => {
  describe("colonneHistoriqueAbsente — trois moteurs, trois grammaires", () => {
    it("sqlite : le message exact qui a conduit à la destruction", () => {
      assert.equal(
        colonneHistoriqueAbsente("no such column: source"),
        "source",
      );
    });

    it("postgres", () => {
      assert.equal(
        colonneHistoriqueAbsente(`column "run_id" does not exist`),
        "run_id",
      );
    });

    it("mysql", () => {
      assert.equal(
        colonneHistoriqueAbsente(
          "Unknown column 'finished_at' in 'field list'",
        ),
        "finished_at",
      );
    });

    it("🔴 une colonne APPLICATIVE ne déclenche RIEN — c'est un autre incident", () => {
      // Sans cette borne, toute migration qui bute sur une colonne métier
      // serait rangée sous « historique étranger », et le vrai motif effacé.
      assert.equal(colonneHistoriqueAbsente("no such column: slug"), null);
      assert.equal(
        colonneHistoriqueAbsente(`column "title" does not exist`),
        null,
      );
    });

    it("une panne qui ne parle pas de colonne reste au fourre-tout", () => {
      assert.equal(
        colonneHistoriqueAbsente("ECONNREFUSED 127.0.0.1:5432"),
        null,
      );
      assert.equal(colonneHistoriqueAbsente("access denied for user"), null);
    });
  });

  describe("verifierLesDonnees — la base est NOMMÉE, la copie est expliquée", () => {
    it("sqlite : le fichier à copier, et l'ordre de ne pas le recréer", () => {
      const p = verifierLesDonnees("default", {
        dialect: "sqlite",
        target: "var/databases/nodefony-drizzle.db",
      });
      assert.match(p, /var\/databases\/nodefony-drizzle\.db/);
      assert.match(p, /copie le fichier/);
      assert.match(p, /ne la RECRÉE pas à la main/);
    });

    it("serveur : un export du moteur, jamais un schéma écrit à la main", () => {
      const p = verifierLesDonnees("default", {
        dialect: "postgres",
        target: "postgres://…/app",
      });
      assert.match(p, /pg_dump/);
      assert.match(p, /ne la RECRÉE pas à la main/);
    });

    it("cible inconnue : la phrase tient debout sans inventer de chemin", () => {
      const p = verifierLesDonnees("default");
      assert.match(p, /la base de ce connecteur/);
      assert.doesNotMatch(p, /undefined/);
    });

    it("porte toujours les deux interpréteurs et le connecteur visé", () => {
      const p = verifierLesDonnees("facturation", { dialect: "sqlite" });
      assert.match(p, /PowerShell/);
      assert.match(p, /--connector facturation/);
    });
  });
});
