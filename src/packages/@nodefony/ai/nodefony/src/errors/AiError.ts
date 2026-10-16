/**
 * Erreur du module ai.
 *
 * Deux champs qui font la différence en production :
 *  - `code` : identifiant MACHINE (stable, grep-able, consommé par Studio et
 *    l'audit) — le message, lui, peut changer sans rien casser ;
 *  - `context` : payload structuré joint au log (jamais de secret ici).
 */
export class AiError extends Error {
  constructor(
    message: string,
    public override readonly code: string = "AI_ERROR",
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export default AiError;
