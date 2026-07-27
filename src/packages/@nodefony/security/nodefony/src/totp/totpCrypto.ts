import {
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Cœur **pur** du 2FA TOTP — RFC 6238 (Time-based OTP) au-dessus de RFC 4226
 * (HOTP). Aucun I/O, aucun container, aucune persistance → testable sans serveur
 * et partagé par l'émetteur (enrôlement) et le vérificateur (login step-up).
 *
 * **Principe** (RFC 6238 §4) : un secret partagé `K` + un compteur dérivé du
 * temps `T = ⌊(epochSec − T0) / step⌋` remplacent le compteur incrémental de
 * HOTP. Les deux parties (serveur, application d'authentification) calculent
 * `HOTP(K, T) = Truncate(HMAC-SHA-1(K, T))` ; l'horloge fait office de canal de
 * synchronisation — aucun échange réseau par code.
 *
 * **Troncature dynamique** (RFC 4226 §5.3) : l'octet de poids faible du condensat
 * HMAC fournit un offset `0..15` ; on lit 4 octets à cet offset, on masque le bit
 * de signe (`0x7f`, pour lever l'ambiguïté signé/non-signé inter-processeur), puis
 * `code = bin31 mod 10^digits`.
 *
 * **Secret** : RFC 4226 R6 exige ≥ 128 bits, RECOMMANDE 160 bits → 20 octets
 * (= taille du bloc HMAC-SHA-1, optimal). Encodé en base32 RFC 4648 (sans padding)
 * pour l'URI `otpauth://` que lisent Google Authenticator / Authy / 1Password.
 */

/** Algorithmes HMAC admis (RFC 6238 §1.2 : SHA1 par défaut, SHA256/512 optionnels). */
export type TotpAlgorithm = "SHA1" | "SHA256" | "SHA512";

/** Paramètres TOTP — défauts interopérables (Google Authenticator). */
export const TOTP_DEFAULTS = {
  /** Taille du secret en octets (RFC 4226 R6 : 160 bits recommandés). */
  secretBytes: 20,
  /** Période d'un code en secondes (RFC 6238 §5.2 : 30 s recommandé). */
  step: 30,
  /** Nombre de chiffres du code (RFC 4226 §5.3 : 6 minimum). */
  digits: 6,
  /** Fonction de hachage HMAC (compat maximale = SHA1). */
  algorithm: "SHA1" as TotpAlgorithm,
  /** Origine du décompte des tranches (RFC 6238 : T0 = 0 = epoch Unix). */
  t0: 0,
  /**
   * Tolérance de dérive d'horloge, en nombre de pas de part et d'autre.
   * RFC 6238 §5.2 : « at most one time step » → ±1 (1 pas = 30 s avant/après).
   */
  window: 1,
} as const;

// ── base32 RFC 4648 (alphabet sans padding) ──────────────────────────────────
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encode des octets en base32 RFC 4648 **sans padding** (`=`) — forme attendue
 * par les applications d'authentification dans l'URI `otpauth://`.
 */
export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | (buf[i] as number);
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

/**
 * Décode une chaîne base32 RFC 4648 → octets. Tolérant : ignore espaces,
 * tirets et padding `=`, insensible à la casse (un secret peut être saisi à la
 * main par l'utilisateur). Lève si un caractère hors alphabet est rencontré.
 */
export function base32Decode(input: string): Buffer {
  const clean = input.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i] as string);
    if (idx === -1) {
      throw new Error(`base32: caractère invalide « ${clean[i]} »`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** Génère un secret TOTP cryptographiquement aléatoire (défaut 160 bits). */
export function generateTotpSecret(
  bytes: number = TOTP_DEFAULTS.secretBytes,
): Buffer {
  return randomBytes(bytes);
}

/** Map nom RFC → identifiant `node:crypto`. */
function hmacName(algo: TotpAlgorithm): string {
  return algo === "SHA1" ? "sha1" : algo === "SHA256" ? "sha256" : "sha512";
}

/** Encode un compteur 64 bits big-endian (RFC 4226 §5.1 : C sur 8 octets). */
function counterBuffer(counter: number): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  return buf;
}

/**
 * HOTP (RFC 4226 §5.3) — `Truncate(HMAC(K, counter))` → code à `digits` chiffres,
 * complété à gauche par des zéros.
 *
 * @param secret - secret partagé `K` (octets bruts).
 * @param counter - compteur `C` (≥ 0).
 * @param digits - longueur du code (défaut 6).
 * @param algorithm - fonction HMAC (défaut SHA1).
 */
export function hotp(
  secret: Buffer,
  counter: number,
  digits: number = TOTP_DEFAULTS.digits,
  algorithm: TotpAlgorithm = TOTP_DEFAULTS.algorithm,
): string {
  const hs = createHmac(hmacName(algorithm), secret)
    .update(counterBuffer(counter))
    .digest();
  // Troncature dynamique (RFC 4226 §5.3) : offset = 4 bits de poids faible.
  const offset = (hs[hs.length - 1] as number) & 0x0f;
  const bin =
    (((hs[offset] as number) & 0x7f) << 24) |
    (((hs[offset + 1] as number) & 0xff) << 16) |
    (((hs[offset + 2] as number) & 0xff) << 8) |
    ((hs[offset + 3] as number) & 0xff);
  const mod = bin % 10 ** digits;
  return mod.toString().padStart(digits, "0");
}

/** Numéro de tranche temporelle `T` (RFC 6238 §4.2) pour un instant donné. */
export function totpCounter(
  epochSec: number,
  step: number = TOTP_DEFAULTS.step,
  t0: number = TOTP_DEFAULTS.t0,
): number {
  return Math.floor((epochSec - t0) / step);
}

/** Options de calcul/vérification d'un code TOTP. */
export interface ITotpOptions {
  /** Instant de référence en **millisecondes** (défaut : horloge système). */
  epochMs?: number;
  step?: number;
  digits?: number;
  algorithm?: TotpAlgorithm;
  t0?: number;
}

/**
 * Calcule le code TOTP courant (RFC 6238 §4) pour un secret donné.
 *
 * @param secret - secret partagé `K`.
 * @returns le code à `digits` chiffres pour la tranche temporelle courante.
 */
export function totpCode(secret: Buffer, opts: ITotpOptions = {}): string {
  const step = opts.step ?? TOTP_DEFAULTS.step;
  const epochSec = Math.floor((opts.epochMs ?? Date.now()) / 1000);
  const counter = totpCounter(epochSec, step, opts.t0 ?? TOTP_DEFAULTS.t0);
  return hotp(
    secret,
    counter,
    opts.digits ?? TOTP_DEFAULTS.digits,
    opts.algorithm ?? TOTP_DEFAULTS.algorithm,
  );
}

/** Résultat d'une vérification TOTP — `step` matché = ancre anti-rejeu. */
export interface ITotpVerifyResult {
  /** Le code présenté correspond à une tranche de la fenêtre de tolérance. */
  valid: boolean;
  /**
   * Numéro de tranche `T` qui a validé le code (présent si `valid`). À
   * persister (`lastUsedStep`) pour **refuser tout rejeu** dans la même fenêtre
   * (RFC 6238 §5.2).
   */
  step?: number;
}

/**
 * Vérifie un code TOTP présenté contre une fenêtre de tolérance `±window` pas
 * (RFC 6238 §5.2). Comparaison en **temps constant** (anti-timing). Retourne la
 * tranche `T` validée pour permettre à l'appelant d'appliquer l'anti-rejeu.
 *
 * @param code - code présenté par l'utilisateur (les espaces sont ignorés).
 * @param secret - secret partagé `K`.
 * @param window - nombre de pas de tolérance de part et d'autre (défaut ±1).
 */
export function verifyTotp(
  code: string,
  secret: Buffer,
  opts: ITotpOptions & { window?: number } = {},
): ITotpVerifyResult {
  const digits = opts.digits ?? TOTP_DEFAULTS.digits;
  const normalized = code.replace(/\s/g, "");
  if (!/^\d+$/.test(normalized) || normalized.length !== digits) {
    return { valid: false };
  }
  const step = opts.step ?? TOTP_DEFAULTS.step;
  const epochSec = Math.floor((opts.epochMs ?? Date.now()) / 1000);
  const current = totpCounter(epochSec, step, opts.t0 ?? TOTP_DEFAULTS.t0);
  const window = opts.window ?? TOTP_DEFAULTS.window;
  const algorithm = opts.algorithm ?? TOTP_DEFAULTS.algorithm;
  const presented = Buffer.from(normalized);
  for (let i = -window; i <= window; i++) {
    const candidate = Buffer.from(hotp(secret, current + i, digits, algorithm));
    if (
      candidate.length === presented.length &&
      timingSafeEqual(candidate, presented)
    ) {
      return { valid: true, step: current + i };
    }
  }
  return { valid: false };
}

/** Champs d'un URI `otpauth://totp/...` (Key Uri Format de facto). */
export interface IOtpauthParams {
  /** Émetteur affiché dans l'application (ex. « Nodefony »). */
  issuer: string;
  /** Compte (ex. identifiant/email de l'utilisateur). */
  account: string;
  /** Secret encodé en base32 RFC 4648. */
  secretBase32: string;
  algorithm?: TotpAlgorithm;
  digits?: number;
  period?: number;
}

/**
 * Construit l'URI `otpauth://totp/{issuer}:{account}?...` encodé dans le QR code
 * d'enrôlement. Le label `issuer:account` et le paramètre `issuer` sont tous deux
 * renseignés (recommandation Key Uri Format pour la compat des lecteurs).
 */
export function buildOtpauthUri(params: IOtpauthParams): string {
  const issuer = encodeURIComponent(params.issuer);
  const account = encodeURIComponent(params.account);
  const query = new URLSearchParams({
    secret: params.secretBase32,
    issuer: params.issuer,
    algorithm: params.algorithm ?? TOTP_DEFAULTS.algorithm,
    digits: String(params.digits ?? TOTP_DEFAULTS.digits),
    period: String(params.period ?? TOTP_DEFAULTS.step),
  });
  return `otpauth://totp/${issuer}:${account}?${query.toString()}`;
}

// ── Codes de récupération (NIST SP 800-63B §5.1.2 « look-up secrets ») ────────

/** Alphabet des codes de récupération (Crockford-ish, sans I/L/O/U ambigus). */
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";

/**
 * Tire `count` indices UNIFORMES dans `[0, size)` à partir d'octets aléatoires.
 *
 * Le repli direct (`octet % size`) n'est uniforme que si `size` divise 256. Ici
 * `256 % 30 = 16` : les seize premiers symboles de l'alphabet sortaient une fois
 * sur neuf-deux-cent-cinquante-sixièmes, les quatorze autres une fois sur huit —
 * environ 12 % plus souvent pour les premiers.
 *
 * L'enjeu réel est modeste (l'entropie tombe de 4,9069 à 4,9044 bit par
 * caractère, soit 0,025 bit perdu sur les ~49 d'un code) et n'ouvre aucune
 * attaque praticable. Ce n'est pas la raison de corriger : un tirage biaisé dans
 * du code cryptographique est une dette qui ne se voit plus une fois écrite, et
 * dont le coût explose si l'alphabet change un jour pour une taille moins
 * clémente. Le refus d'échantillon coûte ici quelques octets de plus, une fois
 * par activation de second facteur.
 *
 * @param count - nombre d'indices voulus.
 * @param size - taille de l'alphabet (2 à 256).
 * @param source - fournisseur d'octets aléatoires — paramétrable pour que le
 *          refus d'échantillon soit OBSERVABLE en test, faute de quoi on ne
 *          prouverait jamais que la garde mord.
 * @returns exactement `count` indices, uniformément distribués.
 */
export function unbiasedIndices(
  count: number,
  size: number,
  source: (n: number) => Buffer = randomBytes,
): number[] {
  if (size < 2 || size > 256) {
    throw new RangeError(`taille d'alphabet hors bornes : ${size}`);
  }
  // Plus grand multiple de `size` tenant dans un octet : au-delà, l'octet est
  // REJETÉ plutôt que replié — c'est tout le principe.
  const limit = 256 - (256 % size);
  const out: number[] = [];
  while (out.length < count) {
    // Marge de huit octets : avec un alphabet de 30, moins d'un octet sur seize
    // est rejeté, donc une seule passe suffit en pratique. La boucle reste là
    // pour les alphabets ingrats, où le taux de rejet grimpe.
    const bytes = source(count - out.length + 8);
    for (const b of bytes) {
      if (b >= limit) continue;
      out.push(b % size);
      if (out.length === count) break;
    }
  }
  return out;
}

/** Normalise un code de récupération présenté (casse + séparateurs ignorés). */
function normalizeRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, "").toUpperCase();
}

/**
 * Génère `count` codes de récupération à usage unique, lisibles
 * (`XXXXX-XXXXX`, ~50 bits chacun). À présenter **une seule fois** à
 * l'utilisateur ; seul leur condensat est persisté ({@link hashRecoveryCode}).
 */
export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let c = 0; c < count; c++) {
    let raw = "";
    for (const idx of unbiasedIndices(10, RECOVERY_ALPHABET.length)) {
      raw += RECOVERY_ALPHABET[idx];
    }
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5)}`);
  }
  return codes;
}

/**
 * Condensat au repos d'un code de récupération (`sha256` hex). `sha256` suffit
 * (≈ 50 bits aléatoires non brute-forçables, comme une clé API — pas un mot de
 * passe humain) ; la normalisation rend la vérification insensible casse/tirets.
 */
export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(normalizeRecoveryCode(code)).digest("hex");
}

/**
 * Cherche un code de récupération présenté parmi des condensats stockés, en
 * **temps constant par entrée**. Retourne l'index consommé (à retirer du stock),
 * ou `-1` si aucun ne correspond.
 */
export function matchRecoveryCode(
  presented: string,
  hashes: readonly string[],
): number {
  const target = Buffer.from(hashRecoveryCode(presented));
  let found = -1;
  for (let i = 0; i < hashes.length; i++) {
    const candidate = Buffer.from(hashes[i] as string);
    if (
      candidate.length === target.length &&
      timingSafeEqual(candidate, target)
    ) {
      found = i;
    }
  }
  return found;
}
