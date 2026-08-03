import type { FacetCounts, IFacetSpec, IFilterSpec } from "nodefony";
import type { IWebhookListQuery } from "../../contracts/IWebhookStore";

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
  /** `true` = en échec (`failureCount > 0`), `false` = sains, absent = les deux. */
  failing: "boolean",
} as const satisfies IFilterSpec;

/**
 * **Les facettes des endpoints** — les questions fermées que la console pose à
 * la collection ENTIÈRE pour ses cartes de tête.
 *
 * Chacune est un filtre du contrat, et c'est la règle : une carte affiche un
 * nombre que le tableau doit pouvoir montrer. `failing` recoupe volontairement
 * `active` et `disabled` — un endpoint peut être actif ET en échec — d'où
 * l'interdiction de déduire une facette d'une autre par soustraction.
 */
export const WEBHOOK_FACETS = {
  /** Tous les endpoints configurés. */
  total: {},
  /** Endpoints actifs (le dispatcher leur livre). */
  active: { enabled: true },
  /** Endpoints désactivés — à la main ou par coupe-circuit. */
  disabled: { enabled: false },
  /** Endpoints en échec, actifs ou non. */
  failing: { failing: true },
} as const satisfies IFacetSpec<IWebhookListQuery>;

/** Les compteurs rendus par `GET /nodefony/security/api/webhooks/stats`. */
export type IWebhookCounts = FacetCounts<typeof WEBHOOK_FACETS>;

/**
 * Ce que l'endpoint de COMPTEURS accepte de filtrer — `WEBHOOK_FILTERS` **moins**
 * les champs que les facettes décomposent (`enabled`, `failing`).
 *
 * Les demander ici rendrait une réponse contradictoire : le total suivrait le
 * filtre pendant que chaque facette l'écraserait par le sien. `event` reste,
 * parce qu'il découpe une AUTRE dimension — « combien d'endpoints écoutent
 * `user.created`, et dans quel état sont-ils ? » est une question cohérente.
 *
 * Un test verrouille l'accord entre cette liste et {@link WEBHOOK_FACETS}.
 */
export const WEBHOOK_STATS_FILTERS = {
  event: "string",
} as const satisfies IFilterSpec;
