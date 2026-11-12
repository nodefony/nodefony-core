/**
 * Le protocole RPC parlé sur le fil : `grpc`, `grpc-web` ou `connect` pour un
 * appel gRPC (ADR-0026 D10). Union OUVERTE : un appel JSON-RPC (porte MCP,
 * A2A) pourra s'y ajouter (`jsonrpc`) sans rupture.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export type RpcSystem = "grpc" | "grpc-web" | "connect" | (string & {});

/**
 * Le résultat d'un appel RPC tel que le voient la ligne d'accès, l'audit et le
 * canal de traçage (ADR-0026 D10) : quatre champs, jamais la fiche d'appel
 * entière — elle porte le contrôleur et le contexte.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export interface IRpcOutcome {
  /** Le protocole parlé sur le fil. */
  readonly system: RpcSystem;
  /**
   * La méthode appelée, `paquet.Service/Méthode` — tirée de la route : jamais
   * une valeur inventée (`_OTHER`), la route est connue.
   */
  readonly method: string;
  /**
   * Le code de l'appel (gRPC : 0 à 16), lu une fois au `close` de la réponse.
   * `null` avant, ou quand l'appel n'a jamais commencé (requête refusée par le
   * transport avant tout contexte d'appel : le statut HTTP dit alors tout).
   */
  readonly code: number | null;
  /** Le nom du code (`OK`, `UNAVAILABLE`…), `null` avec lui. */
  readonly codeName: string | null;
}

/**
 * Un appel RPC servi sur une requête HTTP — gRPC, gRPC-Web ou Connect —, porté
 * par `HttpContext.rpc`, `null` hors appel RPC (ADR-0026 D10).
 *
 * Le contrat vit dans `@nodefony/http` et ne nomme rien de l'adaptateur : un
 * appel JSON-RPC pourra le porter sans rupture. La fiche d'appel gRPC
 * (`GrpcCall`, sous-chemin `@nodefony/http/grpc`) l'implémente : aucune
 * allocation de plus par appel.
 *
 * @experimental Surface gRPC, ADR-0026 D11.
 */
export interface IRpcCall extends IRpcOutcome {
  /**
   * Le délai de réponse du serveur est échu : termine l'appel au format de
   * son protocole (gRPC : 4 `DEADLINE_EXCEEDED`). Appelé par
   * `HttpContext._onTimeout` À LA PLACE du 408/504, qui serait un second
   * écrivain sur une réponse que l'adaptateur possède (ADR-0026 D4, point 3).
   * Sans effet sur un appel déjà terminé.
   */
  expire(): void;
  /**
   * L'identité qui a ouvert l'appel n'est plus valable (jeton révoqué,
   * session fermée, droits changés) : termine l'appel au format de son
   * protocole (gRPC : 16 `UNAUTHENTICATED`). Appelé par le cycle de vie d'un
   * flux À LA PLACE de la destruction du transport, qui ne dirait au client
   * qu'une coupure (ADR-0026 D6). Sans effet sur un appel déjà terminé.
   */
  revoke(): void;
  /**
   * Le serveur s'arrête : termine l'appel au format de son protocole (gRPC :
   * 14 `UNAVAILABLE`, « réessaie, ailleurs »). Appelé par le noyau à l'arrêt,
   * AVANT le drain des connexions, pour chaque flux long encore ouvert
   * (ADR-0026 D8) — à la place de la destruction du transport à
   * `shutdownTimeout`, qui ne dirait au client qu'une coupure. Sans effet sur
   * un appel déjà terminé, ou déjà interrompu.
   */
  shutdown(): void;
  /**
   * Fixe le code de l'appel, une fois, au `close` de la réponse — appelé par
   * le noyau AVANT la ligne d'accès (`HttpKernel.teardownHttp`, ADR-0026 D10
   * point 2). Les appels suivants ne changent rien.
   *
   * @param ended - la réponse a-t-elle été terminée par le serveur
   *   (`responseEnded`) ? Un appel sans motif d'interruption est alors réussi
   *   (0), sinon annulé par le client (1).
   * @returns la cause à porter par la ligne d'accès (`context.error`) quand
   *   l'appel a échoué sur une exception — UNE ligne par appel en erreur
   *   (D10 point 3) —, `null` sinon.
   */
  settle(ended: boolean): Error | null;
}
