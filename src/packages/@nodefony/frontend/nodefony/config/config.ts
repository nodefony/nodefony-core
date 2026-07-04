import { z } from "zod";

/**
 * @nodefony/frontend — CONFIGURATION DU MODULE (schéma Zod = source unique).
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
  .object({
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
  .object({
    devHost: z
      .string()
      .default("127.0.0.1")
      .describe(
        "Host d'écoute du dev server Vite — utilisé tel quel dans les `<script>` " +
          "injectés (doit être joignable depuis le navigateur). Prod : N/A (Vite " +
          "ne tourne pas en prod, le manifest pilote).",
      ),
    devPort: z
      .number()
      .int()
      .positive()
      .default(5173)
      .describe(
        "Port d'écoute du dev server Vite (Vite démarre sur 5173 par défaut). Si " +
          "occupé, Vite incrémente jusqu'à un port libre ; le superviseur détecte " +
          "le port réel dans son stdout et met à jour son `status()`.",
      ),
    autoStartInDevelopment: z
      .boolean()
      .default(true)
      .describe(
        "Démarre automatiquement le superviseur Vite quand le kernel passe en " +
          "`development`. Ignoré en `production`/`staging`. Reco : true en dev, " +
          "sinon les helpers template injecteront une URL morte.",
      ),
    enabledPresets: z
      .array(z.enum(["react19", "vue3", "svelte5", "solid", "vanilla"]))
      .default(["react19", "vanilla"])
      .describe(
        "Présets activés pour le scan paresseux des plugins. Reco : laisser tous " +
          "activés — seuls les modules qui les déclarent déclenchent le chargement " +
          "réel des deps.",
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
    backendHost: z
      .string()
      .default("127.0.0.1")
      .describe(
        "Host du serveur Nodefony cible du proxy Vite (`server.proxy`). Quand le " +
          'navigateur fait `fetch("/api/...")` depuis la page servie par Vite, ' +
          "Vite proxifie vers `${backendProtocol}://${backendHost}:${backendPort}`.",
      ),
    backendPort: z
      .number()
      .int()
      .positive()
      .default(5151)
      .describe(
        "Port du serveur Nodefony cible du proxy Vite. HTTP par défaut (5151, " +
          "config par défaut de `@nodefony/http`). Ajuster si l'app surcharge.",
      ),
    backendProtocol: z
      .enum(["http", "https"])
      .default("http")
      .describe(
        "Protocole du proxy Vite vers Nodefony. `http` par défaut — `https` pour " +
          "proxifier vers le serveur HTTPS Nodefony (5152). Avec `https` et un " +
          "certificat self-signed, prévoir `secure: false` côté proxy.",
      ),
    https: z
      .boolean()
      .default(false)
      .describe(
        "Active HTTPS pour le dev server Vite (récupère les certificats du service " +
          "`certificates` de `@nodefony/http`, mêmes certs que `server-https` 5152). " +
          "Reco : true quand la page Nodefony est servie en HTTPS (5152) — évite le " +
          "warning mixed-content. Le navigateur demandera la confiance pour 5173 si " +
          "la CA root Nodefony n'est pas installée localement.",
      ),
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
export type FrontendConfig = z.infer<typeof frontendConfigSchema>;

/**
 * Défauts du module, matérialisés depuis le schéma (source unique). Toujours
 * valides par construction ; passés au `super(..., config)` du Module class.
 */
const config: FrontendConfig = frontendConfigSchema.parse({});

export default config;
