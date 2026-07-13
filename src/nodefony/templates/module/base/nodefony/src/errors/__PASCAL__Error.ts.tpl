/**
 * Erreur du module <%= it.name %>.
 *
 * Deux champs qui font la différence en production :
 *  - `code` : identifiant MACHINE (stable, grep-able, consommé par Studio et
 *    l'audit) — le message, lui, peut changer sans rien casser ;
 *  - `context` : payload structuré joint au log (jamais de secret ici).
 */
export class <%= it.pascal %>Error extends Error {
  constructor(
    message: string,
    public readonly code: string = "<%= it.upper %>_ERROR",
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "<%= it.pascal %>Error";
  }
}

export default <%= it.pascal %>Error;
