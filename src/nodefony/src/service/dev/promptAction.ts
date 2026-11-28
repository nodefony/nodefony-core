/**
 * Une action de l'invite — le contrat que partagent les verbes du
 * superviseur, les commandes du CLI et l'assistant (ADR-0013 §7, #538).
 * Figé par l'ADR : il ne bouge pas d'un lot à l'autre, chacun l'implémente.
 */
import type { IQuestion, IQuestionOutcome } from "../../cli/question";
import { redactSecrets } from "../../runtime/redact";
import {
  PROMPT_INTERRUPTED_CODE,
  PROMPT_NOT_STARTED_CODE,
} from "./promptLaunch";
import {
  computeCompletions,
  type ICliManifest,
  type ICliManifestCommand,
} from "../../cli/completion";

/** Une demande de confirmation, posée par une action avant d'agir. */
export interface IConfirmRequest {
  readonly title: string;
  readonly detail?: string;
  readonly action?: {
    tool: string;
    arguments: Readonly<Record<string, unknown>>;
  };
  readonly risk: "read" | "write" | "destructive";
}

/**
 * La réponse à une confirmation — le même triplet que l'élicitation MCP.
 * `decline` est rendu au modèle ; `cancel` arrête le tour. Une approbation
 * ne vaut que pour l'appel qu'elle accompagne, jamais « pour la session ».
 */
export interface IConfirmDecision {
  readonly action: "accept" | "decline" | "cancel";
  readonly id: string;
  readonly at: number;
}

/** Ce que l'invite prête à une action pendant qu'elle tourne. */
export interface IPromptIO {
  /** Vers l'historique, au fil de l'eau (jeton par jeton). */
  write(text: string, stream?: "out" | "err"): void;
  confirm(request: IConfirmRequest): Promise<IConfirmDecision>;
  /**
   * Pose une question dans l'onglet de l'action — celle d'une commande lancée
   * depuis l'invite, que le canal IPC remonte. `signal` la retire de l'écran
   * (commande finie ou interrompue) : l'issue est alors `cancel`.
   */
  ask(question: IQuestion, signal: AbortSignal): Promise<IQuestionOutcome>;
  /**
   * Prête le terminal à `task` — un programme interactif qui en hérite — puis
   * le reprend : le plein écran est quitté (mode cuit, écran d'avant), le
   * rendu s'arrête et l'ingestion continue ; `task` finie, une touche ramène
   * l'écran. Pendant le prêt, Ctrl+C va au programme, jamais au superviseur.
   */
  suspend<T>(task: () => Promise<T>): Promise<T>;
  /**
   * Le build que le superviseur mène en ce moment, s'il y en a un. La
   * promesse rend `true` quand il réussit ; `false` s'il échoue, si `signal`
   * tombe (Ctrl+C dans l'onglet) ou si le terminal se ferme. `null` : aucun
   * build ne tourne — l'action part tout de suite, sans microtâche.
   *
   * @param signal - l'interruption de l'action qui attend.
   */
  pendingBuild(signal: AbortSignal): Promise<boolean> | null;
  readonly columns: number;
}

/** Une action que l'invite sait lancer. */
export interface IPromptAction {
  readonly id: string;
  /** La saisie lui revient-elle ? */
  matches(input: string): boolean;
  /**
   * Les saisies ENTIÈRES qui prolongent `prefix` (Tab) : `/re` → `/restart`,
   * `/nodefony build --f` → `/nodefony build --force`.
   *
   * @param prefix - la saisie, du début au curseur.
   */
  complete?(prefix: string): readonly string[] | Promise<readonly string[]>;
  /**
   * Un libellé : l'action ouvre SON onglet (`run`), titré ainsi — sa sortie y
   * reste, à l'abri du trafic du serveur, et son issue ✓ / ✗ s'y lit. Absent,
   * ou `null` pour cette saisie (un refus, une erreur d'usage) : elle écrit
   * dans l'onglet d'où elle part. Additif au contrat de l'ADR-0013 §7 (#538,
   * lot 2).
   *
   * @param input - la saisie qu'elle va lancer.
   * @returns le libellé de l'onglet (`build`), ou `null`.
   */
  tabTitle?(input: string): string | null;
  /**
   * Lance l'action.
   *
   * @returns son code de sortie.
   */
  run(input: string, io: IPromptIO, signal: AbortSignal): Promise<number>;
}

/** Ce que les verbes du superviseur font faire — fournis par lui. */
export interface ISupervisorVerbs {
  /**
   * Relance le serveur ; les fichiers qu'un rechargement différé retenait
   * sont bâtis d'abord (un lancement de l'invite en cours ne l'empêche pas).
   *
   * @returns `false` si un rechargement est déjà en cours.
   */
  restart(): Promise<boolean>;
  /** Vide l'onglet affiché. */
  clear(): void;
  /**
   * Ferme l'onglet affiché — une commande finie, un panneau.
   *
   * @returns `false` s'il ne se ferme pas (`serveur`, un journal).
   */
  close(): boolean;
  /** Ouvre l'aide. */
  help(): void;
  /**
   * Relève l'état des process et des ports, et l'ouvre en panneau.
   *
   * @param signal - l'interruption de l'invite (Ctrl+C) : levée, rien ne
   *   s'ouvre.
   */
  status(signal: AbortSignal): Promise<void>;
  /** Arrête proprement le superviseur, le serveur et ses enfants. */
  quit(): void;
}

/**
 * Le préfixe d'une commande de l'invite, à la manière de Claude Code :
 * `/help`, `/quit`. Une saisie sans lui n'est pas une commande — elle
 * reste libre pour l'assistant (#539).
 */
export const PROMPT_COMMAND_PREFIX = "/";

/**
 * Les verbes du superviseur, ce qu'ils font et leurs autres noms — l'aide, le
 * texte d'invite et la complétion les lisent.
 */
export const SUPERVISOR_VERBS: readonly {
  readonly id: "status" | "restart" | "clear" | "close" | "help" | "quit";
  /** Autres noms reconnus, sans le préfixe. */
  readonly aliases: readonly string[];
  readonly does: string;
}[] = [
  {
    id: "status",
    aliases: [],
    does: "l'état des process et des ports, en panneau",
  },
  {
    id: "restart",
    aliases: ["reboot"],
    does: "relancer le serveur — force un rechargement différé",
  },
  { id: "clear", aliases: [], does: "vider l'onglet affiché" },
  {
    id: "close",
    aliases: [],
    does: "fermer l'onglet d'une commande finie (Échap)",
  },
  { id: "help", aliases: [], does: "l'aide complète, en rubriques (F1)" },
  {
    id: "quit",
    aliases: ["exit"],
    does: "tout arrêter : serveur et superviseur",
  },
];

/**
 * La porte des commandes du CLI dans l'invite : `/nodefony <commande>`, la
 * ligne qu'on taperait dans un terminal, préfixée. La bande la propose dès
 * le `/` (`devMenuBand.ts`).
 */
export const CLI_PROMPT_COMMAND = {
  id: "nodefony",
  usage: `${PROMPT_COMMAND_PREFIX}nodefony <commande>`,
  does: "une commande du CLI — la bande les propose dès le « / »",
} as const;

/**
 * Le préfixe d'une ligne du shell : `!git status`, à la manière des shells
 * interactifs (IPython, Vim) et de Claude Code.
 */
export const PROMPT_SHELL_PREFIX = "!";

/**
 * La porte des lignes du shell dans l'invite : `!<ligne>`, lancée par le shell
 * de l'utilisateur dans son onglet (`promptAction.ts#shellLineAction`).
 */
export const SHELL_PROMPT_LINE = {
  id: "shell",
  usage: `${PROMPT_SHELL_PREFIX}<ligne>`,
  does: "une ligne du shell, dans son onglet — la ligne qu'on taperait dans un terminal",
} as const;

/**
 * La porte des programmes INTERACTIFS : `/term <ligne>` — un éditeur,
 * `npm init`, `git add -p`. La ligne part au shell comme une ligne `!`, mais
 * le terminal lui est prêté, clavier compris (`promptAction.ts#terminalLineAction`).
 */
export const TERM_PROMPT_COMMAND = {
  id: "term",
  usage: `${PROMPT_COMMAND_PREFIX}term <ligne>`,
  does: "un programme interactif (éditeur, npm init) : il prend le terminal, puis le rend",
} as const;

/**
 * La commande du manifeste que désigne ce que l'on tape — son nom ou l'un de
 * ses alias : le refus porte sur ce que l'on tape.
 *
 * @param manifest - le manifeste du CLI (`null` s'il est illisible).
 * @param name - le premier mot tapé après `/nodefony`.
 * @returns la commande, ou `undefined` si aucune ne porte ce nom.
 */
export function findPromptCommand(
  manifest: ICliManifest | null,
  name: string,
): ICliManifestCommand | undefined {
  if (manifest === null) return undefined;
  for (const command of manifest.commands) {
    if (command.name === name || command.aliases.includes(name)) return command;
  }
  return undefined;
}

/**
 * Une commande du CLI que l'invite propose : ni une commande qui REFUSE
 * l'invite (`prompt: "refuse"`, déclaré par la commande et publié au
 * manifeste — runtime, arrêt, terminal pris), ni une commande qu'un verbe
 * porte déjà (`status`). La bande et Tab lisent cette seule règle.
 *
 * @param command - la commande, telle que le manifeste la publie.
 * @returns `true` si l'invite la propose.
 */
export function isPromptCommand(command: ICliManifestCommand): boolean {
  if (command.prompt === "refuse") return false;
  for (const verb of SUPERVISOR_VERBS)
    if (verb.id === command.name) return false;
  return true;
}

/** Longueur au plus d'une ligne de commande citée dans un message. */
const PROMPT_LINE_MAX = 200;

/**
 * Découpe une ligne de commande en arguments, comme un shell le ferait pour
 * l'essentiel : blancs entre les mots, `"…"` et `'…'` pour en garder un
 * entier, `\` devant un caractère pour le prendre tel quel (hors `'…'`).
 * Aucune substitution (`$VAR`, `*`, `~`) : la ligne part sans shell.
 *
 * @param line - la ligne, sans le `/nodefony` de tête.
 * @returns les arguments, ou `null` si un guillemet reste ouvert.
 */
export function splitPromptLine(line: string): string[] | null {
  const out: string[] = [];
  let word = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length) {
        word += line.charAt(++i);
      } else word += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (ch === "\\" && i + 1 < line.length) {
      word += line.charAt(++i);
      started = true;
    } else if (/\s/.test(ch)) {
      if (started) out.push(word);
      word = "";
      started = false;
    } else {
      word += ch;
      started = true;
    }
  }
  if (quote !== null) return null;
  if (started) out.push(word);
  return out;
}

/**
 * Lance une commande du CLI — ses arguments, sans `nodefony` — et rend son
 * code de sortie (`promptLaunch.ts#launchPromptCommand`, posé par le
 * superviseur).
 */
export type PromptCommandLauncher = (
  argv: readonly string[],
  io: IPromptIO,
  signal: AbortSignal,
) => Promise<number>;

/**
 * L'action `/nodefony <commande>` : la commande du CLI, en sous-processus,
 * dans SON onglet (`tabTitle` = le nom de la commande). Une commande de
 * runtime est refusée, en disant pourquoi, dans l'onglet d'où l'on tape.
 *
 * Tab complète la ligne par `computeCompletions` — la complétion du shell,
 * sur le même manifeste : le nom de la commande, puis ses arguments, ses
 * options et les valeurs qu'elles attendent.
 *
 * @param manifest - le manifeste du CLI, relu à chaque Tab et à chaque
 *   lancement (`null` s'il est illisible) : il porte les refus déclarés
 *   (`prompt: "refuse"`). Absent : Tab ne complète que `/nodefony`, et rien
 *   ne se lance — sans lui, rien ne dit qu'une commande refuse l'invite.
 * @param launch - le lanceur. Absent : la commande est refusée avec la ligne
 *   à taper dans un autre terminal.
 * @returns l'action.
 */
export function cliCommandAction(
  manifest?: () => ICliManifest | null,
  launch?: PromptCommandLauncher,
): IPromptAction {
  const head = `${PROMPT_COMMAND_PREFIX}${CLI_PROMPT_COMMAND.id}`;
  const nameOf = (input: string): string =>
    input.trim().slice(head.length).trim().split(/\s/, 1)[0] ?? "";
  return {
    id: CLI_PROMPT_COMMAND.id,
    tabTitle: (input: string): string | null => {
      const name = nameOf(input);
      if (launch === undefined || name === "") return null;
      const read = manifest?.() ?? null;
      if (read === null || findPromptCommand(read, name)?.prompt === "refuse") {
        return null;
      }
      // Un guillemet ouvert est une erreur d'usage : elle se dit sur place.
      return splitPromptLine(input.trim().slice(head.length)) === null
        ? null
        : name.slice(0, PROMPT_VERB_MAX);
    },
    matches: (input: string): boolean => {
      const trimmed = input.trim();
      return (
        trimmed.startsWith(head) &&
        (trimmed.length === head.length ||
          /\s/.test(trimmed.charAt(head.length)))
      );
    },
    complete: (prefix: string): readonly string[] => {
      const line = prefix.trimStart();
      if (!line.startsWith(PROMPT_COMMAND_PREFIX)) return [];
      if (line.length <= head.length)
        return head.startsWith(line) ? [head] : [];
      if (!/\s/.test(line.charAt(head.length)) || !line.startsWith(head)) {
        return [];
      }
      const read = manifest?.() ?? null;
      if (read === null) return [];
      // Le protocole du shell : tous les mots, le dernier (en cours) même vide.
      const words = line.slice(head.length).trimStart().split(/\s+/);
      const typed = words[words.length - 1] ?? "";
      const before = words.slice(0, -1);
      const lead = before.length === 0 ? head : `${head} ${before.join(" ")}`;
      const seen = new Set<string>();
      const out: string[] = [];
      // La forme courte (`-f`) seulement si l'on tape `-x` : sinon elle
      // double la longue, et leur début commun tombe à `-`.
      const short = /^-[^-]?$|^-[^-]/.test(typed);
      for (const word of computeCompletions(read, words)) {
        if (!word.startsWith(typed) || seen.has(word)) continue;
        if (!short && /^-[^-]/.test(word)) continue;
        if (before.length === 0) {
          const command = findPromptCommand(read, word);
          if (command !== undefined && !isPromptCommand(command)) continue;
        }
        seen.add(word);
        out.push(`${lead} ${word}`);
      }
      return out;
    },
    run: async (
      input: string,
      io: IPromptIO,
      signal: AbortSignal,
    ): Promise<number> => {
      const whole = input.trim().slice(head.length).trim();
      const line =
        whole.length > PROMPT_LINE_MAX
          ? `${whole.slice(0, PROMPT_LINE_MAX)}…`
          : whole;
      const name = nameOf(input);
      if (name === "") {
        io.write(
          `${CLI_PROMPT_COMMAND.usage} — la bande propose les commandes, Tab complète\n`,
          "err",
        );
        return 64;
      }
      const read = manifest?.() ?? null;
      if (findPromptCommand(read, name)?.prompt === "refuse") {
        io.write(
          `« nodefony ${name} » ne se lance jamais depuis l'invite : elle démarre, arrête ou prend le terminal que ce superviseur tient\n`,
          "err",
        );
        return 1;
      }
      const argv = splitPromptLine(whole);
      if (argv === null) {
        io.write(`guillemet non fermé : ${redactSecrets(line)}\n`, "err");
        return 64;
      }
      if (launch !== undefined && read === null) {
        // Sans manifeste, rien ne dit si la commande refuse l'invite : on ne
        // lance pas à l'aveugle ce qui pourrait arrêter ce superviseur.
        io.write(
          `liste des commandes illisible — « nodefony ${line} » ne se lance pas d'ici ; dans un autre terminal : npx nodefony ${line}\n`,
          "err",
        );
        return 1;
      }
      if (launch === undefined) {
        io.write(
          `« nodefony ${line} » ne se lance pas depuis cette invite — dans un autre terminal : npx nodefony ${line}\n`,
          "err",
        );
        return 1;
      }
      // Lancée en plein build, la commande chargerait un `dist` à moitié
      // écrit et rendrait de fausses erreurs : elle attend, onglet ouvert. Un
      // build peut en suivre un autre (une sauvegarde de plus) : on revérifie.
      for (
        let build = io.pendingBuild(signal);
        build !== null;
        build = io.pendingBuild(signal)
      ) {
        io.write("attend la fin du build…\n");
        if (await build) continue;
        if (signal.aborted) return PROMPT_INTERRUPTED_CODE;
        io.write("build en échec — la commande n'est pas lancée\n", "err");
        return PROMPT_NOT_STARTED_CODE;
      }
      return launch(argv, io, signal);
    },
  };
}

/**
 * Lance une ligne du shell — sans le `!` de tête — et rend son code de sortie
 * (`promptLaunch.ts#launchPromptCommand` avec `shell`, posé par le
 * superviseur).
 */
export type PromptShellLauncher = (
  line: string,
  io: IPromptIO,
  signal: AbortSignal,
) => Promise<number>;

/**
 * Le titre de l'onglet d'une ligne du shell : son premier mot, sans le chemin
 * qui le précède (`!./node_modules/.bin/tsc -b` → `tsc`), les deux
 * séparateurs compris.
 *
 * @param line - la ligne, sans le `!`.
 * @returns le titre, borné, ou `""` pour une ligne vide.
 */
function shellTitle(line: string): string {
  const word = line.split(/\s/, 1)[0] ?? "";
  const cut = Math.max(word.lastIndexOf("/"), word.lastIndexOf("\\"));
  const name =
    cut === -1 || cut === word.length - 1 ? word : word.slice(cut + 1);
  return name.slice(0, PROMPT_VERB_MAX);
}

/**
 * L'action `!<ligne>` : la ligne, telle que tapée, confiée au shell de
 * l'utilisateur, dans SON onglet (`tabTitle` = le premier mot). Rien n'est
 * découpé ni interprété ici — tubes, `$VAR`, `*` et `&&` sont l'affaire du
 * shell. Elle part tout de suite, build en cours ou non : une ligne du shell ne
 * charge pas le `dist`.
 *
 * @param launch - le lanceur. Absent : la ligne est refusée, avec le conseil de
 *   la taper dans un autre terminal.
 * @returns l'action.
 */
export function shellLineAction(launch?: PromptShellLauncher): IPromptAction {
  const lineOf = (input: string): string =>
    input.trim().slice(PROMPT_SHELL_PREFIX.length).trim();
  return {
    id: SHELL_PROMPT_LINE.id,
    matches: (input: string): boolean =>
      input.trimStart().startsWith(PROMPT_SHELL_PREFIX),
    tabTitle: (input: string): string | null => {
      if (launch === undefined) return null;
      const title = shellTitle(lineOf(input));
      return title === "" ? null : title;
    },
    run: (
      input: string,
      io: IPromptIO,
      signal: AbortSignal,
    ): Promise<number> => {
      const line = lineOf(input);
      if (line === "") {
        io.write(
          `${SHELL_PROMPT_LINE.usage} — une ligne du shell, par exemple !git status\n`,
          "err",
        );
        return Promise.resolve(64);
      }
      if (launch === undefined) {
        const shown =
          line.length > PROMPT_LINE_MAX
            ? `${line.slice(0, PROMPT_LINE_MAX)}…`
            : line;
        io.write(
          `« ${redactSecrets(shown)} » ne se lance pas depuis cette invite — dans un autre terminal\n`,
          "err",
        );
        return Promise.resolve(1);
      }
      return launch(line, io, signal);
    },
  };
}

/**
 * Lance une ligne du shell qui prend le terminal — appelé pendant le prêt —
 * et rend son code de sortie (`promptLaunch.ts#launchInTerminal`, posé par le
 * superviseur).
 */
export type PromptTerminalLauncher = (
  line: string,
  io: IPromptIO,
  signal: AbortSignal,
) => Promise<number>;

/**
 * L'action `/term <ligne>` : la ligne, telle que tapée, au shell de
 * l'utilisateur, le terminal PRÊTÉ le temps qu'elle tourne (`io.suspend`).
 * Pas d'onglet : sa sortie va au vrai terminal, rien n'est à recueillir ; son
 * issue s'écrit dans l'onglet d'où elle est partie. Comme une ligne `!`, elle
 * part tout de suite, build en cours ou non.
 *
 * @param launch - le lanceur. Absent : la ligne est refusée, avec le conseil
 *   de la taper dans un autre terminal.
 * @returns l'action.
 */
export function terminalLineAction(
  launch?: PromptTerminalLauncher,
): IPromptAction {
  const head = `${PROMPT_COMMAND_PREFIX}${TERM_PROMPT_COMMAND.id}`;
  return {
    id: TERM_PROMPT_COMMAND.id,
    matches: (input: string): boolean => {
      const trimmed = input.trim();
      return (
        trimmed === head ||
        (trimmed.startsWith(head) && /\s/.test(trimmed[head.length] ?? ""))
      );
    },
    complete: (prefix: string): readonly string[] =>
      head.startsWith(prefix) ? [head] : [],
    run: (
      input: string,
      io: IPromptIO,
      signal: AbortSignal,
    ): Promise<number> => {
      const line = input.trim().slice(head.length).trim();
      if (line === "") {
        io.write(
          `${TERM_PROMPT_COMMAND.usage} — un programme interactif, par exemple /term npm init\n`,
          "err",
        );
        return Promise.resolve(64);
      }
      if (launch === undefined) {
        const shown =
          line.length > PROMPT_LINE_MAX
            ? `${line.slice(0, PROMPT_LINE_MAX)}…`
            : line;
        io.write(
          `« ${redactSecrets(shown)} » ne se lance pas depuis cette invite — dans un autre terminal\n`,
          "err",
        );
        return Promise.resolve(1);
      }
      return io.suspend(() => launch(line, io, signal));
    },
  };
}

/**
 * Le premier mot d'une saisie, sans le préfixe `/` d'une commande.
 *
 * @param input - la saisie.
 * @returns le mot, ou `""`.
 */
export function promptVerb(input: string): string {
  const trimmed = input.trim();
  const start = trimmed.startsWith(PROMPT_COMMAND_PREFIX)
    ? PROMPT_COMMAND_PREFIX.length
    : 0;
  const space = trimmed.slice(start).search(/\s/);
  const word =
    space === -1 ? trimmed.slice(start) : trimmed.slice(start, start + space);
  // Cité dans un message : borné, un collage sans espace ne s'y recopie pas.
  return word.length > PROMPT_VERB_MAX
    ? `${word.slice(0, PROMPT_VERB_MAX)}…`
    : word;
}

/** Longueur au plus du mot cité par {@link promptVerb}. */
const PROMPT_VERB_MAX = 64;

/**
 * Ce que l'invite répond à une saisie qu'aucune action ne reconnaît : la
 * commande inconnue nommée, ou — sans préfixe — les deux règles rappelées.
 *
 * @param input - la saisie refusée.
 * @returns le message, fin de ligne comprise.
 */
export function describeUnmatchedInput(input: string): string {
  const help = `${PROMPT_COMMAND_PREFIX}help pour l'aide`;
  return input.trim().startsWith(PROMPT_COMMAND_PREFIX)
    ? `commande inconnue : ${PROMPT_COMMAND_PREFIX}${promptVerb(input)} — ${help}\n`
    : `les commandes commencent par « ${PROMPT_COMMAND_PREFIX} », une ligne du shell par « ${PROMPT_SHELL_PREFIX} » — ${help}\n`;
}

/**
 * Les verbes du superviseur comme actions de l'invite : `/status`, `/restart` (ou
 * `/reboot`), `/clear`, `/close`, `/help`, `/quit` (ou `/exit`). Le préfixe est
 * exigé, et aucun ne prend d'argument : un verbe suivi d'autre chose n'est
 * pas le verbe.
 *
 * @param verbs - ce qu'ils font faire.
 * @returns les actions, dans l'ordre de {@link SUPERVISOR_VERBS}.
 */
export function supervisorActions(verbs: ISupervisorVerbs): IPromptAction[] {
  return SUPERVISOR_VERBS.map(({ id, aliases }) => {
    // Petit ensemble fixe (≤ 2 noms), lu à chaque Entrée : un tableau suffit.
    const names = [id, ...aliases].map((n) => `${PROMPT_COMMAND_PREFIX}${n}`);
    return {
      id,
      matches: (input: string): boolean => names.includes(input.trim()),
      // Le nom principal d'abord ; un autre nom seulement s'il est le seul à
      // prolonger le préfixe (`/ex` → `/exit`), jamais les deux à la fois.
      complete: (prefix: string): readonly string[] => {
        const hit = names.find((n) => n.startsWith(prefix));
        return hit === undefined ? [] : [hit];
      },
      run: async (
        _input: string,
        io: IPromptIO,
        signal: AbortSignal,
      ): Promise<number> => {
        switch (id) {
          case "status":
            await verbs.status(signal);
            return 0;
          case "restart":
            if (!(await verbs.restart())) {
              io.write("un rechargement est déjà en cours\n", "err");
              return 1;
            }
            return 0;
          case "clear":
            verbs.clear();
            return 0;
          case "close":
            if (!verbs.close()) {
              io.write(
                "cet onglet ne se ferme pas — seuls ceux d'une commande finie ou d'un panneau\n",
                "err",
              );
              return 1;
            }
            return 0;
          case "help":
            verbs.help();
            return 0;
          case "quit":
            verbs.quit();
            return 0;
        }
      },
    };
  });
}
