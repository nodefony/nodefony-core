import { z } from "zod";

/**
 * Schéma Zod de la configuration de `@nodefony/documentation`.
 *
 * Source de vérité du module : le type TS est dérivé via `z.infer<>`, et la
 * config est validée au boot du Module class (hook `onKernelRegister`, via le
 * builder {@link defineDocumentationConfig}) → plante propre avec messages
 * clairs si la config est invalide, plutôt qu'un `undefined.x` silencieux.
 *
 * Convention figée 2026-05-28 (cf mémoire `feedback_config_validation_zod`).
 * Alignement sur `@nodefony/redis/nodefony/config/schema.ts`.
 *
 * ⚠️ ENV : ce schéma reste PUR (pas de lecture `process.env` ici, sinon il
 * deviendrait non déterministe et non sérialisable en JSON Schema pour Studio).
 * La surcharge par variables d'environnement (`DOCS_REPO_URL`,
 * `DOCS_REPO_BRANCH`) est appliquée dans {@link defineDocumentationConfig},
 * APRÈS le parse.
 */

// Sous-schémas extraits — réutilisés dans `.default(() => sub.parse({}))` pour
// que les sous-défauts soient appliqués quand la section parente est omise (Zod
// 4 n'applique PAS les sous-défauts via un `.default({})` plat — cf redis).

const scanSchema = z
  .object({
    rootDir: z
      .string()
      .min(1)
      .default("docs")
      .describe(
        "Dossier de documentation transverse, relatif à la racine du projet " +
          "(`kernel.path`). Défaut `docs`. Scanné récursivement pour les `.md`. " +
          "C'est la doc qui n'appartient à aucun module (guides, ADR, audits).",
      ),
    includeModules: z
      .boolean()
      .default(true)
      .describe(
        "Scanne aussi les `<module>/docs/*.md` co-localisés à chaque module " +
          "chargé (ADR-0001 : la doc d'un module vit DANS le module). true = " +
          "index transverse complet (racine + modules). false = racine seule " +
          "(parité POC). La découverte des modules passe par `kernel.modules`.",
      ),
    exclude: z
      .array(z.string().min(1))
      .default(["session-retros", "node_modules", "dist"])
      .describe(
        "Noms de segments de chemin EXCLUS du scan (comparaison par segment, " +
          "pas par préfixe). Défaut : retex de session, deps et build. Évite " +
          "de surfacer du bruit ou des fichiers générés dans le portail.",
      ),
  })
  .describe("Sources scannées pour construire l'index transverse de la doc.");

const repoSchema = z
  .object({
    url: z
      .string()
      .min(1)
      .default("https://github.com/nodefony/nodefony-core")
      .describe(
        "URL de base du dépôt (sans slash final), pour construire le lien " +
          "« Modifier sur GitHub » d'une page. Surchargeable par l'env " +
          "`DOCS_REPO_URL`. Aucun secret — URL publique uniquement.",
      ),
    branch: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Branche utilisée dans le lien d'édition. Si OMISE (défaut), la " +
          "branche RÉELLE est résolue au runtime via `GitService.branch()` du " +
          "core (lecture `.git/HEAD`, 0 spawn) → le lien suit toujours la " +
          "branche courante. Surchargeable par l'env `DOCS_REPO_BRANCH` " +
          "(utile en CI/prod détaché de git, ex. conteneur sans `.git`).",
      ),
    editPathPrefix: z
      .enum(["edit", "blob", "tree"])
      .default("edit")
      .describe(
        "Segment GitHub du lien source : `edit` (éditeur web), `blob` " +
          "(lecture du fichier), `tree` (dossier). Défaut `edit`.",
      ),
  })
  .describe("Identité du dépôt pour les liens d'édition des pages.");

const cacheSchema = z
  .object({
    ttlMs: z
      .number()
      .int()
      .nonnegative()
      .default(30_000)
      .describe(
        "Durée de vie (ms) du cache de l'index (l'arbre des pages). Le scan FS " +
          "n'est refait qu'à l'expiration. Défaut 30 s. 0 = pas de cache (chaque " +
          "requête rescanne — pratique en dev pour voir un nouveau `.md` " +
          "immédiatement). Le contenu d'une page n'est PAS caché (toujours relu).",
      ),
  })
  .describe("Politique de cache de l'index (chemin froid admin, lazy).");

export const documentationConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Active le data plane de documentation au boot. false = module chargé " +
          "mais inerte (endpoints inactifs) — utile pour couper la doc en prod " +
          "si non désirée.",
      ),
    scan: scanSchema.default(() => scanSchema.parse({})),
    repo: repoSchema.default(() => repoSchema.parse({})),
    cache: cacheSchema.default(() => cacheSchema.parse({})),
  })
  .describe("Configuration de @nodefony/documentation.");

export type DocumentationConfig = z.infer<typeof documentationConfigSchema>;
