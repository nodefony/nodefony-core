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
export interface IRpcCall {
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
}
