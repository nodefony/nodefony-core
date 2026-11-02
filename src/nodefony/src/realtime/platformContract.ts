/**
 * platformContract — le **contrat temps réel de la plateforme** : ce que les canaux
 * `nodefony:*` livrent, déclaré une fois pour les deux bouts de la socket.
 *
 * Les NOMS vivent dans {@link PLATFORM_CHANNELS} ; ce fichier leur donne une FORME.
 * Une application qui lit `nodefony:socket` dans son propre écran, comme la console
 * d'administration, part de ce contrat au lieu de recopier la charge :
 *
 * ```ts
 * interface MonitorContract extends IPlatformRealtimeContract {
 *   serverToClient: PlatformServerToClient & { "monitor:jobs": Job };
 * }
 * const monitor = NodefonySocket.fromContract<MonitorContract>({ url, shared: true });
 * useNodefonyChannelData(monitor, PLATFORM_CHANNELS.socket); // RealtimeHealthReport
 * ```
 *
 * Types seuls : 0 octet compilé, le navigateur qui l'importe ne tire aucun code serveur.
 * Un canal de plateforme n'y entre que lorsque sa charge a une forme publiée au cœur —
 * un canal absent reste lisible par son nom, sans type déduit.
 */
import type { PLATFORM_CHANNELS } from "./platformChannels";
import type { IRealtimeContract } from "./RealtimeEventMap";
import type { RealtimeHealthReport } from "./platformHealth";

/** Canaux de plateforme : nom → charge poussée par le serveur. */
export type PlatformServerToClient = {
  [K in (typeof PLATFORM_CHANNELS)["socket"]]: RealtimeHealthReport;
};

/**
 * Contrat des canaux `nodefony:*`. Une application l'ÉTEND pour ajouter les siens ;
 * c'est la seule façon de typer, sur une même socket, les canaux de la plateforme et
 * ceux de son métier.
 */
export interface IPlatformRealtimeContract extends IRealtimeContract {
  /** Canaux poussés par la plateforme (cf {@link PlatformServerToClient}). */
  serverToClient: PlatformServerToClient;
}
