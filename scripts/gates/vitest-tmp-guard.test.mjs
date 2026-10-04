// Toute configuration vitest du dépôt pose la garde des dossiers temporaires
// (scripts/test/vitest/tmp-guard.ts). Une config qui l'oublie rouvre la fuite qu'elle ferme :
// 28 454 entrées et 42 Go laissés dans le dossier temporaire du système avant
// elle — et un oubli ne se verrait pas, puisqu'une passe sans garde est verte.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../lib/repo-root.mjs";

const configs = execFileSync("git", ["ls-files", "-z"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
})
  .split("\0")
  .filter((f) => /(^|\/)vitest[^/]*\.config\.(ts|mjs|js)$/u.test(f));

describe("vitest — la garde des dossiers temporaires est posée partout", () => {
  it("trouve des configurations à contrôler", () => {
    expect(configs.length).toBeGreaterThan(0);
  });

  it.each(configs)("%s déclare globalSetup: tmpGuard(…)", (config) => {
    const src = readFileSync(path.join(REPO_ROOT, config), "utf8");
    expect(src).toMatch(/globalSetup:\s*tmpGuard\(/u);
  });
});
