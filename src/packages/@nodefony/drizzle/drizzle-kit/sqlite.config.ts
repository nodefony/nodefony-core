import { defineConfig } from "drizzle-kit";

/**
 * Configuration `drizzle-kit` du dialecte `sqlite` — génération SEULE.
 *
 * Aucune information de connexion n'y figure : ce dépôt ne génère jamais contre
 * une base vivante. Le diff est calculé entre l'instantané du dossier de sortie
 * et le schéma matérialisé — c'est ce qui permet de produire les trois dialectes
 * depuis une machine qui n'a aucun serveur installé.
 *
 * `prefix: "index"` donne des noms `0000_…`, `0001_…` : un ordre lexicographique
 * qui est aussi l'ordre d'application, et qui reste lisible dans le journal.
 *
 * ⚠️ Ne jamais lancer ce fichier seul — les trois dialectes se génèrent ENSEMBLE
 * sous le même nom (`npm run generate:migrations`), sinon les trois journaux
 * divergent et l'historique est désaligné pour toujours.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./nodefony/migrations-schema/sqlite.ts",
  out: "./migrations/sqlite",
  migrations: { prefix: "index" },
});
