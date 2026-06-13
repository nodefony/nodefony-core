import type { ContextType } from "@nodefony/http";

/**
 * Zone sécurisée — un pattern d'URL + la liste des authenticators à exécuter.
 *
 * Le firewall teste chaque zone par ordre de spécificité ; la première dont le
 * pattern matche capture la requête (`context.security`). Les zones viennent de
 * `defineSecurityConfig({ areas })` — patterns compilés et triés au boot, conflits
 * détectés au boot (pas au premier match runtime).
 */
export interface ISecuredArea {
  /** Nom de la zone (`"main_api"`, `"admin"`…). */
  readonly name: string;

  /** Pattern d'URL compilé. */
  readonly pattern: RegExp;

  /** Zone protégée (Zero Trust) ; `false` = zone publique explicite. */
  readonly security: boolean;

  /**
   * Stratégie d'identité AU-DESSUS du protocole. `false` (défaut) : registre
   * serveur autorisé — session créée AU LOGIN, cookie opaque révocable (BFF).
   * `true` : chaque requête porte sa preuve complète (JWT/clé API), session ignorée.
   */
  readonly stateless: boolean;

  /**
   * Sémantique de la chaîne : `"first"` = le premier authenticator qui
   * reconnaît la requête authentifie ; `"all"` = tous doivent passer (MFA —
   * le DERNIER porte l'identité).
   */
  readonly mode: "first" | "all";

  /** Noms des authenticators à exécuter (sémantique selon {@link mode}). */
  readonly authenticators: readonly string[];

  /** Domaine/vhost de la zone (ex. `admin.exemple.com`). Omis = tous domaines. */
  readonly host?: string;

  /**
   * Zone valable AUSSI pour le WebSocket (frames `api.request` + `subscribe`),
   * pas seulement HTTP. `false` (défaut) : la zone ne s'applique qu'au HTTP. Le
   * verrou WS consulte la même zone que HTTP (invariant `api.request` ≤ `GET`).
   */
  readonly realtime: boolean;

  /** La requête tombe-t-elle dans cette zone ? (pattern + host éventuel). */
  match(context: ContextType): boolean;
}
