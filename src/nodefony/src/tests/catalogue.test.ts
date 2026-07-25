import { describe, it } from "vitest";
import { assert } from "chai";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Gate anti-dérive du CATALOGUE des modules (`docs/catalogue.md`).
 *
 * Le catalogue répond à la question qu'un développeur — ou un agent — se pose
 * avant d'écrire du code : quel paquet installer pour ce besoin. Il est ÉCRIT à
 * la main, parce que « quand le prendre / quand ne pas le prendre » est un
 * arbitrage éditorial qu'aucun `package.json` ne contient (les descriptions npm
 * du dépôt vont de la phrase complète au laconique « nodefony http »).
 *
 * Ce qui est écrit à la main se périme en silence : un paquet ajouté au
 * monorepo n'y entre pas tout seul, et un paquet retiré y reste. D'où ce gate,
 * qui mord dans les DEUX sens — même geste que la table des entités réservées
 * du scaffold, tenue honnête par une confrontation au réel.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(here, "..", "..");
const REPO = path.resolve(CORE, "..", "..");
const CATALOGUE = path.join(CORE, "docs", "catalogue.md");

/** Paquets `@nodefony/*` du monorepo destinés à être PUBLIÉS (hors `private`). */
function publishablePackages(): string[] {
  const dir = path.join(REPO, "src", "packages", "@nodefony");
  const names: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = path.join(dir, entry.name, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8")) as {
      name?: string;
      private?: boolean;
    };
    if (pkg.private === true || !pkg.name) continue;
    names.push(pkg.name);
  }
  return names.sort();
}

describe("catalogue des modules (anti-dérive docs ↔ monorepo)", () => {
  it("est publié avec le cœur — sinon aucune app ne peut le lire", () => {
    const pkg = JSON.parse(
      readFileSync(path.join(CORE, "package.json"), "utf8"),
    ) as { files?: string[] };
    assert.include(
      pkg.files ?? [],
      "docs",
      "`docs` doit rester dans `files` : sans lui, `node_modules/nodefony/docs/catalogue.md` n'existe pas chez l'utilisateur",
    );
    assert.isTrue(existsSync(CATALOGUE), "docs/catalogue.md est introuvable");
  });

  it("cite CHAQUE paquet publiable du monorepo", () => {
    const text = readFileSync(CATALOGUE, "utf8");
    const missing = publishablePackages().filter(
      (name) => !text.includes(name),
    );
    assert.deepEqual(
      missing,
      [],
      `paquets publiables absents du catalogue (un module qu'on ne sait pas trouver n'existe pas) :\n${missing.join("\n")}`,
    );
  });

  it("ne cite AUCUN paquet qui n'existe plus", () => {
    // Deux exclusions, pour la MÊME raison : `@nodefony/core` est le nom du
    // WORKSPACE du cœur, qui se publie sous `nodefony`. Il apparaît légitimement
    // dans le frontmatter (`module:`) et dans les libellés de navigation
    // (« Cœur — @nodefony/core »), conformes aux autres pages du cœur.
    //
    // On ne retire que ça : une phrase de PROSE qui dirait « installe
    // @nodefony/core » reste fautive et doit continuer de faire rougir ce test —
    // c'est précisément la confusion que le catalogue existe pour épargner à son
    // lecteur. Les titres des cards ne sont pas des liens markdown : ils restent
    // scannés, donc un module retiré du dépôt fait tomber sa card.
    const raw = readFileSync(CATALOGUE, "utf8");
    const body = raw.startsWith("---")
      ? raw.slice(raw.indexOf("\n---", 3) + 4)
      : raw;
    const text = body.replace(/\[[^\]]*\]\([^)]*\)/gu, "");
    const known = new Set(publishablePackages());
    const cited = new Set(
      [...text.matchAll(/@nodefony\/[a-z0-9-]+/gu)].map((m) => m[0]),
    );
    const ghosts = [...cited].filter((name) => !known.has(name)).sort();
    assert.deepEqual(
      ghosts,
      [],
      `paquets cités par le catalogue mais absents du monorepo :\n${ghosts.join("\n")}`,
    );
  });
});
