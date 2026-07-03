/**
 * Compteur de connexions WebSocket CONCURRENTES par IP — backstop opt-in
 * (F6c, revue 0.6). Distinct du {@link MemoryRateLimitStore} : celui-ci compte un
 * DÉBIT d'ouverture par fenêtre (handshakes/s) ; celui-là un NOMBRE de sockets
 * simultanément ouvertes par IP.
 *
 * ⚠️ Portée : PAR PROCESS (1 pod). Un vrai plafond global/IP se fait à l'ingress
 * (nginx `limit_conn`, HAProxy `sc_conn_cur`, annotation k8s) — l'edge voit tout le
 * trafic, rejette avant que l'app paie le fd + le handshake TLS, et couvre TOUS les
 * pods. Ce compteur est une défense en profondeur pour le bare-metal/VPS sans
 * ingress. Cf `wsMaxConnectionsPerIp` (config, opt-in, `null` par défaut).
 *
 * Auto-bornée : la Map ne suit que les IP AYANT des sockets ouvertes (bornée par le
 * nombre de connexions réelles), et se vide au fur et à mesure des fermetures — pas
 * besoin d'un GC ni d'un `maxTracked` (contrairement au store de débit qui retient
 * les IP sur toute la fenêtre). Lazy : Map allouée au 1ᵉʳ acquire.
 */
export class WsConnectionCounter {
  readonly #max: number;
  #counts: Map<string, number> | null = null;
  #rejectedTotal = 0;

  /** @param max - plafond de connexions concurrentes par IP (entier > 0). */
  constructor(max: number) {
    this.#max = max;
  }

  /**
   * Tente de réserver un créneau pour `ip`. `true` = sous le plafond (compteur
   * incrémenté, appeler {@link release} à la fermeture) ; `false` = plafond atteint
   * (rien n'est incrémenté, la connexion doit être refusée).
   */
  tryAcquire(ip: string): boolean {
    const counts = (this.#counts ??= new Map());
    const cur = counts.get(ip) ?? 0;
    if (cur >= this.#max) {
      this.#rejectedTotal += 1;
      return false;
    }
    counts.set(ip, cur + 1);
    return true;
  }

  /** Libère un créneau de `ip` (à la fermeture de la socket). Idempotent-safe. */
  release(ip: string): void {
    if (this.#counts === null) return;
    const cur = this.#counts.get(ip);
    if (cur === undefined) return;
    if (cur <= 1) this.#counts.delete(ip);
    else this.#counts.set(ip, cur - 1);
  }

  /** Plafond configuré (par IP). */
  get max(): number {
    return this.#max;
  }

  /** Nombre d'IP actuellement suivies (avec ≥ 1 socket ouverte). */
  get trackedIps(): number {
    return this.#counts?.size ?? 0;
  }

  /** Total de connexions refusées depuis la construction (observabilité). */
  get rejectedTotal(): number {
    return this.#rejectedTotal;
  }
}

export default WsConnectionCounter;
