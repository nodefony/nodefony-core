/**
 * Le déclencheur de la publication ne porte aucune majeure écrite en dur (#796).
 *
 * `release.yml` se déclenche sur le push d'une étiquette. Écrit `v10.*`, le
 * filtre aurait laissé `v11.0.0` posée sans RIEN publier — un défaut qui ne se
 * voit que le jour de la 11, au pire moment. La garde lit le filtre du fichier
 * et le juge avec la sémantique des motifs GitHub (`*`, `+`, `[…]`).
 *
 * Et la CI ne tourne qu’UNE fois par sha publié : aucun workflow de CI ne se
 * déclenche sur un push vers `main`, qui ne reçoit que des commits déjà poussés.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const WORKFLOWS = path.join(
  import.meta.dirname,
  "..",
  "..",
  ".github",
  "workflows",
);
const WORKFLOW = path.join(WORKFLOWS, "release.yml");

/**
 * Traduit un motif de filtre GitHub en expression rationnelle — le sous-ensemble
 * employé ici : `*` (tout sauf `/`), `+` (une ou plusieurs fois le caractère ou
 * la classe qui précède), `[…]` (classe), le reste littéral.
 *
 * @param {string} pattern
 * @returns {RegExp}
 */
function githubFilter(pattern) {
  let re = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") re += "[^/]*";
    else if (c === "+") re += "+";
    else if (c === "[") {
      const end = pattern.indexOf("]", i);
      re += pattern.slice(i, end + 1);
      i = end;
    } else re += c.replace(/[.\\^$|?(){}]/gu, "\\$&");
  }
  return new RegExp(`^${re}$`, "u");
}

/** Les motifs `tags:` du déclencheur `push`. */
function tagFilters() {
  const yml = readFileSync(WORKFLOW, "utf8");
  const m = /^ {2}push:\n(?:\s*#.*\n)*\s*tags:\s*\[(.*)\]\s*$/mu.exec(yml);
  if (!m)
    throw new Error("déclencheur `push.tags` introuvable dans release.yml");
  return [...m[1].matchAll(/"([^"]+)"/gu)].map((x) => githubFilter(x[1]));
}

describe("release.yml — le tag de TOUTE majeure déclenche la publication", () => {
  const matches = (tag) => tagFilters().some((re) => re.test(tag));

  it("la 10, la 11 et au-delà, préversions comprises", () => {
    for (const tag of [
      "v10.0.1",
      "v10.1.0-beta.2",
      "v11.0.0",
      "v11.0.0-alpha.1",
      "v12.3.4",
    ])
      expect(matches(tag), tag).toBe(true);
  });

  it("ni les étiquettes du dépôt historique (v7), ni ce qui n'est pas une version", () => {
    for (const tag of ["v7.0.2", "v9.9.9", "latest", "10.0.1"])
      expect(matches(tag), tag).toBe(false);
  });
});

/**
 * Les workflows poussés sur `main` À DESSEIN, et pourquoi. Aucun ne juge du
 * code : la garde de publication (`attendre-ci.mjs`) les tient pour non
 * bloquants ou ne les voit pas.
 */
const MAIN_PUSH_ALLOWED = new Map([
  ["pages.yml", "publie le site public depuis la version servie"],
  ["soak.yml", "mesure longue, filtrée sur ses propres fichiers"],
]);

/** Les branches du déclencheur `push` de chaque workflow qui en a un. */
function pushBranches() {
  const out = [];
  for (const file of readdirSync(WORKFLOWS)) {
    if (!file.endsWith(".yml")) continue;
    const on = parse(readFileSync(path.join(WORKFLOWS, file), "utf8")).on;
    const branches = on?.push?.branches;
    if (Array.isArray(branches)) out.push({ file, branches });
  }
  return out;
}

describe("une seule CI par sha — rien ne rejoue la CI sur main (#796)", () => {
  // `--promouvoir` pousse le MÊME commit sur `main` et sur la branche d'où l'on
  // publie, en une poussée atomique (`release-core.mjs#planDePromotion`). Une CI
  // sur les deux rejouait ~35 min de travail identique, et `attendre-ci.mjs`,
  // qui juge toutes les exécutions du sha, bloquait la publication sur un rouge
  // de hasard d'un côté alors que l'autre était vert.
  it("aucun workflow de CI ne se déclenche sur un push vers main", () => {
    const offenders = pushBranches()
      .filter(
        ({ file, branches }) =>
          branches.includes("main") && !MAIN_PUSH_ALLOWED.has(file),
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it("chaque workflow de CI poussé couvre dev ET release/** — sinon le sha publié n'aurait aucune CI", () => {
    const missing = pushBranches()
      .filter(({ file }) => !MAIN_PUSH_ALLOWED.has(file))
      .filter(
        ({ branches }) =>
          !branches.includes("dev") || !branches.includes("release/**"),
      )
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });
});
