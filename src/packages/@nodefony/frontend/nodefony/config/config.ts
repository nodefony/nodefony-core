import { z } from "zod";

/**
 * @nodefony/frontend — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` = la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * surcharge via `use("@nodefony/...", { … })` dans SON `nodefony.config.ts`.
 *
 * Ce module pilote Vite (builder + dev server) pour transpiler les frontends
 * déclarés par chaque module Nodefony :
 *
 *   { frontend: { type: "react19", entry: "./frontend/src/main.tsx" } }
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le **schéma Zod commenté** (type +
 * validation + défaut + doc) ET matérialise les défauts via `parse({})`. Aucune
 * valeur n'est re-tapée ailleurs. Le builder (`defineModuleConfig.ts` →
 * `defineFrontendConfig`) importe le schéma D'ICI (nœud bas : ce fichier
 * n'importe que `zod` → pas de cycle). La fusion + validation finale
 * (`défauts + module.options`) est faite dans `index.ts` au hook
 * `onKernelRegister` via `defineFrontendConfig` (plante propre si invalide).
 *
 * ⚠️ NE PAS éditer les défauts matérialisés en bas de fichier : modifier les
 * `.default(...)` du schéma. La doc de chaque champ (`.describe(...)`) est
 * surfacée dans le panneau de config Studio via `frontendConfigJsonSchema()`.
 *
 * Périmètre : config **module-level** (le dev server Vite + le build prod). La
 * config **par entrée** (`registerEntry(module, { entry, root, publicPath, … })`)
 * est une déclaration runtime du module consommateur, PAS de la config — donc
 * hors de ce schéma.
 */

// Sous-schéma extrait → `.default(() => resilienceSchema.parse({}))` pour que les
// sous-défauts s'appliquent même quand la section `resilience` est omise (Zod 4
// n'applique pas les sous-défauts via un `.default({})` plat).
const resilienceSchema = z
  .strictObject({
    autoRestart: z
      .boolean()
      .default(true)
      .describe(
        "Redémarre automatiquement le superviseur Vite sur crash inattendu. " +
          "Défaut : true. Mettre `false` en CI pour faire échouer le pipeline " +
          "sur un crash Vite au lieu de le masquer.",
      ),
    maxRestarts: z
      .number()
      .int()
      .nonnegative()
      .default(5)
      .describe(
        "Nombre maximal de tentatives de restart avant de passer en " +
          '`state: "errored"`. Défaut : 5.',
      ),
    restartBackoffBaseMs: z
      .number()
      .int()
      .positive()
      .default(500)
      .describe(
        "Base du backoff exponentiel entre deux restarts (ms). Défaut : 500.",
      ),
    restartBackoffMaxMs: z
      .number()
      .int()
      .positive()
      .default(8_000)
      .describe("Plafond du backoff exponentiel (ms). Défaut : 8000."),
    healthCheckIntervalMs: z
      .number()
      .int()
      .nonnegative()
      .default(30_000)
      .describe(
        "Intervalle entre deux health checks du dev server (ms). `0` désactive " +
          "le health check. Défaut : 30000.",
      ),
    healthCheckFailureThreshold: z
      .number()
      .int()
      .positive()
      .default(3)
      .describe(
        "Nombre d'échecs consécutifs de health check avant de déclencher un " +
          "restart. Défaut : 3.",
      ),
    healthCheckTimeoutMs: z
      .number()
      .int()
      .positive()
      .default(5_000)
      .describe("Timeout d'un health check individuel (ms). Défaut : 5000."),
    portRetryAttempts: z
      .number()
      .int()
      .positive()
      .default(3)
      .describe(
        "Nombre de ports à essayer sur `EADDRINUSE` (devPort, devPort+1, …). " +
          "Défaut : 3.",
      ),
  })
  .describe(
    "Résilience du superviseur Vite (auto-restart, backoff, health check). " +
      "Toutes optionnelles — les défauts internes s'appliquent si rien n'est fourni.",
  );

export const frontendConfigSchema = z
  .strictObject({
    devHost: z
      .string()
      .default("127.0.0.1")
      .describe(
        "Adresse d'écoute du dev server Vite. Défaut (RECOMMANDÉ) : la boucle " +
          "locale — le navigateur ne joint jamais Vite directement, Nodefony le " +
          "relaie sur l'origine de la page (`/_vite/<famille>/`). Prod : N/A " +
          "(Vite ne tourne pas en prod, le manifest pilote).",
      ),
    devPort: z
      .number()
      .int()
      .positive()
      .default(5173)
      .describe(
        "Port d'écoute du dev server Vite (5173 par défaut) — port de BASE : chaque " +
          "famille de frontends prend le bloc suivant. Si occupé, c'est le " +
          "SUPERVISEUR qui relance sur le port suivant (`resilience.portRetryAttempts` " +
          "essais) et publie le port réel dans son `status()` — Vite, lui, ne se " +
          "décale jamais seul : le fichier généré porte `strictPort` pour que " +
          "le relais `/_vite/<famille>/` vise toujours le Vite qui sert. Le " +
          "navigateur ne voit jamais ce port : il passe par l'origine de la page.",
      ),
    publicOrigin: z
      .string()
      .default("")
      .meta({
        deprecated: true,
        description:
          "DÉPRÉCIÉE — sans effet, retrait à la majeure suivante (un WARNING le " +
          "dit au démarrage). Vite est désormais servi DERRIÈRE Nodefony, sur " +
          "l'origine de la page (`/_vite/<famille>/`, proxy inverse) : la page, " +
          "ses scripts et le socket du rechargement à chaud n'ont qu'une " +
          "origine, quel que soit le chemin du client (poste, conteneur, IP de " +
          "réseau local, Codespaces). Retirer la clé.",
      }),
    autoStartInDevelopment: z
      .boolean()
      .default(true)
      .describe(
        "Démarre automatiquement le superviseur Vite quand le kernel passe en " +
          "`development`. Ignoré en `production`/`staging`. Reco : true en dev, " +
          "sinon les helpers template injecteront une URL morte.",
      ),
    defaultOutDir: z
      .string()
      .default("./public/dist")
      .describe(
        "Dossier de sortie par défaut pour le build prod, relatif à la racine du " +
          "module consommateur. Réécrit par la prop `outDir` de la déclaration d'entrée.",
      ),
    defaultRoot: z
      .string()
      .default("./frontend")
      .describe("Racine front par défaut (contient `index.html`) côté module."),
    assetBaseUrl: z
      .string()
      .default("")
      .describe(
        "Base URL des assets servis en PRODUCTION (CDN / object storage / edge). " +
          "Vide = assets servis depuis l'origine Nodefony en chemins relatifs " +
          "(comportement historique). Renseignée (ex. `https://cdn.example.com`), " +
          "elle préfixe le `base` Vite au build, les URLs de `renderProdTags` et le " +
          "helper `asset('/x')`. N'affecte JAMAIS le mount `Statics`. Reco prod " +
          "cloud-native : pointer le CDN devant l'object storage.",
      ),
    startupTimeoutMs: z
      .number()
      .int()
      .positive()
      .default(30_000)
      .describe(
        "Timeout (ms) d'attente du `Local: http://…` dans le stdout Vite avant de " +
          "considérer le démarrage comme cassé. Dev : 30s suffisent pour un " +
          "cold-start Vite. Prod : N/A.",
      ),
    pipeViteLogs: z
      .boolean()
      .default(true)
      .describe(
        "Propage les logs Vite vers le syslog Nodefony (sinon ils restent dans le " +
          "stdout du process enfant uniquement).",
      ),
    https: z
      .boolean()
      .default(false)
      .meta({
        deprecated: true,
        description:
          "DÉPRÉCIÉE — sans effet, retrait à la majeure suivante (un WARNING le " +
          "dit au démarrage). Le chiffrement est celui de la page : Vite reste " +
          "en HTTP sur la boucle locale, derrière le proxy inverse de Nodefony, " +
          "et une page HTTPS charge ses scripts en HTTPS sur la même origine — " +
          "un seul certificat à accepter. Retirer la clé.",
      }),
    viteEnv: z
      .record(z.string(), z.string())
      .default({})
      .describe(
        "Variables d'environnement supplémentaires passées au child Vite. Les clés " +
          "préfixées `VITE_` sont exposées au navigateur via `import.meta.env.VITE_*` " +
          '(ex. `{ VITE_API_BASE: "/api/v1" }`). Reco prod : utiliser un ' +
          "`.env.production` dans le `root` Vite plutôt que cette option, pour ne pas " +
          "leak de secrets dans le code Nodefony.",
      ),
    resilience: resilienceSchema.default(() => resilienceSchema.parse({})),
  })
  .describe(
    "Configuration de @nodefony/frontend (dev server Vite + build prod).",
  );

/** Type de sortie (config normalisée + défauts appliqués). */
export type IFrontendConfig = z.infer<typeof frontendConfigSchema>;

/**
 * Défauts du module, matérialisés depuis le schéma (source unique). Toujours
 * valides par construction ; passés au `super(..., config)` du Module class.
 */
const config: IFrontendConfig = frontendConfigSchema.parse({});

export default config;
