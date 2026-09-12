/**
 * **Politique de mot de passe par défaut** — refuse ce qui est manifestement
 * faible, et DIT laquelle de ses règles a mordu.
 *
 * ## Pourquoi des règles AVANT une liste
 *
 * Une liste, même de dix mille entrées, ne voit pas `aaaaaaaaaa`, `azertyuiop`
 * ni un mot de passe égal au nom du compte. Les règles algorithmiques coûtent
 * zéro octet, attrapent ces familles entières, et s'appliquent donc d'abord. La
 * liste ne sert qu'à ce qu'elles ratent — un mot réel et courant, assez long
 * pour passer la longueur minimale (`password123`, `iloveyou2`).
 *
 * ## Pourquoi la liste est LAZY
 *
 * Les empreintes pèsent 40 Ko de tas décodé, et 53 Ko de source. Le module qui
 * les porte est donc chargé par un `import()` DYNAMIQUE, au premier contrôle
 * réellement atteint — lors d'une création ou d'un changement de mot de passe,
 * jamais au démarrage, jamais dans le chemin d'une requête. Une application qui
 * ne crée aucun compte ne paie ni le décodage, ni même la lecture du fichier.
 *
 * ## Ce que cette politique ne fait PAS
 *
 * Elle ne juge ni la composition (majuscules, chiffres, caractères spéciaux) ni
 * la rotation : le NIST (SP 800-63B §5.1.1.2) a retiré ces exigences, qui
 * poussent aux mots de passe prévisibles (`Password1!`) sans rien ajouter à
 * l'entropie réelle. Ce qui est mesuré ici, c'est la PRÉVISIBILITÉ.
 *
 * Une application durcit en composant sa propre implémentation
 * d'`IPasswordBlocklist` ; elle ne peut pas désactiver ce contrôle en silence —
 * le service en pose une par défaut, et la retirer est un geste explicite.
 */
import { readFileSync } from "node:fs";

import type {
  IPasswordBlocklist,
  IPasswordSubjectHint,
} from "../../contracts/IPasswordBlocklist";
import { truncatedPasswordHash } from "./passwordHash";

/** Réglages d'une politique — tout est optionnel, les défauts sont sains. */
export interface IPasswordPolicyOptions {
  /**
   * Longueur minimale acceptée. Défaut : 10.
   *
   * Le plancher du NIST est 8 ; on retient 10 parce que le contrôle de liste le
   * permet sans exiger de composition — et parce qu'en deçà, les empreintes des
   * mots de passe courants couvrent déjà presque tout l'espace saisi.
   */
  minLength?: number;
  /** Mots de passe refusés en propre (noms métier, du produit, du client). */
  blocklist?: readonly string[];
  /**
   * Fichier de mots de passe refusés, une valeur par ligne (UTF-8). Lu au
   * PREMIER contrôle, comme les empreintes — un fichier absent ou illisible est
   * une erreur FRANCHE, jamais un contrôle qui se tait.
   */
  blocklistFile?: string | null;
  /** Consulter les empreintes embarquées. Défaut : `true`. */
  checkCommonPasswords?: boolean;
}

/** Défauts de la politique — source unique, relue par les tests. */
export const DEFAULT_PASSWORD_POLICY: Required<IPasswordPolicyOptions> = {
  minLength: 10,
  blocklist: [],
  blocklistFile: null,
  checkCommonPasswords: true,
};

/**
 * Suites de touches et de caractères d'où sortent les mots de passe « au clavier ».
 *
 * Les trois dispositions courantes y figurent : un `azerty` français et un
 * `qwerty` anglais donnent des suites DIFFÉRENTES, et ne garder que l'une ferait
 * un contrôle qui mord chez l'un et pas chez l'autre.
 */
const KEYBOARD_RUNS: readonly string[] = [
  "abcdefghijklmnopqrstuvwxyz",
  "0123456789",
  "azertyuiop",
  "qwertyuiop",
  "qwertzuiop",
  "asdfghjklm",
  "qsdfghjklm",
  "wxcvbn",
  "zxcvbnm",
  "yxcvbnm",
];

/** Longueur minimale d'une suite pour que la coïncidence cesse d'en être une. */
const MIN_RUN_LENGTH = 4;

/** Vrai si `value` contient une tranche d'au moins 4 touches consécutives. */
function containsKeyboardRun(value: string): boolean {
  const lower = value.toLowerCase();
  for (const run of KEYBOARD_RUNS) {
    const reversed = [...run].reverse().join("");
    for (const sequence of [run, reversed]) {
      for (
        let start = 0;
        start + MIN_RUN_LENGTH <= sequence.length;
        start += 1
      ) {
        if (lower.includes(sequence.slice(start, start + MIN_RUN_LENGTH))) {
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * Vrai si `value` n'est qu'un motif court répété (`aaaa`, `abab`, `123123`).
 *
 * On s'arrête à un motif de 4 caractères : au-delà, « répéter » n'est plus un
 * indice de faiblesse (`correct-horse-correct-horse` est long et imprévisible).
 */
function isRepeatedPattern(value: string): boolean {
  const lower = value.toLowerCase();
  for (let size = 1; size <= 4; size += 1) {
    if (lower.length < size * 2 || lower.length % size !== 0) continue;
    const unit = lower.slice(0, size);
    if (unit.repeat(lower.length / size) === lower) return true;
  }
  return false;
}

/** Partie « nom » d'un identifiant : `marie.dupont@exemple.fr` → `marie.dupont`. */
function localPart(identifier: string): string {
  const at = identifier.indexOf("@");
  return at > 0 ? identifier.slice(0, at) : identifier;
}

/** Longueur en deçà de laquelle une inclusion n'est plus significative. */
const MIN_IDENTIFIER_FRAGMENT = 4;

/**
 * Politique par défaut : six règles, de la moins chère à la plus chère.
 *
 * Implémente {@link IPasswordBlocklist} — donc remplaçable par l'application,
 * et composable (une implémentation maison peut l'appeler avant sa propre source).
 */
export class PasswordPolicy implements IPasswordBlocklist {
  readonly options: Required<IPasswordPolicyOptions>;

  /** Empreintes décodées — `null` tant qu'aucun contrôle n'en a eu besoin. */
  #commonHashes: Uint32Array | null = null;

  /** Valeurs refusées en propre, repliées en minuscules — lazy, comme le reste. */
  #denied: Set<string> | null = null;

  /**
   * @param options - réglages ; chaque clé absente prend le défaut sain.
   */
  constructor(options: IPasswordPolicyOptions = {}) {
    this.options = { ...DEFAULT_PASSWORD_POLICY, ...options };
  }

  /**
   * La règle enfreinte, ou `null` si le mot de passe est accepté.
   *
   * Le texte rendu nomme la règle SANS jamais citer le mot de passe : il finit
   * dans un message d'erreur, donc potentiellement dans un journal.
   *
   * @param plain - mot de passe candidat.
   * @param subject - ce qu'on sait du compte (son identifiant).
   * @returns la règle enfreinte, en français, ou `null`.
   */
  async violation(
    plain: string,
    subject: IPasswordSubjectHint = {},
  ): Promise<string | null> {
    if (plain.length < this.options.minLength) {
      return `trop court — ${this.options.minLength} caractères au minimum`;
    }
    const identifier = subject.identifier;
    if (identifier != null && identifier.length > 0) {
      const lower = plain.toLowerCase();
      const name = localPart(identifier).toLowerCase();
      if (
        lower === identifier.toLowerCase() ||
        (name.length >= MIN_IDENTIFIER_FRAGMENT && lower.includes(name))
      ) {
        return "contient l'identifiant du compte";
      }
    }
    if (isRepeatedPattern(plain)) {
      return "répète un même motif de bout en bout";
    }
    if (containsKeyboardRun(plain)) {
      return "contient une suite de touches ou de chiffres";
    }
    if (this.#deniedValues().has(plain.toLowerCase())) {
      return "figure dans la liste interdite de cette application";
    }
    if (this.options.checkCommonPasswords && (await this.#isCommon(plain))) {
      return "figure parmi les mots de passe les plus courants";
    }
    return null;
  }

  /**
   * Le mot de passe doit-il être refusé ?
   *
   * Même règle, même code que {@link violation} — une seule implémentation, deux
   * portes : le contrat ne demande qu'un booléen, l'appelant qui veut expliquer
   * prend l'autre.
   *
   * @param plain - mot de passe candidat.
   * @param subject - ce qu'on sait du compte.
   */
  async isBlocked(
    plain: string,
    subject: IPasswordSubjectHint = {},
  ): Promise<boolean> {
    return (await this.violation(plain, subject)) !== null;
  }

  /** Valeurs refusées en propre — config + fichier, lus une seule fois. */
  #deniedValues(): Set<string> {
    if (this.#denied !== null) return this.#denied;
    const denied = new Set<string>();
    for (const value of this.options.blocklist) {
      if (value.length > 0) denied.add(value.toLowerCase());
    }
    const file = this.options.blocklistFile;
    if (file != null && file.length > 0) {
      // Fail-loud : une politique qu'on croit en place et qui n'a rien lu est
      // pire qu'une politique absente. L'erreur remonte telle quelle.
      for (const line of readFileSync(file, "utf8").split("\n")) {
        const value = line.replace(/\r$/, "");
        if (value.length > 0) denied.add(value.toLowerCase());
      }
    }
    this.#denied = denied;
    return denied;
  }

  /** Recherche binaire dans les empreintes triées (chargées au premier appel). */
  async #isCommon(plain: string): Promise<boolean> {
    if (this.#commonHashes === null) {
      const { COMMON_PASSWORD_HASHES_BASE64, COMMON_PASSWORD_HASH_COUNT } =
        await import("./commonPasswordHashes");
      const bytes = Buffer.from(COMMON_PASSWORD_HASHES_BASE64, "base64");
      const hashes = new Uint32Array(COMMON_PASSWORD_HASH_COUNT);
      for (let index = 0; index < hashes.length; index += 1) {
        hashes[index] = bytes.readUInt32BE(index * 4);
      }
      this.#commonHashes = hashes;
    }
    const needle = truncatedPasswordHash(plain);
    const hashes = this.#commonHashes;
    let low = 0;
    let high = hashes.length - 1;
    while (low <= high) {
      const middle = (low + high) >>> 1;
      const value = hashes[middle];
      if (value === needle) return true;
      if (value < needle) low = middle + 1;
      else high = middle - 1;
    }
    return false;
  }
}
