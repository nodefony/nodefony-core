/**
 * Vue FENÊTRÉE du journal de la barre de debug.
 *
 * Deux exigences, et ce module existe pour les tenir ensemble :
 *
 * 1. **Ne pas peser sur l'application.** Le tampon garde des milliers
 *    d'entrées ; le DOM, lui, ne porte que les lignes visibles plus une marge
 *    — une quarantaine de nœuds, RÉUTILISÉS : on change leur texte, on ne
 *    reconstruit jamais de HTML. Le rendu est regroupé à une fois par image.
 * 2. **Ne rien déplacer sous l'œil.** La plus récente EN HAUT : on la voit sans
 *    défiler. La vue reste collée au haut tant qu'on y est ; si l'on descend
 *    lire, elle ne bouge plus d'un pixel — ni quand de nouvelles entrées
 *    arrivent au-dessus, ni quand le tampon perd ses plus anciennes en dessous
 *    — et un bouton « ↑ N nouvelles » ramène au flux.
 *
 * La géométrie est faite de fonctions PURES ({@link visibleWindow},
 * {@link isAtTop}) : un environnement sans mise en page (jsdom) ne mesure
 * rien, et c'est par elles que la logique s'éprouve.
 *
 * @module nodefony/debugbar
 */
import type { FeedLog } from "./model";

/** Hauteur d'une ligne, en pixels — fixe, c'est ce qui rend le fenêtrage exact. */
export const LOG_ROW_H = 22;
/** Lignes rendues au-delà de la zone visible, de chaque côté (défilement fluide). */
const OVERSCAN = 8;
/** Hauteur supposée quand l'élément n'est pas mesurable (masqué, ou sans mise en page). */
const FALLBACK_VIEWPORT_H = 320;

/**
 * Les index `[start, end)` des lignes à rendre pour une position de défilement.
 *
 * @param scrollTop - défilement courant (px)
 * @param viewportH - hauteur visible (px)
 * @param total - nombre d'entrées
 * @param rowH - hauteur d'une ligne (px)
 * @param overscan - lignes de marge de chaque côté
 * @returns la fenêtre, bornée à `[0, total]`
 */
export function visibleWindow(
  scrollTop: number,
  viewportH: number,
  total: number,
  rowH = LOG_ROW_H,
  overscan = OVERSCAN,
): { start: number; end: number } {
  const first = Math.floor(Math.max(0, scrollTop) / rowH);
  const count = Math.ceil(Math.max(0, viewportH) / rowH) + 1;
  const start = Math.max(0, first - overscan);
  const end = Math.min(total, first + count + overscan);
  return { start, end: Math.max(start, end) };
}

/**
 * La vue est-elle en haut — là où arrivent les nouvelles, donc doit-elle
 * suivre le flux ?
 *
 * La tolérance d'une demi-ligne absorbe les arrondis de défilement : sans
 * elle, un défilement fractionnaire ferait croire qu'on a quitté le haut.
 */
export function isAtTop(scrollTop: number, tolerance = LOG_ROW_H / 2): boolean {
  return scrollTop <= tolerance;
}

/** Une ligne recyclée et ses cellules — gardées pour ne jamais les rechercher. */
interface IRowParts {
  row: HTMLDivElement;
  ts: HTMLSpanElement;
  sev: HTMLSpanElement;
  mod: HTMLSpanElement;
  txt: HTMLSpanElement;
  rid: HTMLSpanElement;
}

/** Ce que la vue demande à son hôte — elle ne connaît ni le modèle ni le rendu des détails. */
export interface IFeedViewHost {
  /** Une ligne a été choisie (`null` : la sélection est levée). */
  onSelect(entry: FeedLog | null): void;
  /** Classe de couleur d'une sévérité (`crit`, `warn`, `info`, `muted`). */
  tierOf(severity: number): string;
  /** Horodatage affiché. */
  formatTime(ts: number): string;
}

/**
 * Le journal fenêtré : un ascenseur, un intercalaire qui porte la hauteur
 * totale, et un réservoir de lignes positionnées par `transform` (le seul
 * changement qui ne relance pas la mise en page).
 */
export class FeedView {
  private readonly scroller: HTMLElement;
  private readonly spacer: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly jump: HTMLButtonElement;
  private readonly empty: HTMLElement;
  /** Réservoir de lignes — alloué au fil du besoin, jamais au-delà de la fenêtre. */
  private readonly pool: IRowParts[] = [];
  private entries: readonly FeedLog[] = [];
  private follow = true;
  private unseen = 0;
  private selectedSeq = -1;
  private frame = 0;
  /**
   * La ligne en haut de l'écran, relevée AU MOMENT DU RENDU. Pas recalculée
   * depuis la liste précédente : sans filtre, la liste EST le tampon du
   * modèle, modifié sur place — relue après coup, elle contient déjà les
   * nouvelles, et l'ancre désignerait la mauvaise ligne (vécu).
   */
  private topSeq = -1;
  private topOffset = 0;
  private readonly disposers: Array<() => void> = [];

  constructor(
    root: HTMLElement,
    private readonly host: IFeedViewHost,
  ) {
    const doc = root.ownerDocument;
    this.scroller = doc.createElement("div");
    this.scroller.className = "feedscroll";
    this.scroller.setAttribute("role", "log");
    // Pas d'annonce automatique : un lecteur d'écran qui lirait chaque ligne
    // d'un flux à 50 entrées par seconde rendrait la page inutilisable.
    this.scroller.setAttribute("aria-live", "off");
    this.scroller.setAttribute("aria-label", "Journaux du serveur");
    this.scroller.tabIndex = 0;
    this.spacer = doc.createElement("div");
    this.spacer.className = "feedspacer";
    this.layer = doc.createElement("div");
    this.layer.className = "feedlayer";
    this.scroller.append(this.spacer, this.layer);
    this.jump = doc.createElement("button");
    this.jump.type = "button";
    this.jump.className = "feedjump";
    this.jump.hidden = true;
    this.empty = doc.createElement("div");
    this.empty.className = "feedempty";
    this.empty.textContent = "en attente de journaux…";
    root.append(this.scroller, this.jump, this.empty);

    const onScroll = (): void => {
      this.follow = isAtTop(this.scroller.scrollTop);
      // Relevée tout de suite, pas à l'image suivante : des entrées peuvent
      // arriver entre les deux, et l'ancre serait celle d'avant le défilement.
      this.recordTop();
      if (this.follow) this.setUnseen(0);
      this.schedule();
    };
    const onClick = (ev: Event): void => {
      const row =
        ev.target instanceof Element ? ev.target.closest(".log") : null;
      if (!row) return;
      const seq = Number(row.getAttribute("data-seq"));
      this.select(seq === this.selectedSeq ? -1 : seq);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Home") {
        ev.preventDefault();
        this.scrollToEnd();
      } else if (ev.key === "Escape") {
        this.select(-1);
      } else if (
        (ev.key === "Enter" || ev.key === " ") &&
        ev.target instanceof HTMLElement &&
        ev.target.closest(".log")
      ) {
        ev.preventDefault();
        ev.target.click();
      }
    };
    const onJump = (): void => this.scrollToEnd();
    this.scroller.addEventListener("scroll", onScroll, { passive: true });
    this.layer.addEventListener("click", onClick);
    this.scroller.addEventListener("keydown", onKey);
    this.jump.addEventListener("click", onJump);
    this.disposers.push(
      () => this.scroller.removeEventListener("scroll", onScroll),
      () => this.layer.removeEventListener("click", onClick),
      () => this.scroller.removeEventListener("keydown", onKey),
      () => this.jump.removeEventListener("click", onJump),
    );
  }

  /** Nombre de nœuds de ligne présents dans le DOM — borné par la fenêtre. */
  get rowNodes(): number {
    return this.pool.length;
  }

  /** La vue suit-elle le flux (collée en haut, où arrivent les nouvelles) ? */
  get following(): boolean {
    return this.follow;
  }

  /**
   * Donne la liste à afficher.
   *
   * @param list - les entrées, la plus ancienne en premier (la vue les
   *   affiche dans l'ordre inverse : la plus récente en haut)
   * @param appended - combien sont NOUVELLES depuis l'appel précédent ; `-1`
   *   signale un jeu remplacé (filtre, recherche) : la vue revient au flux.
   * @param emptyText - message quand la liste est vide
   */
  setEntries(
    list: readonly FeedLog[],
    appended: number,
    emptyText = "en attente de journaux…",
  ): void {
    // Ancre : la première ligne lue, et son décalage. Tant qu'on ne suit pas le
    // flux, elle reste à la même place à l'écran, quoi que le tampon fasse —
    // des nouvelles au-dessus, des anciennes qui partent en dessous.
    const anchorSeq = !this.follow && appended >= 0 ? this.topSeq : -1;
    const anchorOffset = this.topOffset;
    this.entries = list;
    this.spacer.style.height = `${list.length * LOG_ROW_H}px`;
    this.empty.hidden = list.length > 0;
    this.empty.textContent = emptyText;
    if (appended < 0) {
      this.follow = true;
      this.setUnseen(0);
    }
    if (this.follow) {
      this.scroller.scrollTop = 0;
    } else {
      if (anchorSeq >= 0) {
        const j = indexOfSeq(list, anchorSeq);
        if (j >= 0)
          this.scroller.scrollTop =
            (list.length - 1 - j) * LOG_ROW_H + anchorOffset;
      }
      if (appended > 0) this.setUnseen(this.unseen + appended);
    }
    this.paint();
  }

  /** Revient au flux : en haut, et la vue suit de nouveau. */
  scrollToEnd(): void {
    this.follow = true;
    this.setUnseen(0);
    this.scroller.scrollTop = 0;
    this.paint();
  }

  /** Sélectionne une entrée par sa séquence (`-1` : aucune). */
  select(seq: number): void {
    this.selectedSeq = seq;
    const i = seq >= 0 ? indexOfSeq(this.entries, seq) : -1;
    this.host.onSelect(i >= 0 ? (this.entries[i] ?? null) : null);
    this.paint();
  }

  /** Les entrées affichées — pour la copie, qui prend TOUT le jeu, pas l'écran. */
  get shown(): readonly FeedLog[] {
    return this.entries;
  }

  /** Libère écouteurs et image en attente. Le DOM part avec sa racine. */
  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    if (this.frame && typeof cancelAnimationFrame === "function")
      cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** Relève la ligne en haut de l'écran et son décalage — O(1). */
  private recordTop(): void {
    const top = this.scroller.scrollTop;
    const row = Math.floor(top / LOG_ROW_H);
    this.topSeq = this.at(row)?.seq ?? -1;
    this.topOffset = top - row * LOG_ROW_H;
  }

  /** L'entrée affichée à la ligne `row` — la plus récente en ligne 0. */
  private at(row: number): FeedLog | undefined {
    return this.entries[this.entries.length - 1 - row];
  }

  private viewportH(): number {
    return this.scroller.clientHeight || FALLBACK_VIEWPORT_H;
  }

  private setUnseen(n: number): void {
    this.unseen = n;
    this.jump.hidden = n === 0;
    this.jump.textContent = `↑ ${n} nouvelle${n > 1 ? "s" : ""}`;
  }

  /** Un rendu par image au plus, quel que soit le nombre d'événements de défilement. */
  private schedule(): void {
    if (this.frame) return;
    if (typeof requestAnimationFrame !== "function") {
      this.paint();
      return;
    }
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  private paint(): void {
    const { start, end } = visibleWindow(
      this.scroller.scrollTop,
      this.viewportH(),
      this.entries.length,
    );
    const needed = end - start;
    this.recordTop();
    while (this.pool.length < needed) this.pool.push(this.makeRow());
    for (let k = 0; k < this.pool.length; k++) {
      const parts = this.pool[k];
      if (parts === undefined) continue;
      const entry = k < needed ? this.at(start + k) : undefined;
      if (entry === undefined) {
        parts.row.hidden = true;
        continue;
      }
      parts.row.hidden = false;
      this.fill(parts, entry, start + k);
    }
  }

  private makeRow(): IRowParts {
    const doc = this.layer.ownerDocument;
    const row = doc.createElement("div");
    row.className = "log";
    row.tabIndex = -1;
    row.setAttribute("role", "button");
    const cell = (c: string): HTMLSpanElement => {
      const span = doc.createElement("span");
      span.className = c;
      row.append(span);
      return span;
    };
    const parts: IRowParts = {
      row,
      ts: cell("ts"),
      sev: cell("sev"),
      mod: cell("mod"),
      txt: cell("txt"),
      rid: cell("rid"),
    };
    this.layer.append(row);
    return parts;
  }

  /** Remplit une ligne recyclée — texte et classes, jamais de HTML. */
  private fill(parts: IRowParts, l: FeedLog, index: number): void {
    const tier = this.host.tierOf(l.severity);
    const sel = l.seq === this.selectedSeq;
    const { row } = parts;
    row.className = `log t-${tier}${index % 2 ? " odd" : ""}${sel ? " sel" : ""}`;
    row.style.transform = `translateY(${index * LOG_ROW_H}px)`;
    row.setAttribute("data-seq", String(l.seq));
    row.setAttribute("aria-pressed", sel ? "true" : "false");
    row.tabIndex = sel ? 0 : -1;
    parts.ts.textContent = this.host.formatTime(l.ts);
    parts.sev.textContent = l.name;
    parts.sev.className = `sev ${tier}`;
    parts.mod.textContent = l.module;
    parts.txt.textContent = l.text;
    parts.txt.title = l.text;
    parts.rid.textContent = l.requestId ? l.requestId.slice(0, 8) : "";
  }
}

/** Index d'une séquence — les séquences croissent, d'où la dichotomie. */
function indexOfSeq(list: readonly FeedLog[], seq: number): number {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const item = list[mid];
    if (item === undefined) return -1;
    const v = item.seq;
    if (v === seq) return mid;
    if (v < seq) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
