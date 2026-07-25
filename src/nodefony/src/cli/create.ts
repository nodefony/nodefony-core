import path from "node:path";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SysExit } from "./sysexits";
import { version } from "../../package.json";
import {
  getScaffoldSpec,
  COMMAND_PHASE_CHOICES,
  CONTROLLER_KIND_CHOICES,
  ENTITY_ID_CHOICES,
  FRONTEND_CHOICES,
  MODULE_CONTROLLER_CHOICES,
  PRESET_CHOICES,
} from "./scaffold/spec";
import {
  findPackageRoot,
  findProjectRoot,
  listTargets,
  getScaffoldContext,
  resolveLocalWorkspaces,
  runScaffold,
  type TScaffoldAnswers,
} from "./scaffold/engine";
import { diffLines, type IScaffoldChange } from "./scaffold/writer";
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

/** Types de scaffold disponibles. */
export const CREATE_TYPES = [
  "app",
  "module",
  "controller",
  "front",
  "entity",
  "command",
] as const;
export type TCreateType = (typeof CREATE_TYPES)[number];

export interface ICreateRequest {
  /** `undefined` seulement avec `--describe-json` (décrire TOUS les types). */
  type?: TCreateType;
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
  /** `--dry-run` : montrer ce qui serait écrit, ne rien écrire. */
  dryRun: boolean;
  /** `--describe-json` : décrire le scaffold en JSON et sortir (mode machine). */
  describeJson: boolean;
  /** `--answers-json <fichier|->` : source des réponses (fichier, ou `-` = stdin). */
  answersJson?: string;
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
  let dryRun = false;
  let describeJson = false;
  let answersJson: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const word = rest[i];
    if (word === "--force" || word === "-f") {
      force = true;
    } else if (word === "--yes" || word === "-y") {
      yes = true;
    } else if (word === "--dry-run" || word === "-n") {
      dryRun = true;
    } else if (word === "--describe-json") {
      describeJson = true;
    } else if (word === "--answers-json") {
      answersJson = rest[++i];
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
    } else if (word === "--phase") {
      answers.phase = rest[++i];
    } else if (word === "--route") {
      answers.route = rest[++i];
    } else if (word === "--module") {
      answers.module = rest[++i];
      // ─── `create entity` ────────────────────────────────────────────────────
      // `--controller` est déjà un flag À VALEUR (`create module --controller hello`) :
      // pour une entité, le booléen s'exprime donc par sa négation, jamais par
      // `--controller` seul (qui avalerait le mot suivant).
    } else if (word === "--no-controller") {
      answers.controller = false;
    } else if (word === "--fields") {
      answers.fields = rest[++i];
    } else if (word === "--id") {
      answers.id = rest[++i];
    } else if (word === "--connector") {
      answers.connector = rest[++i];
    } else if (word === "--dialect") {
      answers.dialect = rest[++i];
      // Index de TABLE : RÉPÉTABLES, parce qu'une table réelle en porte plusieurs
      // et qu'ils ne se cumulent pas en une seule liste — `--index "a,b" --index
      // "c,d"` déclare deux index de deux colonnes, jamais un de quatre.
    } else if (word === "--index" || word === "--unique") {
      const value = rest[++i];
      if (value !== undefined) {
        const key = word === "--index" ? "index" : "uniqueIndex";
        const current = answers[key];
        answers[key] = [...(Array.isArray(current) ? current : []), value];
      }
    } else if (word === "--soft-delete") {
      answers.softDelete = true;
    } else if (word === "--no-timestamps") {
      answers.timestamps = false;
    } else if (word === "--no-tests") {
      answers.tests = false;
    } else if (word === "--dir") {
      dir = rest[++i];
    } else if (word.startsWith("-")) {
      return { error: `option inconnue : ${word}` };
    } else {
      positionals.push(word);
    }
  }
  const [type, name, ...extra] = positionals;
  // Le type est obligatoire pour AGIR, facultatif pour se DÉCRIRE : un agent
  // qui découvre l'outil demande le catalogue entier avant de savoir quel type
  // il veut.
  if (
    type !== undefined &&
    !(CREATE_TYPES as readonly string[]).includes(type)
  ) {
    return {
      error: `type requis : ${CREATE_TYPES.join(" | ")} (reçu : ${type})`,
    };
  }
  if (type === undefined && !describeJson) {
    return {
      error: `type requis : ${CREATE_TYPES.join(" | ")} (reçu : rien)`,
    };
  }
  if (answersJson === undefined && rest.includes("--answers-json")) {
    return {
      error: "--answers-json attend un fichier, ou - pour l'entrée standard",
    };
  }
  if (name !== undefined) {
    answers.name = name;
  }
  // Les champs d'une entité se déclarent en positionnels (façon Rails) :
  // `create entity Post title:string content:text`. `--fields "…"` reste possible
  // pour un appel programmatique ; les positionnels l'emportent s'il y en a.
  if (type === "entity" && extra.length > 0) {
    answers.fields = extra.join(" ");
  }
  return {
    type: type as TCreateType | undefined,
    answers,
    dir,
    force,
    yes,
    install,
    git,
    dryRun,
    describeJson,
    answersJson,
  };
}

const USAGE =
  `usage : nodefony create <${CREATE_TYPES.join("|")}> [name] [--dir <path>] [--force] [--yes] [--dry-run|-n]\n` +
  `  app        : [--preset <${PRESET_CHOICES.join("|")}>] [--frontend <${FRONTEND_CHOICES.join("|")}>]\n` +
  `               [--link|--no-link] [--no-install] [--no-git]\n` +
  `  module     : [--controller <${MODULE_CONTROLLER_CHOICES.join("|")}>] [--no-service] [--command]\n` +
  `               [--frontend <${FRONTEND_CHOICES.join("|")}>] [--description "…"] [--no-install]\n` +
  `  controller : [--kind <${CONTROLLER_KIND_CHOICES.join("|")}>] [--route </api/x>] [--module <nom>]\n` +
  `  front      : [--frontend <react|vue|angular>] [--route </page>] [--module <nom>]\n` +
  `  entity     : [champs…] [--id <${ENTITY_ID_CHOICES.join("|")}>] [--soft-delete] [--no-timestamps]\n` +
  `               [--no-controller] [--no-service] [--no-tests] [--route </api/x>] [--module <nom>]\n` +
  `               [--connector <nom>] [--dialect <sqlite|postgres|mysql>]\n` +
  `               [--index "colA,colB"] [--unique "colA,colB"] — répétables, un par index\n` +
  `               champs : nom:type[?|!][:index] — types : string text int float bool json date uuid ref:<Entité>\n` +
  `               ex : nodefony create entity Post title:string! content:text views:int author:ref:User\n` +
  `               ex : nodefony create entity Event siteId:uuid path:string --index "siteId,createdAt"\n` +
  `  command    : [--phase <${COMMAND_PHASE_CHOICES.join("|")}>] [--description "…"] [--service] [--module <nom>]\n` +
  `               nom = l'ACTION ; la commande vaut <module>:<action> (ex : blog:publish)\n` +
  `               (types controller/front/entity/command : dans un projet existant — app racine ou module)\n` +
  `  Sans flags dans un terminal → mode interactif (questions + récap).\n` +
  `  Mode machine (agents, scripts) :\n` +
  `    --describe-json                  types, questions, valeurs permises et cibles du projet, en JSON\n` +
  `    --answers-json <fichier|->       réponses en JSON (- = entrée standard) ; les flags l'emportent\n` +
  `    --dry-run                        le plan (fichiers créés + diff des réécritures), sans rien écrire\n`;

/**
 * Décrit le scaffold en JSON — la porte MACHINE de `nodefony create`.
 *
 * POURQUOI : un agent qui développe dans une app Nodefony n'a que deux façons
 * d'obtenir du code conforme — imiter des fichiers existants (et se tromper dès
 * que l'exemple vieillit), ou APPELER le générateur. La seconde n'est possible
 * que si l'outil sait dire ce qu'il attend : types disponibles, questions,
 * valeurs permises, défauts. C'est exactement ce que la spec déclarative
 * contient déjà ; il ne manquait que la porte.
 *
 * Le format est additif : `types` décrit les questions, `project` décrit où l'on
 * se trouve — et son `context` porte ce que seul le projet sait (connecteurs
 * déclarés, entités déjà créées, traduction des types par moteur). Une question
 * marquée `optionsFrom` s'y réfère : ses réponses valides sont là, pas dans la
 * spec, parce qu'elles changent d'un projet à l'autre.
 */
function describeScaffold(type: TCreateType | undefined): string {
  const projectRoot = findProjectRoot(process.cwd());
  return `${JSON.stringify(
    {
      nodefony: version,
      types: getScaffoldSpec(type),
      caps: {
        hasCheckout: resolveLocalWorkspaces(findPackageRoot()) !== null,
      },
      project: projectRoot
        ? {
            root: projectRoot,
            // Cibles d'un scaffold in-project : l'app et ses modules locaux.
            targets: listTargets(projectRoot).map((t) => ({
              kind: t.kind,
              name: t.name,
            })),
            // Ce que le projet RÉEL offre comme choix — un appelant automatique
            // n'a pas à deviner un nom de connecteur ni d'entité cible.
            context: getScaffoldContext(projectRoot),
          }
        : null,
      usage: {
        run: "nodefony create <type> <name> [flags]",
        answers:
          "nodefony create <type> --answers-json - (réponses JSON sur l'entrée standard ; les flags l'emportent)",
        preview: "ajouter --dry-run pour obtenir le plan sans rien écrire",
      },
    },
    null,
    2,
  )}\n`;
}

/**
 * Réponses lues depuis `--answers-json` (fichier, ou `-` = entrée standard).
 *
 * Une clé hors spec est REFUSÉE plutôt qu'ignorée : `resolveAnswers` ne
 * conserve que les clés déclarées, si bien qu'un `"preset"` mal orthographié
 * produirait un scaffold silencieusement différent de celui demandé — le pire
 * retour possible pour un appelant automatique, qui n'a pas d'yeux pour
 * relire le résultat.
 *
 * @throws Error si la source est illisible, le JSON invalide, ou une clé inconnue
 */
function readAnswersJson(source: string, type: TCreateType): TScaffoldAnswers {
  const raw =
    source === "-" ? readFileSync(0, "utf8") : readFileSync(source, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`--answers-json : JSON invalide (${(e as Error).message})`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--answers-json : un objet de réponses est attendu");
  }
  const [spec] = getScaffoldSpec(type);
  const known = new Set(spec.questions.map((q) => q.key));
  const answers: TScaffoldAnswers = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (!known.has(key)) {
      throw new Error(
        `--answers-json : clé inconnue « ${key} » pour ${type} — attendues : ${[...known].join(", ")}`,
      );
    }
    if (typeof value !== "string" && typeof value !== "boolean") {
      throw new Error(
        `--answers-json : « ${key} » doit être une chaîne ou un booléen`,
      );
    }
    answers[key] = value;
  }
  return answers;
}

/** Lignes de diff affichées par fichier réécrit, avant troncature annoncée. */
const DRY_RUN_DIFF_LINES = 20;

/**
 * Rend le plan d'un `--dry-run` : ce qui serait créé, et surtout le DIFF de ce
 * qui serait réécrit.
 *
 * Les créations sont listées à plat (leur contenu n'écrase rien, l'inventaire
 * suffit) ; les réécritures sont les seules opérations qui touchent au travail
 * existant — c'est là que la simulation a une valeur, donc c'est là qu'on
 * dépense de la place.
 */
function renderDryRun(changes: IScaffoldChange[]): string {
  const rel = (file: string) => path.relative(process.cwd(), file) || ".";
  const created = changes.filter((c) => c.kind === "create");
  const rewritten = changes.filter((c) => c.kind === "overwrite");
  let out =
    `\n🔍 simulation (--dry-run) — RIEN n'a été écrit\n\n` +
    `  ${created.length} fichier(s) à créer, ${rewritten.length} à réécrire\n`;
  if (created.length > 0) {
    out += `\nCréés :\n${created.map((c) => `  + ${rel(c.path)}`).join("\n")}\n`;
  }
  for (const change of rewritten) {
    const lines = diffLines(change.previous ?? "", change.content).filter(
      (l) => l.kind !== "keep",
    );
    const shown = lines.slice(0, DRY_RUN_DIFF_LINES);
    out +=
      `\nRéécrit : ${rel(change.path)}\n` +
      shown
        .map((l) => `  ${l.kind === "add" ? "+" : "-"} ${l.text}`)
        .join("\n") +
      (lines.length > shown.length
        ? `\n  … ${lines.length - shown.length} ligne(s) de plus\n`
        : "\n");
  }
  return out;
}

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
  if (parsed.describeJson) {
    // Avant tout le reste : se décrire ne dépend d'aucune réponse, et doit
    // rester lisible même quand la commande serait par ailleurs incomplète.
    process.stdout.write(describeScaffold(parsed.type));
    return SysExit.OK;
  }
  const type = parsed.type as TCreateType;
  const caps = {
    hasCheckout: resolveLocalWorkspaces(findPackageRoot()) !== null,
  };
  let answers = parsed.answers;
  if (parsed.answersJson !== undefined) {
    try {
      // Les FLAGS l'emportent : le fichier porte le gros de la demande, le flag
      // est la retouche ponctuelle de l'appel — l'inverse rendrait un flag
      // explicite silencieusement inopérant.
      answers = { ...readAnswersJson(parsed.answersJson, type), ...answers };
    } catch (e) {
      process.stderr.write(`create: ${(e as Error).message}\n`);
      return SysExit.USAGE;
    }
  }
  const interactive = process.stdin.isTTY === true && !parsed.yes;
  if (interactive) {
    const [spec] = getScaffoldSpec(type);
    // Le contexte du projet transforme les questions dont les réponses valides
    // n'existent QUE dans ce projet (connecteurs déclarés, entités présentes) en
    // choix réels — au lieu d'un champ libre où une faute de frappe ne se voit
    // qu'au démarrage suivant. `null` hors projet : les questions restent libres.
    answers = await askMissing(
      spec,
      answers,
      caps,
      process.stdin,
      process.stdout,
      getScaffoldContext(process.cwd()),
    );
    // Récap générique piloté par la spec (mêmes questions que l'interactif).
    // ⚠️ On affiche ce qui SERA fait, donc le DÉFAUT de la spec quand la question n'a
    // pas été posée (réglage `advanced`). Sans ce repli, un booléen non répondu
    // s'affichait « non » alors que son défaut est `true` — le récap annonçait
    // « service : non » puis le service était généré (vécu).
    const lines = spec.questions
      .map((q) => {
        const value = answers[q.key] ?? q.default;
        const shown =
          q.type === "boolean"
            ? value === true
              ? "oui"
              : "non"
            : String(value ?? "") || "(auto)";
        return `  ${q.key.padEnd(10)} : ${shown}`;
      })
      .join("\n");
    process.stdout.write(`\nRécapitulatif :\n${lines}\n`);
    if (!(await confirm(parsed.dryRun ? "Simuler ?" : "Générer ?"))) {
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
    parsed.dir ?? (type === "app" ? String(answers.name) : process.cwd());
  let result;
  try {
    result = runScaffold(
      { type: type, answers, dir, force: parsed.force },
      version,
      { dryRun: parsed.dryRun },
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
  if (parsed.dryRun) {
    // Sortie AVANT toute étape post-génération : installer, construire ou
    // initialiser un dépôt pour des fichiers qui n'existent pas serait
    // exactement le contraire de ce que « simulation » promet.
    process.stdout.write(
      `✔ ${type} « ${String(answers.name)} » — cible : ${relDest}/\n` +
        renderDryRun(result.changes ?? []) +
        `\nRelance sans --dry-run pour écrire.\n`,
    );
    return SysExit.OK;
  }
  if (type === "module") {
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
  if (type !== "app") {
    // In-project : ni install, ni git — le projet existe. En dev, le
    // superviseur rebuild/relance tout seul au prochain tick de watch.
    process.stdout.write(
      `✔ ${type} « ${String(answers.name)} » généré dans ${relDest}/\n\n` +
        result.files.map((f) => `  ${f}`).join("\n") +
        // Une commande CLI n'expose aucune URL : annoncer « Endpoints » pour
        // elle serait un contresens (l'utilisateur chercherait une route).
        `\n\n${type === "command" ? "Câblage" : "Endpoints"} :\n` +
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
    `✔ ${type} « ${String(answers.name)} » généré dans ${relDest}/\n\n` +
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
