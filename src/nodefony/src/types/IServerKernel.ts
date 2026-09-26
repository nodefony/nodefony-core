/**
 * Ce que le Kernel attend du service `HttpKernel` pour ouvrir les serveurs — et
 * rien de plus.
 *
 * Le service est fourni par `@nodefony/http`, qui dépend du cœur : le cœur ne
 * peut donc pas nommer sa classe sans cycle. C'est le LECTEUR qui définit le
 * contrat ; `IHttpKernel` l'étend, et le typecheck de `http` garantit
 * l'alignement.
 */
/**
 * Ce que le Kernel utilise d'un serveur démarré : afficher son adresse d'écoute.
 */
export interface IStartedServer {
  /** Affiche la bannière « Server Listen on… » du serveur. */
  showBanner(): void;
}

export interface IServerKernel {
  /**
   * Démarre les serveurs HTTP/HTTPS/WS/WSS activés par la configuration.
   *
   * @returns les serveurs démarrés
   */
  initServers(): Promise<IStartedServer[]>;
}
