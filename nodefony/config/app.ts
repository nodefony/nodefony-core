/**
 * Domaine de config : APPLICATION — identité, locale, templating, ORM, packaging.
 */

/**
 * Recharge automatique des fichiers sources en mode dev (watch Rollup).
 * Recommandation prod : `false` pour éviter l'overhead Rollup en runtime.
 */
export const watch = true;

/**
 * Locale par défaut de l'application (fallback pour translation, dates, etc.).
 * Override par requête via headers Accept-Language.
 */
export const locale = "en_en";

/**
 * Métadonnées de l'application — affichées dans les CLI et logs d'init.
 * Modifier pour personnaliser ton fork du framework.
 */
export const App = {
  projectYear: "2024",
  locale: "en_en",
  authorName: "Camensuli Christophe",
  authorMail: "ccamensuli@gmail.com",
};

/**
 * MOTEUR DE TEMPLATES des vues controllers (`renderView()`).
 * Moteur unique = **Eta** (https://eta.js.org) — TypeScript natif, ESM,
 * autoescape, délimiteurs `<% %>`/`<%= %>` sûrs pour HTML comme codegen.
 * Vues `.eta` (remplace l'historique Twig/EJS, retiré 2026-05-29).
 */
export const templating = "eta";

/**
 * ORM PAR DÉFAUT — utilisé par les commandes CLI (orm:migrate, etc.)
 * et par les modules qui n'en déclarent pas un explicitement.
 *   "sequelize" → SQL legacy (maintenance-only, voir migration P7.1)
 *   "mongoose"  → NoSQL standard (P7.2)
 *   futur :
 *     "drizzle"  → SQL moderne TS-first (choix #1 2026 — P7.4)
 *     "mikroorm" → Data Mapper SQL (apps complexes — P7.8)
 * Recommandation prod : "drizzle" dès que P7.4 stable.
 */
export const orm = "sequelize";

/**
 * GESTIONNAIRE DE PAQUETS Node.js — utilisé par les commandes CLI
 * (install, outdated, build, etc.).
 *   "npm"  → standard
 *   "yarn" → workspaces
 *   "pnpm" → store partagé, plus rapide en monorepo
 *   "bun"  → ultra-rapide, supporté pour @nodefony/llm/test
 * Recommandation : "npm" (le plus stable cross-platform).
 */
export const packageManager = "npm";
