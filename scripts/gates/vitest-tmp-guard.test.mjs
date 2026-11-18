// Toute configuration vitest du dépôt pose la garde des dossiers temporaires
// (scripts/test/vitest/tmp-guard.ts). Une config qui l'oublie rouvre la fuite qu'elle ferme :
// 28 454 entrées et 42 Go laissés dans le dossier temporaire du système avant
// elle — et un oubli ne se verrait pas, puisqu'une passe sans garde est verte.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { REPO_ROOT } from "../lib/repo-root.mjs";
import setup from "../test/vitest/tmp-guard.ts";

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

/**
 * Ouvre un dossier de passe, y laisse un reste, et rend le teardown avec le
 * dossier qu'il contrôle.
 */
function passWithLeftover(project) {
  const teardown = setup(project);
  const runDir = process.env.TMPDIR;
  mkdirSync(path.join(runDir, "nf-oubli-"));
  return { teardown, runDir };
}

describe("vitest — teardown de la garde des dossiers temporaires", () => {
  it("une passe complète qui laisse un reste échoue en le nommant, et le supprime", () => {
    const { teardown, runDir } = passWithLeftover(undefined);
    expect(teardown).toThrow(/nf-oubli-/u);
    expect(existsSync(runDir)).toBe(false);
  });

  it("sous -t, le reste est nommé et supprimé sans faire échouer la passe", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { teardown, runDir } = passWithLeftover({
        vitest: { config: { testNamePattern: /perf/u } },
        config: {},
      });
      expect(teardown).not.toThrow();
      expect(existsSync(runDir)).toBe(false);
      expect(warn.mock.calls.join("\n")).toMatch(/-t\).*\n.*nf-oubli-/su);
    } finally {
      warn.mockRestore();
    }
  });
});
