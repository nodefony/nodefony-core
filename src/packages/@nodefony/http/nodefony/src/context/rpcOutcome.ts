import type { IRpcOutcome } from "../../interfaces/IRpcCall";

/**
 * Copie le résultat d'un appel RPC — les quatre champs, jamais la fiche
 * d'appel entière, qui porte le contrôleur et le contexte (ADR-0026 D10). La
 * forme est fixe : un objet par appel, alloué seulement par qui publie (audit
 * JSON, canal de traçage avec abonné).
 *
 * @param call - l'appel RPC de la requête, `null` hors RPC.
 * @returns sa copie, `null` hors RPC.
 */
export function rpcOutcomeOf(call: IRpcOutcome | null): IRpcOutcome | null {
  if (call === null) return null;
  return {
    system: call.system,
    method: call.method,
    code: call.code,
    codeName: call.codeName,
  };
}
