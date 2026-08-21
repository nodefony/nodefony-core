import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  planGitHooks,
  renderGitHook,
  GIT_HOOKS_DIR,
  GIT_HOOKS_MARKER,
  GIT_HOOK_NAMES,
} from "../cli/gitHooksReport";
import { runGitHooksCommand, installGitHooks } from "../cli/gitHooks";
import { SysExit } from "../cli/sysexits";

describe("git:hooks — la composition PURE", () => {
  it("chaque hook porte le marqueur, le shebang sh et ses issues de secours", () => {
    for (const name of GIT_HOOK_NAMES) {
      const out = renderGitHook(name);
      expect(out.startsWith("#!/usr/bin/env sh\n")).toBe(true);
      expect(out).toContain(GIT_HOOKS_MARKER);
      expect(out).toContain("--no-verify");
      expect(out).toContain("git config --unset core.hooksPath");
    }
  });

  it("le pre-commit reste LÉGER, le pre-push porte verify", () => {
    // Doctrine : le filet complet est la CI ; un commit doit rester rapide.
    expect(renderGitHook("pre-commit")).toContain(
      "npm run typecheck && npm run lint",
    );
    expect(renderGitHook("pre-commit")).not.toContain("npm run verify");
    expect(renderGitHook("pre-push")).toContain("npm run verify");
  });

  it("pose / inchange / remplace — selon l'existant et le marqueur", () => {
    const mien = renderGitHook("pre-commit");
    const plan = planGitHooks(
      {
        "pre-commit": null,
        "pre-push": renderGitHook("pre-push"),
      },
      null,
      GIT_HOOKS_DIR,
    );
    expect(plan.hooks.find((h) => h.name === "pre-commit")?.action).toBe(
      "pose",
    );
    expect(plan.hooks.find((h) => h.name === "pre-push")?.action).toBe(
      "inchange",
    );
    const remplace = planGitHooks(
      { "pre-commit": `${mien}\n# version antérieure`, "pre-push": null },
      null,
      GIT_HOOKS_DIR,
    );
    expect(remplace.hooks.find((h) => h.name === "pre-commit")?.action).toBe(
      "remplace",
    );
    expect(remplace.refused).toBe(false);
  });

  it("🔴 un hook ÉTRANGER (sans marqueur) fait tout REFUSER", () => {
    // Effacer le travail de quelqu'un n'est pas le rôle d'une commande de pose
    // — et poser la moitié d'un jeu de hooks laisse un état illisible.
    const plan = planGitHooks(
      { "pre-commit": "#!/bin/sh\n# mon hook à moi\nmake check\n" },
      null,
      GIT_HOOKS_DIR,
    );
    expect(plan.hooks.find((h) => h.name === "pre-commit")?.action).toBe(
      "refus-etranger",
    );
    expect(plan.refused).toBe(true);
  });

  it("🔴 un core.hooksPath déjà GÉRÉ AUTREMENT fait tout refuser", () => {
    const plan = planGitHooks({}, ".husky", GIT_HOOKS_DIR);
    expect(plan.hooksPath.action).toBe("refus-autre");
    expect(plan.refused).toBe(true);
    // Déjà à nous → rien à faire, aucun refus.
    const deja = planGitHooks({}, GIT_HOOKS_DIR, GIT_HOOKS_DIR);
    expect(deja.hooksPath.action).toBe("inchange");
    expect(deja.refused).toBe(false);
  });
});

// Timeout LARGE : chaque cas spawn git (init, config) et deux passages de la
// commande — 2 s isolé, mais une suite chargée (110 fichiers en parallèle,
// machine sous un banc) a déjà dépassé les 5 s par pure contention. Le plafond
// borne un blocage, il ne mesure pas une performance.
describe("git:hooks — le geste sur disque", { timeout: 20_000 }, () => {
  let root = "";

  const gitConfig = (cwd: string, key: string): string | null => {
    try {
      return execFileSync("git", ["config", "--get", key], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return null;
    }
  };

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "nf-githooks-"));
    writeFileSync(
      path.join(root, "nodefony.config.ts"),
      "export default {};\n",
    );
    writeFileSync(path.join(root, "package.json"), '{"name":"app"}\n');
    execFileSync("git", ["init", "-q"], { cwd: root });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("🔴 pose les deux hooks ET core.hooksPath — puis ne touche plus à rien", () => {
    expect(
      runGitHooksCommand(["node", "nodefony", "git:hooks", "--cwd", root]),
    ).toBe(SysExit.OK);
    const cible = path.join(root, GIT_HOOKS_DIR, "pre-commit");
    expect(readFileSync(cible, "utf8")).toContain(GIT_HOOKS_MARKER);
    expect(gitConfig(root, "core.hooksPath")).toBe(GIT_HOOKS_DIR);
    if (process.platform !== "win32") {
      // Le bit x est NÉCESSAIRE sur POSIX (git n'exécute pas sans lui) ;
      // il n'existe pas sous Windows, où git passe par sh.exe.
      expect(statSync(cible).mode & 0o100).toBeTruthy();
    }
    // Idempotence FORTE : le second passage ne touche pas au fichier — la
    // date de modification est la seule preuve du non-geste.
    const avant = statSync(cible).mtimeMs;
    expect(
      runGitHooksCommand(["node", "nodefony", "git:hooks", "--cwd", root]),
    ).toBe(SysExit.OK);
    expect(statSync(cible).mtimeMs).toBe(avant);
  });

  it("🔴 hook étranger sur disque : REFUS TOTAL — fichier intact, config non posée", () => {
    const dir = path.join(root, GIT_HOOKS_DIR);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "pre-commit"), "#!/bin/sh\nmake check\n");
    expect(
      runGitHooksCommand(["node", "nodefony", "git:hooks", "--cwd", root]),
    ).toBe(SysExit.CANTCREAT);
    expect(readFileSync(path.join(dir, "pre-commit"), "utf8")).toBe(
      "#!/bin/sh\nmake check\n",
    );
    // Le refus est TOTAL : même le pre-push, pourtant posable, ne l'est pas,
    // et la config reste vierge.
    expect(existsSync(path.join(dir, "pre-push"))).toBe(false);
    expect(gitConfig(root, "core.hooksPath")).toBeNull();
  });

  it("core.hooksPath déjà posé ailleurs (.husky) : refus, aucun fichier écrit", () => {
    execFileSync("git", ["config", "core.hooksPath", ".husky"], { cwd: root });
    expect(
      runGitHooksCommand(["node", "nodefony", "git:hooks", "--cwd", root]),
    ).toBe(SysExit.CANTCREAT);
    expect(existsSync(path.join(root, GIT_HOOKS_DIR))).toBe(false);
    expect(gitConfig(root, "core.hooksPath")).toBe(".husky");
  });

  it("--dry-run : rien d'écrit, rien de configuré", () => {
    expect(
      runGitHooksCommand([
        "node",
        "nodefony",
        "git:hooks",
        "--dry-run",
        "--cwd",
        root,
      ]),
    ).toBe(SysExit.OK);
    expect(existsSync(path.join(root, GIT_HOOKS_DIR))).toBe(false);
    expect(gitConfig(root, "core.hooksPath")).toBeNull();
  });

  it("hors dépôt git : refus actionnable (git init), rien d'écrit", () => {
    const nu = mkdtempSync(path.join(tmpdir(), "nf-sans-git-"));
    try {
      writeFileSync(
        path.join(nu, "nodefony.config.ts"),
        "export default {};\n",
      );
      writeFileSync(path.join(nu, "package.json"), '{"name":"app"}\n');
      expect(
        runGitHooksCommand(["node", "nodefony", "git:hooks", "--cwd", nu]),
      ).toBe(SysExit.UNAVAILABLE);
      expect(existsSync(path.join(nu, GIT_HOOKS_DIR))).toBe(false);
    } finally {
      rmSync(nu, { recursive: true, force: true });
    }
  });

  it("🔴 app dans un SOUS-DOSSIER du dépôt git : le chemin est vu du TOPLEVEL", () => {
    // core.hooksPath relatif se résout depuis la racine du dépôt git, pas
    // depuis l'application : « .githooks » nu pointerait sur un dossier qui
    // n'existe pas au toplevel, et git n'exécuterait JAMAIS les hooks.
    const app = path.join(root, "apps", "boutique");
    mkdirSync(app, { recursive: true });
    writeFileSync(path.join(app, "nodefony.config.ts"), "export default {};\n");
    const plan = installGitHooks(app);
    expect(plan?.hooksPath.wanted).toBe("apps/boutique/.githooks");
    expect(gitConfig(root, "core.hooksPath")).toBe("apps/boutique/.githooks");
    expect(
      readFileSync(path.join(app, GIT_HOOKS_DIR, "pre-push"), "utf8"),
    ).toContain(GIT_HOOKS_MARKER);
  });
});
