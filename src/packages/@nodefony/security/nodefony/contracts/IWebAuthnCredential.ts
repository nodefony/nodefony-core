/**
 * Enregistrement d'un **credential WebAuthn / passkey** côté serveur — le
 * `credentialRecord` de WebAuthn L3 §7.1 (produit par la cérémonie
 * d'enregistrement, relu et mis à jour à chaque authentification §7.2).
 *
 * Le serveur ne stocke QUE de la donnée publique : la clé privée ne quitte
 * jamais l'authenticator (Touch ID, Windows Hello, clé FIDO…). Une fuite de ce
 * store ne compromet aucun compte — une clé publique est inexploitable seule.
 */
export interface IWebAuthnCredential {
  /** Identifiant du credential (base64url) — unique, fourni par l'authenticator. */
  readonly id: string;
  /** Identifiant de l'utilisateur propriétaire (sub / userHandle applicatif). */
  readonly userId: string;
  /** Clé publique **COSE** encodée base64url — vérifie la signature des assertions. */
  readonly publicKey: string;
  /**
   * Compteur de signatures (WebAuthn §6.1.1) — anti-clone : SHOULD croître à
   * chaque authentification. `0` = authenticator sans compteur (les passkeys
   * synchronisées iCloud/Google le laissent souvent à 0, ce n'est pas une erreur).
   */
  signCount: number;
  /** Transports annoncés (`usb` | `nfc` | `ble` | `internal` | `hybrid`). */
  readonly transports: readonly string[];
  /**
   * BE flag (Backup Eligibility, §6.1.3) — credential multi-appareils
   * (synchronisable). Fixé à l'enregistrement, ne change **jamais**.
   */
  readonly backupEligible: boolean;
  /** BS flag (Backup State) — actuellement sauvegardé. Peut évoluer dans le temps. */
  backupState: boolean;
  /**
   * La cérémonie a-t-elle réalisé une **vérification d'utilisateur** (biométrie/
   * PIN) au moins une fois (`uvInitialized`, §7.2) — base du step-up MFA.
   */
  uvInitialized: boolean;
  /**
   * Surnom optionnel de la passkey (« MacBook de Chris »).
   *
   * ⚠️ **Emplacement réservé — rien ne l'écrit aujourd'hui.** Le champ est porté
   * par ce contrat, par les trois stores (memory, drizzle, redis) et par la vue
   * admin de Studio, mais **aucune API publique ne le renseigne** : ni endpoint,
   * ni setter. En pratique il vaut donc toujours `undefined`, et l'écran retombe
   * sur son libellé de repli (`Passkey ···1234`).
   *
   * Le garder coûte zéro (il traverse déjà toute la chaîne) ; le renseigner
   * demande une décision produit — un endpoint de renommage, avec la question de
   * qui a le droit de renommer la passkey de qui.
   */
  nickname?: string;
  /** Création (epoch ms). */
  readonly createdAt: number;
  /** Dernière authentification réussie (epoch ms), ou `null` si jamais utilisé. */
  lastUsedAt: number | null;
}

export default IWebAuthnCredential;
