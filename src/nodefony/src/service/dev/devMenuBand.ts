/**
 * La bande `/nodefony` de l'invite (#538, D9, D10) : dès qu'une saisie
 * commence par `/`, une bande modale propose ce qu'on peut taper — les verbes
 * de l'invite, puis les commandes du CLI rangées comme dans `nodefony menu` —
 * et se filtre à la frappe.
 *
 * Elle ne recopie aucune liste : le menu vient de `cli/startMenu.ts`
 * (`buildStartMenu`, `filterStartMenu`, `buildInspectMenu`), les commandes du
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
  filterStartMenu,
  type StartMenuItem,
} from "../../cli/startMenu";
import { fitToWidth, visibleWidth } from "../../runtime/textWidth";
import type { IDevBand } from "./devBand";
import type { IRegion } from "./devLayout";
import type { InputEvent } from "./inputDecoder";
import {
  CLI_PROMPT_COMMAND,
  PROMPT_COMMAND_PREFIX,
  PROMPT_EXCLUDED_COMMANDS,
  SUPERVISOR_VERBS,
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
}

/** Le titre du groupe des verbes dans la bande. */
const VERBS_GROUP = "Invite";
/** La ligne d'invite d'une commande du CLI. */
const CLI_HEAD = `${PROMPT_COMMAND_PREFIX}${CLI_PROMPT_COMMAND.id}`;
/** La ligne d'invite du sous-menu d'`inspect`. */
const INSPECT_HEAD = `${CLI_HEAD} inspect`;
/** Largeur au plus de la colonne des noms. */
const LABEL_MAX = 28;

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
  const verbNames = new Set<string>();
  for (const verb of SUPERVISOR_VERBS) {
    verbNames.add(verb.id);
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
  const commands = (input.manifest?.commands ?? []).filter(
    (c) => !PROMPT_EXCLUDED_COMMANDS.has(c.name) && !verbNames.has(c.name),
  );
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
  return { items, verbs, inspect };
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
 * Les entrées que la bande montre pour la saisie `draft` : `/x` filtre tout
 * le menu, `/nodefony x` les seules commandes du CLI, `/nodefony inspect x`
 * les sujets d'`inspect` — par `filterStartMenu`, le filtre de `nodefony menu`.
 *
 * @param menu - le menu de l'invite.
 * @param draft - la saisie, `/` compris.
 * @returns la vue.
 */
export function promptMenuView(
  menu: IPromptMenu,
  draft: string,
): IPromptMenuView {
  const line = draft.trimStart();
  let source: readonly StartMenuItem[] = menu.items;
  let term = line.slice(PROMPT_COMMAND_PREFIX.length);
  let inspect = false;
  if (isWordPrefix(line, INSPECT_HEAD)) {
    source = menu.inspect;
    term = line.slice(INSPECT_HEAD.length);
    inspect = true;
  } else if (isWordPrefix(line, CLI_HEAD)) {
    source = menu.items.slice(menu.verbs + 1);
    term = line.slice(CLI_HEAD.length);
  }
  const items = filterStartMenu([...source], term.trim());
  const choices: MenuChoice[] = [];
  for (const item of items) if (item.kind === "choice") choices.push(item);
  return { items, choices, inspect };
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
 * La bande ouverte. ↑↓ (ou Maj+Tab, la molette) choisissent, Tab complète
 * la saisie, Entrée lance l'entrée choisie — la commande tapée en entier
 * l'est d'office ; si rien ne répond, la saisie part telle quelle —, Échap
 * la retire. La frappe passe à l'invite : la bande se refiltre à l'image
 * suivante.
 */
export class PromptMenuBand implements IDevBand {
  /** L'index de l'entrée choisie dans `#view.choices`. */
  #selected = 0;
  /** La saisie pour laquelle `#view` a été calculée. */
  #draft: string | null = null;
  #view: IPromptMenuView = { items: [], choices: [], inspect: false };
  /** L'entrée sous chaque ligne de la dernière image (souris). */
  #rows: (MenuChoice | null)[] = [];

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
   * entier, sinon la première.
   */
  view(): IPromptMenuView {
    const draft = this.hooks.draft();
    if (draft !== this.#draft) {
      const kept = this.selection()?.value;
      this.#draft = draft;
      this.#view = promptMenuView(this.menu, draft);
      const typed = draft.trim();
      const at = this.#view.choices.findIndex((c) => c.value === kept);
      const exact = this.#view.choices.findIndex((c) => c.value === typed);
      this.#selected = at !== -1 ? at : Math.max(0, exact);
    }
    return this.#view;
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
    const head = `${rule}${rule} ${title} · ${ascii ? "haut bas" : "↑↓"} choisir · Entrée lancer · Tab compléter · Échap fermer `;
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
        out.push(paint("1", fitToWidth(`  ${item.label}`, width, ellipsis)));
        this.#rows.push(null);
        continue;
      }
      const on = item === selected;
      const label = fitToWidth(item.label, labelWidth, ellipsis);
      const pad = " ".repeat(Math.max(0, labelWidth - visibleWidth(label)));
      const line = fitToWidth(
        `${on ? (ascii ? ">" : "▸") : " "} ${label}${pad}  ${item.summary}`,
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
        if (choice !== null) this.#selected = choices.indexOf(choice);
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
    if (key === "tab" && event.shift) {
      this.#move(-1);
      return true;
    }
    if (selected === null || event.shift) return false;
    if (key === "tab") {
      this.hooks.fill(this.#completion(selected));
      return true;
    }
    if (key !== "enter") return false;
    // `inspect` ouvre SON menu, comme dans `nodefony menu`.
    if (selected.value === INSPECT_HEAD) {
      this.hooks.fill(this.#completion(selected));
      return true;
    }
    this.hooks.fill(selected.value);
    this.hooks.submit();
    return true;
  }

  /** Ce que Tab écrit : l'entrée, et un blanc derrière `inspect` pour son menu. */
  #completion(choice: MenuChoice): string {
    return choice.value === INSPECT_HEAD ? `${INSPECT_HEAD} ` : choice.value;
  }

  /** Déplace le choix, borné aux entrées. */
  #move(step: number): void {
    const last = this.#view.choices.length - 1;
    this.#selected = Math.max(0, Math.min(last, this.#selected + step));
  }
}
