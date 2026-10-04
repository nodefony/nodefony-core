/**
 * Une ligne d'état FIGÉE EN BAS du terminal — comme la ligne d'une invite.
 *
 * Pourquoi en bas, et pas un en-tête figé en haut : un terminal ne verse dans
 * son historique que les lignes qui sortent par le HAUT de l'écran. Figer le
 * haut (zone de défilement VT100) les fait sortir par le dessous de l'en-tête
 * — et elles sont perdues ; l'historique se vide. Figer le bas laisse le
 * contenu défiler normalement au-dessus, donc vers l'historique.
 *
 * Et pourquoi pas une zone de défilement en bas non plus : son comportement
 * d'historique varie selon les terminaux (Windows Terminal ne garde pas ce qui
 * sort d'une zone), et un processus tué net laisse le terminal cassé. Ici, la
 * ligne d'état est seulement la DERNIÈRE ligne écrite : avant chaque écriture
 * on l'efface (`\r` + `\x1b[2K`), après on la redessine. Ces deux séquences
 * sont rendues partout, y compris par l'émulation de libuv sur une console
 * Windows sans mode VT. Au pire — processus tué net — il reste une ligne
 * d'état périmée dans l'historique, jamais un terminal inutilisable.
 *
 * Gabarit d'une future invite de saisie : elle prendrait la place de cette
 * ligne, avec la même mécanique.
 */

import { fitToWidth } from "../../runtime/textWidth";

/** Efface la ligne courante et ramène le curseur en colonne 0. */
export const ERASE_LINE = "\r\x1b[2K";

/**
 * Efface un bloc de `lines` lignes dont le curseur occupe la DERNIÈRE, et
 * laisse le curseur en colonne 0 de la première : on remonte d'une ligne
 * (`CUU`), on l'efface (`EL`), autant de fois que nécessaire. Ni zone de
 * défilement, ni sauvegarde de curseur — ce que rend aussi l'émulation de
 * libuv sous une console Windows sans mode VT.
 *
 * @param lines - hauteur du bloc.
 * @returns la séquence.
 */
export function eraseBlock(lines: number): string {
  return ERASE_LINE + "\x1b[1A\x1b[2K".repeat(Math.max(0, lines - 1));
}

/** Le minimum d'un flux d'écriture, injectable en test. */
export interface IStatusStream {
  write(chunk: string | Uint8Array, ...rest: unknown[]): boolean;
  columns?: number | undefined;
}

/** Type de la méthode `write` d'un flux Node. */
type WriteFn = IStatusStream["write"];

/**
 * Le `write` posé sur le flux LUI-MÊME (propriété propre), ou `undefined`
 * s'il vient du prototype — ce qu'il faut savoir pour rendre au flux,
 * à la sortie, exactement son état d'avant.
 *
 * @param stream - le flux.
 * @returns la fonction propre, ou `undefined`.
 */
function ownWrite(stream: IStatusStream): WriteFn | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(stream, "write");
  return typeof descriptor?.value === "function"
    ? (descriptor.value as WriteFn)
    : undefined;
}

/**
 * Rend au flux son `write` d'avant : la fonction propre s'il en avait une,
 * celle du prototype sinon (on retire alors la nôtre).
 *
 * @param stream - le flux.
 * @param own - ce que {@link ownWrite} a relevé avant l'interception.
 */
function restoreWrite(stream: IStatusStream, own: WriteFn | undefined): void {
  if (own) stream.write = own;
  else Reflect.deleteProperty(stream, "write");
}

/**
 * Tronque une ligne d'état à la largeur du terminal, en COLONNES (cf
 * `visibleWidth`), séquences de couleur exclues du compte. Une ligne d'état
 * qui déborde se replie, et `\x1b[2K` n'effacerait plus que sa dernière
 * moitié.
 *
 * @param text - la ligne, couleurs comprises.
 * @param columns - largeur du terminal.
 * @returns la ligne, bornée à `columns - 1` colonnes.
 */
export function fitStatus(text: string, columns: number | undefined): string {
  return fitToWidth(text, Math.max(10, (columns ?? 80) - 1));
}

/**
 * Le bloc d'état d'un processus, toujours sous la dernière ligne écrite : il
 * intercepte les écritures de ses flux (sortie standard ET sortie d'erreur —
 * une erreur écrite à côté se collerait au bloc), s'efface avant chacune et se
 * redessine après.
 *
 * Une écriture qui ne finit pas par un retour à la ligne laisse le curseur au
 * milieu d'une ligne : le bloc n'est alors redessiné qu'à la prochaine fin de
 * ligne, jamais collé au texte.
 *
 * **Un seul écrivain.** Pour s'effacer, le bloc remonte de N lignes : un autre
 * processus qui écrirait dans le même terminal laisserait des lignes de bloc
 * périmées, et le bloc, en remontant, effacerait les siennes. Sous
 * `nodefony development`, c'est donc le SUPERVISEUR qui tient le bloc
 * (`DevTerminal`, surface `inline`) et relaie la sortie du serveur ; le
 * serveur ne le dessine lui-même que sans superviseur (`--no-watch`).
 */
export class StatusLine {
  readonly #streams: IStatusStream[];
  readonly #originals: WriteFn[];
  /** `write` propre de chaque flux avant interception (cf {@link ownWrite}). */
  readonly #ownWrite: Array<WriteFn | undefined>;
  /** Lignes du bloc — `null` tant que rien n'a été montré. */
  #lines: readonly string[] | null = null;
  /** Le bloc est-il À L'ÉCRAN en ce moment (et donc à effacer) ? */
  #displayed = false;
  #atLineStart = true;
  #attached = false;

  /**
   * @param streams - les flux à surveiller ; le premier porte le bloc.
   */
  constructor(streams: IStatusStream[]) {
    this.#streams = streams;
    this.#originals = streams.map((s) => s.write.bind(s));
    this.#ownWrite = streams.map(ownWrite);
  }

  /** Dessine le bloc, chaque ligne bornée à la largeur, sans retour final. */
  #draw(): void {
    const write = this.#originals[0];
    const stream = this.#streams[0];
    if (!write || !stream || this.#lines === null) return;
    write(this.#lines.map((l) => fitStatus(l, stream.columns)).join("\n"));
    this.#displayed = true;
  }

  /** Efface le bloc s'il est à l'écran, curseur en colonne 0 de sa 1ʳᵉ ligne. */
  #erase(): void {
    const first = this.#originals[0];
    if (!this.#displayed || this.#lines === null || !first) return;
    first(eraseBlock(this.#lines.length));
    this.#displayed = false;
  }

  /**
   * Affiche (ou remplace) le bloc d'état, et commence à surveiller les flux.
   *
   * @param lines - la ou les lignes, couleurs comprises, sans retour chariot.
   */
  show(lines: string | readonly string[]): void {
    if (!this.#attached) this.#attach();
    const first = this.#originals[0];
    if (this.#displayed) this.#erase();
    else if (!this.#atLineStart && first) {
      first("\n");
      this.#atLineStart = true;
    }
    this.#lines = typeof lines === "string" ? [lines] : [...lines];
    this.#draw();
  }

  /**
   * Retire le bloc de l'écran sans lâcher les flux : rien n'est redessiné
   * jusqu'au prochain {@link StatusLine.show} (le serveur redémarre, la barre
   * n'a plus rien de vrai à dire).
   */
  hide(): void {
    this.#erase();
    this.#lines = null;
  }

  /**
   * Retire le bloc et rend aux flux leur `write` d'origine — à appeler à la
   * sortie du processus, pour que l'invite du shell reparte d'une ligne propre.
   */
  release(): void {
    // Idempotent : appelée au début de l'arrêt PUIS à `exit`, en filet.
    if (!this.#attached) return;
    this.#erase();
    this.#lines = null;
    this.#streams.forEach((stream, i) =>
      restoreWrite(stream, this.#ownWrite[i]),
    );
    this.#attached = false;
  }

  /** Pose l'interception sur chaque flux. */
  #attach(): void {
    this.#attached = true;
    this.#streams.forEach((stream, i) => {
      const original = this.#originals[i];
      if (!original) return;
      stream.write = (chunk: string | Uint8Array, ...rest: unknown[]) => {
        const text =
          typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
        if (text.length === 0) return original(chunk, ...rest);
        // Efface le bloc AVANT le contenu : il s'écrit à sa place.
        if (this.#atLineStart) this.#erase();
        const result = original(chunk, ...rest);
        this.#atLineStart = text.endsWith("\n");
        // Puis le redessine dessous — seulement en début de ligne.
        if (this.#atLineStart) this.#draw();
        return result;
      };
    });
  }
}
