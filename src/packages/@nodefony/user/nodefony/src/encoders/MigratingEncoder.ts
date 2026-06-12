import type { IPasswordEncoder } from "../../contracts/IPasswordEncoder";

/**
 * Encodeur composite de **migration d'algorithme** — accepte les hashs legacy à
 * la vérification, ne produit que des hashs au format courant.
 *
 * Une base existante (ex. bcrypt) ne peut pas être convertie hors-ligne : les
 * mots de passe n'existent qu'au moment du login. Ce composite fait la
 * transition sans rien casser :
 *
 * - {@link hash} → toujours l'encodeur PRINCIPAL (le format cible) ;
 * - {@link verify} → routé vers le premier encodeur qui {@link IPasswordEncoder.supports | reconnaît}
 *   le hash stocké (principal d'abord, puis legacy dans l'ordre) ;
 * - {@link needsRehash} → `true` dès que le hash n'est pas au format principal
 *   → `UserService.authenticate` re-hashe au prochain login réussi (seul moment
 *   où le clair existe) = migration transparente, comptes legacy compris.
 *
 * Exemple — migration bcrypt → argon2id :
 * ```ts
 * new MigratingEncoder(new Argon2idEncoder(), [new BcryptEncoder()]);
 * ```
 * Le jour où plus aucun hash bcrypt ne subsiste, retirer le legacy.
 */
export class MigratingEncoder implements IPasswordEncoder {
  /** Encodeur cible — produit tous les nouveaux hashs. */
  readonly primary: IPasswordEncoder;
  /** Encodeurs acceptés en lecture seule pendant la migration. */
  readonly legacy: readonly IPasswordEncoder[];

  /**
   * @param primary - encodeur cible (format des nouveaux hashs).
   * @param legacy - encodeurs des formats encore présents en base (vérification seule).
   */
  constructor(primary: IPasswordEncoder, legacy: readonly IPasswordEncoder[]) {
    this.primary = primary;
    this.legacy = legacy;
  }

  /**
   * Reconnaît un hash si l'UN des encodeurs (principal ou legacy) le reconnaît.
   *
   * @param hash - hash stocké à inspecter.
   * @returns `true` si un membre du composite sait vérifier ce hash.
   */
  supports(hash: string): boolean {
    return this.#resolve(hash) !== null;
  }

  /**
   * Hache avec l'encodeur PRINCIPAL uniquement (jamais un format legacy).
   *
   * @param plain - mot de passe en clair.
   * @returns le hash au format cible.
   */
  async hash(plain: string): Promise<string> {
    return this.primary.hash(plain);
  }

  /**
   * Vérifie en routant vers l'encodeur dont le format correspond au hash stocké.
   *
   * Hash d'un format inconnu de tous → `false` (jamais d'erreur : un credential
   * invérifiable est un credential invalide — l'égalisation de temps des chemins
   * d'échec reste portée par `UserService`).
   *
   * @param plain - mot de passe fourni à la connexion.
   * @param hash - hash stocké (format courant ou legacy).
   * @returns `true` si la correspondance est valide.
   */
  async verify(plain: string, hash: string): Promise<boolean> {
    const encoder = this.#resolve(hash);
    if (encoder === null) return false;
    return encoder.verify(plain, hash);
  }

  /**
   * Recommande un re-hash si le hash n'est pas au format principal (migration),
   * ou si le principal lui-même le juge obsolète (coûts augmentés).
   *
   * @param hash - hash stocké à inspecter.
   * @returns `true` si un re-hash est recommandé au prochain login réussi.
   */
  needsRehash(hash: string): boolean {
    if (!this.primary.supports(hash)) return true;
    return this.primary.needsRehash(hash);
  }

  // Premier encodeur qui reconnaît le format (principal prioritaire) — O(n)
  // sur 2-3 membres, regex sync, négligeable devant le hash lui-même.
  #resolve(hash: string): IPasswordEncoder | null {
    if (this.primary.supports(hash)) return this.primary;
    for (const encoder of this.legacy) {
      if (encoder.supports(hash)) return encoder;
    }
    return null;
  }
}
