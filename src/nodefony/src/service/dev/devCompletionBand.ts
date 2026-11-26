/**
 * Les propositions de Tab (#538, D12) : quand plusieurs saisies prolongent
 * l'invite et que leur début commun n'avance pas — le mot en cours est vide,
 * typiquement —, Tab les MONTRE dans une bande au lieu d'en écrire une au
 * hasard. Comme le menu de zsh ou le pager de fish.
 *
 * Pur : ni terminal, ni horloge. `DevTerminal` l'ouvre, lui prête la saisie
 * et ce qu'un choix doit y écrire.
 */
import { fitToWidth, visibleWidth } from "../../runtime/textWidth";
import type { IDevBand } from "./devBand";
import type { IRegion } from "./devLayout";
import type { InputEvent } from "./inputDecoder";
import type { ScreenCharset } from "./startupScreen";

/** Propositions montrées au plus à la fois : la bande défile au-delà. */
const COMPLETION_ROWS = 8;

/** Ce que la bande demande à l'invite. */
export interface ICompletionHooks {
  /** La saisie de l'onglet affiché. */
  draft(): string;
  /** Écrit la saisie choisie (curseur en fin), sans l'envoyer. */
  fill(text: string): void;
  /** Referme la bande, la saisie intacte. */
  close(): void;
}

/**
 * La bande des propositions. Elle ne garde que celles que la saisie prolonge
 * encore : la frappe passe à l'invite et la bande se refiltre. ↑↓ ou Maj+Tab
 * choisissent ; Tab ou Entrée écrivent le choix suivi d'un blanc ; Échap
 * referme.
 */
export class CompletionBand implements IDevBand {
  #selected = 0;
  /** La saisie pour laquelle `#shown` a été filtré. */
  #draft: string | null = null;
  #shown: readonly string[] = [];

  /**
   * @param candidates - les saisies entières proposées, dans l'ordre des
   *   actions.
   */
  constructor(
    readonly candidates: readonly string[],
    readonly paint: {
      readonly color: boolean;
      readonly charset: ScreenCharset;
    },
    readonly hooks: ICompletionHooks,
  ) {}

  /** Les propositions que la saisie courante prolonge encore. */
  shown(): readonly string[] {
    const draft = this.hooks.draft();
    if (draft !== this.#draft) {
      const kept = this.selection();
      this.#draft = draft;
      this.#shown = this.candidates.filter((c) => c.startsWith(draft));
      const at = kept === null ? -1 : this.#shown.indexOf(kept);
      this.#selected = Math.max(0, at);
    }
    return this.#shown;
  }

  /** La proposition choisie, ou `null` quand plus rien ne répond. */
  selection(): string | null {
    return this.#shown[this.#selected] ?? null;
  }

  height(width: number): number {
    void width;
    return Math.min(this.shown().length, COMPLETION_ROWS) + 1;
  }

  render(region: IRegion): readonly string[] {
    const shown = this.shown();
    const width = region.width;
    const ascii = this.paint.charset === "ascii";
    const ellipsis = ascii ? "~" : "…";
    const paint = (code: string, text: string): string =>
      this.paint.color ? `\x1b[${code}m${text}\x1b[0m` : text;
    const rule = ascii ? "-" : "─";
    const head = `${rule}${rule} Tab · ${shown.length} proposition${shown.length > 1 ? "s" : ""} · ${ascii ? "haut bas" : "↑↓"} choisir · Tab/Entrée prendre · Échap fermer `;
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
    const room = Math.max(0, region.height - 1);
    const start = Math.max(
      0,
      Math.min(this.#selected - Math.floor(room / 2), shown.length - room),
    );
    for (let i = start; i < shown.length && out.length <= room; i++) {
      const candidate = shown[i];
      if (candidate === undefined) break;
      const on = i === this.#selected;
      // Le mot proposé seul : le début de la ligne est déjà dans l'invite.
      const word = candidate.slice(candidate.lastIndexOf(" ") + 1);
      const line = fitToWidth(
        `${on ? (ascii ? ">" : "▸") : " "} ${word}`,
        width,
        ellipsis,
      );
      out.push(on ? paint("1;7", line) : line);
    }
    while (out.length < region.height) out.push("");
    return out.slice(0, region.height);
  }

  handle(event: InputEvent): boolean {
    const shown = this.shown();
    if (event.kind === "wheel") {
      this.#move(event.direction === "up" ? -1 : 1);
      return true;
    }
    if (event.kind === "mouse") return true;
    if (event.kind !== "key" || event.ctrl || event.alt) return false;
    const key = event.key;
    if (key === "escape") {
      this.hooks.close();
      return true;
    }
    if (key === "up" || key === "down" || (key === "tab" && event.shift)) {
      this.#move(key === "down" ? 1 : -1);
      return true;
    }
    if (key !== "tab" && key !== "enter") return false;
    const chosen = this.selection();
    if (chosen === null || shown.length === 0) return false;
    this.hooks.close();
    this.hooks.fill(chosen.endsWith(" ") ? chosen : `${chosen} `);
    return true;
  }

  /** Déplace le choix, borné aux propositions montrées. */
  #move(step: number): void {
    const last = this.#shown.length - 1;
    this.#selected = Math.max(0, Math.min(last, this.#selected + step));
  }
}
