/**
 * Binaire tiers ÉPINGLÉ : téléchargé une fois, refusé si sa somme diffère de
 * celle FIGÉE par l'appelant, extrait à chaque usage depuis l'archive vérifiée.
 *
 * Seule implémentation du geste pour les bancs de conformité qui pilotent un
 * exécutable publié (connectconformance, suite HTTP/2) : les recopier
 * laisserait l'une des copies perdre sa vérification sans que l'autre le dise.
 *
 * @usage import { ensurePinnedBinary, probeExecutable } from "../lib/pinned-binary.mjs"
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Empreinte SHA-256 d'une suite d'octets, en hexadécimal.
 *
 * @param {Uint8Array} bytes - octets à hacher
 * @returns {string} empreinte hexadécimale (64 caractères)
 */
export function sha256Hex(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Refuse des octets dont l'empreinte diffère de celle FIGÉE.
 *
 * @param {string} name - nom de l'archive, repris dans le message
 * @param {Uint8Array} bytes - octets reçus ou relus du cache
 * @param {string} expected - empreinte figée par l'appelant
 * @throws {Error} quand les empreintes diffèrent
 */
export function assertSha256(name, bytes, expected) {
  const actual = sha256Hex(bytes);
  if (actual !== expected) {
    throw new Error(
      `${name} : SHA-256 ${actual} ≠ ${expected} figé — binaire refusé`,
    );
  }
}

/** Pauses avant chaque nouvel essai d'un téléchargement, en millisecondes. */
const RETRY_DELAYS_MS = [1_000, 4_000];

/**
 * Télécharge une URL en entier, en réessayant une panne de réseau ou une
 * erreur 5xx : un hoquet du serveur de releases ne doit pas rougir une CI dont
 * le rouge coûte une instruction. Un 4xx est définitif (l'archive n'existe pas).
 *
 * @param {string} url - adresse de l'archive
 * @returns {Promise<Uint8Array>} corps de la réponse
 * @throws {Error} 4xx, ou échec après le dernier essai
 */
async function download(url) {
  for (let attempt = 0; ; attempt++) {
    let failure;
    try {
      const res = await fetch(url);
      if (res.ok) return new Uint8Array(await res.arrayBuffer());
      failure = new Error(`${url} : HTTP ${res.status}`);
      if (res.status < 500) throw failure;
    } catch (e) {
      if (e === failure) throw e;
      failure = e;
    }
    const delay = RETRY_DELAYS_MS[attempt];
    if (delay === undefined) throw failure;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
}

/**
 * Rend le chemin d'un binaire épinglé, prêt à lancer.
 *
 * L'archive est vérifiée à CHAQUE appel, qu'elle vienne du réseau ou du cache,
 * puis extraite à nouveau : le binaire lancé est toujours celui de l'archive
 * vérifiée, jamais un fichier du cache modifié depuis.
 *
 * @param {object} spec - description du binaire
 * @param {string} spec.url - adresse de l'archive publiée
 * @param {string} spec.archive - nom de l'archive dans le cache
 * @param {string} spec.sha256 - empreinte FIGÉE dans le script appelant (jamais
 *   lue à côté de l'archive : qui altère l'une altère l'autre)
 * @param {string} spec.bin - chemin du binaire relatif au cache, après extraction
 * @param {string} spec.cacheDir - dossier du cache (créé au besoin)
 * @param {(url: string) => Promise<Uint8Array>} [spec.fetchBytes] - transport,
 *   injecté par les tests
 * @returns {Promise<string>} chemin absolu du binaire extrait
 * @throws {Error} somme différente, téléchargement ou extraction en échec
 */
export async function ensurePinnedBinary({
  url,
  archive,
  sha256,
  bin,
  cacheDir,
  fetchBytes = download,
}) {
  const archivePath = path.join(cacheDir, archive);
  const binPath = path.join(cacheDir, bin);
  // Lire PUIS constater l'absence (ENOENT), jamais tester puis lire : entre le
  // test et la lecture, un autre processus peut poser ou retirer l'archive.
  let cached = null;
  try {
    cached = readFileSync(archivePath);
  } catch (e) {
    if (!(e instanceof Error && "code" in e && e.code === "ENOENT")) throw e;
  }
  if (cached !== null) {
    try {
      assertSha256(archive, cached, sha256);
    } catch (e) {
      throw new Error(
        `${e instanceof Error ? e.message : String(e)} (archive du cache ${cacheDir} : la supprimer pour la retélécharger)`,
        { cause: e },
      );
    }
  } else {
    const bytes = await fetchBytes(url);
    assertSha256(archive, bytes, sha256);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(archivePath, bytes);
  }
  // `tar` lit .tar.gz ET .zip sur les trois plateformes (bsdtar sous
  // Windows 10+) : la capacité se CONSTATE, à l'extraction même.
  const tar = spawnSync("tar", ["-xf", archivePath, "-C", cacheDir], {
    stdio: ["ignore", "ignore", "pipe"],
    encoding: "utf8",
  });
  if (tar.error !== undefined || tar.status !== 0 || !existsSync(binPath)) {
    throw new Error(
      `extraction de ${archive} impossible (tar absent ou en échec${tar.stderr ? ` : ${tar.stderr.trim()}` : ""}) — ` +
        `l'extraire à la main dans ${cacheDir}`,
    );
  }
  return binPath;
}

/**
 * Constate qu'un binaire S'EXÉCUTE ici, en le lançant — jamais déduit de
 * `process.platform` ou de l'architecture (un exécutable amd64 tourne sur un
 * Mac Apple Silicon avec Rosetta, pas sans).
 *
 * @param {string} binPath - exécutable à éprouver
 * @param {readonly string[]} args - arguments d'un appel sans effet (`--version`)
 * @returns {{ supported: true, output: string } | { supported: false, reason: string }}
 *   le constat, et sa raison quand il est négatif
 */
export function probeExecutable(binPath, args) {
  const run = spawnSync(binPath, args, { encoding: "utf8", timeout: 10_000 });
  if (run.error !== undefined) {
    const code = "code" in run.error ? run.error.code : undefined;
    return {
      supported: false,
      reason: typeof code === "string" ? code : run.error.message,
    };
  }
  if (run.status !== 0) {
    return {
      supported: false,
      reason:
        run.status === null
          ? `interrompu (${run.signal ?? "signal inconnu"})`
          : `code de sortie ${run.status}`,
    };
  }
  return { supported: true, output: `${run.stdout}${run.stderr}`.trim() };
}
