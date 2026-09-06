import { z } from "zod";

/**
 * @nodefony/realtime — CONFIGURATION DU MODULE (schéma Zod = source unique).
 *
 * ⭐ TL;DR : CE SCHÉMA EST LA CONFIG. Chaque `.default(...)` = la valeur d'usine ;
 * changer un défaut du module = ÉDITER ICI (et nulle part ailleurs). L'app, elle,
 * surcharge via `use("@nodefony/...", { … })` dans SON `nodefony.config.ts`.
 *
 * RÈGLE D'OR (ADR-0006) : ce fichier porte le **schéma Zod commenté** (type +
 * validation + défaut + doc) ET matérialise les défauts via `parse({})`. Aucune
 * valeur n'est re-tapée ailleurs. Le builder (`defineModuleConfig.ts` →
 * `defineRealtimeConfig`) importe le schéma D'ICI (nœud bas : ce fichier
 * n'importe que `zod` → pas de cycle).
 *
 * Validé au boot du Module class (hook `onKernelRegister`) → plante propre avec
 * messages clairs si la config est invalide, pas d'`undefined.x` silencieux en
 * runtime. Les seams sécurité (areas WS, authenticator, origin, auditOnFrame)
 * vivent dans les sous-schémas `csrf`/`limits` ci-dessous.
 *
 * ⚠️ NE PAS éditer les défauts matérialisés en bas de fichier : modifier les
 * `.default(...)` du schéma. La fusion + validation finale est faite dans
 * `index.ts` au hook `onKernelRegister` (via `defineRealtimeConfig`).
 */
// Sous-schémas extraits — réutilisés dans `.default(() => subSchema.parse({}))`
// pour que les sous-défauts soient appliqués quand la section parente est omise
// (cf `defineSecurityConfig` — Zod 4 n'applique PAS les sous-défauts via
// `.default({})` plat).

const probeSchema = z
  .strictObject({
    enabled: z
      .boolean()
      .default(true)
      .describe(
        "Branche le ClusterProbeClient (sonde agrégée pod, Phase 4c) en " +
          "worker `nodefony cluster`. true = sonde active (timer + IPC). " +
          "false = bypass total (0 timer / 0 listener / 0 IPC, l'endpoint " +
          "santé sert la vue per-instance). Override env : " +
          "NF_CLUSTER_PROBE=0 force la désactivation.",
      ),
  })
  .describe("Sonde agrégée pod (Phase 4c).");

const backplaneSchema = z
  .strictObject({
    driver: z
      .string()
      .default("loopback")
      .describe(
        "Nom du driver IBackplane, résolu dans le registre de drivers " +
          "(`listBackplaneDrivers()`) — PAS d'enum en dur ici : la liste réelle " +
          "est la source de vérité du registre, ouverte aux drivers custom " +
          "utilisateur (`registerBackplaneDriver(name, factory)`). Natifs : " +
          "`loopback` (mono, hub local sans IPC), `cluster` (IPC workers " +
          "`nodefony cluster`, actif si NF_CLUSTER=1), `redis` (multi-host " +
          "pub/sub). Driver inconnu au boot → warn fail-soft, le hub reste local.",
      ),
    namespace: z
      .string()
      .min(1)
      .regex(/^[\w.-]+$/)
      .optional()
      .describe(
        "Cloison logique du transport partagé (drivers cross-pod : redis, " +
          "futur kafka) — suffixe le canal pub/sub (`nodefony:realtime:<ns>`). " +
          "Le `database` Redis ne cloisonnant PAS le pub/sub, deux apps sur un " +
          "Redis mutualisé SANS namespace se parleraient (cross-talk). Défaut : " +
          "dérivé du nom d'app (`kernel.projectName`). À poser EXPLICITEMENT " +
          "quand deux déploiements de la même app (staging/prod) partagent un " +
          "Redis. Caractères : alphanumériques, `_`, `.`, `-`. Env : " +
          "`NF_REALTIME_BACKPLANE_NAMESPACE` (prioritaire — le namespace " +
          "distingue des DÉPLOIEMENTS, il n'a pas à être figé dans le code).",
      ),
    secret: z
      .string()
      .min(32)
      .optional()
      .describe(
        "Secret de SCELLEMENT des messages du backplane, partagé par tous les " +
          "pods de l'app (drivers à transport PARTAGÉ : redis, futurs drivers " +
          "cross-host). Un bus pub/sub n'authentifie PAS l'émetteur : sans ce " +
          "secret, quiconque écrit dans le Redis (autre app d'un Redis mutualisé, " +
          "credential fuité, SSRF) publie sur les canaux de TOUS les pods. Posé, " +
          "chaque message porte un HMAC-SHA256 et l'ingress devient fail-closed " +
          "strict (non scellé ou mal scellé = ignoré, aucun downgrade). Sans lui, " +
          "le boot ALERTE et le bus reste ouvert. Inutile pour `cluster` (IPC " +
          "master↔workers : aucun tiers ne peut y écrire). Env : " +
          "`NF_REALTIME_BACKPLANE_SECRET`. Minimum 32 caractères.",
      )
      .meta({ secret: true }),
    maxQueueBytes: z
      .number()
      .int()
      .nonnegative()
      .default(1 << 23)
      .describe(
        "Seuil d'octets PUBLIÉS mais pas encore acquittés par le bus, au-delà " +
          "duquel les publications suivantes sont JETÉES (drivers à transport " +
          "réseau : redis, drivers cross-host userland). Un `publish` de " +
          "backplane est fire-and-forget : quand le bus ne draine plus, la file " +
          "interne du client réseau grossit sans limite (583 MB observés sous " +
          "rafale sur le banc multi-pods). Même doctrine que le back-pressure " +
          "WS : on sacrifie du fan-out cross-pod pour tenir la mémoire du pod, " +
          "jamais en silence (compteurs `backplane.queue` dans la sonde + Studio, " +
          "alerte au franchissement). Défaut 8 MiB, soit trois ordres de grandeur " +
          "au-dessus d'un régime sain (bus acquitté en quelques ms). `0` = " +
          "illimité (opt-out explicite : la mémoire n'est alors bornée par rien).",
      ),
  })
  .describe("Driver IBackplane (fan-out cluster realtime cross-process).");

const clusterSchema = z
  .strictObject({
    probe: probeSchema.default(() => probeSchema.parse({})),
  })
  .describe("Comportement spécifique au mode cluster (worker IPC).");

const slowConsumerSchema = z
  .strictObject({
    bytes: z
      .number()
      .int()
      .positive()
      .default(1 << 20)
      .describe(
        "Seuil de `bufferedAmount` (octets) au-dessus duquel une connexion " +
          "WS est comptée comme `slowConsumer` dans la sonde RealtimeHub " +
          "(métrique d'observabilité). Défaut : 1 MiB (1<<20). À augmenter " +
          "pour clients lents tolérés (IoT, mobile faible bande), à diminuer " +
          "pour un signalement plus précoce. N.B. : ce seuil pilote UNIQUEMENT " +
          "le COMPTAGE de la sonde — l'ACTION de back-pressure (drop/close de " +
          "frames) se règle sur le SERVEUR WebSocket, côté @nodefony/http : " +
          "`websocket.maxBackpressure` / `.backpressurePolicy` / `.backpressureCloseAfterDrops`.",
      ),
  })
  .describe("Détection des consommateurs lents (métrique de la sonde WS).");

// Bornes de ressources PAR CONNEXION — garde anti-DoS/OOM (revue 0.6, F6a).
const limitsSchema = z
  .strictObject({
    maxChannelsPerConnection: z
      .number()
      .int()
      .positive()
      .nullable()
      .default(256)
      .describe(
        "Plafond de canaux qu'UNE connexion peut ouvrir (subscribe). Chaque " +
          "canal ouvert = 1 ticker hub + 1 provider + 1 entrée Map côté " +
          "connexion → sans borne, un socket peut subscribe à N canaux jusqu'à " +
          "l'OOM. Au-delà du plafond, le subscribe est REFUSÉ (le canal n'est " +
          "pas ouvert) et le client reçoit `realtime:denied` (motif `limit`). " +
          "GARDE anti-OOM, PAS une bride : sous le seuil le multiplexage " +
          "N-canaux reste libre. `null` = illimité (opt-out explicite, à " +
          "réserver aux déploiements maîtrisés). Défaut 256.",
      ),
  })
  .describe("Bornes de ressources par connexion (anti-DoS/OOM).");

// Seam sécurité #4 — Origin check natif sur upgrade WS (P13 Bloc A étape 6).
const checkOriginSchema = z
  .strictObject({
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

// Réception des journaux du NAVIGATEUR (#35) — surface d'ÉCRITURE, donc fermée par
// défaut : un canal entrant qui écrit dans le journal du pod ne s'ouvre que sur décision.
const clientLogsSchema = z
  .strictObject({
    enabled: z
      .boolean()
      .default(false)
      .describe(
        "Accepte les journaux remontés par les navigateurs sur le canal " +
          "`nodefony:syslog:uplink`, et les réinjecte dans le journal du pod " +
          "(origine forcée `browser`). Permet de recouper une erreur survenue " +
          "dans la page avec la requête HTTP qui l'a précédée, par le même " +
          "`requestId`. Défaut : false — c'est une surface d'écriture, elle " +
          "s'ouvre sur décision, jamais par héritage. Le canal reste soumis au " +
          "plancher du namespace plateforme : une connexion ANONYME ne peut " +
          "rien pousser, quelle que soit cette valeur.",
      ),
    maxEntriesPerBatch: z
      .number()
      .int()
      .positive()
      .default(50)
      .describe(
        "Entrées retenues par lot reçu. Le surplus est ignoré en silence — " +
          "borner le lot évite qu'un seul message n'occupe l'event-loop.",
      ),
    maxEntriesPerWindow: z
      .number()
      .int()
      .positive()
      .default(300)
      .describe(
        "Entrées retenues par fenêtre et PAR CONNEXION. Au-delà, le reste du " +
          "lot est jeté. Par connexion et non globalement : sinon un onglet " +
          "bavard muselle tous les autres.",
      ),
    windowMs: z
      .number()
      .int()
      .positive()
      .default(10000)
      .describe("Durée de la fenêtre de débit, en ms."),
    maxStringLength: z
      .number()
      .int()
      .positive()
      .default(4096)
      .describe(
        "Longueur maximale d'une chaîne acceptée (message, pile). Le client " +
          "tronque déjà ; le serveur ne le croit pas sur parole.",
      ),
  })
  .describe("Réception des journaux du navigateur (canal montant).");

const csrfSchema = z
  .strictObject({
    checkOrigin: checkOriginSchema.default(() => checkOriginSchema.parse({})),
  })
  .describe("Protections CSRF natives realtime (origin check upgrade WS).");

export const realtimeConfigSchema = z
  .strictObject({
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
    limits: limitsSchema.default(() => limitsSchema.parse({})),
    csrf: csrfSchema.default(() => csrfSchema.parse({})),
    clientLogs: clientLogsSchema.default(() => clientLogsSchema.parse({})),
  })
  .describe("Configuration de @nodefony/realtime.");

/** Type de sortie (config normalisée + défauts appliqués). */
export type RealtimeConfig = z.infer<typeof realtimeConfigSchema>;

/**
 * Défauts du module, matérialisés depuis le schéma (source unique). Toujours
 * valides par construction ; passés au `super(..., config)` du Module class.
 */
const config: RealtimeConfig = realtimeConfigSchema.parse({});

export default config;
