#!/usr/bin/env node
/**
 * Récupère le DDL MySQL d'ORIGINE d'un logiciel libre réel — un fichier par
 * table (`*.sql`) et ses index et clés (`*.key.sql`) — dans un cache sous
 * `tmp/bench/corpus/<nom>/`.
 *
 * Clone SPARSE et sans blobs (quelques secondes) : on ne lit que le dossier du
 * schéma, jamais le dépôt entier.
 *
 * 🔴 **Licence** : un corpus tiers ne se versionne JAMAIS ici (le dépôt
 * Nodefony est sous Apache 2.0, le corpus `erp` sous GPLv3). Il se télécharge
 * à la demande, et `tmp/` est ignoré par git. Le premier générateur d'un tel
 * corpus vivait sous `/tmp` et s'est perdu : ce script, lui, vit dans le skill.
 *
 * Le commit lu est ÉPINGLÉ dans `source.json` à côté du cache : un verdict du
 * banc vaut pour un schéma précis, et une branche de développement bouge chaque
 * jour.
 *
 * Usage :
 *   node corpus-fetch.mjs                     # corpus `erp`, cache réutilisé
 *   node corpus-fetch.mjs --corpus erp        # un corpus du catalogue
 *   node corpus-fetch.mjs --refresh           # re-télécharge
 *   node corpus-fetch.mjs --ref <branche>     # une branche ou une étiquette
 *
 * Sorties : 0 cache prêt · 1 téléchargement impossible · 64 usage.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { garderDrapeaux } from "./lib/argv.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));

/** Racine du dépôt, trouvée en REMONTANT — un skill se déplace, un `..` compté se périme. */
function findRepoRoot(from) {
  let dir = from;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(path.join(dir, "src/nodefony/bin/nodefony"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("racine du dépôt Nodefony introuvable depuis " + from);
}

/**
 * Les corpus connus. Un nom GÉNÉRIQUE par corpus — c'est ce que portent les
 * fichiers, les décors et les rapports du banc ; l'origine n'est qu'une donnée.
 *
 * - `erp` : un progiciel de gestion libre, 421 tables nées sur MySQL — le
 *   volume, 44 longueurs de `varchar`, des montants `double(24,8)`, des
 *   horodatages `ON UPDATE`, des tables de liaison à clé composite.
 *
 * @type {Record<string, { upstream: string, ref: string, sparsePath: string, tablePrefix: string, license: string }>}
 */
export const CORPORA = {
  erp: {
    upstream: "https://github.com/Dolibarr/dolibarr.git",
    ref: "develop",
    sparsePath: "htdocs/install/mysql/tables",
    tablePrefix: "llx_",
    license: "GPL-3.0",
  },
};

/** Le cache d'un corpus — sous `tmp/bench/`, catégorie déclarée de `tmp/`. */
export function corpusCache(name) {
  return path.join(findRepoRoot(ICI), "tmp", "bench", "corpus", name);
}

/**
 * Dossier des fichiers DDL d'un corpus en cache, et le commit épinglé.
 *
 * @returns {{ dir: string, source: { corpus: string, ref: string, commit: string, fetchedAt: string } } | null}
 */
export function cachedCorpus(name = "erp") {
  const cache = corpusCache(name);
  const sourceFile = path.join(cache, "source.json");
  const dir = path.join(cache, "repo", ...CORPORA[name].sparsePath.split("/"));
  if (!existsSync(sourceFile) || !existsSync(dir)) return null;
  return { dir, source: JSON.parse(readFileSync(sourceFile, "utf8")) };
}

function git(args, cwd) {
  const res = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (res.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} → ${res.status}\n${res.stderr ?? ""}${res.stdout ?? ""}`,
    );
  }
  return res.stdout.trim();
}

/**
 * Télécharge un corpus (clone sparse sans blobs) et épingle le commit lu.
 *
 * @returns {{ dir: string, source: { corpus: string, ref: string, commit: string, fetchedAt: string } }}
 */
export function fetchCorpus({ name = "erp", ref } = {}) {
  const entry = CORPORA[name];
  const cache = corpusCache(name);
  const repo = path.join(cache, "repo");
  const wanted = ref ?? entry.ref;
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(cache, { recursive: true });
  git(
    [
      "clone",
      "--depth",
      "1",
      "--filter=blob:none",
      "--sparse",
      "--branch",
      wanted,
      entry.upstream,
      repo,
    ],
    cache,
  );
  git(["sparse-checkout", "set", "--no-cone", `/${entry.sparsePath}`], repo);
  const source = {
    corpus: name,
    ref: wanted,
    commit: git(["rev-parse", "HEAD"], repo),
    fetchedAt: new Date().toISOString(),
  };
  writeFileSync(
    path.join(cache, "source.json"),
    `${JSON.stringify(source, null, 2)}\n`,
  );
  const corpus = cachedCorpus(name);
  if (corpus === null) {
    throw new Error(
      `clone fait, mais ${entry.sparsePath} absent — l'amont a-t-il bougé ?`,
    );
  }
  return corpus;
}

function main() {
  const args = process.argv.slice(2);
  garderDrapeaux({
    args,
    connus: ["--corpus", "--refresh", "--ref"],
    aValeur: ["--corpus", "--ref"],
    usage: [
      "Récupère le DDL MySQL d'un logiciel libre réel dans tmp/bench/corpus/<nom>/ (jamais versionné).",
      "",
      `  node corpus-fetch.mjs --corpus <nom>   ${Object.keys(CORPORA).join(", ")} (défaut erp)`,
      "  node corpus-fetch.mjs --refresh        re-télécharge",
      "  node corpus-fetch.mjs --ref <r>        une branche ou une étiquette",
    ].join("\n"),
  });
  const valueOf = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const name = valueOf("--corpus") ?? "erp";
  if (!Object.hasOwn(CORPORA, name)) {
    process.stderr.write(
      `--corpus ${name} inconnu — connus : ${Object.keys(CORPORA).join(", ")}\n`,
    );
    process.exit(64);
  }
  let corpus = args.includes("--refresh") ? null : cachedCorpus(name);
  if (corpus === null) {
    try {
      corpus = fetchCorpus({ name, ref: valueOf("--ref") });
    } catch (error) {
      process.stderr.write(
        `${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(1);
    }
  }
  const files = readdirSync(corpus.dir);
  const keys = files.filter((f) => f.endsWith(".key.sql")).length;
  const tables = files.filter(
    (f) => f.endsWith(".sql") && !f.endsWith(".key.sql"),
  ).length;
  process.stdout.write(
    `corpus ${name} — ${corpus.source.ref} @ ${corpus.source.commit.slice(0, 12)} — ` +
      `${tables} tables, ${keys} fichiers de clés\n${corpus.dir}\n`,
  );
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main();
}
