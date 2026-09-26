/**
 * Ce que le Kernel attend du service `HttpKernel` pour ouvrir les serveurs — et
 * rien de plus.
 *
 * Le service est fourni par `@nodefony/http`, qui dépend du cœur : le cœur ne
 * peut donc pas nommer sa classe sans cycle. C'est le LECTEUR qui définit le
 * contrat ; `IHttpKernel` l'étend, et le typecheck de `http` garantit
 * l'alignement.
 */
export interface IServerKernel {
  /**
   * Démarre les serveurs HTTP/HTTPS/WS/WSS activés par la configuration.
   *
   * @returns les serveurs démarrés
   */
  initServers(): Promise<unknown[]>;
}
