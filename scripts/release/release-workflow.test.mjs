/**
 * Le déclencheur de la publication ne porte aucune majeure écrite en dur (#796).
 *
 * `release.yml` se déclenche sur le push d'une étiquette. Écrit `v10.*`, le
 * filtre aurait laissé `v11.0.0` posée sans RIEN publier — un défaut qui ne se
 * voit que le jour de la 11, au pire moment. La garde lit le filtre du fichier
 * et le juge avec la sémantique des motifs GitHub (`*`, `+`, `[…]`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const WORKFLOW = path.join(
  import.meta.dirname,
  "..",
  "..",
  ".github",
  "workflows",
  "release.yml",
);

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
