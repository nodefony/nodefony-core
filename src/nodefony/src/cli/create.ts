import path from "node:path";
import { SysExit } from "./sysexits";
import { version } from "../../package.json";
import {
  getScaffoldSpec,
  FRONTEND_CHOICES,
  PRESET_CHOICES,
} from "./scaffold/spec";
import {
  findPackageRoot,
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

/** Types de scaffold disponibles (`module`/`controller`/`entity` = lots suivants). */
export const CREATE_TYPES = ["app"] as const;
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
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--force" || word === "-f") {
      force = true;
    } else if (word === "--yes" || word === "-y") {
      yes = true;
    } else if (word === "--link") {
      answers.link = true;
    } else if (word === "--no-link") {
      answers.link = false;
    } else if (word === "--preset") {
      answers.preset = rest[++i];
    } else if (word === "--frontend") {
      answers.frontend = rest[++i];
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
  return { type: type as TCreateType, answers, dir, force, yes };
}

const USAGE =
  `usage : nodefony create <${CREATE_TYPES.join("|")}> [name] [--dir <path>] [--force] [--yes]\n` +
  `        [--preset <${PRESET_CHOICES.join("|")}>] [--frontend <${FRONTEND_CHOICES.join("|")}>] [--link|--no-link]\n` +
  `        Sans flags dans un terminal → mode interactif (questions + récap).\n`;

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
    const front =
      answers.frontend === "none" ? "aucun" : String(answers.frontend);
    process.stdout.write(
      `\nRécapitulatif :\n` +
        `  app       : ${String(answers.name)}\n` +
        `  preset    : ${String(answers.preset)}\n` +
        `  frontend  : ${front}\n` +
        `  link      : ${answers.link === true ? "oui (checkout local)" : "non (registre npm)"}\n`,
    );
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
  const dir = parsed.dir ?? String(answers.name);
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
  const linkNote = result.linked.length
    ? `\n🔗 link : ${result.linked.length} paquets nodefony câblés en file: sur le checkout local ` +
      `(dev framework — ne pas publier ce package.json tel quel)\n`
    : "";
  process.stdout.write(
    `✔ ${parsed.type} « ${String(answers.name)} » généré dans ${relDest}/\n\n` +
      result.files.map((f) => `  ${f}`).join("\n") +
      `\n${linkNote}\nProchaines étapes :\n` +
      `  cd ${relDest}\n` +
      `  npm install\n` +
      `  npm run dev        # → http://127.0.0.1:5151/api/hello\n`,
  );
  return SysExit.OK;
}
