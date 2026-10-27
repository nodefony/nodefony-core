// Schéma du banc ORM pour les camps témoins — LA table que le serveur Nodefony
// exécute, lue dans le `dist` du module test (`entity/benchCorpus/corpus.js`,
// écrit par `bench-orm-corpus.mjs` du skill `nodefony-devkit-bench`). UNE
// implémentation : chaque camp qui recopiait son chemin d'import aurait pu
// viser une autre table que celle de Nodefony, sans que rien ne le signale.
//
// Les tables sont des descriptions du kit de colonnes : `.table(dialect)` rend
// la table Drizzle du moteur visé, mémoïsée — la même instance que celle du
// serveur sur ce dialecte. Son `drizzle-orm` est celui du node_modules RACINE :
// un camp l'exécute par la passerelle (`../repo-drizzle-*.mjs`), jamais par un
// spécificateur nu écrit ici.
//
// ⚠️ `total_ht` / `total_ttc` sont des `decimal(24,8)` : le kit les lit et les
// écrit en CHAÎNE (`String(n)`) — un `number` y est refusé.
const CORPUS = new URL(
  "../../../../src/modules/test/dist/nodefony/entity/benchCorpus/corpus.js",
  import.meta.url,
).href;

let corpus = null;

/**
 * Table Drizzle d'une table du banc, pour un dialecte.
 *
 * @param {string} name - `llx_facture`, `llx_user`, `llx_societe`.
 * @param {"sqlite" | "postgres" | "mysql"} dialect - moteur du camp.
 * @returns la table du dialecte.
 */
export async function benchTable(name, dialect) {
  if (corpus === null) {
    try {
      ({ BENCH_CORPUS: corpus } = await import(CORPUS));
    } catch (e) {
      console.error(
        `❌ corpus du banc ORM introuvable (${CORPUS}) — le produire :\n` +
          "   node .claude/skills/nodefony-devkit-bench/scripts/bench-orm-corpus.mjs\n" +
          "   (cd src/modules/test && npm run build)",
      );
      throw e;
    }
  }
  const table = corpus.get(name);
  if (!table) throw new Error(`banc ORM : table ${name} absente du corpus`);
  return table.table(dialect);
}
