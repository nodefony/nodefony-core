/**
 * Erreur du module devkit.
 *
 * Deux champs qui font la différence en production :
 *  - `code` : identifiant MACHINE (stable, grep-able, consommé par Studio et
 *    l'audit) — le message, lui, peut changer sans rien casser ;
 *  - `context` : payload structuré joint au log (jamais de secret ici).
 */
export class DevkitError extends Error {
  constructor(
    message: string,
    public readonly code: string = "DEVKIT_ERROR",
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DevkitError";
  }
}

export default DevkitError;
