import { z } from "zod";

/**
 * Schéma Zod de la configuration de @nodefony/realtime.
 *
 * Source de vérité (TS type dérivé via `z.infer<>`). Validé au boot du Module
 * class (hook `onKernelRegister`) → plante propre avec messages clairs si la
 * config est invalide, pas d'`undefined.x` silencieux en runtime.
 *
 * Cible figée du futur builder `defineRealtimeConfig()` (P13.4) — voir
 * `docs/configuration.md`. Les seams sécurité (areas WS, authenticator,
 * origin, auditOnFrame) seront ajoutés en Bloc A étapes 2+6.
 */
// Sous-schémas extraits — réutilisés dans `.default(() => subSchema.parse({}))`
// pour que les sous-défauts soient appliqués quand la section parente est omise
// (cf `defineSecurityConfig` — Zod 4 n'applique PAS les sous-défauts via
// `.default({})` plat).

const probeSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Branche le ClusterProbeClient (sonde agrégée pod, Phase 4c) en " +
          "worker `nodefony cluster`. true = sonde active (timer + IPC). " +
          "false = bypass total (0 timer / 0 listener / 0 IPC, l'endpoint " +
          "santé sert la vue per-instance). Override env : " +
          "NODEFONY_CLUSTER_PROBE=0 force la désactivation.",
      ),
  })
  .describe("Sonde agrégée pod (Phase 4c).");

const backplaneSchema = z
  .object({
    driver: z
      .enum(["loopback", "cluster", "redis", "kafka"])
      .default("loopback")
      .describe(
        "Driver IBackplane. `loopback` = mono-process (défaut, le hub fan-out " +
          "directement sans IPC). `cluster` = IPC entre workers `nodefony cluster` " +
          "(auto-branché si NODEFONY_CLUSTER=1, sinon ignoré). `redis` (P13.5) et " +
          "`kafka` (P13.6) = multi-host. Pluggable utilisateur via instance " +
          "`IBackplane` passée au builder (P13.4).",
      ),
  })
  .describe("Driver IBackplane (fan-out cluster realtime cross-process).");

const clusterSchema = z
  .object({
    probe: probeSchema.default(() => probeSchema.parse({})),
  })
  .describe("Comportement spécifique au mode cluster (worker IPC).");

const slowConsumerSchema = z
  .object({
    bytes: z
      .number()
      .int()
      .positive()
      .default(1 << 20)
      .describe(
        "Seuil de `bufferedAmount` (octets) au-dessus duquel une connexion " +
          "WS est comptée comme `slowConsumer` dans la sonde RealtimeHub. " +
          "Défaut : 1 MiB (1<<20). À augmenter pour clients lents tolérés " +
          "(IoT, mobile faible bande), à diminuer pour back-pressure plus " +
          "agressif.",
      ),
  })
  .describe("Détection des consommateurs lents (back-pressure WS).");

// Seam sécurité #4 — Origin check natif sur upgrade WS (P13 Bloc A étape 6).
const checkOriginSchema = z
  .object({
    enabled: z
      .boolean()
      .default(false)
      .describe(
        "Active le contrôle de l'en-tête `Origin` (RFC 6455 §10.2) à l'upgrade " +
          "WebSocket. Défense CSRF native (les cookies sont envoyés en cross-origin " +
          "même avec `SameSite=Lax`/`Strict` selon le contexte). Défaut : false " +
          "(rétro-compat). Activation recommandée dès qu'un authenticator pose un " +
          "cookie de session/JWT. Si `allowList` est vide quand `enabled=true`, " +
          "TOUTE origin est refusée (échec fermé).",
      ),
    allowList: z
      .array(z.string())
      .default([])
      .describe(
        "Liste des origines acceptées (match EXACT, scheme+host+port, ex. " +
          "`https://app.example.com`). Wildcards NON supportés (durcissement vs " +
          "CORS `Access-Control-Allow-Origin: *`). Inclure les origines de dev si " +
          "nécessaire (`http://localhost:5151`). Origines absentes (clients " +
          "non-browser, mobile natif) → traitées selon `allowMissingOrigin`.",
      ),
    allowMissingOrigin: z
      .boolean()
      .default(false)
      .describe(
        "Accepter une upgrade sans en-tête `Origin` (clients non-browser, " +
          "ex. mobile natif, tests). `false` (défaut) = refus, `true` = accepte. " +
          "À `true` UNIQUEMENT si l'authenticator vérifie un credential fort " +
          "(JWT signé, API key) — sans Origin ET sans authenticator = brèche CSRF.",
      ),
  })
  .describe(
    "Contrôle Origin RFC 6455 §10.2 (défense CSRF native à l'upgrade WS).",
  );

const csrfSchema = z
  .object({
    checkOrigin: checkOriginSchema.default(() => checkOriginSchema.parse({})),
  })
  .describe("Protections CSRF natives realtime (origin check upgrade WS).");

export const realtimeConfigSchema = z
  .object({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Active le module realtime au boot. Recommandation prod : true. " +
          "false = module chargé mais inerte (registry, mais aucun hub/listener actif).",
      ),
    backplane: backplaneSchema.default(() => backplaneSchema.parse({})),
    cluster: clusterSchema.default(() => clusterSchema.parse({})),
    slowConsumer: slowConsumerSchema.default(() =>
      slowConsumerSchema.parse({}),
    ),
    csrf: csrfSchema.default(() => csrfSchema.parse({})),
  })
  .describe("Configuration de @nodefony/realtime.");

export type RealtimeConfig = z.infer<typeof realtimeConfigSchema>;
