/*
 *   `isolatedGitEnv` — un git lancé sur un AUTRE dépôt ne doit pas hériter des
 *   variables par lesquelles git redirige vers le dépôt appelant.
 *
 *   Vécu : le hook de commit du dépôt engendre une application témoin
 *   (`nodefony create app`) ; son `git add -A` héritait de `GIT_INDEX_FILE` et
 *   écrivait l'arbre de l'application dans l'index du commit en cours.
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isolatedGitEnv } from "../cli/gitEnv";

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(path.join(os.tmpdir(), "nf-gitenv-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Un index « appelant » et un dépôt neuf qui a un fichier à indexer. */
function decor(): { callerIndex: string; fresh: string } {
  const caller = tmp();
  execFileSync("git", ["init", "-q"], { cwd: caller, env: isolatedGitEnv() });
  const fresh = tmp();
  writeFileSync(path.join(fresh, "ci.yml"), "name: ci\n");
  return { callerIndex: path.join(caller, ".git", "index-du-commit"), fresh };
}

const gitIn = (cwd: string, env: NodeJS.ProcessEnv, ...args: string[]) =>
  execFileSync("git", args, { cwd, env, stdio: "ignore" });

describe("isolatedGitEnv", () => {
  it("retire les variables de redirection, garde le reste, ne mute rien", () => {
    const env = {
      PATH: "/bin",
      GIT_INDEX_FILE: "/x/index",
      GIT_DIR: "/x/.git",
      GIT_WORK_TREE: "/x",
      GIT_AUTHOR_NAME: "auteur",
    };
    const out = isolatedGitEnv(env);
    expect(out).toEqual({ PATH: "/bin", GIT_AUTHOR_NAME: "auteur" });
    expect(env.GIT_INDEX_FILE).toBe("/x/index");
  });

  it("TÉMOIN — sans elle, `git add` d'un dépôt neuf écrit dans l'index hérité", () => {
    const { callerIndex, fresh } = decor();
    const leaking = { ...process.env, GIT_INDEX_FILE: callerIndex };
    gitIn(fresh, isolatedGitEnv(leaking), "init", "-q");
    gitIn(fresh, leaking, "add", "-A");
    expect(existsSync(callerIndex)).toBe(true);
  });

  it("avec elle, l'index hérité reste intact", () => {
    const { callerIndex, fresh } = decor();
    writeFileSync(callerIndex, "intact");
    const inherited = isolatedGitEnv({
      ...process.env,
      GIT_INDEX_FILE: callerIndex,
    });
    gitIn(fresh, inherited, "init", "-q");
    gitIn(fresh, inherited, "add", "-A");
    expect(readFileSync(callerIndex, "utf8")).toBe("intact");
    expect(existsSync(path.join(fresh, ".git", "index"))).toBe(true);
  });
});
