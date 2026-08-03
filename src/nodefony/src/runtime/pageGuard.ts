import nodefonyError from "../Error";
import type { IPageQuery } from "../types/IPage";

/**
 * Les deux modes de pagination du contrat {@link IPageQuery}, **mutuellement
 * exclusifs** : un backend n'expose que l'un ({@link IPageQuery.offset} navigation
 * directe, ou {@link IPageQuery.cursor} navigation « après ce jeton »). Cf le TSDoc
 * d'`IPageQuery` : « un backend n'expose qu'un mode ; le store le déclare ».
 */
export type PaginationMode = "offset" | "cursor";

/**
 * Erreur levée quand un `listPage` reçoit le champ de pagination du mode que son
 * store **ne sait pas honorer** — un `cursor` pour un store offset, ou un `offset`
 * de navigation pour un store curseur.
 *
 * `code = 400` : c'est une erreur du **client** (mauvais paramètre), jamais une
 * panne serveur. Avant ce garde-fou, le champ hors-mode était **avalé en silence**
 * (un client curseur bouclait indéfiniment sur la page 1 d'un store offset, cf
 * l'écart F27/F51 du registre doc↔code). Le data plane admin (`AdminApiController`)
 * traduit ce `code` en statut HTTP 400 au lieu du 500 générique.
 */
export class PaginationModeError extends nodefonyError {
  /**
   * @param received - le mode dont un champ a été fourni (celui de trop).
   * @param supported - le mode réellement supporté par le store.
   */
  constructor(received: PaginationMode, supported: PaginationMode) {
    super(
      `Pagination mode mismatch: this store paginates by "${supported}", ` +
        `but a "${received}" parameter was supplied. Pass "${supported}" only ` +
        `(offset and cursor are mutually exclusive per the IPage contract).`,
      400,
    );
  }
}

/**
 * Erreur levée quand un store paginant par **curseur** reçoit un
 * {@link IPageQuery.order} : il ne peut pas l'honorer, et l'avaler mentirait.
 *
 * Ce n'est pas une limite d'implémentation, c'est la nature du curseur : le
 * jeton encode une **position dans un ordre total**, celui-là même que le store
 * applique. Le rendre paramétrable rendrait tout jeton déjà émis ininterprétable
 * — la page suivante sauterait ou répéterait des lignes, silencieusement, ce qui
 * est le pire défaut possible sur un journal d'audit.
 *
 * `code = 400` : c'est le client qui demande une capacité que ce point d'entrée
 * n'a pas. Un backend curseur qui saurait trier devrait d'abord embarquer
 * l'ordre DANS son curseur ; il déclarerait alors `sortableFields` et cette
 * garde serait à revoir avec lui — pas avant.
 */
export class CursorOrderError extends nodefonyError {
  /** @param fields - les champs de tri demandés, dans l'ordre reçu. */
  constructor(fields: readonly string[]) {
    super(
      `Sorting is not supported by a cursor-paginated store (requested: ` +
        `${fields.join(", ")}). The cursor encodes a position in the store's ` +
        `own total order; changing that order would invalidate every token ` +
        `already issued. Drop "order", or use an offset-paginated backend.`,
      400,
    );
  }
}

/**
 * Fait respecter le contrat « un store expose UN seul mode » au point d'entrée
 * d'un `listPage`, sur la requête **brute** reçue de l'appelant (avant qu'elle ne
 * soit normalisée) : rejette explicitement le champ du mode non supporté plutôt
 * que de l'ignorer sans un mot.
 *
 * Chaque store connaît son mode **statiquement** (constante de l'implémentation) et
 * appelle ce garde-fou en première ligne. À placer côté store — jamais dans un
 * helper de pagination en aval (`paginate()`), qui reçoit une requête déjà
 * reconstruite d'où le champ hors-mode a pu disparaître, laissant la violation
 * passer inaperçue.
 *
 * **Valeurs neutres tolérées** (pas une navigation) : un `cursor` **vide** côté
 * offset et un `offset` **0** côté curseur désignent tous deux « le début » — ils
 * ne trahissent aucune intention du mauvais mode et ne sont donc pas rejetés. Seule
 * une vraie navigation du mode adverse (`cursor` non vide, `offset > 0`) lève.
 *
 * **Le mode curseur refuse aussi le TRI** ({@link CursorOrderError}) : son ordre
 * est imposé par le jeton, pas choisi par l'appelant. Le data plane le refuse
 * déjà en amont (aucun endpoint curseur ne déclare `sortable`), mais un appelant
 * interne — un autre service, un test, un futur endpoint — fabrique son
 * `IPageQuery` à la main ; sans cette ligne, son `order` était ignoré sans un
 * mot par les six stores curseur du dépôt.
 *
 * @param query - la requête de page brute reçue par le store.
 * @param mode - le mode que le store sait honorer.
 * @throws {@link PaginationModeError} (`code` 400) si le champ du mode adverse est
 *   présent avec une valeur de navigation.
 * @throws {@link CursorOrderError} (`code` 400) si un `order` non vide est fourni
 *   à un store curseur.
 */
export function assertPageQuery(query: IPageQuery, mode: PaginationMode): void {
  if (mode === "offset") {
    if (typeof query.cursor === "string" && query.cursor !== "") {
      throw new PaginationModeError("cursor", "offset");
    }
    return;
  }
  // mode === "cursor"
  if (typeof query.offset === "number" && query.offset > 0) {
    throw new PaginationModeError("offset", "cursor");
  }
  // Un `order` VIDE n'exprime aucune intention (comme `offset: 0`) → toléré.
  if (query.order && query.order.length > 0) {
    throw new CursorOrderError(query.order.map(([field]) => field));
  }
}
