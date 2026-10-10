/**
 * Facteurs d'authentification de Nodefony → méthodes RFC 8176, posées dans la
 * session à son ouverture. Les clés et leur lecteur sont au cœur
 * (`readSessionAuthentication`, `nodefony`) ; seule la POLITIQUE de
 * correspondance vit ici.
 */

// Facteur nommé par l'appelant → valeurs du registre IANA « Authentication
// Method Reference Values » (RFC 8176). `pop` (preuve de possession d'une clé,
// matérielle ou logicielle) couvre une passkey, synchronisée ou non. Le second
// facteur ne s'ouvre qu'après le mot de passe, d'où `pwd` + `otp`. Un facteur
// absent de la table (fournisseur OAuth…) n'a été vérifié par AUCUN facteur
// local : sa liste est vide, et la session nomme son fournisseur ailleurs.
const FACTOR_AMR: Readonly<Record<string, readonly string[]>> = Object.freeze({
  password: Object.freeze(["pwd"]),
  totp: Object.freeze(["pwd", "otp"]),
  recovery: Object.freeze(["pwd", "otp"]),
  webauthn: Object.freeze(["pop"]),
});

const NO_LOCAL_FACTOR: readonly string[] = Object.freeze([]);

/**
 * Valeurs RFC 8176 d'un facteur nommé par un chemin d'authentification.
 *
 * @param factor - le facteur tel que l'audit le nomme (`password`, `totp`,
 *   `recovery`, `webauthn`, `oauth`…)
 * @returns les méthodes vérifiées localement ; vide pour un facteur délégué
 */
export function amrForFactor(factor: string): readonly string[] {
  return Object.hasOwn(FACTOR_AMR, factor)
    ? (FACTOR_AMR[factor] ?? NO_LOCAL_FACTOR)
    : NO_LOCAL_FACTOR;
}
