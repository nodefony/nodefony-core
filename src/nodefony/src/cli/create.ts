import path from "node:path";
import { spawnSync } from "node:child_process";
import { SysExit } from "./sysexits";
import { version } from "../../package.json";
import {
  getScaffoldSpec,
  CONTROLLER_KIND_CHOICES,
  FRONTEND_CHOICES,
  MODULE_CONTROLLER_CHOICES,
  PRESET_CHOICES,
} from "./scaffold/spec";
import {
  findPackageRoot,
  findProjectRoot,
  resolveLocalWorkspaces,
  runScaffold,
  type TScaffoldAnswers,
} from "./scaffold/engine";
import { askMissing, confirm } from "./scaffold/interactive";

/**
 * Adaptateur CLI du scaffold `nodefony create <type> [name]` — front n°1 et n°2
 * du moteur (`scaffold/engine.ts`, partagé avec Studio) :
 *
 *   - **CLI rapide** : tout est dit en flags (`create app x --preset minimal
 *     --frontend react --link`) → zéro question, scriptable.
 *   - **CLI interactif** (défaut en TTY) : les questions de la spec NON couvertes
 *     par les flags sont posées en readline natif, récap + confirmation.
 *   - Hors TTY (CI, spawn de test) : les défauts de la spec s'appliquent —
 *     comportement stable pour les scripts, `--yes` force la même chose en TTY.
 *
 * Pur outillage standalone (même famille que status/stop/completion) : AUCUN
 * boot kernel — cas nominal HORS projet : `npx nodefony create app mon-app`.
 */

/** Types de scaffold disponibles (`entity` = lot suivant). */
export const CREATE_TYPES = ["app", "module", "controller", "front"] as const;
export type TCreateType = (typeof CREATE_TYPES)[number];

export interface ICreateRequest {
  type: TCreateType;
  /** Réponses partielles issues des flags (le reste : interactif ou défauts). */
  answers: TScaffoldAnswers;
  /** Dossier cible (défaut : `./<name>` une fois le nom connu). */
  dir?: string;
  force: boolean;
  /** `--yes` : accepter les défauts sans poser de question (même en TTY). */
  yes: boolean;
  /** `--no-install` : ne pas lancer `npm install` après la génération. */
  install: boolean;
  /** `--no-git` : ne pas faire `git init` + first commit après la génération. */
  git: boolean;
}

/**
 * Parse l'argv complet du process après le mot `create`. Ne valide QUE la forme
 * des flags — les valeurs (nom, preset…) sont jugées par la spec du moteur.
 *
 * @returns la requête, ou un message d'usage si invalide
 */
export function parseCreateArgv(
  argv: string[],
): ICreateRequest | { error: string } {
  const at = argv.indexOf("create");
  const rest = at === -1 ? [] : argv.slice(at + 1);
  const positionals: string[] = [];
  const answers: TScaffoldAnswers = {};
  let dir: string | undefined;
  let force = false;
  let yes = false;
  let install = true;
  let git = true;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--force" || word === "-f") {
      force = true;
    } else if (word === "--yes" || word === "-y") {
      yes = true;
    } else if (word === "--no-install") {
      install = false;
    } else if (word === "--no-git") {
      git = false;
    } else if (word === "--link") {
      answers.link = true;
    } else if (word === "--no-link") {
      answers.link = false;
    } else if (word === "--preset") {
      answers.preset = rest[++i];
    } else if (word === "--frontend") {
      answers.frontend = rest[++i];
    } else if (word === "--kind") {
      answers.kind = rest[++i];
    } else if (word === "--controller") {
      answers.controller = rest[++i];
    } else if (word === "--description") {
      answers.description = rest[++i];
    } else if (word === "--service") {
      answers.service = true;
    } else if (word === "--no-service") {
      answers.service = false;
    } else if (word === "--command") {
      answers.command = true;
    } else if (word === "--no-command") {
      answers.command = false;
    } else if (word === "--route") {
      answers.route = rest[++i];
    } else if (word === "--module") {
      answers.module = rest[++i];
    } else if (word === "--dir") {
      dir = rest[++i];
    } else if (word.startsWith("-")) {
      return { error: `option inconnue : ${word}` };
    } else {
      positionals.push(word);
    }
  }
  const [type, name] = positionals;
  if (!type || !(CREATE_TYPES as readonly string[]).includes(type)) {
    return {
      error: `type requis : ${CREATE_TYPES.join(" | ")} (reçu : ${type ?? "rien"})`,
    };
  }
  if (name !== undefined) {
    answers.name = name;
  }
  return { type: type as TCreateType, answers, dir, force, yes, install, git };
}

const USAGE =
  `usage : nodefony create <${CREATE_TYPES.join("|")}> [name] [--dir <path>] [--force] [--yes]\n` +
  `  app        : [--preset <${PRESET_CHOICES.join("|")}>] [--frontend <${FRONTEND_CHOICES.join("|")}>]\n` +
  `               [--link|--no-link] [--no-install] [--no-git]\n` +
  `  module     : [--controller <${MODULE_CONTROLLER_CHOICES.join("|")}>] [--no-service] [--command]\n` +
  `               [--frontend <${FRONTEND_CHOICES.join("|")}>] [--description "…"] [--no-install]\n` +
  `  controller : [--kind <${CONTROLLER_KIND_CHOICES.join("|")}>] [--route </api/x>] [--module <nom>]\n` +
  `  front      : [--frontend <react|vue|angular>] [--route </page>] [--module <nom>]\n` +
  `               (types controller/front : dans un projet existant — app racine ou module)\n` +
  `  Sans flags dans un terminal → mode interactif (questions + récap).\n`;

/**
 * `npm install` dans l'app générée (sortie streamée — le dev voit npm
 * travailler, pas un silence de 60 s). Échec = code retourné, l'appelant
 * décide (l'app EST générée : on n'échoue pas tout le create pour un réseau).
 */
function runInstall(dest: string): boolean {
  process.stdout.write(`\n⏳ npm install (${path.basename(dest)})…\n`);
  const r = spawnSync("npm", ["install"], { cwd: dest, stdio: "inherit" });
  return r.status === 0;
}

/**
 * `npm run build` dans l'app générée — le runtime charge `dist/index.js`
 * (garde fail-loud « NON CONSTRUIT » au boot) : sans ce build, le premier
 * `npm run dev` échoue. Suit l'install (pas de node_modules = pas de build) ;
 * `dist/` est gitignoré → n'entre pas dans le premier commit.
 */
function runBuild(dest: string): boolean {
  process.stdout.write(`\n⏳ npm run build (${path.basename(dest)})…\n`);
  const r = spawnSync("npm", ["run", "build"], { cwd: dest, stdio: "inherit" });
  return r.status === 0;
}

/**
 * `git init` + first commit dans l'app générée — SEULEMENT si git est
 * disponible ET que le dossier n'est pas déjà couvert par un repo (une app de
 * banc dans le checkout du framework ne doit pas créer un repo imbriqué).
 * Le `.gitignore` généré exclut `*.local` AVANT ce commit : les secrets de
 * `.env.local` ne peuvent pas y entrer.
 *
 * @returns note affichable (fait / sauté et pourquoi)
 */
function runGitInit(dest: string, appName: string): string {
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: dest, stdio: "ignore" });
  if (spawnSync("git", ["--version"], { stdio: "ignore" }).error) {
    return "git indisponible → repo non initialisé (git init à la main plus tard)";
  }
  if (git("rev-parse", "--is-inside-work-tree").status === 0) {
    return "déjà dans un repo git → init sauté (pas de repo imbriqué)";
  }
  if (git("init").status !== 0) {
    return "git init a échoué → repo non initialisé";
  }
  git("add", "-A");
  const commit = spawnSync(
    "git",
    ["commit", "-m", `chore: bootstrap ${appName} (nodefony create app)`],
    { cwd: dest, stdio: "ignore" },
  );
  return commit.status === 0
    ? "repo git initialisé + premier commit"
    : "repo git initialisé (commit initial à faire : identité git non configurée ?)";
}

/**
 * Commande `nodefony create` — orchestre l'adaptateur : parse argv, complète en
 * interactif si TTY, délègue au moteur, rend le récap.
 *
 * @returns exit code sémantique (`OK`, `USAGE`, `CANTCREAT`, `SOFTWARE`)
 */
export async function runCreateCommand(argv: string[]): Promise<number> {
  const parsed = parseCreateArgv(argv);
  if ("error" in parsed) {
    process.stderr.write(`create: ${parsed.error}\n${USAGE}`);
    return SysExit.USAGE;
  }
  const caps = {
    hasCheckout: resolveLocalWorkspaces(findPackageRoot()) !== null,
  };
  let answers = parsed.answers;
  const interactive = process.stdin.isTTY === true && !parsed.yes;
  if (interactive) {
    const [spec] = getScaffoldSpec(parsed.type);
    answers = await askMissing(spec, answers, caps);
    // Récap générique piloté par la spec (mêmes questions que l'interactif).
    const lines = spec.questions
      .map((q) => {
        const value = answers[q.key];
        const shown =
          q.type === "boolean"
            ? value === true
              ? "oui"
              : "non"
            : String(value ?? "") || "(défaut)";
        return `  ${q.key.padEnd(9)} : ${shown}`;
      })
      .join("\n");
    process.stdout.write(`\nRécapitulatif :\n${lines}\n`);
    if (!(await confirm("Générer ?"))) {
      process.stdout.write("create: annulé\n");
      return SysExit.OK;
    }
  } else if (answers.link === undefined) {
    // Non-interactif : le câblage checkout ne s'active JAMAIS implicitement —
    // un script qui veut le mode dev framework le dit (`--link`).
    answers.link = false;
  }
  if (answers.name === undefined || answers.name === "") {
    process.stderr.write(`create: nom requis\n${USAGE}`);
    return SysExit.USAGE;
  }
  // app = dossier NEUF ./<name> ; types in-project = détection racine depuis le cwd.
  const dir =
    parsed.dir ??
    (parsed.type === "app" ? String(answers.name) : process.cwd());
  let result;
  try {
    result = runScaffold(
      { type: parsed.type, answers, dir, force: parsed.force },
      version,
    );
  } catch (e) {
    const message = (e as Error).message;
    process.stderr.write(`create: ${message}\n`);
    if (message.includes("n'est pas vide")) {
      return SysExit.CANTCREAT;
    }
    if (message.includes("invalide")) {
      process.stderr.write(USAGE);
      return SysExit.USAGE;
    }
    return SysExit.SOFTWARE;
  }
  const relDest = path.relative(process.cwd(), result.dest) || ".";
  if (parsed.type === "module") {
    process.stdout.write(
      `✔ module « ${String(answers.name)} » généré dans ${relDest}/\n\n` +
        result.files.map((f) => `  ${f}`).join("\n") +
        `\n\nCâblage :\n` +
        (result.notes ?? []).map((n) => `  ${n}`).join("\n") +
        `\n`,
    );
    // Un module est un WORKSPACE npm : sans `npm install`, le symlink n'existe
    // pas et le Kernel ne peut pas l'importer par son nom (« Cannot find
    // package ») — l'install n'est donc pas un confort, c'est ce qui rend le
    // module chargeable. Le build suit : le runtime charge `dist/index.js`.
    const projectRoot = findProjectRoot(process.cwd());
    if (!parsed.install) {
      process.stdout.write(
        `\nProchaines étapes (--no-install) :\n` +
          `  npm install        # symlinke modules/${String(answers.name)} (workspace)\n` +
          `  npm run build\n`,
      );
      return SysExit.OK;
    }
    const installed = projectRoot ? runInstall(projectRoot) : false;
    if (!installed) {
      process.stdout.write(
        `⚠ npm install a échoué — relance-le à la racine de l'app (le module ne sera pas chargeable avant)\n`,
      );
      return SysExit.OK;
    }
    const built = runBuild(result.dest);
    process.stdout.write(
      built
        ? `\n✔ module installé (workspace) et construit — un serveur dev le rechargera au prochain redémarrage\n`
        : `\n⚠ npm run build a échoué dans ${relDest}/ — corrige puis relance-le\n`,
    );
    return SysExit.OK;
  }
  if (parsed.type !== "app") {
    // In-project : ni install, ni git — le projet existe. En dev, le
    // superviseur rebuild/relance tout seul au prochain tick de watch.
    process.stdout.write(
      `✔ ${parsed.type} « ${String(answers.name)} » généré dans ${relDest}/\n\n` +
        result.files.map((f) => `  ${f}`).join("\n") +
        `\n\nEndpoints :\n` +
        (result.notes ?? []).map((n) => `  ${n}`).join("\n") +
        `\n\nServeur dev lancé → rebuild automatique ; sinon : npm run build\n`,
    );
    return SysExit.OK;
  }
  const linkNote = result.linked.length
    ? `\n🔗 link : ${result.linked.length} paquets nodefony câblés en file: sur le checkout local ` +
      `(dev framework — ne pas publier ce package.json tel quel)\n`
    : "";
  process.stdout.write(
    `✔ ${parsed.type} « ${String(answers.name)} » généré dans ${relDest}/\n\n` +
      result.files.map((f) => `  ${f}`).join("\n") +
      `\n${linkNote}`,
  );
  // ── Post-génération : install PUIS build PUIS git (lockfile dans le 1er
  //    commit, dist/ gitignoré). Opt-out : --no-install (saute aussi le build,
  //    qui exige node_modules) / --no-git. Un échec n'annule pas le create
  //    (l'app est là) — il est DIT et les étapes manuelles réaffichées.
  const installed = parsed.install ? runInstall(result.dest) : false;
  if (parsed.install && !installed) {
    process.stdout.write(
      `⚠ npm install a échoué — relance-le à la main dans ${relDest}/\n`,
    );
  }
  const built = installed ? runBuild(result.dest) : false;
  if (installed && !built) {
    process.stdout.write(
      `⚠ npm run build a échoué — relance-le à la main dans ${relDest}/\n`,
    );
  }
  const gitNote = parsed.git
    ? runGitInit(result.dest, String(answers.name))
    : "sauté (--no-git)";
  process.stdout.write(`\n🌱 git : ${gitNote}\n`);
  process.stdout.write(
    `\nProchaines étapes :\n` +
      `  cd ${relDest}\n` +
      (installed ? "" : `  npm install\n`) +
      (built ? "" : `  npm run build\n`) +
      `  npm run dev        # → https://127.0.0.1:5152 (admin : /nodefony — admin/admin en dev)\n`,
  );
  return SysExit.OK;
}
