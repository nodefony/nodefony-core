import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../lib/repo-root.mjs";
import { moduleDocsUrl } from "../site/lib/module-docs.mjs";
import { packageEnglishBlock, withEnglishBlock } from "./readmes.mjs";

const SITE = "https://nodefony.net";

describe("encart anglais des README de paquet", () => {
  const block = packageEnglishBlock(
    "@nodefony/http",
    "Servers for Nodefony",
    moduleDocsUrl(REPO_ROOT, "@nodefony/http", SITE),
  );

  it("pose l'encart sous le titre et garde le reste intact", () => {
    const page = withEnglishBlock(
      "# @nodefony/http\n\nTexte français.\n",
      block,
    );
    expect(page.startsWith("# @nodefony/http\n\n<!-- nf-en:begin")).toBe(true);
    expect(page.endsWith("\n\nTexte français.\n")).toBe(true);
  });

  it("est idempotent : un second passage ne duplique rien", () => {
    const once = withEnglishBlock("# T\n\nCorps\n", block);
    expect(withEnglishBlock(once, block)).toBe(once);
  });

  it("remplace un encart périmé", () => {
    const old = withEnglishBlock(
      "# T\n\nCorps\n",
      packageEnglishBlock("t", "Old"),
    );
    const next = withEnglishBlock(old, block);
    expect(next).not.toContain("Old");
    expect(next.match(/nf-en:begin/g)).toHaveLength(1);
  });

  it("renvoie vers la page du module quand elle existe, sinon vers la doc", () => {
    expect(block).toContain("https://nodefony.net/docs/modules/http/");
    // La règle est CELLE du site : un dossier `docs/` ⇒ une page de module.
    // Une liste recopiée avait oublié devkit et documentation.
    for (const name of ["@nodefony/devkit", "@nodefony/documentation"])
      expect(moduleDocsUrl(REPO_ROOT, name, SITE)).toBe(
        `${SITE}/docs/modules/${name.slice("@nodefony/".length)}/`,
      );
    expect(moduleDocsUrl(REPO_ROOT, "create-nodefony", SITE)).toBeNull();
    expect(packageEnglishBlock("create-nodefony", "x")).toContain(
      `${SITE}/docs/demarrer/)`,
    );
    expect(packageEnglishBlock("@nodefony/inconnu", "x")).toContain(
      `${SITE}/docs/)`,
    );
  });

  it("refuse un README sans titre", () => {
    expect(() => withEnglishBlock("pas de titre\n", block)).toThrow(/titre/);
  });
});
