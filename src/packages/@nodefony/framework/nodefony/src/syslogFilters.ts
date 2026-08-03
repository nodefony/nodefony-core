import { FLOW_STEPS, SEVERITY_NAMES } from "nodefony";
import type { FlowStepId, IFilterSpec } from "nodefony";

/**
 * Ce que le journal sait TRIER — un seul axe, le temps.
 *
 * Le nom est public (celui de la ligne rendue, `ILogRecord.timeStamp`) ; l'axe
 * technique du driver est l'`uid` du Pdu, un compteur monotone d'émission. Les
 * deux disent la même chose, à ceci près que l'`uid` départage deux logs de la
 * MÊME milliseconde — ce qu'un tri sur l'horodatage seul ne saurait pas faire.
 */
export const SYSLOG_SORTABLE = ["timeStamp"] as const;

/**
 * Le vocabulaire de filtre du journal — une **donnée**, publiée telle quelle
 * dans le catalogue admin.
 *
 * Il remplace une lecture à la main qui acceptait tout et ne validait rien :
 * `?severity=CRITICAL` (au lieu de `CRITIC`), `?protocol=grpc`, `?flow=nimporte`
 * et même `?severty=ERROR` posaient un critère vide et rendaient le journal
 * ENTIER sous un `200` — la réponse qu'un exploitant lit comme « aucune erreur ».
 *
 * `severity` et `flow` sont **répétables** (`?severity=ERROR&severity=CRITIC`) :
 * c'est le OU dont le viewer a besoin, et la seule raison d'être de la nature
 * `{ each }` du contrat.
 */
export const SYSLOG_FILTERS = {
  /** Corrélation log↔requête (ALS) — match exact, la clé de la trace. */
  requestId: "string",
  /** Nom de module/service — inclusion insensible à la casse côté driver. */
  module: "string",
  /** Catégorie de message (msgid) — inclusion insensible à la casse. */
  msgid: "string",
  /** Protocole d'origine ; absent = les deux. */
  protocol: ["ws", "http"],
  /**
   * Sévérités RFC 5424 — l'allowlist EST {@link SEVERITY_NAMES} (source unique
   * du cœur), jamais une liste recopiée qui finirait par diverger de l'enum.
   */
  severity: { each: SEVERITY_NAMES },
  /**
   * Étapes du cycle de vie — l'allowlist est dérivée de la table `FLOW_STEPS`
   * elle-même : ajouter une étape suffit à la rendre filtrable, et aucune
   * seconde liste ne peut se périmer.
   */
  flow: { each: Object.keys(FLOW_STEPS) as FlowStepId[] },
  /** Borne basse d'horodatage (epoch ms, incluse). */
  from: "int",
  /** Borne haute d'horodatage (epoch ms, incluse). */
  to: "int",
} as const satisfies IFilterSpec;
