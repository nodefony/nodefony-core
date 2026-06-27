import { nodefonyError } from "nodefony";

/**
 * URL rejetée par la protection SSRF — `code = 422`. Levée quand une URL sortante
 * (endpoint webhook, fetch applicatif…) est syntaxiquement valide mais cible une
 * ressource **interdite** : protocole non autorisé, identifiants embarqués, hôte
 * non résolvable, ou IP non publique (loopback, privée, link-local, métadonnées
 * cloud `169.254.169.254`…). Sémantique alignée sur GitHub (422 à l'enregistrement
 * d'un webhook invalide).
 */
export class SsrfError extends nodefonyError {
  constructor(message: string | Error = "URL sortante interdite (SSRF)") {
    super(message, 422);
  }
}

export default SsrfError;
