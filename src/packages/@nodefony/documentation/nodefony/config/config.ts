import { z } from "zod";

/**
 * @nodefony/documentation — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` = la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * surcharge via `use("@nodefony/...", { … })` dans SON `nodefony.config.ts`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le **schéma Zod commenté** (type +
 * validation + défaut + doc) ET matérialise les défauts via `parse({})`. Aucune
 * valeur n'est re-tapée ailleurs. Le builder (`defineModuleConfig.ts` →
 * `defineDocumentationConfig`) importe le schéma D'ICI (nœud bas : ce fichier
 * n'importe que `zod` → pas de cycle).
 *
 * La config est validée au boot du Module class (hook `onKernelRegister`, via
 * le builder {@link defineDocumentationConfig}) → plante propre avec messages
 * clairs si la config est invalide, plutôt qu'un `undefined.x` silencieux.
 *
 * ⚠️ ENV : ce schéma reste PUR (pas de lecture `process.env` ici, sinon il
 * deviendrait non déterministe et non sérialisable en JSON Schema pour Studio).
 * La surcharge par variables d'environnement (`DOCS_REPO_URL`,
 * `DOCS_REPO_BRANCH`) est appliquée dans {@link defineDocumentationConfig},
 * APRÈS le parse.
 *
 * SURCHARGE PAR L'APPLICATION (fusion récursive) :
 *
 *   // nodefony.config.ts
 *   use("@nodefony/documentation", {
 *     scan: { includeModules: false },
 *     repo: { url: "https://github.com/acme/app", editPathPrefix: "blob" },
 *     cache: { ttlMs: 0 },
 *   })
 *
 * ⚠️ NE PAS éditer les défauts matérialisés en bas de fichier : modifier les
 * `.default(...)` du schéma. La validation + le merge env finaux sont faits dans
 * `index.ts` au hook `onKernelRegister` via `defineDocumentationConfig`.
 */

// Sous-schémas extraits — réutilisés dans `.default(() => sub.parse({}))` pour
// que les sous-défauts soient appliqués quand la section parente est omise (Zod
// 4 n'applique PAS les sous-défauts via un `.default({})` plat — cf redis).

const scanSchema = z
  .strictObject({
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
    includeInstalled: z
      .boolean()
      .default(true)
      .describe(
        "Scanne aussi la doc des paquets Nodefony INSTALLÉS mais pas encore " +
          "chargés (`node_modules/@nodefony/*/docs` + le cœur `nodefony`). " +
          "Sans cela, la doc d'un module non activé est introuvable — alors " +
          "que c'est précisément le moment où on la lit : pour décider de " +
          "l'activer. Les chemins sont résolus en real-path, donc un lien de " +
          "workspace pointe vers la source, pas vers le lien symbolique.",
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
  .strictObject({
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
  .strictObject({
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
  .strictObject({
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

/** Type de sortie (config normalisée + défauts appliqués). */
export type DocumentationConfig = z.infer<typeof documentationConfigSchema>;

/**
 * Type d'ENTRÉE (ce que l'utilisateur écrit dans `use()`, avant application des
 * défauts) — tout y est optionnel. C'est CE type qui augmente le registre
 * `NodefonyModuleConfig`, jamais la sortie : exiger la forme normalisée
 * obligerait l'app à réécrire chaque défaut.
 */
export type DocumentationConfigInput = z.input<
  typeof documentationConfigSchema
>;

/**
 * Défauts du module, matérialisés depuis le schéma (source unique). Toujours
 * valides par construction ; passés au `super(..., config)` du Module class.
 */
const config: DocumentationConfig = documentationConfigSchema.parse({});

export default config;
