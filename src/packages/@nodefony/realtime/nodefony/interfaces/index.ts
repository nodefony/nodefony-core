/**
 * Interfaces publiques de @nodefony/realtime.
 *
 * Vide pour ce premier scaffold. Sera peuplé en P13.0 par les interfaces
 * rapatriées depuis @nodefony/framework :
 *  - IBackplane           — contrat cluster (4 drivers)
 *  - IRealtimeController  — contrat controller serveur
 *  - IRealtimeProbe       — contrat sonde de santé
 *  - IRealtimeAuthenticator (P13.4a — seam sécurité)
 *
 * Le contrat client `IRealtimeSocket` reste dans le core (subpath
 * `nodefony/realtime`) — il est isomorphe et ne doit pas dépendre du serveur.
 */

export {};
