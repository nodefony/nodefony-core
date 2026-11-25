/**
 * Anneau de capacité fixe : écrire, lire par index et retirer en tête, tout en
 * O(1) et sans copie.
 *
 * Plein, `push` écrase la plus ancienne entrée — c'est ce qui borne la mémoire
 * d'un journal sans `Array.shift()` (O(n)). Lire une fenêtre se fait par
 * {@link CircularBuffer.at} : `toArray()` allouerait autant de cases que
 * l'anneau en contient, à chaque lecture.
 *
 * Les cases s'allouent d'un coup par défaut ; avec `initialSlots`, l'anneau
 * part petit et double jusqu'à sa capacité — un historique ouvert par canal ne
 * paie pas dix mille cases pour une commande qui écrit trois lignes.
 *
 * Le SEUL anneau du dépôt : le tampon de `Syslog` et l'historique du terminal
 * de développement le partagent.
 */
export class CircularBuffer<T> {
  #buf: Array<T | undefined>;
  /** Cases allouées — `capacity` au plus. */
  #slots: number;
  #head = 0;
  #size = 0;
  readonly capacity: number;

  /**
   * @param capacity - nombre maximal d'entrées retenues.
   * @param initialSlots - cases allouées d'emblée (défaut : `capacity`) ;
   *   l'anneau double ensuite à la demande, sans dépasser `capacity`.
   */
  constructor(capacity: number, initialSlots: number = capacity) {
    this.capacity = capacity;
    this.#slots = Math.min(capacity, Math.max(1, Math.floor(initialSlots)));
    this.#buf = new Array<T | undefined>(this.#slots);
  }

  /**
   * Ajoute en queue ; plein, écrase la plus ancienne entrée.
   *
   * @param item - l'entrée.
   */
  push(item: T): void {
    if (this.#size === this.capacity) {
      this.#buf[this.#head] = item;
      this.#head = (this.#head + 1) % this.#slots;
      return;
    }
    if (this.#size === this.#slots) this.#grow();
    this.#buf[(this.#head + this.#size) % this.#slots] = item;
    this.#size++;
  }

  /** Double les cases (sans dépasser `capacity`), la plus ancienne entrée en `0`. */
  #grow(): void {
    const slots = Math.min(this.capacity, this.#slots * 2);
    const next = new Array<T | undefined>(slots);
    for (let i = 0; i < this.#size; i++) {
      next[i] = this.#buf[(this.#head + i) % this.#slots];
    }
    this.#buf = next;
    this.#slots = slots;
    this.#head = 0;
  }

  /**
   * Retire et rend la plus ancienne entrée.
   *
   * @returns l'entrée retirée, ou `undefined` si l'anneau est vide.
   */
  shift(): T | undefined {
    if (this.#size === 0) return undefined;
    const item = this.#buf[this.#head];
    // La case est libérée : l'anneau ne retient plus ce qu'il a rendu.
    this.#buf[this.#head] = undefined;
    this.#head = (this.#head + 1) % this.#slots;
    this.#size--;
    return item;
  }

  /**
   * Lit une entrée par sa position, la plus ancienne en `0`.
   *
   * @param index - position, négative pour compter depuis la fin (`-1` = la dernière).
   * @returns l'entrée, ou `undefined` hors bornes.
   */
  at(index: number): T | undefined {
    const i = index < 0 ? this.#size + index : index;
    if (!Number.isInteger(i) || i < 0 || i >= this.#size) return undefined;
    return this.#buf[(this.#head + i) % this.#slots];
  }

  /** Nombre d'entrées retenues. */
  get length(): number {
    return this.#size;
  }

  /** La dernière entrée écrite, ou `undefined` si l'anneau est vide. */
  last(): T | undefined {
    return this.at(-1);
  }

  /** Vide l'anneau, sans rien retenir de son contenu. */
  clear(): void {
    this.#buf.fill(undefined);
    this.#head = 0;
    this.#size = 0;
  }

  /**
   * Copie le contenu, la plus ancienne entrée en tête.
   *
   * @returns un tableau neuf.
   */
  toArray(): T[] {
    const result = new Array<T>(this.#size);
    for (let i = 0; i < this.#size; i++) {
      result[i] = this.#buf[(this.#head + i) % this.#slots] as T;
    }
    return result;
  }
}
