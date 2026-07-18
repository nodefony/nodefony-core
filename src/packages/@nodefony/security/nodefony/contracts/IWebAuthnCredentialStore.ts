import type { IPage, IPageQuery } from "nodefony";
import type { IWebAuthnCredential } from "./IWebAuthnCredential";

/**
 * Vue d'une passkey pour l'INTROSPECTION admin (« quels appareils portent des
 * passkeys, lesquelles meurent avec leur appareil »).
 *
 * **Sans `publicKey`, par construction du contrat.** La clé publique n'est pas un
 * secret — c'est sa nature d'être publique — mais elle n'a aucune valeur
 * d'exploitation dans une console : c'est de la matière cryptographique brute que
 * personne ne lit, et une projection minimale est plus facile à garder juste. Ce
 * qui S'EXPLOITE est ici : `backupState` (une passkey non sauvegardée disparaît
 * avec l'appareil → l'utilisateur se verrouille dehors) et `signCount` (le
 * compteur anti-clone du §6.1.1).
 */
export interface IWebAuthnCredentialSummary {
  /** Identifiant du credential (base64url) — la clé naturelle. */
  readonly id: string;
  /** Utilisateur propriétaire. */
  readonly userId: string;
  /** Canaux de l'authenticator (`internal`, `hybrid`, `usb`…). */
  readonly transports: readonly string[];
  /** Le credential PEUT être sauvegardé/synchronisé (BE flag). */
  readonly backupEligible: boolean;
  /** Le credential EST sauvegardé (BS flag) — sinon il meurt avec l'appareil. */
  readonly backupState: boolean;
  /** Une vérification utilisateur (biométrie/PIN) a déjà eu lieu. */
  readonly uvInitialized: boolean;
  /** Compteur de signatures (anti-clone WebAuthn §6.1.1). */
  readonly signCount: number;
  /** Nom donné à l'appareil par l'utilisateur, si renseigné. */
  readonly nickname?: string;
  /** Enrôlement (epoch ms). */
  readonly createdAt: number;
  /** Dernière authentification réussie (epoch ms), ou `null` = jamais servie. */
  readonly lastUsedAt: number | null;
}

/**
 * Requête de listing des passkeys — {@link IPageQuery} + les filtres qui ont un
 * sens ici. `q` (hérité) = **préfixe** d'`userId`.
 *
 * ⚠️ À ne pas confondre avec {@link IWebAuthnCredentialStore.findByUser} : ce
 * listing est le chemin FROID d'introspection admin ; `findByUser` est le chemin
 * chaud du login, non paginé par nature.
 */
export interface IWebAuthnListQuery extends IPageQuery {
  /** Restreindre à un porteur (sa liste d'appareils). */
  userId?: string;
  /**
   * `true` = passkeys sauvegardées/synchronisées seulement, `false` = celles
   * liées à un seul appareil (les porteurs à risque de verrouillage), omis = les deux.
   */
  backedUp?: boolean;
}

/** État mis à jour après une authentification réussie (WebAuthn §7.2). */
export interface WebAuthnAuthUpdate {
  /** Nouveau compteur de signatures (anti-clone). */
  signCount: number;
  /** Nouvel état de sauvegarde (BS flag). */
  backupState: boolean;
  /** UV réalisée durant cette cérémonie. */
  uvInitialized: boolean;
  /** Horodatage de l'usage (epoch ms). */
  lastUsedAt: number;
}

/**
 * Store **pluggable** des credentials WebAuthn — découple le cœur du backend de
 * persistance (mémoire / ORM / Redis). Convention-frère d'`ITokenStore` :
 * le builtin `memory` est sans dépendance, les adapters lourds s'enregistrent
 * depuis leur propre module (inversion de dépendance).
 */
export interface IWebAuthnCredentialStore {
  /** Credential par son id (base64url), ou `null` — résolution à l'authentification. */
  findById(credentialId: string): Promise<IWebAuthnCredential | null>;
  /**
   * Tous les credentials d'un utilisateur — pour `allowCredentials`
   * (authentification ciblée) et l'UX « mes appareils ».
   *
   * **Volontairement NON paginé** : `allowCredentials` doit être COMPLET ou il
   * est faux — un authenticator dont la passkey manque de la liste ne peut pas
   * répondre au défi, et le protocole WebAuthn n'offre aucun « page suivante »
   * (le navigateur reçoit une liste unique et choisit). Ce qui borne cet appel
   * est le plafond d'enrôlement (`passkeys.maxPerUser`), pas une pagination.
   */
  findByUser(userId: string): Promise<IWebAuthnCredential[]>;
  /**
   * Nombre de credentials d'un utilisateur — **natif** par backend (`COUNT`,
   * `countDocuments`, `SCARD`), jamais un `findByUser().length`.
   *
   * Sert le plafond d'enrôlement (`passkeys.maxPerUser`) : le chemin
   * d'enregistrement ne doit pas charger N credentials pour en compter le
   * nombre, et le plafond est ce qui garantit que {@link findByUser} reste borné.
   */
  countByUser(userId: string): Promise<number>;
  /** Persiste un nouveau credential (fin de la cérémonie d'enregistrement). */
  save(credential: IWebAuthnCredential): Promise<void>;
  /** Met à jour l'état post-authentification (compteur, sauvegarde, UV, usage). */
  update(credentialId: string, patch: WebAuthnAuthUpdate): Promise<void>;
  /** Révoque un credential (l'utilisateur retire un appareil). */
  delete(credentialId: string): Promise<void>;
  /**
   * Page de passkeys pour le data plane admin — ne matérialise jamais plus d'une
   * page, filtres appliqués au store, `publicKey` exclue (cf
   * {@link IWebAuthnCredentialSummary}).
   *
   * Ordre contractuel (backends `offset`) : `createdAt` DESC, départagé par `id`
   * ASC. Les backends **curseur** (Redis, dont l'index par utilisateur est un
   * Set) n'ont pas d'ordre global : ils rendent des pages de taille variable et
   * le client boucle sur `nextCursor` — capacité réduite déclarée, pas un défaut.
   */
  listPage(
    query: IWebAuthnListQuery,
  ): Promise<IPage<IWebAuthnCredentialSummary>>;
  /**
   * Nombre de passkeys correspondant aux filtres (`COUNT` natif), ou **`-1`** si
   * le backend ne sait pas compter à coût raisonnable (Redis : un total exigerait
   * un `SCAN` complet O(N) sur un chemin froid — refusé).
   */
  countCredentials(query: IWebAuthnListQuery): Promise<number>;
}

export default IWebAuthnCredentialStore;
