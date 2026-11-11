/** Capacité de départ de l'anneau, et celle où il revient une fois vide. */
const INITIAL_CAPACITY = 64;

/**
 * Une échéance ABSOLUE pour des réceptions en cours, sans un minuteur par
 * réception : un seul balayage périodique pour toutes.
 *
 * ## Pourquoi
 *
 * `node:http2` ne borne pas la réception d'une requête : il n'a que des délais
 * d'INACTIVITÉ (`http2stream.setTimeout`, `http2session.setTimeout`), qu'un
 * client tient en vie avec un octet avant chaque échéance. `requestTimeout`,
 * la borne absolue anti « slow-loris », n'existe que pour HTTP/1.1.
 *
 * ## Le coût, et pourquoi cette forme
 *
 * C'est la forme que Node donne lui-même à `requestTimeout` : aucun minuteur
 * par requête, un contrôle périodique (`connectionsCheckingInterval`). Les
 * réceptions suivies vivent dans un ANNEAU — un tableau des éléments et un
 * `Int32Array` des tours d'entrée, indexés par un numéro de séquence :
 * - suivre = deux écritures ; libérer = une comparaison et une écriture. Ni
 *   minuteur, ni fermeture, ni lecture d'horloge (le temps se compte en TOURS),
 *   ni champ ajouté à l'élément suivi ;
 * - mesuré contre une `Map` (hachage d'identité de la clé) : ~26–32 ns par
 *   réception contre ~90–150 ns, de 1 à 10 000 réceptions simultanées.
 *
 * Toutes les entrées ont le même délai : l'ordre d'insertion EST l'ordre
 * d'échéance. Un tour avance la tête et s'arrête à la première entrée vivante
 * non échue — il ne coûte que ce qu'il expire ou saute.
 *
 * Contrepartie, bornée : une case libérée DERRIÈRE une entrée vivante attend
 * que la tête la dépasse, soit au plus un délai de réception — 12 octets par
 * réception commencée dans cette fenêtre. Sous charge, l'anneau garde sa
 * capacité d'un tour à l'autre (jamais rétréci puis recrû) ; il la rend au
 * premier tour sans réception nouvelle. Le minuteur unique est `unref`, et s'arrête au
 * même moment.
 *
 * ## Précision
 *
 * Une entrée expire entre `timeoutMs` et `timeoutMs + periodMs` après son
 * suivi — jamais AVANT le délai configuré.
 *
 * @typeParam T - l'élément suivi (un contexte de requête)
 */
export class ReceiveDeadline<T extends object> {
  #items: (T | null)[] = new Array<T | null>(INITIAL_CAPACITY).fill(null);
  #ticks = new Int32Array(INITIAL_CAPACITY);
  #mask = INITIAL_CAPACITY - 1;
  /** Numéro de séquence de la plus ancienne case non balayée. */
  #head = 0;
  /** Numéro de séquence de la prochaine entrée. */
  #tail = 0;
  #tick = 0;
  #timer: NodeJS.Timeout | null = null;
  readonly #onExpire: (item: T) => void;
  readonly #periodMs: number;
  /** Tours pleins qu'une entrée doit voir passer avant d'expirer. */
  readonly #ttl: number;

  /**
   * @param timeoutMs - le délai de réception (> 0)
   * @param onExpire - appelé une fois par entrée échue, déjà retirée
   * @param periodMs - la période du balayage, bornée par le délai (défaut 1 s)
   * @throws RangeError si `timeoutMs` ou `periodMs` n'est pas un entier > 0
   */
  constructor(timeoutMs: number, onExpire: (item: T) => void, periodMs = 1000) {
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new RangeError(`délai de réception invalide : ${timeoutMs}`);
    }
    if (!Number.isInteger(periodMs) || periodMs <= 0) {
      throw new RangeError(`période de balayage invalide : ${periodMs}`);
    }
    this.#onExpire = onExpire;
    this.#periodMs = Math.min(periodMs, timeoutMs);
    this.#ttl = Math.ceil(timeoutMs / this.#periodMs);
  }

  /** Cases occupées, libérées ou non, entre la tête et la queue. */
  get size(): number {
    return this.#tail - this.#head;
  }

  /** Capacité courante de l'anneau. */
  get capacity(): number {
    return this.#mask + 1;
  }

  /** Vrai tant que le balayage tourne. */
  get running(): boolean {
    return this.#timer !== null;
  }

  /**
   * Suit une réception qui commence ; démarre le balayage s'il dormait.
   *
   * @param item - la réception
   * @returns le numéro à rendre à {@link ReceiveDeadline.release}
   */
  track(item: T): number {
    if (this.#tail - this.#head > this.#mask) this.#grow();
    const seq = this.#tail++;
    const index = seq & this.#mask;
    this.#items[index] = item;
    this.#ticks[index] = this.#tick;
    if (this.#timer === null) {
      this.#timer = setInterval(() => this.#sweep(), this.#periodMs);
      this.#timer.unref();
    }
    return seq;
  }

  /**
   * Cesse de suivre une réception terminée (reçue, refusée ou échue). Sans
   * effet si la case a déjà été balayée ou réattribuée : l'identité de
   * l'élément est vérifiée. Le balayage ne s'arrête pas ici mais au tour
   * suivant s'il ne reste rien — jamais un minuteur armé puis désarmé par
   * requête.
   *
   * @param seq - le numéro rendu par {@link ReceiveDeadline.track}
   * @param item - la réception suivie
   */
  release(seq: number, item: T): void {
    const index = seq & this.#mask;
    if (this.#items[index] === item) this.#items[index] = null;
  }

  /** Arrête le balayage et oublie toutes les réceptions (arrêt du serveur). */
  close(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#reset();
  }

  #sweep(): void {
    const tick = ++this.#tick;
    const items = this.#items;
    // Ce que ce tour a porté : les réceptions commencées depuis le précédent.
    const carried = this.#tail - this.#head;
    while (this.#head < this.#tail) {
      const index = this.#head & this.#mask;
      const item = items[index] ?? null;
      if (item !== null && tick - (this.#ticks[index] ?? 0) <= this.#ttl) break;
      items[index] = null;
      this.#head++;
      if (item !== null) this.#onExpire(item);
    }
    if (this.#head !== this.#tail) return;
    // Vide. Sous charge (ce tour a porté des réceptions), l'anneau garde sa
    // capacité ET son minuteur : rétrécir puis recroître, désarmer puis
    // réarmer, se paieraient à CHAQUE tour. Seuls les numéros repartent de 0
    // (ils restent de petits entiers) ; les cases parcourues sont déjà vides.
    if (carried > 0) {
      this.#head = 0;
      this.#tail = 0;
      return;
    }
    // Au repos (aucune réception depuis le tour précédent) : tout est rendu.
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
    this.#reset();
  }

  /**
   * Anneau au repos ou fermé : numéros remis à zéro et capacité de départ
   * rendue. Un numéro encore détenu par un appelant ne désigne plus son
   * élément : `release` le reconnaît à l'identité.
   */
  #reset(): void {
    this.#head = 0;
    this.#tail = 0;
    if (this.#mask + 1 !== INITIAL_CAPACITY) {
      this.#items = new Array<T | null>(INITIAL_CAPACITY).fill(null);
      this.#ticks = new Int32Array(INITIAL_CAPACITY);
      this.#mask = INITIAL_CAPACITY - 1;
    } else {
      this.#items.fill(null);
    }
  }

  /** Double la capacité, les entrées gardant leur numéro de séquence. */
  #grow(): void {
    const capacity = (this.#mask + 1) * 2;
    const mask = capacity - 1;
    const items = new Array<T | null>(capacity).fill(null);
    const ticks = new Int32Array(capacity);
    for (let seq = this.#head; seq < this.#tail; seq++) {
      items[seq & mask] = this.#items[seq & this.#mask] ?? null;
      ticks[seq & mask] = this.#ticks[seq & this.#mask] ?? 0;
    }
    this.#items = items;
    this.#ticks = ticks;
    this.#mask = mask;
  }
}
