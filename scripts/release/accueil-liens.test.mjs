/**
 * Le README du dépôt envoie vers la documentation PUBLIÉE, jamais vers un `.md`.
 *
 * Sur GitHub, un lien relatif `docs/…/x.md` ouvre le fichier source brut — avec
 * son frontmatter, sans navigation — au lieu de la page du site. Sur la page
 * d'accueil du site, `readme-html.mjs` le replie sur `./docs/`, la racine de la
 * documentation : le lecteur perd la page visée dans les deux cas. Vécu : le lien
 * vers `docs/performance/` du paragraphe des mesures.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RACINE = path.resolve(import.meta.dirname, "../..");

/**
 * Les cibles de liens Markdown relatives vers un `.md` d'un dossier `docs/` —
 * ceux que le site publie. Un fichier racine (`AGENTS.md`, `SECURITY.md`) n'a
 * pas de page sur le site : GitHub l'affiche, le lien relatif y est juste.
 *
 * @param {string} texte - le Markdown à lire.
 * @returns {string[]} les cibles fautives, dans l'ordre du texte.
 */
export function liensMdRelatifs(texte) {
  const fautifs = [];
  for (const [, cible] of texte.matchAll(/\]\(([^)\s]+)\)/g)) {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(cible)) continue;
    if (/(?:^|\/)docs\/.*\.md(?:#.*)?$/i.test(cible)) fautifs.push(cible);
  }
  return fautifs;
}

describe("README du dépôt — liens vers la documentation publiée", () => {
  it("repère un lien relatif vers un .md, et laisse passer URL et ancre", () => {
    expect(
      liensMdRelatifs(
        "[a](docs/x.md) [b](https://site/x.md) [c](#ancre) [d](SECURITY.md) " +
          "[e](src/nodefony/docs/y.md#t)",
      ),
    ).toEqual(["docs/x.md", "src/nodefony/docs/y.md#t"]);
  });

  it("le README racine ne lie aucune page de docs/ par son .md", () => {
    const readme = readFileSync(path.join(RACINE, "README.md"), "utf8");
    expect(liensMdRelatifs(readme)).toEqual([]);
  });
});
