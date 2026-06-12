import type { IPasswordEncoder } from "../../contracts/IPasswordEncoder";

// Binding natif chargé PARESSEUSEMENT au premier hash/verify (import dynamique,
// caché ensuite) : `@node-rs/argon2` est une peerDependency OPTIONNELLE — un
// import statique le chargerait à l'évaluation du barrel `@nodefony/user` (donc
// à CHAQUE boot consommant le module, ou crash si non installée). `supports` et
// `needsRehash` restent 100 % sync (parse regex, jamais besoin du natif).
type Argon2Binding = typeof import("@node-rs/argon2");
let argon2: Argon2Binding | null = null;
const loadArgon2 = async (): Promise<Argon2Binding> =>
  (argon2 ??= await import("@node-rs/argon2"));

/**
 * Paramètres de coût Argon2id (RFC 9106).
 *
 * Les défauts suivent le minimum OWASP 2026 (m=19 MiB, t=2, p=1) — déjà imposé
 * par le schéma Zod de `@nodefony/security` (`encoders.memoryKiB.min(19456)`).
 * L'encodeur ne valide ici que les bornes TECHNIQUES de l'algorithme : la
 * politique de sécurité vit dans la config (et permet aux tests d'utiliser des
 * coûts bas, rapides).
 */
export interface Argon2idOptions {
  /** Mémoire par hash en KiB (défaut 19456 = 19 MiB, minimum OWASP). */
  memoryKiB?: number;
  /** Nombre de passes sur la mémoire (défaut 3 — voir DEFAULT_TIME_COST). */
  timeCost?: number;
  /** Nombre de threads/lanes (défaut 1 — chaque lane alloue `memoryKiB`). */
  parallelism?: number;
  // Slot réservé : `secret` (pepper) arrivera avec le SecretProvider/KMS
  // (Phase 16 cloud-native) — clé HORS base, mêlée au hash côté serveur.
}

/** Défauts alignés sur le schéma Zod security (m = minimum OWASP). */
const DEFAULT_MEMORY_KIB = 19456;
// t=3 (> minimum OWASP t=2 ; RFC 9106 « uniformly safe ») : renchérit
// l'attaquant de +50 % SANS augmenter la RAM par hash — la pression mémoire
// serveur (m × hashs concurrents du pool libuv) est le vrai budget anti-DoS.
// Bench 2026-06 (Apple Silicon dev) : ~56 ms/hash, dans la cible 50-100 ms.
const DEFAULT_TIME_COST = 3;
const DEFAULT_PARALLELISM = 1;

// Préfixe PHC d'un hash argon2 : `$argon2id$v=19$m=19456,t=2,p=1$salt$digest`.
// Capture variant/version/coûts pour {@link Argon2idEncoder.needsRehash} — pur
// parsing, aucune dépendance au binding natif.
const ARGON2_HASH_RE = /^\$argon2(d|i|id)\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$/;

/** Version courante de l'algorithme (0x13) — toute version antérieure est re-hashée. */
const ARGON2_VERSION = 19;

/**
 * Encodeur de mot de passe **Argon2id** (RFC 9106) — recommandation NIST/OWASP 2026.
 *
 * Fonction de dérivation à MÉMOIRE DURE : chaque vérification exige `memoryKiB`
 * de RAM en plus du CPU, ce qui ruine les attaques massivement parallèles
 * (GPU/ASIC ont des milliers de cœurs mais pas 19 MiB de mémoire dédiée par
 * cœur). Le variant `id` est hybride : résistant aux canaux auxiliaires
 * (première moitié indépendante du mot de passe) ET aux compromis temps-mémoire.
 *
 * Délègue à `@node-rs/argon2` (binding NAPI Rust, exécuté hors thread principal,
 * **peerDependency optionnelle**) : le binaire natif est importé DYNAMIQUEMENT
 * au premier `hash`/`verify` — instancier l'encodeur ne charge rien.
 */
export class Argon2idEncoder implements IPasswordEncoder {
  /** Mémoire par hash (KiB) utilisée pour produire les nouveaux hashs. */
  readonly memoryKiB: number;
  /** Passes sur la mémoire utilisées pour produire les nouveaux hashs. */
  readonly timeCost: number;
  /** Lanes parallèles utilisées pour produire les nouveaux hashs. */
  readonly parallelism: number;

  /**
   * @param options - coûts Argon2id ; défauts = minimum OWASP (19 MiB, t=2, p=1).
   * @throws {RangeError} si un paramètre viole les bornes techniques de
   *   l'algorithme (entiers, `t ≥ 1`, `1 ≤ p ≤ 255`, `m ≥ 8×p`).
   */
  constructor(options: Argon2idOptions = {}) {
    const m = options.memoryKiB ?? DEFAULT_MEMORY_KIB;
    const t = options.timeCost ?? DEFAULT_TIME_COST;
    const p = options.parallelism ?? DEFAULT_PARALLELISM;
    if (!Number.isInteger(t) || t < 1) {
      throw new RangeError(
        `Argon2idEncoder: timeCost must be an integer >= 1, got ${t}`,
      );
    }
    if (!Number.isInteger(p) || p < 1 || p > 255) {
      throw new RangeError(
        `Argon2idEncoder: parallelism must be an integer in [1, 255], got ${p}`,
      );
    }
    // Contrainte RFC 9106 : la mémoire se découpe en 8 blocs par lane minimum.
    if (!Number.isInteger(m) || m < 8 * p) {
      throw new RangeError(
        `Argon2idEncoder: memoryKiB must be an integer >= 8×parallelism (${8 * p}), got ${m}`,
      );
    }
    this.memoryKiB = m;
    this.timeCost = t;
    this.parallelism = p;
  }

  /**
   * Reconnaît un hash argon2 (tous variants `$argon2d|i|id$`) — parsing pur, sync.
   *
   * Tous les variants sont supportés à la VÉRIFICATION (le binding parse le
   * format PHC) ; {@link needsRehash} se charge de moderniser `d`/`i` vers `id`.
   *
   * @param hash - hash stocké à inspecter.
   * @returns `true` si le hash est au format argon2.
   */
  supports(hash: string): boolean {
    return ARGON2_HASH_RE.test(hash);
  }

  /**
   * Hache un mot de passe en clair (sel généré, paramètres inclus dans la sortie PHC).
   *
   * @param plain - mot de passe en clair.
   * @returns le hash argon2id à persister.
   */
  async hash(plain: string): Promise<string> {
    const mod = await loadArgon2();
    return mod.hash(plain, {
      algorithm: mod.Algorithm.Argon2id,
      memoryCost: this.memoryKiB,
      timeCost: this.timeCost,
      parallelism: this.parallelism,
    });
  }

  /**
   * Vérifie un mot de passe en clair contre un hash stocké (temps constant interne).
   *
   * Les paramètres de vérification sont LUS DANS le hash PHC (pas ceux de
   * l'encodeur) : un hash produit avec d'anciens coûts reste vérifiable.
   *
   * @param plain - mot de passe fourni à la connexion.
   * @param hash - hash argon2 stocké.
   * @returns `true` si la correspondance est valide.
   */
  async verify(plain: string, hash: string): Promise<boolean> {
    return (await loadArgon2()).verify(hash, plain);
  }

  /**
   * Indique si un hash doit être recalculé : format non argon2, variant non
   * `id`, version antérieure à 0x13, ou coûts stockés INFÉRIEURS aux coûts
   * courants (politique affaiblie). Des coûts supérieurs ne déclenchent pas de
   * re-hash (jamais de downgrade silencieux).
   *
   * @param hash - hash stocké à inspecter.
   * @returns `true` si un re-hash est recommandé au prochain login réussi.
   */
  needsRehash(hash: string): boolean {
    const match = ARGON2_HASH_RE.exec(hash);
    if (match === null) return true;
    if (match[1] !== "id") return true;
    if (Number.parseInt(match[2], 10) < ARGON2_VERSION) return true;
    const m = Number.parseInt(match[3], 10);
    const t = Number.parseInt(match[4], 10);
    return m < this.memoryKiB || t < this.timeCost;
  }
}
