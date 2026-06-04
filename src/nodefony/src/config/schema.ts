/**
 * Schéma Zod de la config d'application — validé au resolve de `defineConfig` (D1).
 *
 * Vit dans le CORE (zod = peerDep core, back-only) : `import { defineConfig } from
 * "nodefony"` valide tout seul, sans que chaque app porte son propre schéma. But :
 * planter PROPREMENT au boot (message clair) sur une config malformée, plutôt qu'un
 * `Cannot read properties of undefined` plus tard en runtime.
 *
 * Le schéma DÉCRIT (il ne dérive pas les défauts — ceux-ci sont dans `./defaults`).
 * Tous les champs sont `.optional()` : il rejette les TYPES/valeurs invalides, pas
 * l'absence (le merge a déjà rempli les défauts ; le Kernel a des fallbacks
 * résiduels). Les clés inconnues — `module-<x>` (overrides validés par chaque
 * module), `App`, `cluster`… — sont ignorées (objet zod non-strict).
 */
import { z } from "zod";

const serverSchema = z.object({
  port: z.number().int().positive().optional(),
});

const logSchema = z.object({
  active: z.boolean().optional(),
  debug: z.union([z.string(), z.array(z.string())]).optional(),
  requestFormat: z.enum(["auto", "default", "pretty", "json"]).optional(),
  buffered: z.union([z.boolean(), z.literal("auto")]).optional(),
  driver: z.enum(["stdout", "file", "null"]).optional(),
  file: z.object({ sync: z.boolean().optional() }).optional(),
  queryDriver: z.string().optional(),
  loki: z.object({ url: z.string() }).optional(),
  opensearch: z.object({ url: z.string() }).optional(),
});

const serversSchema = z.object({
  statics: z.boolean().optional(),
  http: serverSchema.optional(),
  https: z
    .object({
      port: z.number().int().positive().optional(),
      protocol: z.enum(["1.1", "2.0"]).optional(),
    })
    .optional(),
  ws: z.object({}).optional(),
  wss: z.object({}).optional(),
});

/**
 * Schéma de la config app résolue. Exposé pour l'introspection (Studio :
 * `z.toJSONSchema(appConfigSchema)` → formulaire de config éditable).
 */
export const appConfigSchema = z.object({
  // Manifeste des modules : forme détaillée validée à la résolution (loadModulesFromManifest).
  modules: z.array(z.unknown()).optional(),
  locale: z.string().optional(),
  templating: z.string().optional(),
  orm: z.string().optional(),
  packageManager: z.enum(["npm", "yarn", "pnpm", "bun"]).optional(),
  domain: z.string().optional(),
  domainAlias: z.array(z.string()).optional(),
  domainCheck: z.boolean().optional(),
  servers: serversSchema.optional(),
  // Topologie cluster : forme détaillée portée par resolveTopology.
  cluster: z.unknown().optional(),
  log: logSchema.optional(),
});

/** Type inféré de la config app (source unique TS ↔ runtime). */
export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Valide la config app résolue ; lève une erreur au message agrégé si invalide.
 *
 * Appelée par `defineConfig().resolve()` après le deep-merge avec les défauts.
 *
 * @param options - config app résolue à valider.
 * @throws Error si la config ne respecte pas {@link appConfigSchema}.
 */
export function validateAppConfig(options: unknown): void {
  const result = appConfigSchema.safeParse(options);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join(" · ");
    throw new Error(
      `[nodefony] Configuration d'application invalide : ${issues}`,
    );
  }
}
