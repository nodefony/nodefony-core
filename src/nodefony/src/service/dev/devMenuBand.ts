/**
 * La bande `/nodefony` de l'invite (#538, D9, D10) : dès qu'une saisie
 * commence par `/`, une bande modale propose ce qu'on peut taper — les verbes
 * de l'invite, puis les commandes du CLI rangées comme dans `nodefony menu` —
 * se filtre à la frappe : ne restent que les entrées dont la ligne commence
 * par ce qui est tapé.
 *
 * Elle ne recopie aucune liste : le menu vient de `cli/startMenu.ts`
 * (`buildStartMenu`, `buildInspectMenu`), les commandes du
 * manifeste du CLI, les verbes de `SUPERVISOR_VERBS`. Ce module ne fait que
 * traduire un choix en ligne d'invite (`/status`, `/nodefony build`) et
 * dessiner la bande.
 *
 * Pur : ni terminal, ni horloge. `DevTerminal` l'ouvre, lui prête la saisie
 * de l'onglet affiché et ce qu'Entrée ou Tab doivent y écrire.
 */
import type { ICliManifest } from "../../cli/completion";
import {
  buildInspectMenu,
  buildStartMenu,
  type StartMenuItem,
} from "../../cli/startMenu";
import { fitToWidth, visibleWidth } from "../../runtime/textWidth";
import type { IDevBand } from "./devBand";
import type { IRegion } from "./devLayout";
import type { InputEvent } from "./inputDecoder";
import {
  CLI_PROMPT_COMMAND,
  PROMPT_COMMAND_PREFIX,
  SUPERVISOR_VERBS,
  isPromptCommand,
} from "./promptAction";
import type { ScreenCharset } from "./startupScreen";

/** Une entrée qu'on peut choisir. */
type MenuChoice = Extract<StartMenuItem, { kind: "choice" }>;

/** Le menu de l'invite : la liste principale et le sous-menu d'`inspect`. */
export interface IPromptMenu {
  /** Verbes de l'invite, puis commandes du CLI ; `value` = la ligne d'invite. */
  readonly items: readonly StartMenuItem[];
  /** Le nombre d'entrées de `items` qui sont des verbes (en tête). */
  readonly verbs: number;
  /** Les sujets d'`inspect` sans paramètre ; `value` = la ligne d'invite. */
  readonly inspect: readonly StartMenuItem[];
  /**
   * Les mots qu'un niveau de la bande reconnaît en entier — verbes et leurs
   * autres noms, commandes du CLI et leurs alias, sujets d'`inspect` (avec
   * paramètre compris). Un tel mot suivi d'un blanc : la bande s'efface
   * ({@link promptMenuStepsAside}).
   */
  readonly words: {
    readonly verbs: ReadonlySet<string>;
    readonly commands: ReadonlySet<string>;
    readonly subjects: ReadonlySet<string>;
  };
}

/** Le titre du groupe des verbes dans la bande. */
const VERBS_GROUP = "Invite";
/** La ligne d'invite d'une commande du CLI. */
const CLI_HEAD = `${PROMPT_COMMAND_PREFIX}${CLI_PROMPT_COMMAND.id}`;
/** La ligne d'invite du sous-menu d'`inspect`. */
const INSPECT_HEAD = `${CLI_HEAD} inspect`;
/**
 * Longueur à partir de laquelle un début de `/nodefony` (`/nod`) vaut le
 * mot entier : la bande montre alors les commandes du CLI, pas celles dont
 * la DESCRIPTION contient « nodefony ».
 */
const CLI_HEAD_PREFIX_MIN = 4;
/** Largeur au plus de la colonne des noms. */
const LABEL_MAX = 28;
/** Le retrait d'une rubrique, depuis le bord. */
const GROUP_INDENT = "  ";
/**
 * Le retrait d'une entrée, avant sa marque `▸` : son nom tombe une
 * tabulation (4 colonnes) plus loin que celui de sa rubrique, pour que la
 * liste se lise comme un plan.
 */
const ITEM_INDENT = "    ";

/**
 * Le menu de l'invite, depuis le manifeste du CLI et les sujets d'`inspect`.
 * Une commande de runtime (`PROMPT_EXCLUDED_COMMANDS`) n'y entre pas, ni une
 * commande qu'un verbe porte déjà (`status`).
 *
 * @param input - le manifeste (`readCliManifest`, `null` s'il n'est pas
 *   écrit) et la table des sujets (`INSPECT_SUBJECTS`).
 * @returns le menu.
 */
export function buildPromptMenu(input: {
  readonly manifest: ICliManifest | null;
  readonly inspectSubjects: Record<string, { summary: string; param?: string }>;
}): IPromptMenu {
  const items: StartMenuItem[] = [{ kind: "separator", label: VERBS_GROUP }];
  const verbWords = new Set<string>();
  for (const verb of SUPERVISOR_VERBS) {
    verbWords.add(verb.id);
    for (const alias of verb.aliases) verbWords.add(alias);
    const value = `${PROMPT_COMMAND_PREFIX}${verb.id}`;
    items.push({
      kind: "choice",
      label: value,
      summary: verb.does,
      value,
      description:
        "Commande de l'invite : le superviseur y répond tout de suite, sans second démarrage.",
    });
  }
  const verbs = items.length - 1;
  const commands = (input.manifest?.commands ?? []).filter((c) =>
    isPromptCommand(c.name),
  );
  const commandWords = new Set<string>();
  for (const c of commands) {
    commandWords.add(c.name);
    for (const alias of c.aliases) commandWords.add(alias);
  }
  if (commands.length > 0) {
    const byName = new Map(commands.map((c) => [c.name, c]));
    // Le manifeste ne dit pas qui est intégré et qui vient d'un module : une
    // commande qui déclare son intention se range comme une intégrée, les
    // autres sous « Commandes du projet » — le menu n'en perd aucune.
    const grouped = commands.filter((c) => c.group !== undefined);
    const loose = commands.filter((c) => c.group === undefined);
    const menu = buildStartMenu({
      inProject: true,
      describe: (name) => byName.get(name)?.description ?? null,
      builtinCommands: grouped.map((c) => ({
        name: c.name,
        description: c.description,
        group: c.group,
      })),
      moduleCommands: loose.map((c) => ({
        name: c.name,
        description: c.description,
      })),
    });
    // Entrées fraîches, à nous seuls : la ligne d'invite s'écrit en place.
    for (const item of menu.items) {
      if (item.kind === "choice") item.value = `${CLI_HEAD} ${item.value}`;
      items.push(item);
    }
  }
  const inspect = buildInspectMenu(input.inspectSubjects).items;
  for (const item of inspect) {
    if (item.kind === "choice") item.value = `${INSPECT_HEAD} ${item.value}`;
  }
  return {
    items,
    verbs,
    inspect,
    words: {
      verbs: verbWords,
      commands: commandWords,
      subjects: new Set(Object.keys(input.inspectSubjects)),
    },
  };
}

/** Ce que la bande montre pour une saisie. */
export interface IPromptMenuView {
  /** Les entrées filtrées, titres de groupe compris. */
  readonly items: readonly StartMenuItem[];
  /** Les seules entrées qu'on peut choisir, dans l'ordre. */
  readonly choices: readonly MenuChoice[];
  /** Le sous-menu d'`inspect` est affiché. */
  readonly inspect: boolean;
}

/**
 * Les entrées que la bande montre pour la saisie `draft` : celles dont la
 * ligne d'invite COMMENCE par ce qui est tapé, comme la complétion d'un
 * shell — `/dd` ne montre rien, `/nodefony bu` montre `build`. `/x` puise
 * dans tout le menu, `/nodefony x` dans les seules commandes du CLI,
 * `/nodefony inspect x` dans les sujets d'`inspect`. Une rubrique suit ses
 * entrées : vide, elle disparaît avec elles.
 *
 * Jamais le filtre de `nodefony menu` (`filterStartMenu`), qui cherche aussi
 * dans le résumé et la description : une bande qui complète la saisie ne
 * propose que ce qui la prolonge.
 *
 * @param menu - le menu de l'invite.
 * @param draft - la saisie, `/` compris.
 * @returns la vue.
 */
export function promptMenuView(
  menu: IPromptMenu,
  draft: string,
): IPromptMenuView {
  const level = menuLevel(menu, draft);
  // Passé le mot que la bande choisit, la ligne n'est plus à elle : Entrée ne
  // doit jamais remplacer `/nodefony build --force` par `/nodefony build`.
  if (isPast(level)) return { items: [], choices: [], inspect: level.inspect };
  const typed = draft.trimStart().replace(/\s+/g, " ").toLowerCase();
  const items: StartMenuItem[] = [];
  const choices: MenuChoice[] = [];
  let group: StartMenuItem | null = null;
  for (const item of level.source) {
    if (item.kind === "separator") {
      group = item;
      continue;
    }
    if (!item.value.toLowerCase().startsWith(typed)) continue;
    if (group !== null) {
      items.push(group);
      group = null;
    }
    items.push(item);
    choices.push(item);
  }
  return { items, choices, inspect: level.inspect };
}

/**
 * La bande s'efface : la saisie a dépassé le mot qu'elle aide à choisir — un
 * verbe, une commande du CLI ou un sujet d'`inspect` tapé en entier, suivi
 * d'un blanc (`/nodefony build `). Le reste de la ligne (options, arguments)
 * est à Tab, qui complète par `computeCompletions`.
 *
 * @param menu - le menu de l'invite.
 * @param draft - la saisie, `/` compris.
 * @returns `true` si la bande n'a plus rien à proposer.
 */
export function promptMenuStepsAside(
  menu: IPromptMenu,
  draft: string,
): boolean {
  return isPast(menuLevel(menu, draft));
}

/** Le niveau de la bande pour une saisie : ses entrées, le terme, ses mots. */
interface IMenuLevel {
  readonly source: readonly StartMenuItem[];
  readonly term: string;
  readonly inspect: boolean;
  readonly known: ReadonlySet<string>;
}

function menuLevel(menu: IPromptMenu, draft: string): IMenuLevel {
  const line = draft.trimStart();
  if (isWordPrefix(line, INSPECT_HEAD)) {
    return {
      source: menu.inspect,
      term: line.slice(INSPECT_HEAD.length),
      inspect: true,
      known: menu.words.subjects,
    };
  }
  if (isWordPrefix(line, CLI_HEAD)) {
    return {
      source: menu.items.slice(menu.verbs + 1),
      term: line.slice(CLI_HEAD.length),
      inspect: false,
      known: menu.words.commands,
    };
  }
  if (line.length >= CLI_HEAD_PREFIX_MIN && CLI_HEAD.startsWith(line)) {
    return {
      source: menu.items.slice(menu.verbs + 1),
      term: "",
      inspect: false,
      known: menu.words.commands,
    };
  }
  return {
    source: menu.items,
    term: line.slice(PROMPT_COMMAND_PREFIX.length),
    inspect: false,
    known: menu.words.verbs,
  };
}

/** Le premier mot du terme est connu en entier, et un blanc le suit. */
function isPast(level: IMenuLevel): boolean {
  const term = level.term.trimStart();
  const space = term.search(/\s/);
  return space > 0 && level.known.has(term.slice(0, space));
}

/** `line` commence par le mot `head` (suivi de rien ou d'un blanc). */
function isWordPrefix(line: string, head: string): boolean {
  return (
    line.startsWith(head) &&
    (line.length === head.length || /\s/.test(line.charAt(head.length)))
  );
}

/** Ce que la bande demande à l'invite. */
export interface IPromptMenuHooks {
  /** La saisie de l'onglet affiché. */
  draft(): string;
  /** Remplace la saisie (curseur en fin). */
  fill(text: string): void;
  /** Envoie la saisie, comme Entrée sur l'invite. */
  submit(): void;
  /** Échap : la bande se retire jusqu'à la prochaine saisie hors `/`. */
  dismiss(): void;
}

/**
 * La bande ouverte : un MENU, pas la complétion. ↑↓, la molette ou un clic
 * choisissent ; Entrée lance l'entrée choisie seulement si on l'a choisie,
 * ou si elle est la seule à prolonger la saisie (`/cl` → `/clear`) — sinon
 * la saisie part telle quelle, jamais remplacée par une entrée qu'on n'a pas
 * désignée. Tab n'est pas à elle : il complète le mot tapé, comme un shell —
 * et quand il n'a plus rien à compléter, il PARCOURT cette liste
 * ({@link PromptMenuBand.cycle}) : une seule liste à l'écran, jamais deux.
 * Échap la retire. La frappe passe à l'invite : la bande se refiltre.
 */
export class PromptMenuBand implements IDevBand {
  /** L'index de l'entrée choisie dans `#view.choices`. */
  #selected = 0;
  /** Le choix a été désigné (↑↓, molette, clic) depuis la dernière frappe. */
  #designated = false;
  /** La saisie pour laquelle `#view` a été calculée. */
  #draft: string | null = null;
  #view: IPromptMenuView = { items: [], choices: [], inspect: false };
  /** L'entrée sous chaque ligne de la dernière image (souris). */
  #rows: (MenuChoice | null)[] = [];
  /** La saisie que le dernier Tab a écrite en parcourant la liste, ou `null`. */
  #cycled: string | null = null;

  constructor(
    readonly menu: IPromptMenu,
    readonly paint: {
      readonly color: boolean;
      readonly charset: ScreenCharset;
    },
    readonly hooks: IPromptMenuHooks,
  ) {}

  /**
   * La vue de la saisie courante, recalculée quand elle change ; l'entrée
   * choisie la suit si elle survit au filtre, sinon la commande tapée en
   * entier, sinon la première qui PROLONGE la saisie, sinon la première.
   */
  view(): IPromptMenuView {
    const draft = this.hooks.draft();
    if (draft !== this.#draft) {
      // Tab parcourt la liste : elle reste celle d'avant le premier Tab.
      if (draft === this.#cycled) return this.#view;
      this.#cycled = null;
      const kept = this.selection()?.value;
      this.#draft = draft;
      this.#designated = false;
      this.#view = promptMenuView(this.menu, draft);
      const typed = draft.trim();
      const choices = this.#view.choices;
      const at = choices.findIndex((c) => c.value === kept);
      const exact = choices.findIndex((c) => c.value === typed);
      const prefixed = choices.findIndex((c) => c.value.startsWith(typed));
      this.#selected =
        at !== -1 ? at : exact !== -1 ? exact : Math.max(0, prefixed);
    }
    return this.#view;
  }

  /**
   * Entrée peut-elle lancer l'entrée choisie à la place de la saisie ? Oui si
   * on l'a désignée, ou si elle est la SEULE à prolonger ce qui est tapé.
   */
  #enterTakes(selected: MenuChoice): boolean {
    if (this.#designated) return true;
    const typed = (this.#draft ?? "").trim();
    if (!selected.value.startsWith(typed)) return false;
    let prolong = 0;
    for (const c of this.#view.choices)
      if (c.value.startsWith(typed)) prolong++;
    return prolong === 1;
  }

  /**
   * La saisie est celle que le dernier Tab a écrite en parcourant la liste.
   *
   * @param draft - la saisie.
   * @returns `true` si le prochain Tab doit continuer le parcours.
   */
  cycling(draft: string): boolean {
    return this.#cycled !== null && draft === this.#cycled;
  }

  /**
   * Tab quand il n'y a plus rien à compléter : écrit dans la saisie l'entrée
   * mise en avant, puis la suivante à chaque Tab (la précédente avec
   * Maj+Tab), en boucle — le menu de zsh. Une frappe garde le choix.
   *
   * @param step - `1` (Tab) ou `-1` (Maj+Tab).
   * @returns `false` si la liste est vide.
   */
  cycle(step: 1 | -1): boolean {
    const { choices } = this.view();
    if (choices.length === 0) return false;
    if (this.#cycled !== null) {
      this.#selected =
        (this.#selected + step + choices.length) % choices.length;
    }
    const chosen = choices[this.#selected];
    if (chosen === undefined) return false;
    this.#designated = true;
    this.#cycled = chosen.value;
    this.hooks.fill(chosen.value);
    return true;
  }

  /** L'entrée choisie, ou `null` quand rien ne répond à la saisie. */
  selection(): MenuChoice | null {
    return this.#view.choices[this.#selected] ?? null;
  }

  height(width: number): number {
    void width;
    return Math.max(3, this.view().items.length + 2);
  }

  render(region: IRegion): readonly string[] {
    const { items, choices, inspect } = this.view();
    const width = region.width;
    const ascii = this.paint.charset === "ascii";
    const ellipsis = ascii ? "~" : "…";
    const paint = (code: string, text: string): string =>
      this.paint.color ? `\x1b[${code}m${text}\x1b[0m` : text;
    const rule = ascii ? "-" : "─";
    const title = inspect ? `${INSPECT_HEAD} — Inspecter quoi ?` : CLI_HEAD;
    const head = `${rule}${rule} ${title} · ${ascii ? "haut bas" : "↑↓"} choisir · Entrée lancer le choix · Tab compléter · Échap fermer `;
    const out: string[] = [
      paint(
        "2",
        fitToWidth(
          head + rule.repeat(Math.max(0, width - visibleWidth(head))),
          width,
          ellipsis,
        ),
      ),
    ];
    const room = Math.max(0, region.height - 2);
    const selected = this.selection();
    const at = selected === null ? 0 : items.indexOf(selected);
    const start = Math.max(
      0,
      Math.min(at - Math.floor(room / 2), items.length - room),
    );
    let labelWidth = 0;
    for (const choice of choices) {
      labelWidth = Math.max(labelWidth, visibleWidth(choice.label));
    }
    labelWidth = Math.min(labelWidth, LABEL_MAX);
    this.#rows = [null];
    for (const item of items.slice(start, start + room)) {
      if (item.kind === "separator") {
        out.push(
          paint(
            "1",
            fitToWidth(`${GROUP_INDENT}${item.label}`, width, ellipsis),
          ),
        );
        this.#rows.push(null);
        continue;
      }
      const on = item === selected;
      const label = fitToWidth(item.label, labelWidth, ellipsis);
      const pad = " ".repeat(Math.max(0, labelWidth - visibleWidth(label)));
      const line = fitToWidth(
        `${ITEM_INDENT}${on ? (ascii ? ">" : "▸") : " "} ${label}${pad}  ${item.summary}`,
        width,
        ellipsis,
      );
      out.push(on ? paint("1;7", line) : line);
      this.#rows.push(item);
    }
    while (out.length < region.height - 1) {
      out.push("");
      this.#rows.push(null);
    }
    const foot =
      selected === null
        ? `  aucune commande ne répond à « ${this.#draft?.trim() ?? ""} »`
        : `  ${selected.description}`;
    out.push(paint("2", fitToWidth(foot, width, ellipsis)));
    return out.slice(0, region.height);
  }

  handle(event: InputEvent): boolean {
    const { choices } = this.view();
    if (event.kind === "wheel") {
      this.#move(event.direction === "up" ? -1 : 1);
      return true;
    }
    if (event.kind === "mouse") {
      if (event.action === "press" && event.button === 0) {
        const choice = this.#rows[event.row - 1] ?? null;
        if (choice !== null) {
          this.#selected = choices.indexOf(choice);
          this.#designated = true;
        }
      }
      return true;
    }
    if (event.kind !== "key" || event.ctrl || event.alt) return false;
    const key = event.key;
    const selected = this.selection();
    if (key === "escape") {
      this.hooks.dismiss();
      return true;
    }
    if (key === "up" || key === "down") {
      if (choices.length === 0) return false;
      this.#move(key === "up" ? -1 : 1);
      return true;
    }
    // Tab complète le mot tapé (l'invite, comme un shell) : jamais la bande.
    if (key !== "enter" || event.shift || selected === null) return false;
    if (!this.#enterTakes(selected)) return false;
    // `inspect` ouvre SON menu, comme dans `nodefony menu`.
    if (selected.value === INSPECT_HEAD) {
      this.hooks.fill(`${INSPECT_HEAD} `);
      return true;
    }
    this.hooks.fill(selected.value);
    this.hooks.submit();
    return true;
  }

  /** Déplace le choix, borné aux entrées : il est alors désigné. */
  #move(step: number): void {
    const last = this.#view.choices.length - 1;
    this.#selected = Math.max(0, Math.min(last, this.#selected + step));
    this.#designated = true;
  }
}
