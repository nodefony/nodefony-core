import fs from "node:fs";
import path from "node:path";

/** Identité git du dépôt courant. Champs `""` si indéterminés (hors dépôt). */
export interface GitInfo {
  /** Branche courante, ou sha court si HEAD détaché. */
  branch: string;
  /** Commit HEAD court (7 caractères). */
  commit: string;
}

// Caché pour la vie du process : l'identité git est constante au runtime.
let _cache: GitInfo | undefined;

/** Branche depuis `.git/HEAD` (`ref: refs/heads/X` → `X`, sinon sha court). */
function readBranch(gitDir: string): string {
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    return m ? m[1]! : head.slice(0, 7);
  } catch {
    return "";
  }
}

/** Commit HEAD court : suit `HEAD` → ref file, repli `packed-refs`. */
function readCommit(gitDir: string): string {
  try {
    const head = fs.readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const m = head.match(/^ref:\s*(.+)$/);
    if (!m) return head.slice(0, 7); // HEAD détaché → sha directe
    const ref = m[1]!;
    let sha = "";
    try {
      sha = fs.readFileSync(path.join(gitDir, ref), "utf8").trim();
    } catch {
      const packed = fs.readFileSync(path.join(gitDir, "packed-refs"), "utf8");
      const line = packed.split("\n").find((l) => l.endsWith(` ${ref}`));
      sha = line ? line.split(" ")[0]! : "";
    }
    return sha.slice(0, 7);
  } catch {
    return "";
  }
}

/**
 * Introspection git du dépôt — **sans spawn `git` ni dépendance** (lecture directe
 * de `.git/`). Résultat caché pour la vie du process. Best-effort : champs `""`
 * hors d'un dépôt (ex. container sans `.git`). Consommé par le data plane kernel
 * (`/nodefony/kernel/api/info` → `git`) et la barre de debug (bloc `app`).
 */
export default class GitService {
  /**
   * Lit branche + commit court (une fois, puis cache process).
   *
   * @param cwd - racine où chercher `.git` (défaut `process.cwd()`)
   * @returns `{ branch, commit }` — champs `""` si indéterminés
   */
  static read(cwd: string = process.cwd()): GitInfo {
    if (_cache) return _cache;
    const gitDir = path.join(cwd, ".git");
    _cache = { branch: readBranch(gitDir), commit: readCommit(gitDir) };
    return _cache;
  }

  /** Branche seule (raccourci). */
  static branch(cwd?: string): string {
    return GitService.read(cwd).branch;
  }
}
