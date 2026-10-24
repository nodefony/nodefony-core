/**
 * Suite du contrôle de syntaxe shell — écrite pour le faire ÉCHOUER.
 *
 * Le cas « PIÈGE » est celui qui a cassé le smoke de release : une apostrophe
 * dans un commentaire JavaScript, à l'intérieur d'un `node -e '…'`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { checkShellSyntax } from "./check-shell-syntax.mjs";

const dir = mkdtempSync(path.join(tmpdir(), "nf-shell-syntax-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function script(name, body) {
  const file = path.join(dir, name);
  writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  return file;
}

describe("check-shell-syntax", () => {
  it("laisse passer un script valide (contrôle positif)", () => {
    const ok = script(
      "ok.sh",
      `node -e '\n// sans apostrophe\nconsole.log(1)\n' && echo fini`,
    );
    const verdict = checkShellSyntax([ok]);
    expect(verdict.supported).toBe(true);
    expect(verdict.failures).toEqual([]);
  });

  it("PIÈGE : une apostrophe dans un commentaire de node -e ferme la chaîne", () => {
    const bad = script(
      "apostrophe.sh",
      `node -e '\n// que l'app y envoie ou non\nif (x) throw new Error("y");\n' "$A" || exit 1`,
    );
    const verdict = checkShellSyntax([bad]);
    expect(verdict.failures.map((f) => f.file)).toEqual([bad]);
    expect(verdict.failures[0]?.error).toMatch(/syntax error|unexpected/);
  });

  it("attrape un `if` jamais fermé", () => {
    const bad = script("fi.sh", `if true; then\n  echo oui\n`);
    expect(checkShellSyntax([bad]).failures).toHaveLength(1);
  });

  it("se dit non fait quand bash ne répond pas, au lieu de conclure", () => {
    const verdict = checkShellSyntax(
      [script("x.sh", "echo")],
      "nf-pas-de-bash",
    );
    expect(verdict).toEqual({ supported: false, checked: 0, failures: [] });
  });
});
