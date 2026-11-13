import { nodefonyError } from "nodefony";

/** Cause d'un échec de {@link FetchPublicError}. */
export type FetchPublicFailure = "timeout" | "too-many-redirects" | "network";

/**
 * Échec d'une requête sortante vers un site tiers (`fetchPublic`) qui n'est PAS
 * un refus de cible : délai total dépassé (`504`), trop de redirections ou
 * échec réseau (`502`). Une cible interdite lève `SsrfError` (422), pas
 * celle-ci — l'appelant distingue ainsi « tu n'as pas le droit d'y aller » de
 * « le site n'a pas répondu ».
 */
export class FetchPublicError extends nodefonyError {
  /** Cause de l'échec, stable et exploitable sans lire le message. */
  readonly reason: FetchPublicFailure;

  constructor(reason: FetchPublicFailure, message: string) {
    super(message, reason === "timeout" ? 504 : 502);
    this.reason = reason;
  }
}
