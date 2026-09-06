/**
 * **Le geste que l'on tape doit dire la vérité.**
 *
 * `tsgo --noEmit` dans le cœur rendait un vert qui ne prouvait rien sur les
 * tests : `tsconfig.json` les EXCLUAIT, et rien ne le disait au moment où l'on
 * lançait la commande. Trois tests appelant une méthode retirée le jour même
 * sont restés verts jusqu'à ce qu'un autre contrôle les trouve. Le défaut
 * n'était pas dans la forge — `npm run typecheck` couvrait — mais dans le fait
 * qu'un vert PARTIEL est indiscernable d'un vert complet, pour un humain comme
 * pour un agent, exactement au moment où l'on cherche à se rassurer.
 *
 * La strictitude est donc INVERSÉE : le projet par défaut couvre tout, et c'est
 * la restriction qui porte un nom (`tsconfig.src.json`). Ces cas gardent
 * l'inversion — remettre `src/tests` dans l'exclusion du projet par défaut fait
 * tomber le premier, et retirer la garde de code mort fait tomber le deuxième.
 *
 * Ils ne remplacent pas le typecheck : ils empêchent qu'on lui retire les yeux.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** Un `tsconfig` du cœur, lu tel qu'il est sur le disque. */
const lire = (nom: string): Record<string, never> =>
  JSON.parse(readFileSync(path.join(RACINE, nom), "utf8"));

/** Vrai si la liste d'exclusion écarte les tests, quelle que soit sa forme. */
const ecarteLesTests = (exclude: unknown): boolean =>
  Array.isArray(exclude) &&
  exclude.some((e) => typeof e === "string" && e.includes("src/tests"));

describe("typecheck du cœur — le geste spontané couvre les tests", () => {
  it("⭐ `tsconfig.json` n'écarte PAS `src/tests` — sinon `tsgo --noEmit` ment", () => {
    assert.isFalse(
      ecarteLesTests(lire("tsconfig.json").exclude),
      "le projet par défaut doit voir les tests : c'est lui que l'on tape sans y penser",
    );
  });

  it("la garde de code mort n'est pas perdue : `tsconfig.src.json` la porte", () => {
    const src = lire("tsconfig.src.json") as {
      exclude?: unknown;
      compilerOptions?: { noUnusedLocals?: unknown; types?: unknown };
    };
    assert.isTrue(
      ecarteLesTests(src.exclude),
      "la restriction de production écarte les tests",
    );
    assert.strictEqual(
      src.compilerOptions?.noUnusedLocals,
      true,
      "un local mort en production doit encore être refusé quelque part",
    );
    assert.deepStrictEqual(
      src.compilerOptions?.types,
      ["node"],
      "la production ne voit pas les globals du banc d'essai",
    );
  });

  it("et la chaîne la LANCE — une garde qu'aucun script n'appelle ne garde rien", () => {
    const scripts = (
      lire("package.json") as unknown as { scripts: Record<string, string> }
    ).scripts;
    assert.include(scripts.typecheck, "-p tsconfig.src.json");
  });

  it("🔴 `tsconfig.declarations.json` écarte les tests — sans quoi 170 `.d.ts` de bancs partent dans `dist/types`", () => {
    // Mesuré en retirant cette exclusion : 170 fichiers émis et un build en
    // erreur. Elle était portée par l'héritage du projet par défaut ; l'ouvrir
    // aux tests la lui a retirée sans un mot.
    assert.isTrue(ecarteLesTests(lire("tsconfig.declarations.json").exclude));
  });
});
