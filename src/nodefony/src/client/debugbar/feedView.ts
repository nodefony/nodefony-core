/**
 * Vue FENÊTRÉE du flux de la barre de debug.
 *
 * Deux exigences, et ce module existe pour les tenir ensemble :
 *
 * 1. **Ne pas peser sur l'application.** Le flux garde des milliers de
 *    lignes ; le DOM, lui, ne porte que les lignes visibles plus une marge
 *    — une quarantaine de nœuds, RÉUTILISÉS : on change leur texte, on ne
 *    reconstruit jamais de HTML. Le rendu est regroupé à une fois par image.
 * 2. **Ne rien déplacer sous l'œil.** La plus récente EN HAUT : on la voit sans
 *    défiler. La vue reste collée au haut tant qu'on y est ; si l'on descend
 *    lire, elle ne bouge plus d'un pixel — ni quand de nouvelles lignes
 *    arrivent au-dessus, ni quand le flux perd ses plus anciennes en dessous
 *    — et un bouton « ↑ N nouvelles » ramène au flux.
 *
 * La vue ne connaît pas ce qu'elle affiche : chaque ligne porte une CLÉ stable
 * (l'ancre de lecture et la sélection la suivent, quel que soit l'ordre), et
 * l'hôte remplit le contenu. L'ordre n'a pas à être monotone : une requête
 * dépliée insère ses lignes serveur sous elle.
 *
 * La géométrie est faite de fonctions PURES ({@link visibleWindow},
 * {@link isAtTop}) : un environnement sans mise en page (jsdom) ne mesure
 * rien, et c'est par elles que la logique s'éprouve.
 *
 * @module nodefony/debugbar
 */

/**
 * Hauteur d'une ligne, en pixels — fixe, c'est ce qui rend le fenêtrage exact.
 * 24 : la cible minimale d'un pointeur (WCAG 2.5.8), une ligne étant cliquable.
 */
export const ROW_H = 24;
/** Lignes rendues au-delà de la zone visible, de chaque côté (défilement fluide). */
const OVERSCAN = 8;
/** Hauteur supposée quand l'élément n'est pas mesurable (masqué, ou sans mise en page). */
const FALLBACK_VIEWPORT_H = 320;

/**
 * Les index `[start, end)` des lignes à rendre pour une position de défilement.
 *
 * @param scrollTop - défilement courant (px)
 * @param viewportH - hauteur visible (px)
 * @param total - nombre de lignes
 * @param rowH - hauteur d'une ligne (px)
 * @param overscan - lignes de marge de chaque côté
 * @returns la fenêtre, bornée à `[0, total]`
 */
export function visibleWindow(
  scrollTop: number,
  viewportH: number,
  total: number,
  rowH = ROW_H,
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
export function isAtTop(scrollTop: number, tolerance = ROW_H / 2): boolean {
  return scrollTop <= tolerance;
}

/** Ce que la vue demande à son hôte — elle ne connaît ni le modèle ni le rendu des détails. */
export interface IFeedViewHost<T> {
  /** Clé STABLE d'une ligne : l'ancre de lecture et la sélection la suivent. */
  keyOf(item: T): string;
  /**
   * Remplit une ligne recyclée — son contenu et ses classes propres. La vue
   * pose ensuite position, zébrure et sélection : l'hôte ne les touche pas.
   */
  fill(row: HTMLDivElement, item: T): void;
  /** Une ligne a été choisie (`null` : la sélection est levée). */
  onSelect(item: T | null): void;
  /**
   * Une action portée par la ligne : un clic sur un élément `[data-act]` de
   * la ligne, ou `→` / `←` au clavier (`expand` / `collapse`).
   */
  onAction?(item: T, action: string): void;
}

/**
 * Le flux fenêtré : un ascenseur, un intercalaire qui porte la hauteur
 * totale, et un réservoir de lignes positionnées par `transform` (le seul
 * changement qui ne relance pas la mise en page).
 */
export class FeedView<T> {
  private readonly scroller: HTMLElement;
  private readonly spacer: HTMLElement;
  private readonly layer: HTMLElement;
  private readonly jump: HTMLButtonElement;
  private readonly empty: HTMLElement;
  /** Réservoir de lignes — alloué au fil du besoin, jamais au-delà de la fenêtre. */
  private readonly pool: HTMLDivElement[] = [];
  private entries: readonly T[] = [];
  private follow = true;
  private unseen = 0;
  private selectedKey: string | null = null;
  private frame = 0;
  /**
   * La ligne en haut de l'écran, relevée AU MOMENT DU RENDU, par sa clé : la
   * liste suivante peut être un autre tableau, ou le même modifié sur place —
   * seule la clé survit aux deux.
   */
  private topKey: string | null = null;
  private topIndex = 0;
  private topOffset = 0;
  private readonly disposers: Array<() => void> = [];

  /**
   * @param root - conteneur de la vue (elle y ajoute ascenseur, saut et message vide)
   * @param host - clé, rendu et réactions de l'hôte
   * @param label - nom accessible de la liste
   */
  constructor(
    root: HTMLElement,
    private readonly host: IFeedViewHost<T>,
    label: string,
  ) {
    const doc = root.ownerDocument;
    this.scroller = doc.createElement("div");
    this.scroller.className = "feedscroll";
    this.scroller.setAttribute("role", "tree");
    this.scroller.setAttribute("aria-label", label);
    this.scroller.tabIndex = 0;
    this.spacer = doc.createElement("div");
    this.spacer.className = "feedspacer";
    this.layer = doc.createElement("div");
    this.layer.className = "feedlayer";
    this.layer.setAttribute("role", "none");
    this.scroller.append(this.spacer, this.layer);
    this.jump = doc.createElement("button");
    this.jump.type = "button";
    this.jump.className = "feedjump";
    this.jump.hidden = true;
    this.empty = doc.createElement("div");
    this.empty.className = "feedempty";
    this.empty.textContent = "en attente…";
    root.append(this.scroller, this.jump, this.empty);

    const onScroll = (): void => {
      this.follow = isAtTop(this.scroller.scrollTop);
      // Relevée tout de suite, pas à l'image suivante : des lignes peuvent
      // arriver entre les deux, et l'ancre serait celle d'avant le défilement.
      this.recordTop();
      if (this.follow) this.setUnseen(0);
      this.schedule();
    };
    const onClick = (ev: Event): void => {
      const row = this.rowOf(ev.target);
      if (!row) return;
      const key = row.getAttribute("data-key");
      const item = key === null ? undefined : this.find(key);
      if (item === undefined) return;
      const act =
        ev.target instanceof Element
          ? ev.target.closest("[data-act]")?.getAttribute("data-act")
          : null;
      if (act && this.host.onAction) {
        this.host.onAction(item, act);
        return;
      }
      this.select(key === this.selectedKey ? null : key);
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === "Home") {
        ev.preventDefault();
        this.scrollToEnd();
        return;
      }
      if (ev.key === "Escape") {
        this.select(null);
        return;
      }
      const row = this.rowOf(ev.target);
      if (!row) return;
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        row.click();
      } else if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
        const key = row.getAttribute("data-key");
        const item = key === null ? undefined : this.find(key);
        if (item === undefined || !this.host.onAction) return;
        ev.preventDefault();
        this.host.onAction(
          item,
          ev.key === "ArrowRight" ? "expand" : "collapse",
        );
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

  /** Les lignes affichées — pour la copie, qui prend TOUT le jeu, pas l'écran. */
  get shown(): readonly T[] {
    return this.entries;
  }

  /**
   * Donne la liste à afficher.
   *
   * @param list - les lignes dans l'ordre d'affichage : la plus récente en tête
   * @param reset - le jeu est REMPLACÉ (filtre, recherche) : la vue revient au
   *   flux. Sinon, hors du haut, la ligne lue reste à sa place et ce qui est
   *   arrivé au-dessus est compté.
   * @param emptyText - message quand la liste est vide
   */
  setEntries(list: readonly T[], reset: boolean, emptyText: string): void {
    // Ancre : la première ligne lue, et son décalage. Tant qu'on ne suit pas le
    // flux, elle reste à la même place à l'écran, quoi que la liste fasse —
    // des nouvelles au-dessus, des anciennes qui partent en dessous.
    const anchorKey = !this.follow && !reset ? this.topKey : null;
    const anchorIndex = this.topIndex;
    const anchorOffset = this.topOffset;
    this.entries = list;
    this.spacer.style.height = `${list.length * ROW_H}px`;
    this.empty.hidden = list.length > 0;
    this.empty.textContent = emptyText;
    if (reset) {
      this.follow = true;
      this.setUnseen(0);
    }
    if (this.follow) {
      this.scroller.scrollTop = 0;
    } else if (anchorKey !== null) {
      const j = this.indexOf(anchorKey);
      if (j >= 0) {
        this.scroller.scrollTop = j * ROW_H + anchorOffset;
        if (j > anchorIndex) this.setUnseen(this.unseen + j - anchorIndex);
      }
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

  /** Sélectionne une ligne par sa clé (`null` : aucune). */
  select(key: string | null): void {
    this.selectedKey = key;
    const item = key === null ? undefined : this.find(key);
    this.host.onSelect(item ?? null);
    this.paint();
  }

  /** Libère écouteurs et image en attente. Le DOM part avec sa racine. */
  destroy(): void {
    for (const d of this.disposers) d();
    this.disposers.length = 0;
    if (this.frame && typeof cancelAnimationFrame === "function")
      cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  /** La ligne de la liste qui contient `target`, s'il y en a une. */
  private rowOf(target: EventTarget | null): HTMLElement | null {
    const row = target instanceof Element ? target.closest(".row") : null;
    return row instanceof HTMLElement && this.layer.contains(row) ? row : null;
  }

  private indexOf(key: string): number {
    return this.entries.findIndex((item) => this.host.keyOf(item) === key);
  }

  private find(key: string): T | undefined {
    const i = this.indexOf(key);
    return i >= 0 ? this.entries[i] : undefined;
  }

  /** Relève la ligne en haut de l'écran et son décalage — O(1). */
  private recordTop(): void {
    const top = this.scroller.scrollTop;
    const row = Math.floor(top / ROW_H);
    const item = this.entries[row];
    this.topKey = item === undefined ? null : this.host.keyOf(item);
    this.topIndex = row;
    this.topOffset = top - row * ROW_H;
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
      const row = this.pool[k];
      if (row === undefined) continue;
      const index = start + k;
      const item = k < needed ? this.entries[index] : undefined;
      if (item === undefined) {
        row.hidden = true;
        continue;
      }
      row.hidden = false;
      this.host.fill(row, item);
      const key = this.host.keyOf(item);
      const sel = key === this.selectedKey;
      row.classList.add("row");
      row.classList.toggle("odd", index % 2 === 1);
      row.classList.toggle("sel", sel);
      row.style.transform = `translateY(${index * ROW_H}px)`;
      row.setAttribute("data-key", key);
      row.setAttribute("aria-selected", sel ? "true" : "false");
      row.tabIndex = sel ? 0 : -1;
    }
  }

  private makeRow(): HTMLDivElement {
    const row = this.layer.ownerDocument.createElement("div");
    row.className = "row";
    row.tabIndex = -1;
    row.setAttribute("role", "treeitem");
    this.layer.append(row);
    return row;
  }
}
