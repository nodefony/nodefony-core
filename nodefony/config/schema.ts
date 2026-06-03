/**
 * Schéma Zod de la config de l'APPLICATION — validé au boot par le Kernel.
 *
 * But : planter PROPREMENT au boot (message clair) sur une config malformée, plutôt
 * qu'un `Cannot read properties of undefined` 3 minutes plus tard en runtime. Le
 * schéma DÉCRIT (il ne dérive pas les défauts : la config app est écrite à la main
 * avec ses commentaires — voir `./config` et les domaines `./app`/`./servers`/`./log`).
 *
 * Tous les champs sont `.optional()` : le rôle du schéma est de rejeter les TYPES /
 * valeurs invalides, pas d'imposer une présence (le Kernel a ses propres défauts ; un
 * `config.<appEnv>.ts` peut n'apporter qu'un sous-ensemble). Les clés inconnues
 * (`module-<x>` = surcharges de modules, validées par chaque module) sont ignorées.
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
 * Schéma de la config app. Exposé pour l'introspection (Studio : `z.toJSONSchema`).
 */
export const appConfigSchema = z.object({
  // Manifeste des modules : forme détaillée validée à la résolution (loadModulesFromManifest).
  modules: z.array(z.unknown()).optional(),
  watch: z.boolean().optional(),
  locale: z.string().optional(),
  templating: z.string().optional(),
  orm: z.string().optional(),
  packageManager: z.enum(["npm", "yarn", "pnpm", "bun"]).optional(),
  domain: z.string().optional(),
  domainAlias: z.array(z.string()).optional(),
  domainCheck: z.boolean().optional(),
  servers: serversSchema.optional(),
  devServer: z.object({}).optional(),
  // Topologie cluster : forme détaillée portée par ./cluster/cluster.config.
  cluster: z.unknown().optional(),
  log: logSchema.optional(),
});

/** Type inféré de la config app (source unique TS ↔ runtime). */
export type AppConfig = z.infer<typeof appConfigSchema>;

/**
 * Valide la config app ; lève une erreur au message agrégé si invalide.
 *
 * Appelée par le Kernel au boot (`loadApp`, avant `initializeLog`). Convention :
 * le Kernel résout cette fonction via l'export `validateConfig` de l'entrée de l'app.
 *
 * @param options - objet de config app à valider (typiquement `app.options`).
 * @throws Error si la config ne respecte pas {@link appConfigSchema}.
 */
export function validateConfig(options: unknown): void {
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
