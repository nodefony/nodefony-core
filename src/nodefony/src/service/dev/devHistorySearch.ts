/**
 * Ctrl+R dans l'invite (#538, D11) : une bande modale qui cherche dans
 * l'historique du projet, tous onglets — la recherche est
 * `PromptHistory.search` (chaque mot doit figurer, rang fréquence + récence),
 * jamais une seconde.
 *
 * Comme fzf dans zsh, Entrée REPREND la saisie dans l'invite sans l'envoyer :
 * une commande d'il y a trois jours se relit avant de repartir.
 *
 * Pur : ni terminal, ni horloge, ni fichier. `DevTerminal` lui prête la
 * recherche et ce qu'Entrée doit écrire.
 */
import { fitToWidth, textUnits, visibleWidth } from "../../runtime/textWidth";
import type { IDevBand } from "./devBand";
import type { IRegion } from "./devLayout";
import type { InputEvent } from "./inputDecoder";
import type { PromptHistoryEntry } from "./promptHistory";
import type { ScreenCharset } from "./startupScreen";

/** Entrées montrées au plus : la bande ne mange jamais le journal. */
const SEARCH_ROWS = 8;
/** Longueur au plus du terme cherché (un collage ne s'y recopie pas). */
const TERM_MAX = 200;

/** Ce que la bande demande à l'invite. */
export interface IHistorySearchHooks {
  /** Les entrées qui répondent au terme, la meilleure d'abord. */
  search(term: string): readonly PromptHistoryEntry[];
  /**
   * Un compteur qui change quand l'historique change — chargé après
   * l'ouverture, par exemple : la recherche se refait alors.
   */
  revision(): number;
  /** Reprend l'entrée choisie dans l'invite (curseur en fin), sans l'envoyer. */
  pick(text: string): void;
  /** Referme la bande, la saisie intacte. */
  close(): void;
}

/**
 * La bande de recherche ouverte. La frappe écrit le terme ; ↑↓ ou Ctrl+R
 * choisissent ; Entrée ou Tab reprennent l'entrée choisie ; Échap, Ctrl+C
 * ou Ctrl+G referment sans rien changer.
 */
export class HistorySearchBand implements IDevBand {
  #term = "";
  #selected = 0;
  /** Le terme et la révision pour lesquels `#found` a été calculé. */
  #searched: string | null = null;
  #revision = -1;
  #found: readonly PromptHistoryEntry[] = [];

  constructor(
    readonly paint: {
      readonly color: boolean;
      readonly charset: ScreenCharset;
    },
    readonly hooks: IHistorySearchHooks,
  ) {}

  /** Le terme cherché. */
  get term(): string {
    return this.#term;
  }

  /** Les entrées trouvées, recalculées quand le terme ou l'historique change. */
  found(): readonly PromptHistoryEntry[] {
    const revision = this.hooks.revision();
    if (this.#term !== this.#searched || revision !== this.#revision) {
      this.#searched = this.#term;
      this.#revision = revision;
      this.#found = this.hooks.search(this.#term);
      this.#selected = 0;
    }
    return this.#found;
  }

  /** L'entrée choisie, ou `null` quand rien ne répond. */
  selection(): PromptHistoryEntry | null {
    return this.found()[this.#selected] ?? null;
  }

  height(width: number): number {
    void width;
    return Math.min(this.found().length, SEARCH_ROWS) + 2;
  }

  render(region: IRegion): readonly string[] {
    const found = this.found();
    const width = region.width;
    const ascii = this.paint.charset === "ascii";
    const ellipsis = ascii ? "~" : "…";
    const paint = (code: string, text: string): string =>
      this.paint.color ? `\x1b[${code}m${text}\x1b[0m` : text;
    const rule = ascii ? "-" : "─";
    const head = `${rule}${rule} Ctrl+R historique · ${ascii ? "haut bas" : "↑↓"} choisir · Entrée reprendre · Échap fermer `;
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
    const start = Math.max(
      0,
      Math.min(this.#selected - Math.floor(room / 2), found.length - room),
    );
    const newline = ascii ? " | " : " ⏎ ";
    for (let i = start; i < found.length && out.length - 1 < room; i++) {
      const entry = found[i];
      if (entry === undefined) break;
      const on = i === this.#selected;
      const tag = entry.count > 1 ? ` ×${entry.count}` : "";
      const line = fitToWidth(
        `${on ? (ascii ? ">" : "▸") : " "} ${entry.text.replaceAll("\n", newline)}${paint("2", ` · ${entry.view}${tag}`)}`,
        width,
        ellipsis,
      );
      out.push(on ? paint("1;7", line) : line);
    }
    while (out.length < region.height - 1) out.push("");
    const foot =
      found.length === 0 && this.#term !== ""
        ? `  aucune saisie ne répond à « ${this.#term} »`
        : `  recherche : ${this.#term}${ascii ? "_" : "▏"}`;
    out.push(paint("2", fitToWidth(foot, width, ellipsis)));
    return out.slice(0, region.height);
  }

  handle(event: InputEvent): boolean {
    if (event.kind === "text" || event.kind === "paste") {
      // Le terme tient sur une ligne : un collage n'en garde que la première.
      const text = event.text.split(/\r?\n/, 1)[0] ?? "";
      this.#term = (this.#term + text).slice(0, TERM_MAX);
      return true;
    }
    if (event.kind === "wheel") {
      this.#move(event.direction === "up" ? -1 : 1);
      return true;
    }
    if (event.kind === "mouse") return true;
    if (event.kind !== "key") return false;
    const { key, ctrl, alt } = event;
    if (alt) return false;
    if (ctrl) {
      if (key === "r") {
        this.#move(1);
        return true;
      }
      if (key === "c" || key === "g") {
        this.hooks.close();
        return true;
      }
      if (key === "u") {
        this.#term = "";
        return true;
      }
      return true;
    }
    if (key === "escape") {
      this.hooks.close();
      return true;
    }
    if (key === "up" || key === "down") {
      this.#move(key === "up" ? -1 : 1);
      return true;
    }
    if (key === "backspace") {
      // Le dernier graphème, pas la dernière unité UTF-16 (un émoji, un accent).
      let cut = 0;
      let at = 0;
      for (const unit of textUnits(this.#term)) {
        cut = at;
        at += unit.text.length;
      }
      this.#term = this.#term.slice(0, cut);
      return true;
    }
    if (key === "space") {
      this.#term = (this.#term + " ").slice(0, TERM_MAX);
      return true;
    }
    if (key === "enter" || key === "tab") {
      const chosen = this.selection();
      this.hooks.close();
      if (chosen !== null) this.hooks.pick(chosen.text);
      return true;
    }
    // PgUp/PgDn gardent le défilement du journal ; le reste ne fuit pas.
    return !(key === "pageup" || key === "pagedown");
  }

  /** Déplace le choix, borné aux entrées trouvées. */
  #move(step: number): void {
    const last = this.found().length - 1;
    this.#selected = Math.max(0, Math.min(last, this.#selected + step));
  }
}
