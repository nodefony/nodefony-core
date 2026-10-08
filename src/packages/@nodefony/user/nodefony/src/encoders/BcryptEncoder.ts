import type { IPasswordEncoder } from "../../contracts/IPasswordEncoder";

// Binding natif chargé PARESSEUSEMENT au premier hash/verify (import dynamique,
// caché ensuite) : `@node-rs/bcrypt` est une peerDependency OPTIONNELLE — un
// import statique le chargerait à l'évaluation du barrel `@nodefony/user` (donc
// à CHAQUE boot consommant le module, ou crash si non installée). `needsRehash`
// reste 100 % sync (parse regex, jamais besoin du natif).
type BcryptBinding = typeof import("@node-rs/bcrypt");
let bcrypt: BcryptBinding | null = null;
const loadBcrypt = async (): Promise<BcryptBinding> =>
  (bcrypt ??= await import("@node-rs/bcrypt"));

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
 * @remarks Le binding natif est importé DYNAMIQUEMENT au premier `hash`/`verify`
 * (instancier l'encodeur ne charge rien — la peerDep optionnelle n'est requise
 * qu'au premier usage réel). Le coût est paramétrable au constructeur pour
 * permettre un re-hash progressif via {@link BcryptEncoder.needsRehash}.
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
   * Reconnaît un hash bcrypt (`$2a$`/`$2b$`/`$2y$` + coût) — parsing pur, sync.
   *
   * @param hash - hash stocké à inspecter.
   * @returns `true` si le hash est au format bcrypt.
   */
  supports(hash: string): boolean {
    return BCRYPT_HASH_RE.test(hash);
  }

  /**
   * Hache un mot de passe en clair (sel généré et inclus dans la sortie).
   *
   * Un clair de plus de 72 octets UTF-8 est REFUSÉ : bcrypt n'en lit que les
   * 72 premiers, si bien que deux mots de passe partageant ce préfixe se
   * valideraient l'un l'autre. Une phrase de passe accentuée ou à émojis atteint
   * vite cette borne — mieux vaut le dire à la création que tronquer en silence.
   * Les hashs déjà stockés ne sont pas concernés : {@link BcryptEncoder.verify}
   * n'applique pas cette borne.
   *
   * @param plain - mot de passe en clair.
   * @returns le hash bcrypt à persister.
   * @throws {RangeError} si `plain` dépasse 72 octets UTF-8.
   */
  async hash(plain: string): Promise<string> {
    return (await loadBcrypt()).hash(plain, {
      cost: this.rounds,
      rejectLongPasswords: true,
    });
  }

  /**
   * Vérifie un mot de passe en clair contre un hash stocké (temps constant interne).
   *
   * @param plain - mot de passe fourni à la connexion.
   * @param hash - hash bcrypt stocké.
   * @returns `true` si la correspondance est valide.
   */
  async verify(plain: string, hash: string): Promise<boolean> {
    return (await loadBcrypt()).verify(plain, hash);
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
    const [, rounds = ""] = match; // groupe obligatoire du motif
    return Number.parseInt(rounds, 10) < this.rounds;
  }
}
