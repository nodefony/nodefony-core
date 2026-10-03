/**
 * Le favicon et le logo du bandeau sont la MÊME image — celle du paquet
 * `nodefony`, importée une seule fois.
 *
 * Ils étaient deux data-URI recopiés (composant + `index.html`), tenus d'accord
 * par une comparaison de chaînes. Ils viennent désormais de la source unique
 * (`nodefony/assets/nodefony-logo.png`) : le bandeau l'importe, l'entrée pose le
 * favicon depuis la même valeur. Le gate du dépôt
 * (`src/nodefony/src/tests/brandAssets.test.ts`) refuse toute copie ailleurs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const RACINE = path.resolve(here, "..", "..", "..");
const lire = (...rel: string[]) =>
  readFileSync(path.join(RACINE, "frontend", ...rel), "utf8");

describe("favicon et logo de la console d'administration", () => {
  it("le bandeau importe le logo du paquet, sans copie", () => {
    const src = lire("src", "components", "NodefonyLogo.tsx");
    expect(src).toContain(
      'import logoUrl from "nodefony/assets/nodefony-logo.png";',
    );
    expect(src).not.toMatch(/data:image\//u);
  });

  it("le favicon est posé depuis la MÊME valeur, en PNG déclaré", () => {
    const main = lire("src", "main.tsx");
    expect(main).toContain(
      'import { NODEFONY_LOGO_URL } from "./components/NodefonyLogo";',
    );
    expect(main).toMatch(/\.rel = "icon"/u);
    expect(main).toMatch(/\.type = "image\/png"/u);
    expect(main).toMatch(/\.href = NODEFONY_LOGO_URL/u);
  });

  it("index.html ne porte plus d'image recopiée", () => {
    expect(lire("index.html")).not.toMatch(/data:image\//u);
  });
});
