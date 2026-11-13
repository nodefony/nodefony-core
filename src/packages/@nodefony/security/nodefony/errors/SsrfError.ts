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
  /**
   * `forbidden` : la cible est interdite (protocole, identifiants, IP non
   * publique). `unresolvable` : l'hôte n'a aucune adresse — rien d'interne n'est
   * visé, le site est simplement injoignable ; un appelant qui rend ces deux cas
   * à l'utilisateur les distingue par ce champ, jamais par le texte du message.
   */
  readonly reason: "forbidden" | "unresolvable";

  constructor(
    message: string | Error = "URL sortante interdite (SSRF)",
    reason: "forbidden" | "unresolvable" = "forbidden",
  ) {
    super(message, 422);
    this.reason = reason;
  }
}

export default SsrfError;
