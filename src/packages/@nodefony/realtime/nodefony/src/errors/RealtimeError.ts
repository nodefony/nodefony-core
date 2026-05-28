/**
 * Erreur de base pour @nodefony/realtime.
 *
 * - `code`    : identifiant machine (ex. `REALTIME_HANDSHAKE_DENIED`,
 *               `REALTIME_BACKPRESSURE`, `REALTIME_AUTH_REQUIRED`) — consommé
 *               par Studio (panneau Hub) et l'audit-logger (seam P13.7a).
 * - `context` : payload structuré pour le PDU syslog + corrélation requestId.
 *
 * À étendre avec les sous-erreurs spécifiques (HandshakeError, FrameError,
 * BackplaneError, …) au fur et à mesure du rapatriement P13.0.
 */
export class RealtimeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RealtimeError";
  }
}
