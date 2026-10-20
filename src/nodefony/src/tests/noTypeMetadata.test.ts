/**
 * **Le framework ne lit jamais une métadonnée de TYPE émise par le compilateur.**
 *
 * `design:paramtypes`, `design:type` et `design:returntype` sont écrits par
 * l'émetteur (`emitDecoratorMetadata`) à partir des types TypeScript. Un type
 * importé par `import type`, ou dont le bundler a élidé l'import, y devient
 * `Object` : l'injecteur qui s'y fiait passait alors un argument faux à un
 * service, sans un mot — d'où une expression `Module;` posée dans les serveurs
 * pour empêcher l'élision. ADR-0018 : une dépendance se NOMME (`@Inject("nom")`),
 * le type ne décide plus rien.
 *
 * Ce contrôle refuse le retour d'une telle lecture : toute clé `"design:…"`
 * écrite dans le code du dépôt ou de ses gabarits. Les tests en sont exclus —
 * ils POSENT la métadonnée à la main pour prouver qu'elle est ignorée — ainsi
 * que les `frontend/` (le compilateur Angular exige la sienne, et la lit lui-même).
 */
import { describe, it } from "vitest";
import { assert } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Racine du dépôt — ce fichier vit dans `src/nodefony/src/tests/`. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");

/** Dossiers jamais jugés : hors code du dépôt, tests, frontends Angular. */
const PRUNED = new Set([
  "node_modules",
  "dist",
  ".git",
  ".turbo",
  "coverage",
  "tests",
  "frontend",
]);

/**
 * Collecte les sources TypeScript (et leurs gabarits) sous une racine.
 *
 * @param dir - dossier à explorer.
 * @param out - accumulateur (chemins absolus).
 * @returns les chemins trouvés.
 */
function collectSources(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (PRUNED.has(entry)) {
      continue;
    }
    const full = path.join(dir, entry);
    let isDir;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      collectSources(full, out);
      continue;
    }
    if (
      /\.(ts|mts|tsx)(\.tpl)?$/.test(entry) &&
      !/\.test\.ts(\.tpl)?$/.test(entry)
    ) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Repère les clés de métadonnée de type écrites en littéral dans une source.
 *
 * Une lecture exige la clé en chaîne (`Reflect.getMetadata("design:…")`) :
 * c'est donc le littéral qui se cherche, sous ses trois délimiteurs. Une
 * mention en prose (commentaire, TSDoc) n'est pas une lecture et passe.
 *
 * @param source - contenu d'un fichier.
 * @returns une entrée par ligne fautive, ligne 1-indexée.
 */
export function findTypeMetadataKeys(
  source: string,
): { line: number; text: string }[] {
  const findings: { line: number; text: string }[] = [];
  source.split("\n").forEach((line, i) => {
    if (/["'`]design:/.test(line)) {
      findings.push({ line: i + 1, text: line.trim() });
    }
  });
  return findings;
}

describe("injection — aucune métadonnée de type lue (ADR-0018)", () => {
  const files = collectSources(path.join(REPO_ROOT, "src"));

  // 🔴 Sans matière, « 0 constat » ne se distingue pas d'un dépôt conforme.
  it("le balayage TROUVE la matière qu'il prétend juger", () => {
    assert.isAtLeast(files.length, 500, "le balayage est aveugle");
    assert.isTrue(
      files.some((f) => f.endsWith(path.join("injector", "injector.ts"))),
      "l'injecteur lui-même doit être couvert",
    );
    assert.isTrue(
      files.some((f) => f.endsWith(".ts.tpl")),
      "les gabarits de scaffold doivent être couverts",
    );
  });

  it("aucune clé `design:*` dans le code du dépôt ni ses gabarits", () => {
    const findings: string[] = [];
    for (const file of files) {
      for (const f of findTypeMetadataKeys(readFileSync(file, "utf8"))) {
        findings.push(`${path.relative(REPO_ROOT, file)}:${f.line}  ${f.text}`);
      }
    }
    assert.deepEqual(
      findings,
      [],
      'Une dépendance se nomme : `@Inject("nom")` sur le paramètre. Le type ' +
        "émis par le compilateur devient `Object` dès que son import est élidé.",
    );
  });

  describe("la détection mord (auto-contrôle)", () => {
    it("voit une lecture, quel que soit le délimiteur", () => {
      assert.lengthOf(
        findTypeMetadataKeys('Reflect.getMetadata("design:paramtypes", C);'),
        1,
      );
      assert.lengthOf(findTypeMetadataKeys("get('design:type', t, k)"), 1);
      assert.lengthOf(findTypeMetadataKeys("get(`design:returntype`)"), 1);
    });

    it("laisse passer la prose et les clés du framework", () => {
      assert.isEmpty(findTypeMetadataKeys("// lisait design:paramtypes"));
      assert.isEmpty(findTypeMetadataKeys('getMetadata("inject:services", C)'));
    });

    it("rend TOUTES les occurrences, avec leur ligne", () => {
      const f = findTypeMetadataKeys('"design:type"\nx\n"design:paramtypes"');
      assert.deepEqual(
        f.map((x) => x.line),
        [1, 3],
      );
    });
  });
});
