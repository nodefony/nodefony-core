import { describe, it, expect } from "vitest";
import { rewriteInternalLinks } from "../../src/linkResolver";

/** Index minimal : quelques pages réelles du corpus, chemin repo → slug. */
const INDEX: Record<string, string> = {
  "docs/index.md": "root~index",
  "docs/architecture/pipeline-requete.md": "root~architecture~pipeline-requete",
  "src/packages/@nodefony/security/docs/index.md": "mod~security~index",
  "src/packages/@nodefony/security/docs/cors.md": "mod~security~cors",
  "src/packages/@nodefony/user/docs/index.md": "mod~user~index",
};
const toSlug = (p: string): string | undefined => INDEX[p];
const FROM = "src/packages/@nodefony/security/docs";

const rewrite = (md: string, fromDir = FROM): string =>
  rewriteInternalLinks(md, { fromDir, toSlug });

describe("rewriteInternalLinks", () => {
  it("traduit un lien plat vers une page sœur", () => {
    expect(rewrite("voir [CORS](cors.md) ici")).toBe(
      "voir [CORS](mod~security~cors.md) ici",
    );
  });

  it("traduit une remontée profonde vers la racine (le cas qui cassait)", () => {
    const md = "[Documentation](../../../../../docs/index.md)";
    expect(rewrite(md)).toBe("[Documentation](root~index.md)");
  });

  it("traduit une remontée vers un AUTRE module", () => {
    const md = "[identité](../../user/docs/index.md)";
    expect(rewrite(md)).toBe("[identité](mod~user~index.md)");
  });

  it("préserve l'ancre de section", () => {
    const md =
      "[le pipeline](../../../../../docs/architecture/pipeline-requete.md#etapes)";
    expect(rewrite(md)).toBe(
      "[le pipeline](root~architecture~pipeline-requete.md#etapes)",
    );
  });

  it("laisse INTACT un lien dont la cible n'est pas indexée", () => {
    const md = "[fantôme](authflow.md)";
    expect(rewrite(md)).toBe(md);
  });

  it("ne touche ni aux URL absolues ni aux ancres pures", () => {
    const md =
      "[RFC](https://www.rfc-editor.org/rfc/rfc7235.html) et [haut](#top)";
    expect(rewrite(md)).toBe(md);
  });

  it("ne touche pas aux liens non-markdown", () => {
    const md = "[schéma](./diagramme.png) et [code](../src/firewall.ts)";
    expect(rewrite(md)).toBe(md);
  });

  it("traduit plusieurs liens sur la même ligne", () => {
    const md = "[hub](index.md) · [cors](cors.md)";
    expect(rewrite(md)).toBe(
      "[hub](mod~security~index.md) · [cors](mod~security~cors.md)",
    );
  });

  it("gère le fil d'Ariane complet d'une page réelle", () => {
    const md =
      "📍 [Documentation](../../../../../docs/index.md) › [Sécurité](index.md) › **CORS**";
    expect(rewrite(md)).toBe(
      "📍 [Documentation](root~index.md) › [Sécurité](mod~security~index.md) › **CORS**",
    );
  });

  it("résout depuis un dossier racine (page transverse)", () => {
    const md =
      "[sécurité](../../src/packages/@nodefony/security/docs/index.md)";
    expect(rewrite(md, "docs/architecture")).toBe(
      "[sécurité](mod~security~index.md)",
    );
  });

  it("ne remonte jamais au-dessus de la racine", () => {
    // `../../../../../../../..` sature : le résultat ne peut pas sortir du dépôt.
    const md = "[x](../../../../../../../../../etc/passwd.md)";
    expect(rewrite(md)).toBe(md); // non indexé → intact
  });
});
