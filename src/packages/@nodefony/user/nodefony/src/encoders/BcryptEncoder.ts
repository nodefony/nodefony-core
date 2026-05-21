import { hash as bcryptHash, verify as bcryptVerify } from "@node-rs/bcrypt";
import type { IPasswordEncoder } from "../../contracts/IPasswordEncoder";

/** Coût bcrypt par défaut — 2^12 itérations (recommandation OWASP courante). */
const DEFAULT_ROUNDS = 12;

// Préfixe d'un hash bcrypt : `$2a$` / `$2b$` / `$2y$` suivi du coût sur 2 chiffres.
// Capture le coût pour {@link BcryptEncoder.needsRehash} sans dépendance externe.
const BCRYPT_HASH_RE = /^\$2[aby]\$(\d{2})\$/;

/**
 * Encodeur de mot de passe **bcrypt** — implémentation de référence d'{@link IPasswordEncoder}.
 *
 * Délègue à `@node-rs/bcrypt` (binding NAPI Rust) : hachage/vérification réellement
 * asynchrones (exécutés hors thread principal), ne bloquent pas la boucle
 * d'événements même au coût 12. `@node-rs/bcrypt` est une **peerDependency
 * optionnelle** : seules les applications qui authentifient par mot de passe local
 * la tirent ; un consommateur qui n'importe que `IUser`/`BaseUser` ne charge jamais
 * ce module ni le binaire natif.
 *
 * @remarks `verify` délègue directement la promesse (aucun `async`/`await`
 * superflu). Le coût est paramétrable au constructeur pour permettre un re-hash
 * progressif via {@link BcryptEncoder.needsRehash}.
 */
export class BcryptEncoder implements IPasswordEncoder {
  /** Coût bcrypt utilisé pour produire les nouveaux hashs. */
  readonly rounds: number;

  /**
   * @param rounds - coût bcrypt (log2 des itérations). Entier dans `[4, 31]`.
   * @throws {RangeError} si `rounds` est hors de l'intervalle valide.
   */
  constructor(rounds: number = DEFAULT_ROUNDS) {
    if (!Number.isInteger(rounds) || rounds < 4 || rounds > 31) {
      throw new RangeError(
        `BcryptEncoder: rounds must be an integer in [4, 31], got ${rounds}`,
      );
    }
    this.rounds = rounds;
  }

  /**
   * Hache un mot de passe en clair (sel généré et inclus dans la sortie).
   *
   * @param plain - mot de passe en clair.
   * @returns le hash bcrypt à persister.
   */
  hash(plain: string): Promise<string> {
    return bcryptHash(plain, this.rounds);
  }

  /**
   * Vérifie un mot de passe en clair contre un hash stocké (temps constant interne).
   *
   * @param plain - mot de passe fourni à la connexion.
   * @param hash - hash bcrypt stocké.
   * @returns `true` si la correspondance est valide.
   */
  verify(plain: string, hash: string): Promise<boolean> {
    return bcryptVerify(plain, hash);
  }

  /**
   * Indique si un hash doit être recalculé (coût stocké inférieur au coût courant,
   * ou format non bcrypt).
   *
   * @param hash - hash stocké à inspecter.
   * @returns `true` si un re-hash est recommandé au prochain login réussi.
   */
  needsRehash(hash: string): boolean {
    const match = BCRYPT_HASH_RE.exec(hash);
    if (match === null) return true;
    return Number.parseInt(match[1], 10) < this.rounds;
  }
}
