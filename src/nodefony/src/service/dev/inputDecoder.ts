/**
 * Octets du clavier → évènements, sans terminal : ce qu'un terminal en mode
 * brut envoie (frappe, touches spéciales, collage entre crochets, molette,
 * souris captée, réponses de sonde) devient une suite d'{@link InputEvent}. Cf ADR-0013 §3.
 *
 * TOUTES les touches sont décodées dès maintenant : l'invite et les foyers
 * (défilement, global) n'auront pas à rouvrir ce fichier.
 *
 * Trois garanties :
 * - **jamais d'exception** : une séquence inconnue devient `unknown`, une
 *   séquence inachevée attend le paquet suivant (bornée) ;
 * - **un caractère UTF-8 coupé entre deux paquets** est recomposé ;
 * - **un collage reste du texte** : `\x03` dans un collage n'est pas Ctrl+C,
 *   et un collage qui CONTIENT la marque de fin `ESC[201~` est tronqué là —
 *   ce qui suit jusqu'à la vraie fin n'est jamais réinterprété en frappes.
 *
 * Un Échap isolé est indiscernable du début d'une séquence : le décodeur le
 * garde, et c'est à l'appelant d'appeler {@link InputDecoder.flush} après un
 * court délai sans octet ({@link ESCAPE_TIMEOUT_MS}).
 */
import { StringDecoder } from "node:string_decoder";

/** Délai conseillé avant {@link InputDecoder.flush} : un Échap seul ≠ début de séquence. */
export const ESCAPE_TIMEOUT_MS = 50;

/** Les touches nommées ; une touche « caractère » (Ctrl+A, Alt+X) porte son caractère. */
export type NamedKey =
  | "enter"
  | "backspace"
  | "delete"
  | "insert"
  | "tab"
  | "escape"
  | "space"
  | "up"
  | "down"
  | "left"
  | "right"
  | "home"
  | "end"
  | "pageup"
  | "pagedown"
  | "f1"
  | "f2"
  | "f3"
  | "f4"
  | "f5"
  | "f6"
  | "f7"
  | "f8"
  | "f9"
  | "f10"
  | "f11"
  | "f12";

/** Une touche : nommée, ou un caractère (minuscule pour Ctrl+lettre). */
export type Key = NamedKey | (string & Record<never, never>);

/** Ce que fait la souris dans un évènement `mouse`. */
export type MouseAction = "press" | "release" | "drag" | "move";

/** Ce que le décodeur rend. */
export type InputEvent =
  /** Frappe ordinaire, UTF-8 recomposé. */
  | { kind: "text"; text: string }
  | { kind: "key"; key: Key; ctrl: boolean; alt: boolean; shift: boolean }
  /** Collage entre crochets, UN évènement. */
  | { kind: "paste"; text: string }
  | { kind: "wheel"; direction: "up" | "down"; column: number; row: number }
  /**
   * Souris captée (modes 1000/1002/1006) : bouton enfoncé, relâché, glissé
   * bouton tenu (`drag`), ou déplacé sans bouton (`move`, mode 1003 — jamais
   * posé par nous, décodé quand même). Colonne et ligne comptent depuis 1,
   * comme le terminal les envoie. Seul l'encodage SGR (1006) est lu : le
   * protocole X10 (`ESC [ M` + 3 octets), celui d'un terminal sans 1006,
   * devient `unknown` suivi de trois caractères — jamais un contrôle.
   */
  | {
      kind: "mouse";
      action: MouseAction;
      /** 0 gauche, 1 milieu, 2 droit ; `null` pour `move`. */
      button: 0 | 1 | 2 | null;
      column: number;
      row: number;
      shift: boolean;
      alt: boolean;
      ctrl: boolean;
    }
  /** Réponses de sonde : position du curseur, état d'un mode (DECRQM). */
  | {
      kind: "report";
      report: "cursor-position" | "mode";
      values: readonly number[];
    }
  | { kind: "unknown"; bytes: string };

/** Marques du collage entre crochets (mode 2004). */
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";

/** Taille maximale d'un collage retenu (caractères) ; au-delà, la suite est ignorée. */
const MAX_PASTE = 1024 * 1024;

/** Longueur maximale d'une séquence inachevée gardée en attente. */
const MAX_PENDING_SEQUENCE = 64;

/** Touches des séquences `ESC [ n ~`. */
const TILDE_KEYS: Readonly<Record<number, NamedKey>> = {
  1: "home",
  2: "insert",
  3: "delete",
  4: "end",
  5: "pageup",
  6: "pagedown",
  7: "home",
  8: "end",
  11: "f1",
  12: "f2",
  13: "f3",
  14: "f4",
  15: "f5",
  17: "f6",
  18: "f7",
  19: "f8",
  20: "f9",
  21: "f10",
  23: "f11",
  24: "f12",
};

/** Touches des séquences à lettre finale (`ESC [ A`, `ESC O P`…). */
const LETTER_KEYS: Readonly<Record<string, NamedKey>> = {
  A: "up",
  B: "down",
  C: "right",
  D: "left",
  H: "home",
  F: "end",
  P: "f1",
  Q: "f2",
  S: "f4",
};

/**
 * Fabrique un évènement de touche.
 *
 * @param key - la touche.
 * @param modifiers - masque xterm moins un (1 Maj, 2 Alt, 4 Ctrl), ou drapeaux.
 * @returns l'évènement.
 */
function keyEvent(
  key: Key,
  modifiers: { ctrl?: boolean; alt?: boolean; shift?: boolean } | number = 0,
): InputEvent {
  if (typeof modifiers === "number") {
    return {
      kind: "key",
      key,
      shift: (modifiers & 1) !== 0,
      alt: (modifiers & 2) !== 0,
      ctrl: (modifiers & 4) !== 0,
    };
  }
  return {
    kind: "key",
    key,
    ctrl: modifiers.ctrl ?? false,
    alt: modifiers.alt ?? false,
    shift: modifiers.shift ?? false,
  };
}

/**
 * Lit un paramètre numérique de séquence.
 *
 * @param value - le texte du paramètre.
 * @param fallback - valeur si absent ou illisible.
 * @returns l'entier.
 */
function param(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Décode un caractère de contrôle C0 (ou DEL) en touche.
 *
 * @param code - le code du caractère.
 * @param alt - précédé d'un Échap.
 * @returns l'évènement.
 */
function controlKey(code: number, alt: boolean): InputEvent {
  if (code === 0x0d || code === 0x0a) return keyEvent("enter", { alt });
  if (code === 0x09) return keyEvent("tab", { alt });
  if (code === 0x7f || code === 0x08) return keyEvent("backspace", { alt });
  if (code === 0x00) return keyEvent("space", { ctrl: true, alt });
  if (code === 0x1b) return keyEvent("escape", { alt });
  if (code <= 0x1a) {
    return keyEvent(String.fromCharCode(code + 0x60), { ctrl: true, alt });
  }
  // 0x1c-0x1f : Ctrl+\ Ctrl+] Ctrl+^ Ctrl+_
  return keyEvent(String.fromCharCode(code + 0x40), { ctrl: true, alt });
}

/**
 * Interprète une séquence CSI complète (`ESC [ corps final`).
 *
 * @param body - paramètres et intermédiaires, entre `[` et l'octet final.
 * @param final - l'octet final.
 * @param raw - la séquence entière, pour `unknown`.
 * @returns l'évènement, ou `null` pour l'ouverture d'un collage.
 */
function csiEvent(body: string, final: string, raw: string): InputEvent | null {
  if (body.startsWith("<") && (final === "M" || final === "m")) {
    const [b, x, y] = body.slice(1).split(";");
    const code = param(b, -1);
    if (code < 0) return { kind: "unknown", bytes: raw };
    // Bits 4/8/16 = Maj/Alt/Ctrl : la molette reste la molette.
    const base = code & ~(4 | 8 | 16);
    const column = param(x, 0);
    const row = param(y, 0);
    if (base === 64 || base === 65) {
      // Un relâchement de molette n'existe pas ; un `m` ici est du bruit.
      if (final === "m") return { kind: "unknown", bytes: raw };
      return {
        kind: "wheel",
        direction: base === 64 ? "up" : "down",
        column,
        row,
      };
    }
    // 66/67 (molette horizontale) et 128+ (boutons 8 à 11) : non pris en charge.
    if (base >= 64) return { kind: "unknown", bytes: raw };
    const motion = (base & 32) !== 0;
    const low = base & 3;
    let action: MouseAction;
    if (final === "m") action = "release";
    else if (motion) action = low === 3 ? "move" : "drag";
    else if (low === 3) return { kind: "unknown", bytes: raw };
    else action = "press";
    return {
      kind: "mouse",
      action,
      button: low === 3 ? null : (low as 0 | 1 | 2),
      column,
      row,
      shift: (code & 4) !== 0,
      alt: (code & 8) !== 0,
      ctrl: (code & 16) !== 0,
    };
  }
  if (body.startsWith("?") && body.endsWith("$") && final === "y") {
    const values = body
      .slice(1, -1)
      .split(";")
      .map((v) => param(v, 0));
    return { kind: "report", report: "mode", values };
  }
  if (final === "R" && /^\d+;\d+$/.test(body)) {
    const [row, column] = body.split(";");
    return {
      kind: "report",
      report: "cursor-position",
      values: [param(row, 0), param(column, 0)],
    };
  }
  if (!/^[\d;]*$/.test(body)) return { kind: "unknown", bytes: raw };
  const parts = body.split(";");
  const modifiers = Math.max(0, param(parts[1], 1) - 1);
  if (final === "~") {
    const code = param(parts[0], -1);
    if (code === 200) return null;
    const key = TILDE_KEYS[code];
    return key ? keyEvent(key, modifiers) : { kind: "unknown", bytes: raw };
  }
  if (final === "Z") return keyEvent("tab", { shift: true });
  const key = LETTER_KEYS[final];
  return key ? keyEvent(key, modifiers) : { kind: "unknown", bytes: raw };
}

/**
 * Le décodeur d'entrée d'un terminal en mode brut — un par flux d'entrée.
 */
export class InputDecoder {
  readonly #decoder = new StringDecoder("utf8");
  /** Texte reçu pas encore décodé (séquence inachevée). */
  #rest = "";
  /** Collage en cours — `null` hors collage. */
  #paste: string | null = null;

  /**
   * Verse un paquet reçu du clavier.
   *
   * @param chunk - octets bruts (ou texte déjà décodé).
   * @returns les évènements complets ; une séquence inachevée attend le
   *   paquet suivant ou {@link InputDecoder.flush}.
   */
  feed(chunk: Buffer | Uint8Array | string): InputEvent[] {
    const text =
      typeof chunk === "string"
        ? chunk
        : this.#decoder.write(
            Buffer.isBuffer(chunk)
              ? chunk
              : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength),
          );
    const input = this.#rest + text;
    this.#rest = "";
    const events: InputEvent[] = [];
    this.#parse(input, events);
    return events;
  }

  /**
   * Termine ce qui attendait : un Échap seul devient la touche Échap, une
   * séquence restée inachevée devient `unknown`. Un collage en cours, lui,
   * continue — il finit par sa marque.
   *
   * @returns les évènements libérés.
   */
  flush(): InputEvent[] {
    // En plein collage, ce qui attend est un morceau de marque de fin.
    if (this.#paste !== null) return [];
    const rest = this.#rest;
    this.#rest = "";
    if (rest === "") return [];
    if (rest === "\x1b") return [keyEvent("escape")];
    return [{ kind: "unknown", bytes: rest }];
  }

  /** Une séquence attend-elle la suite (cf {@link ESCAPE_TIMEOUT_MS}) ? */
  get pending(): boolean {
    return this.#rest !== "";
  }

  /** Parcourt le texte et pousse les évènements. */
  #parse(input: string, events: InputEvent[]): void {
    let i = 0;
    let textStart = -1;
    const flushText = (end: number): void => {
      if (textStart !== -1 && end > textStart) {
        events.push({ kind: "text", text: input.slice(textStart, end) });
      }
      textStart = -1;
    };
    while (i < input.length) {
      if (this.#paste !== null) {
        i = this.#readPaste(input, i, events);
        continue;
      }
      const code = input.charCodeAt(i);
      if (code >= 0x20 && code !== 0x7f) {
        if (textStart === -1) textStart = i;
        i++;
        continue;
      }
      flushText(i);
      if (code !== 0x1b) {
        events.push(controlKey(code, false));
        i++;
        continue;
      }
      const consumed = this.#readEscape(input, i, events);
      if (consumed === 0) {
        // Séquence inachevée : elle attend le paquet suivant, bornée.
        const pending = input.slice(i);
        if (pending.length > MAX_PENDING_SEQUENCE) {
          events.push({ kind: "unknown", bytes: pending });
        } else {
          this.#rest = pending;
        }
        return;
      }
      i += consumed;
    }
    flushText(input.length);
  }

  /**
   * Lit une séquence commençant par `ESC` à `i`.
   *
   * @returns le nombre de caractères consommés, `0` si elle est inachevée.
   */
  #readEscape(input: string, i: number, events: InputEvent[]): number {
    const next = input[i + 1];
    if (next === undefined) return 0;
    if (next === "[") {
      let j = i + 2;
      while (j < input.length) {
        const c = input.charCodeAt(j);
        if (c >= 0x40 && c <= 0x7e) break;
        j++;
      }
      if (j >= input.length) return 0;
      const raw = input.slice(i, j + 1);
      const event = csiEvent(input.slice(i + 2, j), input[j] ?? "", raw);
      if (event === null) this.#paste = "";
      else events.push(event);
      return j + 1 - i;
    }
    if (next === "O") {
      const final = input[i + 2];
      if (final === undefined) return 0;
      if (final === "M") events.push(keyEvent("enter"));
      else if (final === "R") events.push(keyEvent("f3"));
      else {
        const key = LETTER_KEYS[final];
        events.push(
          key
            ? keyEvent(key)
            : { kind: "unknown", bytes: input.slice(i, i + 3) },
        );
      }
      return 3;
    }
    if (next === "]" || next === "P" || next === "_") {
      // Réponse OSC/DCS/APC d'un terminal : jusqu'à BEL ou ST, jamais une touche.
      const bel = input.indexOf("\x07", i + 2);
      const st = input.indexOf("\x1b\\", i + 2);
      const ends = [bel === -1 ? -1 : bel + 1, st === -1 ? -1 : st + 2].filter(
        (n) => n !== -1,
      );
      if (ends.length === 0) return 0;
      const end = Math.min(...ends);
      events.push({ kind: "unknown", bytes: input.slice(i, end) });
      return end - i;
    }
    // Alt + touche : Échap suivi du caractère.
    const code = next.charCodeAt(0);
    if (code < 0x20 || code === 0x7f) {
      events.push(controlKey(code, true));
      return 2;
    }
    const cp = input.codePointAt(i + 1) ?? code;
    const char = String.fromCodePoint(cp);
    events.push(keyEvent(char, { alt: true }));
    return 1 + char.length;
  }

  /**
   * Lit la suite d'un collage à partir de `i`.
   *
   * @returns la nouvelle position.
   */
  #readPaste(input: string, i: number, events: InputEvent[]): number {
    const paste = this.#paste ?? "";
    const end = input.indexOf(PASTE_END, i);
    if (end === -1) {
      // Une marque coupée en fin de paquet attend la suite.
      let keep = 0;
      for (
        let k = Math.min(PASTE_END.length - 1, input.length - i);
        k > 0;
        k--
      ) {
        if (input.endsWith(PASTE_END.slice(0, k))) {
          keep = k;
          break;
        }
      }
      const body = input.slice(i, input.length - keep);
      this.#paste =
        paste.length >= MAX_PASTE ? paste : (paste + body).slice(0, MAX_PASTE);
      this.#rest = input.slice(input.length - keep);
      return input.length;
    }
    const body = input.slice(i, end);
    events.push({ kind: "paste", text: (paste + body).slice(0, MAX_PASTE) });
    this.#paste = null;
    let next = end + PASTE_END.length;
    // Un collage qui CONTENAIT `ESC[201~` : la vraie fin suit, sans nouvelle
    // ouverture. Ce qui est entre les deux vient du presse-papiers, pas du
    // clavier — on le jette au lieu de l'exécuter.
    const again = input.lastIndexOf(PASTE_END);
    const reopen = input.indexOf(PASTE_START, next);
    if (again >= next && (reopen === -1 || reopen > again)) {
      next = again + PASTE_END.length;
    }
    return next;
  }
}
