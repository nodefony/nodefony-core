/**
 * **Le binaire `nodefony` n'embarque jamais le cœur.**
 *
 * `dist/bin/nodefony.js` est UN fichier : rolldown y recopie ce que
 * `src/bin/nodefony.ts` importe statiquement et qu'il ne sait pas élaguer. Le
 * cœur, lui, est chargé à part (`dist/node/`) une fois le projet résolu. Si le
 * module qui enregistre la copie du paquet (`Nodefony.ts`,
 * `registerPackageInstance`) entre dans le binaire, le process en compte DEUX
 * — et le démarrage en production le refuse (code 78) : rien ne démarre plus.
 *
 * Vécu : un import de VALEUR ajouté dans `kernel/checks/report.ts` (qui entre
 * dans le binaire) vers `live.ts` a tiré, par les imports à effets de bord de
 * ce dernier, `Nodefony.ts` tout entier. Seuls des tests qui démarrent un vrai
 * serveur l'ont vu.
 *
 * 🔴 La garde lit l'ARTEFACT, pas le source. Une fermeture d'imports calculée
 * sur le source crie à tort : rolldown élague les modules sans effet de bord
 * (`command/Command.ts` est atteint, et n'entre pas), et seule sa sortie dit
 * ce qui a réellement été recopié.
 */
import { assert } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CORE_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const BUNDLE = path.join(CORE_ROOT, "dist", "bin", "nodefony.js");

describe("binaire `nodefony` — ce que le bundle embarque", () => {
  it("🔴 le binaire construit n'embarque pas le cœur (`Nodefony.ts`)", () => {
    // Pas de saut silencieux : un binaire absent rend la garde muette, et un
    // banc muet compte comme vert.
    assert.isTrue(
      existsSync(BUNDLE),
      `${BUNDLE} absent — construire le cœur d'abord (npm run build)`,
    );
    const bundle = readFileSync(BUNDLE, "utf8");
    assert.notInclude(
      bundle,
      "//#region src/Nodefony.ts",
      "le binaire recopie Nodefony.ts : un import de VALEUR, depuis un module " +
        "du binaire, mène au cœur — le passer en `import type`, ou déplacer la " +
        "valeur dans un module sans import à effet de bord",
    );
    assert.notMatch(
      bundle,
      /\bregisterPackageInstance\(import\.meta\.url/u,
      "le binaire enregistre sa propre copie du paquet — le démarrage en " +
        "production verra deux copies et refusera (78)",
    );
  });
});
