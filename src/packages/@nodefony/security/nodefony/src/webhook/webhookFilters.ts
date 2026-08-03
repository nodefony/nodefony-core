import type { IFilterSpec } from "nodefony";

/**
 * **Le vocabulaire de filtre des endpoints webhook**, en noms PUBLICS — ceux
 * qu'un client écrit dans l'URL (`?enabled=false&event=user.created`).
 *
 * Frère de `WEBHOOK_SORTABLE_FIELDS`, et posé au même endroit pour la même
 * raison : le vocabulaire appartient au propriétaire du contrat, la mécanique de
 * lecture au cœur (`parseFilters`).
 *
 * `event` reste une chaîne LIBRE, et non une énumération : le catalogue
 * d'événements est celui de l'application qui émet, pas du framework. Le refus
 * porte donc sur la forme (paramètre inconnu, valeur mal formée), jamais sur le
 * nom d'un événement — le refuser reviendrait à décider à la place de l'app ce
 * qu'elle a le droit de publier.
 */
export const WEBHOOK_FILTERS = {
  /** `true` = actifs seulement, `false` = désactivés seulement, absent = les deux. */
  enabled: "boolean",
  /** Endpoints abonnés à CET événement (« qui écoute `user.created` ? »). */
  event: "string",
} as const satisfies IFilterSpec;
