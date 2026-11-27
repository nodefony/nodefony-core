/**
 * L'historique des saisies de l'invite (#538, décision D11) : une liste
 * d'entrées `{ texte, onglet, date, code, durée }`, l'état de l'art réuni —
 * erasedups et ignorespace (bash `HISTCONTROL`), suggestion grisée (fish),
 * recherche incrémentale (zsh/fzf), issue et durée de chaque entrée, rang par
 * fréquence ET récence (atuin).
 *
 * {@link PromptHistory} est PUR (ni disque ni horloge : la date lui est
 * donnée) ; {@link PromptHistoryFile} le relie à `var/prompt-history.jsonl`,
 * gardé par projet — une ligne JSON par envoi, lue une fois.
 *
 * Structure : un tableau ordonné, la plus ancienne en tête, borné à
 * {@link PROMPT_HISTORY_CAPACITY}. Pas l'anneau `CircularBuffer` : erasedups
 * RETIRE une entrée au milieu pour la remonter en queue, ce qu'un anneau ne
 * sait pas faire sans pierres tombales — qui, sous une commande répétée,
 * évinceraient de vraies entrées. Un `splice` sur mille cases, au rythme d'une
 * frappe humaine, coûte de l'ordre de la microseconde.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { redactSecrets } from "../../runtime/redact";
import { PASTE_ATTACH_CHARS, type IRecallSource } from "./lineEditor";

/** Entrées retenues au plus. */
export const PROMPT_HISTORY_CAPACITY = 1000;
/** Une saisie plus longue n'est pas gardée (un collage énorme n'est pas une commande à rappeler). */
export const PROMPT_HISTORY_MAX_TEXT = 16 * 1024;
/** Le fichier, relatif à la racine du projet. */
export const PROMPT_HISTORY_FILE = path.join("var", "prompt-history.jsonl");

/** Une entrée de l'historique. Forme fixe, posée au constructeur. */
export class PromptHistoryEntry {
  readonly text: string;
  /** L'onglet où elle a été saisie (`server`, `vite`…). */
  readonly view: string;
  /** Date de la dernière saisie, en millisecondes depuis l'époque. */
  at: number;
  /** Nombre de saisies (erasedups les cumule). */
  count: number;
  /** Code de sortie de la commande, `null` tant qu'il n'est pas connu. */
  code: number | null;
  /** Durée de la commande en millisecondes, `null` tant qu'elle n'est pas connue. */
  durationMs: number | null;

  constructor(
    text: string,
    view: string,
    at: number,
    count: number,
    code: number | null,
    durationMs: number | null,
  ) {
    this.text = text;
    this.view = view;
    this.at = at;
    this.count = count;
    this.code = code;
    this.durationMs = durationMs;
  }
}

/** Pourquoi une saisie n'a pas été gardée — à dire, jamais à taire. */
export type PromptHistorySkip =
  "leading-space" | "secret" | "too-long" | "empty";

/** Ce que rend {@link PromptHistory.remember}. */
export type PromptHistoryRemember =
  | { readonly kept: true; readonly entry: PromptHistoryEntry }
  | { readonly kept: false; readonly reason: PromptHistorySkip };

/**
 * La raison d'un refus, à afficher.
 *
 * @param reason - la raison.
 * @returns la phrase.
 */
export function describeHistorySkip(reason: PromptHistorySkip): string {
  switch (reason) {
    case "leading-space":
      return "une espace en tête : non gardée dans l'historique";
    case "secret":
      return "non gardée dans l'historique : elle contient un secret";
    case "too-long":
      return "trop longue pour l'historique : non gardée";
    case "empty":
      return "";
  }
}

/** Une ligne du fichier, telle qu'elle est écrite. Forme fixe. */
interface IStoredEntry {
  t: string;
  v: string;
  at: number;
  /** Nombre de saisies : la compaction le garde, le rang par fréquence aussi. */
  n: number;
  code: number | null;
  ms: number | null;
}

/**
 * Lit une ligne du fichier sans rien supposer de son contenu : une ligne
 * malformée (fichier tronqué, édité à la main) est ignorée.
 *
 * @param line - la ligne.
 * @returns l'entrée lue, ou `null`.
 */
function parseStoredLine(line: string): IStoredEntry | null {
  if (line === "") return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  if (!("t" in value) || !("v" in value) || !("at" in value)) return null;
  const { t, v, at } = value;
  if (typeof t !== "string" || typeof v !== "string") return null;
  if (typeof at !== "number" || !Number.isFinite(at)) return null;
  const n = "n" in value ? value.n : 1;
  const code = "code" in value ? value.code : null;
  const ms = "ms" in value ? value.ms : null;
  return {
    t,
    v,
    at,
    n: typeof n === "number" && Number.isInteger(n) && n > 0 ? n : 1,
    code: typeof code === "number" && Number.isInteger(code) ? code : null,
    ms: typeof ms === "number" && Number.isFinite(ms) ? ms : null,
  };
}

/**
 * La ligne d'une entrée, fin de ligne comprise.
 *
 * @param entry - l'entrée.
 * @returns la ligne JSON.
 */
export function serializeHistoryEntry(entry: PromptHistoryEntry): string {
  const stored: IStoredEntry = {
    t: entry.text,
    v: entry.view,
    at: entry.at,
    n: entry.count,
    code: entry.code,
    ms: entry.durationMs,
  };
  return `${JSON.stringify(stored)}\n`;
}

/** Minuscules, sans accents : la recherche ne bute pas sur `é`. */
function fold(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

/**
 * L'historique de l'invite, tous onglets confondus, la plus ancienne en tête.
 */
export class PromptHistory {
  readonly #entries: PromptHistoryEntry[] = [];
  readonly #capacity: number;
  /** Une source de rappel par onglet — allouée au premier usage. */
  #sources: Map<string, IRecallSource> | null = null;

  /**
   * @param capacity - entrées retenues au plus.
   */
  constructor(capacity: number = PROMPT_HISTORY_CAPACITY) {
    this.#capacity = Math.max(1, Math.floor(capacity));
  }

  /** Nombre d'entrées. */
  get length(): number {
    return this.#entries.length;
  }

  /**
   * Lit une entrée par sa position, la plus ancienne en `0`.
   *
   * @param index - la position.
   * @returns l'entrée, ou `undefined`.
   */
  at(index: number): PromptHistoryEntry | undefined {
    return this.#entries[index];
  }

  /**
   * Garde une saisie envoyée : ignorespace, secret et longueur refusés ;
   * erasedups — la même saisie dans le même onglet remonte en queue, son
   * compteur la suit.
   *
   * @param text - la saisie.
   * @param view - l'onglet.
   * @param at - la date, en millisecondes.
   * @returns l'entrée gardée, ou la raison du refus.
   */
  remember(text: string, view: string, at: number): PromptHistoryRemember {
    if (text.trim() === "") return { kept: false, reason: "empty" };
    if (text.startsWith(" ")) return { kept: false, reason: "leading-space" };
    if (text.length > PROMPT_HISTORY_MAX_TEXT) {
      return { kept: false, reason: "too-long" };
    }
    // Une saisie porte un secret quand le masqueur y trouve quelque chose :
    // la règle est celle des journaux, une seule liste de clés.
    if (redactSecrets(text) !== text) return { kept: false, reason: "secret" };
    return { kept: true, entry: this.#add(text, view, at, 1, null, null) };
  }

  /**
   * Recharge les lignes du fichier (la plus ancienne d'abord), erasedups
   * rejoué. Une entrée déjà en mémoire (saisie avant la fin de la lecture)
   * reste la plus récente.
   *
   * @param content - le contenu du fichier.
   * @returns le nombre de lignes lues (malformées comprises).
   */
  load(content: string): number {
    const live = this.#entries.splice(0, this.#entries.length);
    let lines = 0;
    let start = 0;
    while (start < content.length) {
      let end = content.indexOf("\n", start);
      if (end === -1) end = content.length;
      lines++;
      const stored = parseStoredLine(content.slice(start, end));
      start = end + 1;
      if (stored === null || stored.t.length > PROMPT_HISTORY_MAX_TEXT)
        continue;
      this.#add(
        stored.t,
        stored.v,
        stored.at,
        stored.n,
        stored.code,
        stored.ms,
      );
    }
    for (const entry of live) {
      this.#add(
        entry.text,
        entry.view,
        entry.at,
        entry.count,
        entry.code,
        entry.durationMs,
      );
    }
    return lines;
  }

  #add(
    text: string,
    view: string,
    at: number,
    count: number,
    code: number | null,
    durationMs: number | null,
  ): PromptHistoryEntry {
    const entries = this.#entries;
    let total = count;
    // Depuis la fin : une saisie répétée l'est presque toujours récemment.
    for (let i = entries.length - 1; i >= 0; i--) {
      const old = entries[i];
      if (old?.text === text && old.view === view) {
        total += old.count;
        entries.splice(i, 1);
        break;
      }
    }
    const entry = new PromptHistoryEntry(
      text,
      view,
      at,
      total,
      code,
      durationMs,
    );
    entries.push(entry);
    if (entries.length > this.#capacity) entries.shift();
    return entry;
  }

  /**
   * Les saisies de `view` qui prolongent `prefix` sans l'égaler, la plus
   * ancienne d'abord (Ctrl+P remonte depuis la fin).
   *
   * @param view - l'onglet.
   * @param prefix - ce qui est déjà tapé.
   * @returns les textes.
   */
  matching(view: string, prefix: string): string[] {
    const list: string[] = [];
    for (const entry of this.#entries) {
      if (
        entry.view === view &&
        entry.text !== prefix &&
        entry.text.startsWith(prefix)
      ) {
        list.push(entry.text);
      }
    }
    return list;
  }

  /**
   * La suite grisée : la plus récente saisie qui prolonge `prefix` — de cet
   * onglet d'abord, de n'importe lequel sinon. Une seule passe, depuis la fin.
   *
   * @param view - l'onglet.
   * @param prefix - ce qui est déjà tapé.
   * @returns la suite, ou `""`.
   */
  suggest(view: string, prefix: string): string {
    if (prefix === "") return "";
    let fallback = "";
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      const entry = this.#entries[i];
      if (entry === undefined) continue;
      if (
        entry.text === prefix ||
        !entry.text.startsWith(prefix) ||
        entry.text.includes("\n") ||
        // Une suggestion plus longue que la borne de l'éditeur ne s'affiche pas.
        entry.text.length > PASTE_ATTACH_CHARS
      ) {
        continue;
      }
      if (entry.view === view) return entry.text.slice(prefix.length);
      if (fallback === "") fallback = entry.text.slice(prefix.length);
    }
    return fallback;
  }

  /**
   * Ctrl+R : chaque mot de `term` doit figurer (minuscules, sans accents),
   * tous onglets ; rang = fréquence + récence.
   *
   * @param term - les mots cherchés.
   * @param now - la date de référence, en millisecondes.
   * @param limit - entrées rendues au plus.
   * @returns les entrées, la meilleure d'abord.
   */
  search(term: string, now: number, limit = 50): PromptHistoryEntry[] {
    const words = fold(term)
      .split(/\s+/)
      .filter((word) => word !== "");
    const scored: { entry: PromptHistoryEntry; score: number }[] = [];
    for (const entry of this.#entries) {
      const folded = words.length === 0 ? "" : fold(entry.text);
      let all = true;
      for (const word of words) {
        if (!folded.includes(word)) {
          all = false;
          break;
        }
      }
      if (!all) continue;
      // Une saisie de la dernière minute pèse 30 saisies ; d'une heure, une demie.
      const minutes = Math.max(0, now - entry.at) / 60000;
      scored.push({ entry, score: entry.count + 30 / (1 + minutes) });
    }
    scored.sort((a, b) => b.score - a.score || b.entry.at - a.entry.at);
    const result: PromptHistoryEntry[] = [];
    for (let i = 0; i < scored.length && i < limit; i++) {
      const hit = scored[i];
      if (hit !== undefined) result.push(hit.entry);
    }
    return result;
  }

  /**
   * L'historique d'UN onglet vu par son éditeur — une source par onglet,
   * gardée.
   *
   * @param view - l'onglet.
   * @returns la source de rappel.
   */
  source(view: string): IRecallSource {
    this.#sources ??= new Map();
    let source = this.#sources.get(view);
    if (source === undefined) {
      source = {
        matching: (prefix) => this.matching(view, prefix),
        suggest: (prefix) => this.suggest(view, prefix),
      };
      this.#sources.set(view, source);
    }
    return source;
  }

  /**
   * Oublie la source de rappel d'un onglet fermé (les entrées restent).
   *
   * @param view - l'onglet.
   */
  forget(view: string): void {
    this.#sources?.delete(view);
  }

  /**
   * Le contenu compacté du fichier : une ligne par entrée retenue.
   *
   * @returns le texte à écrire.
   */
  serialize(): string {
    let out = "";
    for (const entry of this.#entries) out += serializeHistoryEntry(entry);
    return out;
  }
}

/**
 * L'historique relié à son fichier : chargé à la PREMIÈRE frappe (rien au
 * démarrage du superviseur), une ligne ajoutée par envoi, compacté au
 * chargement quand le fichier porte plus du double de la capacité.
 *
 * Une écriture qui échoue (disque plein, `var/` en lecture seule) ne casse
 * jamais l'invite : l'historique reste en mémoire, l'échec est rendu une fois
 * à `onError`.
 */
export class PromptHistoryFile {
  readonly history: PromptHistory;
  readonly #file: string;
  readonly #onError: (error: unknown) => void;
  #loading: Promise<void> | null = null;
  /** Les écritures, dans l'ordre : jamais deux en vol sur le même fichier. */
  #writing: Promise<void> = Promise.resolve();
  #failed = false;
  /** Le dossier `var/` existe : `mkdir` une fois, pas à chaque écriture. */
  #dirReady = false;

  /**
   * @param root - la racine du projet.
   * @param onError - reçoit la PREMIÈRE erreur de lecture ou d'écriture.
   * @param history - l'historique (défaut : un neuf).
   */
  constructor(
    root: string,
    onError: (error: unknown) => void,
    history: PromptHistory = new PromptHistory(),
  ) {
    this.history = history;
    this.#file = path.join(root, PROMPT_HISTORY_FILE);
    this.#onError = onError;
  }

  /** Le chemin du fichier. */
  get file(): string {
    return this.#file;
  }

  /**
   * Charge le fichier une fois ; les appels suivants rendent la même
   * promesse. Absent : un historique vide, sans erreur.
   *
   * @returns la fin du chargement.
   */
  load(): Promise<void> {
    this.#loading ??= this.#read();
    return this.#loading;
  }

  async #read(): Promise<void> {
    let content: string;
    try {
      content = await fs.readFile(this.#file, "utf8");
    } catch (error) {
      const absent =
        error instanceof Error && "code" in error && error.code === "ENOENT";
      if (!absent) this.#fail(error);
      return;
    }
    const lines = this.history.load(content);
    if (lines > 2 * PROMPT_HISTORY_CAPACITY) {
      const compacted = this.history.serialize();
      this.#enqueue(() => fs.writeFile(this.#file, compacted, "utf8"));
    }
  }

  /**
   * Garde une saisie en mémoire — le rappel la voit aussitôt. Elle part au
   * fichier par {@link PromptHistoryFile.settle}, une fois son issue connue.
   *
   * @param text - la saisie.
   * @param view - l'onglet.
   * @param at - la date, en millisecondes.
   * @returns ce que l'historique en a fait.
   */
  remember(text: string, view: string, at: number): PromptHistoryRemember {
    return this.history.remember(text, view, at);
  }

  /**
   * Pose l'issue d'une saisie gardée (code de sortie, durée) et l'ajoute au
   * fichier — après la lecture : ajoutée avant, la ligne serait relue et
   * comptée deux fois.
   *
   * @param entry - l'entrée rendue par {@link PromptHistoryFile.remember}.
   * @param code - le code de sortie, `null` s'il n'y en a pas.
   * @param durationMs - la durée, `null` si elle n'a pas de sens.
   */
  settle(
    entry: PromptHistoryEntry,
    code: number | null,
    durationMs: number | null,
  ): void {
    entry.code = code;
    entry.durationMs = durationMs;
    const line = serializeHistoryEntry(entry);
    this.#enqueue(async () => {
      await this.load();
      await fs.appendFile(this.#file, line, "utf8");
    });
  }

  /**
   * La fin de toutes les écritures en vol — pour un arrêt propre et les tests.
   *
   * @returns la promesse de la dernière écriture.
   */
  flush(): Promise<void> {
    return this.#writing;
  }

  #enqueue(write: () => Promise<void>): void {
    this.#writing = this.#run(this.#writing, write);
  }

  /** Une écriture, après la précédente ; jamais rejetée — l'échec va à `onError`. */
  async #run(
    previous: Promise<void>,
    write: () => Promise<void>,
  ): Promise<void> {
    await previous;
    try {
      if (!this.#dirReady) {
        await fs.mkdir(path.dirname(this.#file), { recursive: true });
        this.#dirReady = true;
      }
      await write();
    } catch (error) {
      this.#fail(error);
    }
  }

  #fail(error: unknown): void {
    if (this.#failed) return;
    this.#failed = true;
    this.#onError(error);
  }
}
