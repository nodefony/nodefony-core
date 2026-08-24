import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { SysExit } from "./sysexits";
import { version } from "../../package.json";
import {
  getScaffoldSpec,
  COMMAND_PHASE_CHOICES,
  CONTROLLER_KIND_CHOICES,
  DATABASE_CHOICES,
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
import { syncSkillPointers } from "./aiSync";
import { runAiMcpCommand } from "./aiMcp";
import { AGENT_TARGETS, type IAgentTarget } from "./agentTargets";
import { chargePrompts } from "./prompts";
import { installGitHooks } from "./gitHooks";
import { GIT_HOOKS_DIR } from "./gitHooksReport";

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
  "service",
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
    } else if (word === "--git-hooks") {
      answers.gitHooks = true;
    } else if (word === "--link") {
      answers.link = true;
    } else if (word === "--no-link") {
      answers.link = false;
    } else if (word === "--agents") {
      // La TROISIÈME voie de la même question (spec `agents`) : les flags. Sans
      // elle, un script — ou une forge — ne pouvait pas dire ce qu'un humain
      // coche, et le seul moyen d'obtenir le câblage était un terminal.
      //
      // Liste séparée par des virgules, `none` pour l'absence EXPLICITE : elle
      // se distingue de l'option omise, qui laisse parler le défaut (aucun).
      // Chaque valeur reste ENTIÈRE — c'est une question `list`.
      answers.agents = (rest[++i] ?? "")
        .split(/[\s,]+/u)
        .map((c) => c.trim().toLowerCase())
        .filter((c) => c.length > 0 && c !== "none");
    } else if (word === "--preset") {
      answers.preset = rest[++i];
    } else if (word === "--frontend") {
      answers.frontend = rest[++i];
    } else if (word === "--database") {
      answers.database = rest[++i];
    } else if (word === "--kind") {
      answers.kind = rest[++i];
    } else if (word === "--controller") {
      answers.controller = rest[++i];
    } else if (word === "--description") {
      answers.description = rest[++i];
    } else if (word === "--service") {
      // Valeur OPTIONNELLE : `--service` seul garde son sens booléen (« appelle
      // le service de la cible »), `--service <Nom>` désigne LEQUEL. Le mot
      // suivant n'est consommé que s'il n'est pas une autre option — sans quoi
      // `--service --module blog` avalerait `--module`.
      const next = rest[i + 1];
      answers.service = true;
      if (next !== undefined && !next.startsWith("-")) {
        answers.serviceName = rest[++i];
      }
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
      // ─── `create service` ───────────────────────────────────────────────────
      // Injection par le CONSTRUCTEUR — le service visé doit exister dans la
      // cible, sinon le scaffold refuse avant d'écrire.
    } else if (word === "--inject") {
      answers.inject = rest[++i];
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
      // Épouser une table qui existe : son nom, la casse de ses colonnes, le nom
      // de sa clé primaire. Trois réglages, parce que trois suffisent — sur les
      // 134 renommages qu'exige le schéma d'Umami, 115 sont le passage mécanique
      // au snake_case et 18 sont la clé primaire.
    } else if (word === "--table") {
      answers.table = rest[++i];
    } else if (word === "--column-case") {
      answers.columnCase = rest[++i];
    } else if (word === "--id-name") {
      answers.idName = rest[++i];
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
  `               [--agents <liste|none>] — agents de dev à câbler (défaut : aucun)\n` +
  `               [--database <${DATABASE_CHOICES.join("|")}>] — le compose ne porte QUE ce service\n` +
  `               [--link|--no-link] [--no-install] [--no-git] [--git-hooks]\n` +
  `  module     : [--controller <${MODULE_CONTROLLER_CHOICES.join("|")}>] [--no-service] [--command]\n` +
  `               [--frontend <${FRONTEND_CHOICES.join("|")}>] [--description "…"] [--no-install]\n` +
  `  controller : [--kind <${CONTROLLER_KIND_CHOICES.join("|")}>] [--route </api/x>] [--module <nom>]\n` +
  `  service    : [--inject <AutreService>] [--description "…"] [--module <nom>]\n` +
  `               classe @injectable, sans dépendance à un config.ts — pour la découvrir, imite-la\n` +
  `               --inject : dépendance déclarée au CONSTRUCTEUR (@inject + appel), pas container.get\n` +
  `  front      : [--frontend <react|vue|angular|svelte>] [--route </page>] [--module <nom>]\n` +
  `  entity     : [champs…] [--id <${ENTITY_ID_CHOICES.join("|")}>] [--soft-delete] [--no-timestamps]\n` +
  `               [--no-controller] [--no-service] [--no-tests] [--route </api/x>] [--module <nom>]\n` +
  `               [--connector <nom>] [--dialect <sqlite|postgres|mysql>]\n` +
  `               [--index "colA,colB"] [--unique "colA,colB"] — répétables, un par index\n` +
  `               [--table <nom_sql>] [--column-case <camel|snake>] [--id-name <colonne>]\n` +
  `                 — pour épouser une table EXISTANTE ; les propriétés TS ne changent pas\n` +
  `               ex : nodefony create entity Website name:string domain:string \\\n` +
  `                      --table website --column-case snake --id-name website_id\n` +
  `               champs : nom:type[?|!][:index] — types : string(n) text int float bool json date uuid char(n) decimal(p,s) ref:<Entité>\n` +
  `               ex : nodefony create entity Post title:string! content:text views:int author:ref:User\n` +
  `               ex : nodefony create entity Event siteId:uuid path:string --index "siteId,createdAt"\n` +
  `  command    : [--phase <${COMMAND_PHASE_CHOICES.join("|")}>] [--description "…"] [--service] [--module <nom>]\n` +
  `               nom = l'ACTION ; la commande vaut <module>:<action> (ex : blog:publish)\n` +
  `               (types controller/service/front/entity/command : dans un projet existant — app racine ou module)\n` +
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
    throw new Error(
      `--answers-json : JSON invalide (${(e as Error).message})`,
      { cause: e },
    );
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
export function renderDryRun(
  changes: IScaffoldChange[],
  notes?: string[],
): string {
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
  // 🔴 Les notes appartiennent au PLAN, pas à l'exécution. Une simulation qui
  // tait ce que la vraie commande dit — la table visée, son connecteur, les
  // routes REST, ce que le mode développement ne fera PAS — n'est pas une
  // simulation : c'est un inventaire de fichiers. Mesuré au banc : un agent à
  // qui l'on demande d'établir un plan colle la sortie du `--dry-run` et n'a
  // alors AUCUN moyen de nommer la base sur laquelle il travaille.
  if (notes && notes.length > 0) {
    out += `\nCe que l'exécution dirait :\n${notes.map((n) => `  ${n}`).join("\n")}\n`;
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
 * Met en forme le projet avec SON prettier, une fois les dépendances là.
 *
 * Le formatage de la transaction ({@link formatScaffoldOutput}) ne peut rien
 * pour une app NEUVE : à l'instant où ses fichiers sont écrits, `npm install`
 * n'a pas encore tourné et le projet n'a aucun prettier à emprunter. C'est
 * pourtant le cas qui compte le plus — l'application qu'un utilisateur reçoit.
 * D'où cette seconde passe, sur le disque, après l'installation.
 *
 * Un seul processus pour tout le dossier : le `.prettierignore` de l'app
 * écarte `node_modules` et `dist`. Le projet vient de naître, rien n'y est
 * écrit à la main — reformater en bloc n'y écrase aucun style.
 *
 * Silencieux et non bloquant : une app non formatée reste une app qui marche.
 */
function runFormat(dest: string): boolean {
  const bin = path.join(
    dest,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "prettier.cmd" : "prettier",
  );
  if (!existsSync(bin)) {
    return false;
  }
  const r = spawnSync(bin, ["--write", "."], { cwd: dest, stdio: "ignore" });
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
 * Pose les pointeurs vers les skills d'agent livrés par les paquets installés.
 *
 * **Pourquoi ici, et pas par un `postinstall`** : `--ignore-scripts` est courant
 * (intégration continue, politiques d'entreprise), les scripts d'installation
 * sont un vecteur d'attaque connu de l'écosystème npm, et écrire dans un dossier
 * VERSIONNÉ à chaque installation produirait des différences surprises. Le
 * scaffold pose une fois, `npx nodefony ai:sync` remet à jour quand on le
 * demande.
 *
 * **Pourquoi APRÈS l'install et AVANT le premier commit** : les skills vivent
 * dans `node_modules`, il n'y a rien à découvrir tant qu'il n'existe pas ; et
 * ces pointeurs sont faits pour être VERSIONNÉS — l'équipe et l'intégration
 * continue disposent alors des mêmes skills que celui qui a créé l'app.
 *
 * Sans ce geste, le lot ne servirait qu'à celui qui connaît déjà `ai:sync` — or
 * personne n'apprend un verbe absent.
 *
 * @param dest - racine de l'app générée.
 * @returns la note à afficher. Ne lève JAMAIS : une application entièrement
 *   générée ne s'annule pas parce qu'un dossier de skills est illisible.
 */
function poseSkillPointers(dest: string): string {
  try {
    const plan = syncSkillPointers(dest);
    if (plan.skills.length === 0) {
      return `aucun skill livré par les paquets installés → npx nodefony ai:sync après un npm install`;
    }
    return (
      `${plan.skills.length} dans ${plan.directory}/ ` +
      `(${plan.skills.map((s) => s.name).join(", ")}) — commite-les`
    );
  } catch (e) {
    return `non posés (${(e as Error).message}) → npx nodefony ai:sync`;
  }
}

/**
 * Un type manquant se DEMANDE-t-il, ou l'usage est-il la bonne réponse ? PURE.
 *
 * Trois conditions, et chacune dit quelque chose de différent :
 * - l'erreur est bien « aucun type » — un type FAUTIF (`create ap`) se corrige,
 *   il ne se remplace pas par une question qui masquerait la faute de frappe ;
 * - un terminal répond en face — sans lui, une question est un blocage muet ;
 * - `--yes` n'a pas été demandé : il dit « ne me demande rien », et le
 *   respecter vaut mieux que de rendre service.
 *
 * @param erreur - le motif rendu par l'analyse de la ligne de commande.
 * @param ctx - terminal disponible, et présence de `--yes`.
 */
export function doitDemanderLeType(
  erreur: string,
  ctx: { isTTY: boolean; yes: boolean },
): boolean {
  return erreur.includes("reçu : rien") && ctx.isTTY && !ctx.yes;
}

/**
 * Description courte d'un type de scaffold — celle de la SPEC, jamais une
 * seconde version : deux listes de types divergeraient au premier ajout.
 */
function descriptionType(type: string): string {
  const [spec] = getScaffoldSpec(type);
  return spec?.description ?? type;
}

/**
 * Décide si `create app` CÂBLE la porte MCP chez les agents choisis. PURE.
 *
 * Deux refus, deux raisons qui n'ont rien à voir :
 * - **aucun agent choisi** — et c'est le DÉFAUT (la question de la spec part
 *   vide). Déclarer une porte chez un agent ÉCRIT dans la configuration d'un
 *   autre outil : rien de coché, rien d'écrit, en terminal comme ailleurs.
 *   C'est le choix explicite qui autorise, pas la présence d'un humain — ce
 *   qui rend le geste servable par Studio, qui n'est pas un terminal.
 * - **app ni installée ni construite** (`--no-install`, ou une install en
 *   échec) : `ai:mcp` enchaîne sur l'émission du jeton, qui DÉMARRE le kernel.
 *   Sans `node_modules` ni `dist`, on provoquerait soi-même l'échec — le geste
 *   est alors NOMMÉ plutôt que joué.
 *
 * @param ctx - nombre d'agents choisis, et état réel de l'app générée.
 * @returns la proposition, ou le motif du refus (affiché tel quel).
 */
export function planCablageMcp(ctx: {
  choisis: number;
  installed: boolean;
  built: boolean;
}): { propose: true } | { propose: false; motif: string } {
  if (ctx.choisis === 0) {
    return { propose: false, motif: "aucun agent choisi" };
  }
  if (!ctx.installed || !ctx.built) {
    return {
      propose: false,
      motif:
        "agents choisis mais app ni installée ni construite — " +
        "l'émission du jeton démarre le kernel ; à rejouer : npx nodefony ai:mcp",
    };
  }
  return { propose: true };
}

/**
 * Traduit le choix d'agents de développement en appel `ai:mcp` — PURE.
 *
 * ⭐ **Ce qui se choisit, c'est l'AGENT ; la porte MCP vient AVEC.** Demander
 * « veux-tu déclarer une porte MCP ? » posait la question à l'envers : personne
 * n'installe un protocole, on se sert d'un assistant — et c'est lui qui a besoin
 * de la porte. Une seule question, dans les mots de celui qui répond.
 *
 * Deux familles d'agents, une seule liste : ceux qui se déclarent par LEUR CLI
 * (`--agent <clés>`) et ceux qui lisent le `.mcp.json` du projet — pour ces
 * derniers, écrire le fichier EST la déclaration, d'où `none` plutôt que rien :
 * `--agent none` dit « n'appelle aucune CLI », pas « ne fais rien ».
 *
 * `--auth` : l'en-tête porte `${NF_MCP_TOKEN}`, jamais le jeton lui-même. Une
 * app neuve naît avec sa porte fermée ; l'ouvrir sans authentification serait un
 * défaut par défaut.
 *
 * @param choisis - clés cochées par l'utilisateur.
 * @param detectes - agents présents sur ce poste (source unique `AGENT_TARGETS`).
 * @param dest - racine de l'app générée.
 * @returns l'argv à passer à `ai:mcp`, ou `null` quand aucun agent n'est choisi
 *   — coder seul est un choix, et rien ne doit alors être écrit.
 */
export function argvCablageMcp(
  choisis: readonly string[],
  detectes: readonly IAgentTarget[],
  dest: string,
): string[] | null {
  if (choisis.length === 0) return null;
  const parCli = detectes
    .filter((c) => c.declaration === "cli" && choisis.includes(c.cle))
    .map((c) => c.cle);
  return [
    "ai:mcp",
    "--cwd",
    dest,
    "--auth",
    "--agent",
    parCli.length > 0 ? parCli.join(",") : "none",
  ];
}

/**
 * `git init` + first commit dans l'app générée — SEULEMENT si git est
 * disponible ET que le dossier n'est pas déjà couvert par un repo (une app de
 * banc dans le checkout du framework ne doit pas créer un repo imbriqué).
 * Le `.gitignore` généré exclut `*.local` AVANT ce commit : les secrets de
 * `.env.local` ne peuvent pas y entrer.
 *
 * `--git-hooks` : les hooks se posent ENTRE `git init` et le premier commit —
 * `.githooks/` entre ainsi dans le commit initial, comme les pointeurs de
 * skills. Une app déjà couverte par un repo (init sauté) les reçoit AUSSI :
 * `installGitHooks` calcule alors le chemin vu du toplevel, c'est son cas
 * monorepo. Le geste est celui de `nodefony git:hooks` — MÊME implémentation,
 * jamais recopiée.
 *
 * @returns note affichable (fait / sauté et pourquoi)
 */
function runGitInit(dest: string, appName: string, withHooks: boolean): string {
  const git = (...args: string[]) =>
    spawnSync("git", args, { cwd: dest, stdio: "ignore" });
  const hooksNote = (): string => {
    if (!withHooks) return "";
    try {
      const plan = installGitHooks(dest);
      if (plan === null) return " · hooks non posés (hors dépôt git)";
      return plan.refused
        ? " · hooks REFUSÉS (existant préservé — npx nodefony git:hooks pour le détail)"
        : ` · hooks natifs posés (${GIT_HOOKS_DIR}/ + core.hooksPath)`;
    } catch (e) {
      return ` · hooks non posés (${(e as Error).message})`;
    }
  };
  if (spawnSync("git", ["--version"], { stdio: "ignore" }).error) {
    return "git indisponible → repo non initialisé (git init à la main plus tard)";
  }
  if (git("rev-parse", "--is-inside-work-tree").status === 0) {
    return `déjà dans un repo git → init sauté (pas de repo imbriqué)${hooksNote()}`;
  }
  if (git("init").status !== 0) {
    return "git init a échoué → repo non initialisé";
  }
  const hooks = hooksNote();
  git("add", "-A");
  // `--no-verify` : le hook fraîchement posé s'exécuterait SUR ce commit — or
  // c'est un commit de BOOTSTRAP (contenu tout juste généré, node_modules
  // possiblement absent avec --no-install) : typecheck+lint y échouent sans
  // rien dire du projet, et le premier geste des hooks serait de bloquer la
  // création de l'app qu'ils servent. Vécu au test d'intégration.
  const commit = spawnSync(
    "git",
    [
      "commit",
      "--no-verify",
      "-m",
      `chore: bootstrap ${appName} (nodefony create app)`,
    ],
    { cwd: dest, stdio: "ignore" },
  );
  return (
    (commit.status === 0
      ? "repo git initialisé + premier commit"
      : "repo git initialisé (commit initial à faire : identité git non configurée ?)") +
    hooks
  );
}

/**
 * Commande `nodefony create` — orchestre l'adaptateur : parse argv, complète en
 * interactif si TTY, délègue au moteur, rend le récap.
 *
 * @returns exit code sémantique (`OK`, `USAGE`, `CANTCREAT`, `SOFTWARE`)
 */
export async function runCreateCommand(argv: string[]): Promise<number> {
  let parsed = parseCreateArgv(argv);
  // 🔴 Choisie au MENU, la commande n'a reçu AUCUN argument : personne n'a pu
  // taper un type. Rendre l'usage revenait à proposer un geste puis le refuser
  // — exactement ce que le menu existe pour éviter. Le type manquant est donc
  // DEMANDÉ, comme le sont ensuite le nom et les autres réponses. Hors
  // terminal (script, forge), l'usage reste la bonne réponse : il n'y a
  // personne pour répondre.
  if (
    "error" in parsed &&
    doitDemanderLeType(parsed.error, {
      isTTY: process.stdin.isTTY === true,
      yes: argv.includes("--yes"),
    })
  ) {
    const { select } = await chargePrompts();
    const type = (await select({
      message: "Que veux-tu créer ?",
      default: "app",
      choices: CREATE_TYPES.map((t) => ({
        name: `${t} — ${descriptionType(t)}`,
        value: t,
      })),
    })) as string;
    // Le type se glisse À LA PLACE qu'il aurait occupée si l'utilisateur
    // l'avait tapé : après le mot `create`, avant tout le reste.
    const at = argv.indexOf("create");
    const complet = [...argv];
    complet.splice(at === -1 ? argv.length : at + 1, 0, type);
    parsed = parseCreateArgv(complet);
  }
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
    // Valeur EFFECTIVE de chaque question (réponse, sinon défaut de la spec) —
    // c'est elle que lit la condition `askWhen`, comme le fait le moteur.
    const effective = new Map(
      spec.questions.map((q) => [q.key, answers[q.key] ?? q.default]),
    );
    const lines = spec.questions
      // Une question dont l'`askWhen` n'est pas satisfait ne sera PAS honorée
      // (le moteur la ramène à son défaut) : l'afficher annoncerait un choix
      // que la génération ignore — exactement le contresens que ce récap existe
      // pour éviter.
      .filter(
        (q) =>
          !q.askWhen ||
          String(effective.get(q.askWhen.key)) === q.askWhen.equals,
      )
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
        renderDryRun(result.changes ?? [], result.notes) +
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
      // Le chemin annoncé est celui où le module a RÉELLEMENT atterri (il dépend
      // du layout du dépôt) — pas `modules/` en dur, qui enverrait chercher un
      // dossier inexistant dans un monorepo.
      const where = projectRoot
        ? path.relative(projectRoot, result.dest).split(path.sep).join("/")
        : String(answers.name);
      process.stdout.write(
        `\nProchaines étapes (--no-install) :\n` +
          `  npm install        # symlinke ${where} (workspace)\n` +
          `  npm run build\n`,
      );
      return SysExit.OK;
    }
    const installed = projectRoot !== null && runInstall(projectRoot);
    if (!installed || projectRoot === null) {
      process.stdout.write(
        `⚠ npm install a échoué — relance-le à la racine de l'app (le module ne sera pas chargeable avant)\n`,
      );
      return SysExit.OK;
    }
    // Le build se lance à la RACINE (script chaîné : modules puis app), jamais
    // dans le seul module : le `use(...)` posé dans `nodefony.config.ts` ne vit
    // pour le runtime que compilé dans le dist de l'APP. Construit module seul,
    // `inspect`, les gates et la production ignoraient un module pourtant
    // annoncé « installé et construit » — mesuré au banc (tâche 28).
    runFormat(projectRoot);
    const built = runBuild(projectRoot);
    process.stdout.write(
      built
        ? `\n✔ module installé (workspace), module et application construits — un serveur dev le rechargera au prochain redémarrage\n`
        : `\n⚠ npm run build a échoué à la racine — corrige puis relance-le (le runtime charge le dist de l'app)\n`,
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
  // AVANT le build : le build produit `dist/`, que le formateur n'a pas à
  // relire, et une erreur de compilation doit se lire sur des sources dans leur
  // forme finale — pas sur un texte qui changera juste après.
  if (installed) {
    runFormat(result.dest);
  }
  const built = installed ? runBuild(result.dest) : false;
  if (installed && !built) {
    process.stdout.write(
      `⚠ npm run build a échoué — relance-le à la main dans ${relDest}/\n`,
    );
  }
  // AVANT git : ces pointeurs entrent dans le premier commit, comme le lockfile.
  process.stdout.write(
    `\n🤖 skills d'agent : ${poseSkillPointers(result.dest)}\n`,
  );
  // Le câblage MCP AUSSI avant git : le `.mcp.json` est un fichier de PROJET —
  // versionné, lu tel quel par les agents qui suivent le dépôt — il a donc sa
  // place dans le commit initial, exactement comme les pointeurs de skills. Le
  // JETON, lui, n'y entre jamais : il vit dans `.env.local`, que le `.gitignore`
  // généré exclut (`*.local`) avant ce commit.
  // Le choix d'agents vient de la SPEC (question `agents`) — donc du MÊME
  // endroit pour le terminal, Studio et `--answers-json`. Ce qui autorise
  // l'écriture chez un tiers n'est pas la présence d'un humain, c'est un choix
  // EXPLICITE : rien de coché ⇒ rien d'écrit, y compris hors terminal.
  const choisis = Array.isArray(answers.agents)
    ? (answers.agents as string[])
    : [];
  const cablage = planCablageMcp({
    choisis: choisis.length,
    installed,
    built,
  });
  let mcpNote = cablage.propose ? "" : cablage.motif;
  if (cablage.propose) {
    const appelMcp = argvCablageMcp(choisis, AGENT_TARGETS, result.dest);
    if (appelMcp === null) {
      mcpNote = "aucun agent choisi";
    } else {
      // ⭐ MÊME implémentation que `nodefony ai:mcp` — APPELÉE, jamais
      // recopiée : elle porte l'écriture du `.mcp.json`, la déclaration par la
      // CLI de chaque agent (jamais par son fichier), le constat plutôt que le
      // code de sortie, et l'émission du jeton avec sa durée et sa portée.
      await runAiMcpCommand(appelMcp);
    }
  }
  if (mcpNote !== "") {
    process.stdout.write(`🔌 agents IA : ${mcpNote}\n`);
  }
  const gitNote = parsed.git
    ? runGitInit(result.dest, String(answers.name), answers.gitHooks === true)
    : "sauté (--no-git)";
  process.stdout.write(`🌱 git : ${gitNote}\n`);
  // Une base docker a été retenue : `.env` déclare `NF_DATABASE_URL` dessus, donc
  // le premier `npm run dev` échoue tant que le service n'écoute pas. L'étape est
  // dans la séquence, pas en note de bas de page.
  const needsInfra =
    answers.preset !== "minimal" &&
    answers.database !== undefined &&
    answers.database !== "sqlite";
  process.stdout.write(
    `\nProchaines étapes :\n` +
      `  cd ${relDest}\n` +
      (installed ? "" : `  npm install\n`) +
      (built ? "" : `  npm run build\n`) +
      (needsInfra
        ? `  npm run infra:up   # docker : ${String(answers.database)} + Redis (NF_DATABASE_URL pointe dessus)\n`
        : "") +
      // La console d'administration n'existe QUE si le préset l'a installée, et
      // le port n'est pas garanti : `portPolicy: "auto"` prend le suivant libre
      // quand 5152 est occupé — annoncer une adresse fixe et une console absente
      // envoie l'utilisateur sur deux 404 dès sa première minute.
      `  npm run dev        # → https://127.0.0.1:5152 (ou le port libre suivant, annoncé au démarrage)\n` +
      (answers.preset === "complete"
        ? `                     # console d'administration : /nodefony — admin/admin en dev\n`
        : "") +
      // Le geste n'est PAS perdu quand il n'a pas été proposé (forge, --yes) ou
      // qu'il a été décliné : il se nomme. Une capacité qu'on n'atteint pas
      // n'existe pas.
      (mcpNote !== ""
        ? `  npx nodefony ai:mcp # câbler ton agent IA (porte MCP + jeton)\n`
        : ""),
  );
  return SysExit.OK;
}
