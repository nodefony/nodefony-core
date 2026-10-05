import { join } from "node:path";
import type * as Jose from "jose";
import type { JSONWebKeySet, JWK } from "jose";
import type {
  IJwtKeystore,
  IJwtSigningKey,
} from "../../contracts/IJwtKeystore";
import {
  createSecretExclusive,
  readIfPresent,
  messageNonRestreint,
  modeNonRestreintAsync,
} from "./secretFile";

/** Journalisation injectée (le keystore n'est pas un Service — il reçoit un log). */
type LogFn = (message: string, severity: string) => void;

/** Source de clé configurée (`config.jwt.keystore`). */
interface KeystoreSource {
  /** JWK Set (clés privées) injecté depuis l'env — source `env` (prod). */
  readonly keySetJson?: string | undefined;
  /** Dossier de persistance `keyset.json` — source `fichier` (opt-in dev/VPS). */
  readonly dir?: string | undefined;
}

/**
 * Dossiers que le `Dockerfile` généré EFFACE à l'étage de construction.
 *
 * La liste est ici parce que c'est ici qu'on s'en sert ; elle est tenue honnête
 * par le test qui la confronte au gabarit — deux copies d'une même règle
 * divergent en silence, et c'est une clé privée qui paierait la dérive.
 */
const CLEANED_DIRS = ["var", "tmp"];

/**
 * Le trousseau va-t-il partir dans l'image de conteneur ?
 *
 * ⭐ **Pourquoi cet avertissement existe.** Le trousseau est une clé privée
 * Ed25519. Elle ne sort pas de l'image aujourd'hui pour UNE seule raison : le
 * gabarit a choisi `var/keys`, et le `Dockerfile` généré efface `var/`. Rien
 * n'attache cette sécurité à la configuration — un utilisateur qui écrit
 * `keystore: { dir: "nodefony/config/keys" }`, chemin parfaitement raisonnable,
 * publie sa clé privée sans qu'aucun signal n'existe. C'est exactement le
 * chemin par lequel une clé TLS est déjà partie dans une image publiée.
 *
 * ⚠️ **Les chemins ABSOLUS ne sont pas jugés**, et c'est délibéré : `/etc/…` ou
 * un point de montage sont des choix d'exploitation qui sortent du contexte de
 * construction, et prétendre les évaluer ferait crier ce contrôle sur la
 * pratique la plus saine. Un contrôle qui crie faux apprend à passer outre.
 *
 * @param dir - la valeur de `jwt.keystore.dir`, telle que configurée.
 * @returns le message à journaliser, ou `null` quand le dossier est nettoyé.
 */
export function keystoreLeaksIntoImage(dir: string): string | null {
  // Normalisé en `/` avant de comparer : un filtre écrit en `/` ne mord pas sur
  // `var\keys`, et la faute serait alors INVISIBLE — l'avertissement
  // manquerait précisément sur la plateforme où on l'a oublié.
  const normalized = dir.replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (normalized.startsWith("/") || /^[A-Za-z]:/u.test(normalized)) return null;
  const [first = ""] = normalized.split("/");
  if (CLEANED_DIRS.includes(first)) return null;
  return (
    `JWT keystore: « ${dir} » n'est PAS sous ${CLEANED_DIRS.map((d) => `\`${d}/\``).join(" ni ")}, ` +
    `les seuls dossiers que le Dockerfile généré efface avant de fabriquer l'image. ` +
    `La clé privée de signature partira donc dans ton image de conteneur, où elle ` +
    `reste lisible par quiconque la télécharge — même effacée par une couche suivante. ` +
    `Deux issues : déplacer le dossier sous \`var/\` (ex. \`var/keys\`), ou injecter la ` +
    `clé par jwt.keystore.keySetJson depuis l'environnement, ce qui est la voie de production.`
  );
}

/** Clé telle que persistée : JWK privé (avec `d`) + métadonnées. */
export interface IStoredKey extends JWK {
  kid: string;
  alg: string;
  use?: string;
  createdAt?: number;
}

/** Forme du fichier `keyset.json` / de la variable d'env `keySetJson`. */
export interface IStoredKeySet {
  /** `kid` de la clé qui signe (les autres ne servent qu'à vérifier). */
  active: string;
  keys: IStoredKey[];
}

/**
 * Lit un jeu de clés sérialisé et en vérifie la FORME — la seule lecture du
 * dépôt, appelée par le keystore ET par la validation de configuration.
 *
 * Ne vérifie que la structure (`keys` non vide, un `kid` par clé) : importer
 * les clés exige `jose`, chargé paresseusement au premier jeton. Les messages
 * ne recopient JAMAIS la valeur reçue — elle porte une clé privée.
 *
 * @param json - le jeu de clés, tel que `NF_JWT_KEYSET` ou `keyset.json` le porte.
 * @returns le jeu de clés lu.
 * @throws Error si le JSON est illisible ou la structure incomplète.
 */
export function parseKeySet(json: string): IStoredKeySet {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("JwtKeystore: keyset JSON invalide");
  }
  const keyset = parsed as IStoredKeySet | null; // `JSON.parse("null")`
  if (
    !keyset ||
    !Array.isArray(keyset.keys) ||
    keyset.keys.length === 0 ||
    keyset.keys.some((k) => typeof k.kid !== "string")
  ) {
    throw new Error(
      "JwtKeystore: keyset malformé (champ `keys` non vide avec `kid` requis)",
    );
  }
  return keyset;
}

/** Génère une nouvelle paire Ed25519 (extractable pour persistance JWK). */
async function buildKeySet(jose: typeof Jose): Promise<IStoredKeySet> {
  const { publicKey, privateKey } = await jose.generateKeyPair("Ed25519", {
    extractable: true,
  });
  const publicJwk = await jose.exportJWK(publicKey);
  const kid = await jose.calculateJwkThumbprint(publicJwk, "sha256");
  const privateJwk = await jose.exportJWK(privateKey);
  return {
    active: kid,
    keys: [
      { ...privateJwk, kid, alg: "EdDSA", use: "sig", createdAt: Date.now() },
    ],
  };
}

/**
 * Génère un jeu de clés de signature à partager entre tous les process d'une
 * application — la valeur de `NF_JWT_KEYSET`.
 *
 * Même générateur que celui du keystore (une seule implémentation), sérialisé
 * en JSON COMPACT : une ligne, sans quote simple, qu'un `.env` porte entre
 * quotes simples et qu'un gestionnaire de secrets stocke tel quel.
 *
 * @returns le jeu de clés sérialisé — il contient la clé PRIVÉE.
 */
export async function generateKeySet(): Promise<string> {
  return JSON.stringify(await buildKeySet(await import("jose")));
}

/** Clé chargée en mémoire : privée pour signer, JWK public pour le JWKS. */
interface LoadedKey {
  kid: string;
  privateKey: CryptoKey;
  publicJwk: JWK;
  createdAt: number;
}

/**
 * Keystore Ed25519 — implémentation de référence d'{@link IJwtKeystore}.
 *
 * Résout la clé de signature selon une **priorité** (jamais d'auto-génération en
 * clair « par défaut » en prod) :
 *  1. **env** — `config.jwt.keystore.keySetJson` (JWK Set injecté par l'app depuis
 *     son catalogue d'env) : prod cloud, secret géré hors-app, même clé sur tous
 *     les pods.
 *  2. **fichier** — `config.jwt.keystore.dir/keyset.json` (écrit en mode 600,
 *     généré si absent) : opt-in dev/VPS mono-machine. Le mode effectif est
 *     **constaté** après coup : un système de fichiers qui n'applique pas les
 *     permissions POSIX (NTFS, FAT, NFS sans mapping) déclenche un **warning**
 *     plutôt qu'une garantie silencieusement fausse.
 *  3. **mémoire** — aucune source → clé éphémère générée au 1ᵉʳ usage + **warning**
 *     (perdue au redémarrage = refresh invalidés, incohérente en cluster).
 *
 * jose est importé **paresseusement** (dep lourde — règle perf P6) au premier
 * usage ; le boot ne paie rien si le JWT n'est jamais sollicité. Le chargement
 * est mémoïsé (une seule résolution concurrente).
 *
 * @remarks Plusieurs process qui servent la MÊME application doivent signer
 * avec la même clé, sinon un jeton signé par l'un est refusé par l'autre :
 * - **pods** (aucun disque partagé) → source `env` obligatoire, la même valeur
 *   injectée partout (`NF_JWT_KEYSET`, générée par `security:secrets`) ;
 * - **workers de `nodefony cluster`** → la source `env` est héritée au fork ; à
 *   défaut, la source `fichier` est sûre : la création de `keyset.json` est
 *   EXCLUSIVE ({@link createSecretExclusive}), un seul worker la génère et les
 *   autres relisent la sienne ;
 * - source `mémoire` → une clé par process, jamais cohérente.
 */
export class JwtKeystore implements IJwtKeystore {
  readonly #source: KeystoreSource;
  readonly #log: LogFn;
  #keys: LoadedKey[] = [];
  #activeKid = "";
  #ready: Promise<void> | null = null;

  constructor(source: KeystoreSource, log: LogFn) {
    this.#source = source;
    this.#log = log;
  }

  async getSigningKey(): Promise<IJwtSigningKey> {
    await this.#ensureLoaded();
    const active = this.#keys.find((k) => k.kid === this.#activeKid);
    if (!active) {
      throw new Error("JwtKeystore: aucune clé de signature active");
    }
    return { key: active.privateKey, kid: active.kid, alg: "EdDSA" };
  }

  async getPublicJWKS(): Promise<JSONWebKeySet> {
    await this.#ensureLoaded();
    return { keys: this.#keys.map((k) => k.publicJwk) };
  }

  /** Charge le keyset une seule fois (mémoïsation de la promesse). */
  #ensureLoaded(): Promise<void> {
    return (this.#ready ??= this.#load());
  }

  async #load(): Promise<void> {
    const jose = await import("jose");
    // 1. env (clé injectée par l'app) — prod.
    if (this.#source.keySetJson) {
      await this.#importKeyset(jose, parseKeySet(this.#source.keySetJson));
      return;
    }
    // 2. fichier — opt-in dev/VPS (généré si absent).
    if (this.#source.dir) {
      // AVANT toute écriture : si le dossier part dans l'image, le dire pendant
      // qu'il est encore temps de changer d'avis. Après, la clé existe.
      const risk = keystoreLeaksIntoImage(this.#source.dir);
      if (risk) this.#log(risk, "WARNING");
      const file = join(this.#source.dir, "keyset.json");
      const existing = await this.#readFile(file);
      if (existing) {
        await this.#checkRestricted(file);
        await this.#importKeyset(jose, parseKeySet(existing));
        return;
      }
      // Plusieurs process peuvent arriver ici ENSEMBLE (workers d'un cluster
      // au premier boot) : un seul crée le fichier, les autres relisent le sien.
      const keyset = await buildKeySet(jose);
      if (await createSecretExclusive(file, JSON.stringify(keyset))) {
        this.#log(
          `JWT keystore: clé Ed25519 générée et persistée (${file}).`,
          "INFO",
        );
        await this.#checkRestricted(file);
        await this.#importKeyset(jose, keyset);
        return;
      }
      const winner = await this.#readFile(file);
      if (winner === null) {
        throw new Error(
          `JwtKeystore: ${file} a disparu juste après sa création`,
        );
      }
      await this.#checkRestricted(file);
      await this.#importKeyset(jose, parseKeySet(winner));
      return;
    }
    // 3. mémoire — défaut dev jetable.
    this.#log(
      "JWT keystore: clé de signature ÉPHÉMÈRE en mémoire — perdue au redémarrage " +
        "(jetons en vol invalidés) et propre à CE process : derrière plusieurs pods ou " +
        "workers, un jeton signé par l'un est refusé par l'autre (401 au hasard). " +
        "Production : poser jwt.keystore.keySetJson depuis l'environnement (NF_JWT_KEYSET " +
        "dans une application générée — `npx nodefony security:secrets --jwt-keyset`). " +
        "Développement : jwt.keystore.dir.",
      "WARNING",
    );
    await this.#importKeyset(jose, await buildKeySet(jose));
  }

  /** Importe un keyset persisté : privée → `CryptoKey`, public → JWK sans `d`. */
  async #importKeyset(jose: typeof Jose, keyset: IStoredKeySet): Promise<void> {
    const loaded: LoadedKey[] = [];
    for (const stored of keyset.keys) {
      const imported = await jose.importJWK(stored, "Ed25519");
      if (!(imported instanceof CryptoKey)) {
        throw new Error(
          `JwtKeystore: clé asymétrique attendue pour le kid "${stored.kid}"`,
        );
      }
      // 🔴 Liste BLANCHE, pas liste noire. Retirer `d` suffisait tant que ce
      // JWKS restait interne ; depuis qu'il est PUBLIÉ
      // (`/.well-known/jwks.json`), un spread du keyset stocké fait sortir tout
      // ce qu'on y ajoutera un jour — `createdAt` fuyait ainsi l'âge des clés,
      // et le prochain champ interne suivrait sans que rien ne le signale.
      // Paramètres retenus : RFC 8037 §2 pour une clé OKP (`kty`/`crv`/`x`) +
      // les métadonnées JWK qui servent à la sélection (RFC 7517 §4).
      loaded.push({
        kid: stored.kid,
        privateKey: imported,
        publicJwk: {
          ...(stored.kty !== undefined && { kty: stored.kty }),
          ...(stored.crv !== undefined && { crv: stored.crv }),
          ...(stored.x !== undefined && { x: stored.x }),
          kid: stored.kid,
          use: "sig",
          alg: "EdDSA",
        },
        createdAt: stored.createdAt ?? Date.now(),
      });
    }
    const [firstKey] = loaded;
    if (firstKey === undefined) {
      throw new Error("JwtKeystore: keyset vide");
    }
    this.#keys = loaded;
    this.#activeKid =
      keyset.active && loaded.some((k) => k.kid === keyset.active)
        ? keyset.active
        : firstKey.kid;
  }

  /** Lit un fichier ; `null` si absent (ENOENT), relance toute autre erreur. */
  async #readFile(file: string): Promise<string | null> {
    return readIfPresent(file);
  }

  /**
   * Constate le mode EFFECTIF du fichier de clés et avertit s'il n'est pas 0600.
   *
   * Le mode demandé à l'écriture est une intention, pas une garantie : NTFS
   * (Windows) l'ignore, tout comme un montage FAT/exFAT ou NFS sans mapping
   * d'identité — sous Linux comme ailleurs. Le fichier porte la clé PRIVÉE :
   * si la restriction n'a pas pris, la confidentialité repose sur les droits du
   * dossier, ce qui doit être DIT plutôt que supposé. La capacité se constate,
   * elle ne se déduit pas de `process.platform`.
   *
   * Un `stat` par résolution de keystore (une fois par process, source fichier
   * uniquement) — hors hot-path.
   */
  async #checkRestricted(file: string): Promise<void> {
    const mode = await modeNonRestreintAsync(file);
    if (mode === null || mode === undefined) return;
    this.#log(
      `JWT keystore: ${messageNonRestreint(file, mode)} La clé PRIVÉE y ` +
        `réside : provisionnez-la plutôt hors-bande via jwt.keystore.keySetJson ` +
        `(recommandé en production).`,
      "WARNING",
    );
  }
}

export default JwtKeystore;
