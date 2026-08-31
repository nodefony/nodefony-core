/**
 * Le favicon et le logo du bandeau sont la MÊME image — et le restent.
 *
 * Un `index.html` ne peut pas importer un module TypeScript : le logo officiel
 * vit donc en deux copies, l'une dans le composant qui l'affiche, l'autre dans la
 * page qui le déclare en favicon. Deux copies d'une même donnée divergent en
 * silence — celle qu'on regarde le moins (l'icône d'onglet) reste sur l'ancienne
 * image pendant des mois sans que personne le remarque.
 *
 * Ce cas est la source unique que le langage ne peut pas garantir ici.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(here, "..", "..", "..");

/** Le premier data-URI PNG d'un fichier, ou `null`. */
const dataUri = (rel: string): string | null => {
  const src = readFileSync(path.join(RACINE, ...rel.split("/")), "utf8");
  return /(data:image\/png;base64,[A-Za-z0-9+/=]+)/.exec(src)?.[1] ?? null;
};

describe("favicon de la console d'administration", () => {
  it("est exactement le logo officiel du bandeau", () => {
    const logo = dataUri("frontend/src/components/NodefonyLogo.tsx");
    const favicon = dataUri("frontend/index.html");
    expect(logo, "logo introuvable dans NodefonyLogo.tsx").toBeTruthy();
    expect(favicon, "favicon introuvable dans index.html").toBeTruthy();
    expect(favicon).toBe(logo);
  });

  it("est déclaré en PNG, pas laissé au flair du navigateur", () => {
    const html = readFileSync(
      path.join(RACINE, "frontend", "index.html"),
      "utf8",
    );
    expect(html).toMatch(/<link[^>]*rel="icon"[^>]*type="image\/png"/);
  });
});
