import {
  realpathSync,
  chmodSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { printUsage, printUsageError, type IUsagePage } from "./usageReport";
import { SysExit } from "./sysexits";
import { findProjectRoot } from "./projectRoot";
import {
  GIT_HOOKS_DIR,
  planGitHooks,
  renderGitHooksPlan,
  type IGitHooksPlan,
} from "./gitHooksReport";

/** La page d'aide — `nodefony git:hooks --help`, et le rappel après un refus. */
const PAGE: IUsagePage = {
  command: "nodefony git:hooks",
  tagline:
    "pose les hooks git de ce projet : contrôles au commit, vérification " +
    "au push",
  sections: [
    {
      title: "CE QU'ELLE FAIT",
      paragraph:
        "Elle écrit deux scripts shell et pose une seule clé de configuration " +
        "git, qui désigne le dossier où git ira les chercher. Rien n'est " +
        "installé à votre insu : la pose des hooks est un geste EXPLICITE, " +
        "jamais l'effet de bord d'un `npm install`. Elle ne démarre pas " +
        "l'application.",
    },
  ],
  options: [
    { term: "--dry-run", text: "le plan, sans rien écrire ni configurer" },
    { term: "--json", text: "le même plan, exploitable par un script" },
    {
      term: "--cwd <chemin>",
      text: "point de départ (la racine de l'app est résolue en remontant)",
    },
  ],
  examples: [
    { term: "nodefony git:hooks", text: "pose les hooks dans ce dépôt" },
    {
      term: "nodefony git:hooks --dry-run",
      text: "ce qu'elle écrirait, avant de la laisser faire",
    },
  ],
  exitCodes: [
    {
      term: "66",
      text: "aucune application, ou aucun dépôt git ici (EX_NOINPUT)",
    },
  ],
};

/**
 * Interroge git — sortie capturée, échec rendu `null`.
 *
 * @param args - arguments de git.
 * @param cwd - répertoire d'exécution.
 * @returns stdout épuré, ou `null` si git refuse (pas un dépôt, clé absente).
 */
function git(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Analyse les arguments de `git:hooks`.
 *
 * @param argv - `process.argv` complet.
 * @returns les options, ou une erreur d'usage.
 */
export function parseGitHooksArgv(
  argv: string[],
):
  | { cwd: string; json: boolean; dryRun: boolean; help: boolean }
  | { error: string } {
  const args = argv.slice(2).filter((a) => a !== "git:hooks");
  let cwd = process.cwd();
  let json = false;
  let dryRun = false;
  let help = false;
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i] as string;
    // Une commande qui répond « option inconnue : --help » apprend au lecteur
    // à ne plus croire le pied de l'aide, qui promet ce drapeau.
    if (a === "--help" || a === "-h") help = true;
    else if (a === "--json") json = true;
    else if (a === "--dry-run") dryRun = true;
    else if (a === "--cwd") {
      const v = args[i + 1];
      if (v === undefined) return { error: "--cwd attend un chemin" };
      cwd = path.resolve(v);
      i += 1;
    } else return { error: `option inconnue : ${a}` };
  }
  return { cwd, json, dryRun, help };
}

/**
 * Pose les hooks natifs dans un projet, et rend le plan de ce qui a été fait.
 *
 * Le geste ENTIER — lire, décider, écrire, configurer — en un exemplaire, pour
 * ses appelants présents et futurs (la commande ; un jour `create app
 * --git-hooks`). Tout refus (hook étranger, `core.hooksPath` géré autrement)
 * interdit TOUT le geste : pas d'état à moitié posé.
 *
 * ⚠️ `core.hooksPath` RELATIF se résout depuis le TOPLEVEL du dépôt git, pas
 * depuis l'application. Quand l'application n'est pas le toplevel (monorepo),
 * la valeur posée est le chemin du dossier de hooks VU DU toplevel — calculée
 * ici, écrite en `/` (elle voyage dans la config du clone).
 *
 * @param projectRoot - racine de l'application, DÉJÀ résolue.
 * @param dryRun - `true` pour calculer sans rien écrire ni configurer.
 * @returns le plan, ou `null` si `projectRoot` n'est dans aucun dépôt git.
 */
export function installGitHooks(
  projectRoot: string,
  dryRun = false,
): IGitHooksPlan | null {
  const toplevel = git(["rev-parse", "--show-toplevel"], projectRoot);
  if (toplevel === null) return null;

  // Les DEUX chemins passent par realpath avant d'être comparés : git rend le
  // toplevel RÉSOLU (`/private/var/…` sur macOS) quand l'appelant tient le
  // symlink (`/var/…`) — sans ça, `path.relative` fabrique un chemin en
  // `../../..` qui sort du dépôt, et git n'exécute jamais les hooks.
  // `.native` et pas la version JS : sur Windows, seul l'appel système résout
  // la forme courte 8.3 (`RUNNER~1` sur les runners CI, tenue par $TEMP) vers
  // la forme longue que git rend — la version JS laisse les deux formes
  // diverger et `path.relative` refabrique exactement le même `../../..`.
  const projectReal = realpathSync.native(projectRoot);
  const toplevelReal = realpathSync.native(toplevel);
  const hooksDirAbs = path.join(projectReal, GIT_HOOKS_DIR);
  const wanted =
    path.relative(toplevelReal, hooksDirAbs).split(path.sep).join("/") ||
    GIT_HOOKS_DIR;

  const existants: Record<string, string | null> = {};
  for (const name of ["pre-commit", "pre-push"]) {
    try {
      existants[name] = readFileSync(path.join(hooksDirAbs, name), "utf8");
    } catch {
      existants[name] = null;
    }
  }

  const plan = planGitHooks(
    existants,
    git(["config", "--get", "core.hooksPath"], projectRoot),
    wanted,
  );
  if (dryRun || plan.refused) return plan;

  for (const hook of plan.hooks) {
    if (hook.action === "inchange") continue;
    const dest = path.join(projectRoot, ...hook.target.split("/"));
    mkdirSync(path.dirname(dest), { recursive: true });
    writeFileSync(dest, hook.content, "utf8");
    // Nécessaire sur les systèmes POSIX (git n'exécute pas un hook sans le
    // bit x) ; best-effort ailleurs — les permissions POSIX n'existent pas
    // sous Windows, et git y passe par sh.exe sans les regarder.
    try {
      chmodSync(dest, 0o755);
    } catch {
      // Axiome 8 : ne jamais asseoir le geste sur chmod.
    }
  }
  if (plan.hooksPath.action === "pose") {
    execFileSync("git", ["config", "core.hooksPath", plan.hooksPath.wanted], {
      cwd: projectRoot,
      stdio: ["ignore", "ignore", "ignore"],
    });
  }
  return plan;
}

/**
 * Commande `nodefony git:hooks` — hooks git natifs (`core.hooksPath`), zéro
 * dépendance.
 *
 * Standalone (0 boot) : elle écrit deux fichiers et une clé de config, et doit
 * répondre dans un terminal qui n'a pas posé `NODE_ENV` — même famille que
 * `ai:sync` et `ai:mcp`, mêmes raisons. Et comme eux, AUCUN `postinstall` ne
 * l'appelle : la pose de hooks est un choix, pas un effet de bord d'un
 * `npm install`.
 *
 * @param argv - `process.argv` complet.
 * @returns exit code sémantique (`OK`, `USAGE`, `NOINPUT` hors projet,
 *   `UNAVAILABLE` hors dépôt git, `CANTCREAT` sur refus d'écrasement).
 */
export function runGitHooksCommand(argv: string[]): number {
  const parsed = parseGitHooksArgv(argv);
  if ("error" in parsed) {
    return printUsageError(PAGE, parsed.error);
  }
  if (parsed.help) {
    return printUsage(PAGE);
  }
  const projectRoot = findProjectRoot(parsed.cwd);
  if (projectRoot === null) {
    process.stderr.write(
      `git:hooks: aucun projet Nodefony ici (nodefony.config.ts introuvable en remontant).\n`,
    );
    return SysExit.NOINPUT;
  }

  const plan = installGitHooks(projectRoot, parsed.dryRun);
  if (plan === null) {
    process.stderr.write(
      `git:hooks: ${projectRoot} n'est dans aucun dépôt git.\n` +
        `Pour en créer un :\n  git init\n`,
    );
    return SysExit.UNAVAILABLE;
  }

  process.stdout.write(
    parsed.json
      ? `${JSON.stringify({ ...plan, dryRun: parsed.dryRun }, null, 2)}\n`
      : renderGitHooksPlan(plan, !parsed.dryRun && !plan.refused),
  );
  return plan.refused ? SysExit.CANTCREAT : SysExit.OK;
}
