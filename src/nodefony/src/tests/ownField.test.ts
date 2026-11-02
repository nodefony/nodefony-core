import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ownField } from "../Tools";
import { ownField as fromClient } from "../client/index";

/** Racine du dépôt — ce fichier vit dans `src/nodefony/src/tests/`. */
const REPO_ROOT = path.resolve(import.meta.dirname, "../../../..");
/** Dossiers dont le contenu n'est jamais du code de production du dépôt. */
const PRUNED = new Set([
  "node_modules",
  "dist",
  ".git",
  ".turbo",
  "coverage",
  "tests",
  "templates",
]);
/** La SEULE implémentation admise de la règle. */
const HOME = path.join(
  REPO_ROOT,
  "src",
  "nodefony",
  "src",
  "runtime",
  "ownField.ts",
);
/** Une lecture de champ propre recopiée à la main. */
const COPY = /getOwnPropertyDescriptor\([^)]*\)\s*\??\.value\b/;

/**
 * Sources TypeScript de production sous `dir` (tests et gabarits exclus).
 *
 * @param dir - dossier à explorer.
 * @param out - accumulateur (chemins absolus).
 * @returns les chemins trouvés.
 */
function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (PRUNED.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) collectSources(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("ownField — lire un champ d'une charge inconnue", () => {
  it("rend la valeur d'une propriété propre", () => {
    expect(ownField({ id: "a1" }, "id")).toBe("a1");
    expect(ownField({ n: 0 }, "n")).toBe(0);
    expect(ownField(Object.create(null), "id")).toBeUndefined();
  });

  it("rend undefined pour une valeur qui n'est pas un objet", () => {
    for (const value of [undefined, null, "id", 42, true]) {
      expect(ownField(value, "id")).toBeUndefined();
    }
  });

  it("ignore un champ hérité — il n'a pas été envoyé", () => {
    expect(ownField({}, "constructor")).toBeUndefined();
    expect(ownField({}, "toString")).toBeUndefined();
    expect(ownField(Object.create({ id: "hérité" }), "id")).toBeUndefined();
  });

  it("ne déclenche pas d'accesseur hérité", () => {
    let calls = 0;
    const proto = {
      get id(): string {
        calls += 1;
        return "accesseur";
      },
    };
    expect(ownField(Object.create(proto), "id")).toBeUndefined();
    expect(calls).toBe(0);
  });

  it("est la MÊME fonction côté navigateur (nodefony/client)", () => {
    expect(fromClient).toBe(ownField);
  });
});

describe("ownField — une seule implémentation dans le dépôt", () => {
  it("la détection voit une copie", () => {
    expect(
      COPY.test("Object.getOwnPropertyDescriptor(payload, key)?.value"),
    ).toBe(true);
    expect(COPY.test("ownField(payload, key)")).toBe(false);
  });

  it("aucune source de production ne recopie la lecture d'un champ propre", () => {
    const sources = collectSources(path.join(REPO_ROOT, "src"));
    // Le balayage trouve la matière qu'il prétend juger.
    expect(sources).toContain(HOME);
    const copies = sources.filter(
      (file) => file !== HOME && COPY.test(readFileSync(file, "utf8")),
    );
    // Une copie → importer `ownField` depuis `nodefony` (ou `nodefony/client`).
    expect(copies.map((f) => path.relative(REPO_ROOT, f))).toEqual([]);
  });
});
