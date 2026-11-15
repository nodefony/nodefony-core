// Suite de conformité HTTP/2 contre le serveur de DÉVELOPPEMENT (#778) :
// h2spec, 146 cas boîte noire rejoués sur 5153 (h2c, en clair) puis 5152 (TLS).
//
// h2spec est l'outil que se sont donné les implémentations (hyperium/h2, Netty,
// H2O le jouent en CI) — pas une suite de l'IETF, qui n'en publie aucune. Il a
// été écrit pour RFC 7540 (sa numérotation) et RFC 7541 (HPACK) ; RFC 9113 a
// remplacé RFC 7540 depuis. Un échec ne se déclare donc qu'après confrontation
// au texte de RFC 9113 : défaut de Node, défaut à nous, ou issue conforme que
// l'outil ne reconnaît pas.
//
// Décor : le serveur de dev démarré (skill `nodefony-start-server`).
//
// Usage : node src/modules/test/conformance/http2.mjs [--target h2c|tls] [section…]
//   ex.   node src/modules/test/conformance/http2.mjs
//         node src/modules/test/conformance/http2.mjs --target tls http2/6.1
//
// Verdict : les échecs CONNUS sont déclarés dans `http2-known-failing.txt`,
// ainsi que les cas INDÉTERMINÉS (deux issues conformes, l'outil n'en voit
// qu'une selon une course). Sortie 0 = aucun écart ; 1 = un échec non déclaré, un connu qui passe, ou un
// connu introuvable ; 78 = décor absent ou binaire non exécutable ICI (verdict
// nommé, jamais un succès).
//
// Le binaire OFFICIEL (release GitHub, amd64 seulement) est téléchargé une
// fois dans `node_modules/.cache/`, et refusé si sa somme diffère de celle
// figée ci-dessous. Ni Go, ni Docker.
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  judge,
  parseJUnit,
  parseKnownFailing,
} from "../../../../scripts/lib/conformance-verdict.mjs";
import {
  ensurePinnedBinary,
  probeExecutable,
} from "../../../../scripts/lib/pinned-binary.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/repo-root.mjs";
import { assertDevServer } from "./devServer.mjs";

/** @typedef {import("../../../../scripts/lib/conformance-verdict.mjs").KnownCase} KnownCase */

const VERSION = "v2.6.0";
/**
 * SHA-256 de chaque archive de `VERSION`. La release n'en publie AUCUNE : ces
 * sommes ont été calculées au premier téléchargement (#778), après contrôle de
 * provenance — archives déposées par le mainteneur à la publication
 * (2020-08-04) et jamais remplacées, binaires portant `main.COMMIT` = commit du
 * tag (70ac2294). Figées ici, elles refusent toute archive servie depuis qui
 * différerait. Changer `VERSION` = refaire ce contrôle.
 */
const SHA256 = {
  "h2spec_darwin_amd64.tar.gz":
    "981cb9f90a6f5e36300063022bd4eb7438d3dcf66d63a146a8541359697d1601",
  "h2spec_linux_amd64.tar.gz":
    "157ee0de702e01ad40e752dbf074b366027e550c8e7504f9450da2809e279318",
  "h2spec_windows_amd64.zip":
    "57b608578bd9c8c3b6b821c2ab64925a6caee16185b356fff611a7a86fe8e697",
};
/** Archive par système : amd64 seulement — Rosetta ou émulation ailleurs, constatée. */
const ARCHIVES = {
  darwin: "h2spec_darwin_amd64.tar.gz",
  linux: "h2spec_linux_amd64.tar.gz",
  win32: "h2spec_windows_amd64.zip",
};
/** Les deux portes HTTP/2 du serveur de dev. */
const TARGETS = [
  { name: "h2c", port: 5153, tls: false },
  { name: "tls", port: 5152, tls: true },
];
/** Délai par cas, en secondes : celui du passage de référence (#778). */
const CASE_TIMEOUT = "5";

const here = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = path.join(
  REPO_ROOT,
  "node_modules",
  ".cache",
  "h2spec",
  VERSION,
);
const runsDir = path.join(REPO_ROOT, "tmp", "runs");

/**
 * Lit la ligne de commande : `--target` et des filtres de SECTION.
 *
 * @param {readonly string[]} argv - arguments après le script
 * @returns {{ targets: typeof TARGETS, sections: string[] }} cibles et filtres
 * @throws {Error} cible inconnue, ou filtre par cas (inexprimable)
 */
function readArgs(argv) {
  let targets = TARGETS;
  const sections = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--target") {
      const name = argv[++i];
      targets = TARGETS.filter((t) => t.name === name);
      if (targets.length === 0) {
        throw new Error(`--target ${name ?? "(vide)"} : h2c ou tls`);
      }
      continue;
    }
    // Le rapport JUnit ne porte pas le numéro d'un cas : il se déduit de sa
    // POSITION dans la suite, que fausserait un filtre qui écarte ses voisins.
    if (arg.split("/").length > 2) {
      throw new Error(
        `${arg} : filtre par cas impossible (le rapport ne numérote pas les cas) — filtrer par section, ex. ${arg.split("/").slice(0, 2).join("/")}`,
      );
    }
    sections.push(arg);
  }
  return { targets, sections };
}

/**
 * Le binaire, téléchargé, vérifié, puis ÉPROUVÉ sur cette machine.
 *
 * @returns {Promise<string>} chemin du binaire exécutable
 * @throws {Error} plateforme sans archive, ou binaire non exécutable ici
 */
async function ensureH2spec() {
  const platform = os.platform();
  const archive =
    platform === "darwin" || platform === "linux" || platform === "win32"
      ? ARCHIVES[platform]
      : undefined;
  if (archive === undefined) {
    throw new Error(`aucune archive publiée pour ${platform}/${os.arch()}`);
  }
  const bin = await ensurePinnedBinary({
    url: `https://github.com/summerwind/h2spec/releases/download/${VERSION}/${archive}`,
    archive,
    sha256: SHA256[archive],
    bin: platform === "win32" ? "h2spec.exe" : "h2spec",
    cacheDir,
  });
  const probe = probeExecutable(bin, ["--version"]);
  if (!probe.supported) {
    throw new Error(
      `NON EXÉCUTABLE sur cette plateforme (${platform}/${os.arch()}, binaire amd64 : ${probe.reason}) — conformité HTTP/2 non éprouvée ici`,
    );
  }
  return bin;
}

/**
 * Joue h2spec contre une cible ; sa sortie part dans un journal, son rapport
 * JUnit dans un fichier lu ensuite.
 *
 * @param {string} bin - binaire h2spec
 * @param {(typeof TARGETS)[number]} target - porte visée
 * @param {readonly string[]} sections - filtres de section
 * @returns {Promise<{ report: string, log: string, code: number | null }>}
 *   chemins produits et code de sortie
 */
function runTarget(bin, target, sections) {
  mkdirSync(runsDir, { recursive: true });
  const report = path.join(runsDir, `http2-conformance-${target.name}.xml`);
  const log = path.join(runsDir, `http2-conformance-${target.name}.log`);
  // Un rapport d'une passe précédente ne doit jamais être lu pour celle-ci.
  rmSync(report, { force: true });
  const args = [
    "-h",
    "127.0.0.1",
    "-p",
    String(target.port),
    "-o",
    CASE_TIMEOUT,
    "-j",
    report,
    ...(target.tls ? ["-t", "-k"] : []),
    ...sections,
  ];
  const fd = openSync(log, "w");
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", fd, fd] });
    child.once("error", (e) => {
      closeSync(fd);
      reject(e instanceof Error ? e : new Error(String(e)));
    });
    child.once("exit", (code) => {
      closeSync(fd);
      resolve({ report, log, code });
    });
  });
}

/**
 * Résultats identifiés `section/numéro`, comme h2spec les nomme : le numéro
 * d'un cas est sa position dans sa suite (`spec/spec.go`, `seq := i + 1`).
 *
 * @param {string} xml - rapport JUnit
 * @returns {import("../../../../scripts/lib/conformance-verdict.mjs").CaseResult[]}
 *   un résultat par cas
 */
function identify(xml) {
  return parseJUnit(xml).flatMap((suite) =>
    suite.cases.map((c, i) => ({ ...c, id: `${suite.package}/${i + 1}` })),
  );
}

/**
 * Échecs connus applicables à une cible : sans préfixe, ou préfixés par elle.
 *
 * @param {ReadonlyMap<string, KnownCase>} all - liste complète, préfixes compris
 * @param {string} target - `h2c` ou `tls`
 * @returns {Map<string, KnownCase>} cas déclarés par identifiant nu
 * @throws {Error} préfixe de transport inconnu
 */
function knownFor(all, target) {
  /** @type {Map<string, KnownCase>} */
  const known = new Map();
  for (const [key, declared] of all) {
    const colon = key.indexOf(":");
    const scope = colon === -1 ? null : key.slice(0, colon);
    if (scope !== null && !TARGETS.some((t) => t.name === scope)) {
      throw new Error(`échec connu « ${key} » : préfixe ${scope} inconnu`);
    }
    if (scope === null || scope === target) {
      known.set(colon === -1 ? key : key.slice(colon + 1), declared);
    }
  }
  return known;
}

/**
 * Texte d'un rapport rendu affichable : h2spec y recopie les octets bruts
 * d'une trame (`opaque_data` d'un PING), octets nuls compris.
 *
 * @param {string} text - détail d'un cas
 * @returns {string} texte sans caractère de contrôle hors saut de ligne
 */
function printable(text) {
  return text.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, "·");
}

try {
  const { targets, sections } = readArgs(process.argv.slice(2));
  const allKnown = parseKnownFailing(
    readFileSync(path.join(here, "http2-known-failing.txt"), "utf8"),
  );
  await assertDevServer();
  const bin = await ensureH2spec();
  let failed = false;
  for (const target of targets) {
    const known = knownFor(allKnown, target.name);
    const run = await runTarget(bin, target, sections);
    const head = `http2 ${target.name} (${target.port})`;
    if (!existsSync(run.report)) {
      // h2spec sort sans rapport quand il ne joint pas la cible.
      process.stdout.write(
        `${head} : AUCUN rapport (code ${run.code}) — journal ${run.log}\n`,
      );
      failed = true;
      continue;
    }
    const verdict = judge(identify(readFileSync(run.report, "utf8")), known, {
      partial: sections.length > 0,
    });
    process.stdout.write(
      `${head} : ${verdict.total} cas — ${verdict.passed} passés, ` +
        `${verdict.expected.length} échecs connus, ` +
        `${verdict.tolerated.length} indéterminés en échec, ${verdict.skipped} sautés` +
        ` — ${verdict.ok ? "conforme" : "ÉCART"}\n`,
    );
    for (const c of verdict.tolerated) {
      process.stdout.write(
        `  ~ indéterminé ${c.id} — ${known.get(c.id)?.reason ?? c.name}\n`,
      );
    }
    for (const c of verdict.unexpected) {
      process.stdout.write(
        `  ✗ inattendu ${c.id} — ${c.name}\n${printable(c.detail).replace(/^/gm, "      ")}\n`,
      );
    }
    for (const c of verdict.fixed) {
      process.stdout.write(
        `  ✓ connu qui PASSE ${c.id} — ${c.name} : le retirer de http2-known-failing.txt\n`,
      );
    }
    for (const c of verdict.missing) {
      process.stdout.write(
        `  ? connu introuvable ${c.id} (${c.reason}) : numérotation changée ?\n`,
      );
    }
    if (!verdict.ok) {
      process.stdout.write(`  rapport ${run.report} · journal ${run.log}\n`);
      failed = true;
    }
  }
  process.exitCode = failed ? 1 : 0;
} catch (e) {
  process.stderr.write(
    `conformité http2 : ${e instanceof Error ? e.message : String(e)}\n`,
  );
  // Décor, téléchargement, capacité, liste ou rapport illisible : aucun
  // verdict de conformité n'a été rendu.
  process.exitCode = 78;
}
