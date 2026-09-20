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
   * URI canonique de la ressource protégée par cette zone — l'**audience**
   * qu'un jeton doit porter pour y être accepté (RFC 8707 §2).
   *
   * Exigée par les authenticators qui vérifient un jeton émis AILLEURS : c'est
   * la seule chose qui empêche un jeton parfaitement valide, délivré au même
   * porteur pour un autre service, d'être rejoué ici. Elle s'ÉCRIT et ne se
   * dérive pas de l'en-tête `Host` — derrière un relais, ce que le processus
   * croit être son adresse n'est pas ce que le client a demandé, et l'audience
   * doit être celle que le serveur d'autorisation a inscrite dans le jeton.
   *
   * Omise, une zone reste parfaitement utilisable par les authenticators qui
   * n'en ont pas besoin (session, mot de passe, jetons maison).
   */
  readonly resource?: string;

  /**
   * Zone valable AUSSI pour le WebSocket (frames `api.request` + `subscribe`),
   * pas seulement HTTP. Défaut `true` (Zero Trust : une zone protégée ferme TOUS
   * ses transports) ; `false` = opt-out explicite (zone strictement HTTP). Le
   * verrou WS consulte la même zone que HTTP (invariant `api.request` ≤ `GET`).
   */
  readonly realtime: boolean;

  /**
   * Rôles exigés PAR DÉFAUT dans la zone — en OU, hiérarchie comprise —, ou
   * `null` quand la zone n'exige qu'une identité.
   *
   * C'est le **filet** d'une surface d'administration : une route que personne
   * n'a pensé à garder hérite du rôle de sa zone, au lieu d'être ouverte à
   * n'importe quel compte authentifié. Une route qui décide elle-même de son
   * autorisation — garde déclarée, ou pont du plan d'administration qui résout
   * un rôle par point d'entrée — n'en dépend pas : c'est ce qui laisse exister
   * un point d'entrée ouvert à son propriétaire (`me`, `sessions/mine`) dans
   * une zone par ailleurs fermée.
   *
   * Un refus est un **403** (authentifié mais pas autorisé), jamais un 401.
   */
  readonly roles: readonly string[] | null;

  /** La requête tombe-t-elle dans cette zone ? (pattern + host éventuel). */
  match(context: ContextType): boolean;
}
