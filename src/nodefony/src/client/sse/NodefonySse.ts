/**
 * Le client SSE de Nodefony — classe {@link NodefonySse}, publiée par
 * `nodefony/client`, à côté de `NodefonySocket`.
 *
 * Il parle le vocabulaire d'`EventSource` (`onopen`, `onmessage`, `onerror`,
 * `addEventListener(type)`, `readyState`, `lastEventId`, `close()`, reconnexion
 * avec `Last-Event-ID`, délai `retry:` du serveur) : qui connaît l'un se sert de
 * l'autre sans documentation. Il ajoute ce que le natif refuse — `method`,
 * `headers` (un `Authorization: Bearer`), `body` — et il tourne sous Node, où
 * `EventSource` reste derrière `--experimental-eventsource` (Node 26).
 *
 * Bâti sur `fetch`, TOUJOURS : déléguer au natif dans les cas simples ferait
 * deux comportements selon les options passées, donc deux implémentations à
 * maintenir et à éprouver.
 *
 * Norme : WHATWG HTML §9.2 — copie hors ligne
 * `nodefony-framework-dev/references/rfc/specs/whatwg-sse.md`.
 *
 * @module nodefony/client
 */
import { SseLimitError, SseParser } from "./SseParser";

/** Options de {@link NodefonySse}. */
export interface NodefonySseOptions {
  /** Méthode HTTP. Défaut : `GET`. */
  method?: string | undefined;
  /** En-têtes ajoutés à chaque connexion (un `Authorization`, par exemple). */
  headers?: Record<string, string> | undefined;
  /** Corps de la requête — renvoyé à chaque reconnexion. */
  body?: string | undefined;
  /** Envoyer les cookies vers une autre origine (`credentials: "include"`). Défaut : non. */
  withCredentials?: boolean | undefined;
  /**
   * Délai de reconnexion initial (ms), jusqu'à ce que le serveur en impose un
   * par `retry:`. Défaut : 3000 ; ramené entre 250 ms et 2^31-1 ms, comme
   * celui du serveur.
   */
  retry?: number | undefined;
  /** Identifiant à reprendre dès la première connexion (en-tête `Last-Event-ID`). */
  lastEventId?: string | undefined;
  /**
   * Taille maximale d'un événement (unités UTF-16). Au-delà, la connexion est
   * FERMÉE sans reconnexion : un serveur qui n'envoie jamais de fin de ligne
   * épuiserait la mémoire du client. Défaut : 4 Mi.
   */
  maxEventSize?: number | undefined;
  /**
   * Délai d'ouverture (ms) : une réponse qui n'arrive pas dans ce délai est
   * abandonnée, et la reconnexion prend le relais. Sans lui, un serveur qui
   * accepte la connexion sans jamais répondre immobilise le client en
   * `CONNECTING`, pour toujours. Défaut : 10000 ; `0` retire la borne.
   */
  connectTimeout?: number | undefined;
  /** `fetch` à employer — injectable pour un certificat, un agent ou un test. Défaut : le global. */
  fetch?: typeof fetch | undefined;
}

/** Type MIME d'un flux d'événements (§9.2.5). */
const EVENT_STREAM = "text/event-stream";
/** Délai de reconnexion par défaut, « de l'ordre de quelques secondes » (§9.2.2). */
const DEFAULT_RETRY_MS = 3000;
/**
 * Bornes du délai de reconnexion. Le plancher empêche un serveur hostile (ou
 * cassé) d'imposer `retry: 0` — une tempête de reconnexions ; le plafond est
 * celui de `setTimeout`, au-delà duquel Node ramène le délai à 1 ms.
 */
const MIN_RETRY_MS = 250;
const MAX_RETRY_MS = 2_147_483_647;

/** Délai d'ouverture par défaut (ms) — cf {@link NodefonySseOptions.connectTimeout}. */
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** Délai de reconnexion ramené dans ses bornes. */
function clampRetry(ms: number): number {
  return Math.min(Math.max(ms, MIN_RETRY_MS), MAX_RETRY_MS);
}

/**
 * Délai effectif avant une reconnexion : celui du serveur, plus une gigue
 * jusqu'à la moitié. La gigue va vers le HAUT — le `retry:` du serveur est un
 * minimum qu'il demande, pas un maximum — et désynchronise N clients coupés au
 * même instant, qui sans elle reviendraient tous ensemble frapper le serveur
 * qui redémarre.
 */
function jitteredRetry(ms: number): number {
  return Math.min(Math.round(ms + Math.random() * (ms / 2)), MAX_RETRY_MS);
}

/**
 * Valeur de `Last-Event-ID` telle que Fetch l'émet : les OCTETS UTF-8 de
 * l'identifiant, un caractère par octet (« isomorphic encode »). Un en-tête ne
 * porte que du Latin-1 : passé tel quel, un `id` comme « é€ » ferait lever
 * `fetch` — et le client ne se reconnecterait plus jamais.
 */
function headerValue(id: string): string {
  let out = "";
  for (const byte of new TextEncoder().encode(id))
    out += String.fromCharCode(byte);
  return out;
}

/**
 * Client d'un flux `text/event-stream`, compatible `EventSource`, sur `fetch`.
 *
 * Cycle (§9.2.3) : `CONNECTING` → `OPEN` à la réponse 200 `text/event-stream` ;
 * une coupure réseau ou une fin de flux repasse en `CONNECTING` et reconnecte
 * après le délai courant ; tout autre statut (204 compris), un autre type, ou
 * `close()` mène à `CLOSED`, sans reconnexion.
 */
export class NodefonySse extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;

  /** L'adresse du flux, résolue. */
  readonly url: string;
  /** Les cookies partent-ils vers une autre origine ? */
  readonly withCredentials: boolean;
  /** Appelé à l'ouverture de chaque connexion. */
  onopen: ((event: Event) => void) | null = null;
  /** Appelé pour chaque événement de type `message`. */
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  /** Appelé à chaque coupure, avant la reconnexion ou l'abandon. */
  onerror: ((event: Event) => void) | null = null;

  #readyState: number = NodefonySse.CONNECTING;
  #retryMs: number;
  #lastEventId: string;
  #controller: AbortController | null = null;
  #timer: ReturnType<typeof setTimeout> | null = null;
  // Borne de l'ouverture en cours — `null` dès la réponse reçue.
  #openTimer: ReturnType<typeof setTimeout> | null = null;
  readonly #init: Omit<NodefonySseOptions, "retry" | "lastEventId">;

  /**
   * Ouvre la connexion — tout de suite, comme `new EventSource()`.
   *
   * @param url - adresse du flux, relative à la page quand il y en a une.
   * @param options - méthode, en-têtes, corps, `fetch` injecté.
   * @throws TypeError quand l'adresse ne se résout pas.
   */
  constructor(url: string | URL, options: NodefonySseOptions = {}) {
    super();
    const base = (globalThis as { location?: { href?: string } }).location
      ?.href;
    const target = new URL(url, base);
    // Seuls les schémas que `fetch` sert en réseau : `file:`, `data:` ou
    // `javascript:` échoueraient à chaque tentative, en boucle de reconnexion.
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw new TypeError(
        `NodefonySse : schéma non pris en charge (${target.protocol})`,
      );
    }
    if (/[\r\n\0]/.test(options.lastEventId ?? "")) {
      throw new TypeError(
        "NodefonySse : lastEventId ne peut contenir ni CR, ni LF, ni NUL",
      );
    }
    this.url = target.href;
    this.withCredentials = options.withCredentials === true;
    this.#retryMs = clampRetry(options.retry ?? DEFAULT_RETRY_MS);
    this.#lastEventId = options.lastEventId ?? "";
    this.#init = options;
    this.#connect();
  }

  /** État de la connexion : 0 `CONNECTING`, 1 `OPEN`, 2 `CLOSED`. */
  get readyState(): number {
    return this.#readyState;
  }

  /** Le dernier identifiant reçu — celui que la reconnexion renverra. */
  get lastEventId(): string {
    return this.#lastEventId;
  }

  /** Ferme la connexion et annule toute reconnexion. Idempotent. */
  close(): void {
    this.#readyState = NodefonySse.CLOSED;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    this.#clearOpenTimer();
    const controller = this.#controller;
    this.#controller = null;
    controller?.abort();
  }

  /** Une tentative de connexion, puis la lecture du flux jusqu'à sa fin. */
  #connect(): void {
    this.#timer = null;
    const controller = new AbortController();
    this.#controller = controller;
    const headers: Record<string, string> = {
      Accept: EVENT_STREAM,
      "Cache-Control": "no-cache",
      ...this.#init.headers,
    };
    if (this.#lastEventId !== "") {
      headers["Last-Event-ID"] = headerValue(this.#lastEventId);
    }
    const request: RequestInit = {
      method: this.#init.method ?? "GET",
      headers,
      cache: "no-store",
      credentials: this.withCredentials ? "include" : "same-origin",
      signal: controller.signal,
    };
    if (this.#init.body !== undefined) request.body = this.#init.body;
    // Abandonner l'attente fait rejeter `fetch` : la reconnexion suit le même
    // chemin qu'une coupure réseau.
    const timeout = this.#init.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT_MS;
    if (timeout > 0) {
      this.#openTimer = setTimeout(
        () => {
          this.#openTimer = null;
          controller.abort();
        },
        Math.min(timeout, MAX_RETRY_MS),
      );
    }
    const doFetch = this.#init.fetch ?? fetch;
    doFetch(this.url, request)
      .then(
        (response) => this.#read(response, controller),
        () => this.#reestablish(controller),
      )
      .catch(() => this.#reestablish(controller));
  }

  /** Valide la réponse (§9.2.3), puis lit son corps. */
  async #read(response: Response, controller: AbortController): Promise<void> {
    if (controller !== this.#controller) return;
    this.#clearOpenTimer();
    const type = response.headers.get("Content-Type") ?? "";
    const essence = type.split(";")[0]?.trim().toLowerCase();
    if (response.status !== 200 || essence !== EVENT_STREAM) {
      // 204 compris : « cesse de te reconnecter » (§9.2.1).
      await response.body?.cancel().catch(() => undefined);
      this.#fail();
      return;
    }
    const body = response.body;
    if (body === null) {
      this.#reestablish(controller);
      return;
    }
    this.#readyState = NodefonySse.OPEN;
    this.#emit(new Event("open"), this.onopen);
    const parser = new SseParser(
      {
        onEvent: (event) => {
          // Un écouteur a pu fermer pendant ce morceau : plus rien n'est délivré.
          if (controller !== this.#controller) return;
          this.#lastEventId = event.lastEventId;
          const message = new MessageEvent<string>(event.type, {
            data: event.data,
            lastEventId: event.lastEventId,
            origin: new URL(response.url || this.url).origin,
          });
          this.#emit(message, event.type === "message" ? this.onmessage : null);
        },
        onRetry: (ms) => {
          this.#retryMs = clampRetry(ms);
        },
      },
      this.#lastEventId,
      this.#init.maxEventSize,
    );
    const reader = body.getReader();
    const decoder = new TextDecoder();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller !== this.#controller) return;
        parser.push(decoder.decode(value, { stream: true }));
      }
    } catch (error) {
      if (error instanceof SseLimitError) {
        reader.cancel().catch(() => undefined);
        controller.abort();
        this.#fail();
        return;
      }
      // Coupure en cours de lecture — même suite qu'une fin de flux.
    }
    parser.end();
    // Un bloc sans `id` garde l'identifiant ; celui du parseur fait foi.
    this.#lastEventId = parser.lastEventId;
    this.#reestablish(controller);
  }

  /** Coupure : nouvelle tentative après le délai courant (§9.2.3). */
  #reestablish(controller: AbortController): void {
    if (controller !== this.#controller) return;
    this.#clearOpenTimer();
    if (this.#readyState === NodefonySse.CLOSED) return;
    this.#readyState = NodefonySse.CONNECTING;
    this.#emit(new Event("error"), this.onerror);
    // Un gestionnaire `onerror` a pu fermer.
    if (this.#readyState !== NodefonySse.CONNECTING) return;
    this.#timer = setTimeout(
      () => this.#connect(),
      jitteredRetry(this.#retryMs),
    );
  }

  /** Désarme la borne d'ouverture, si elle court encore. */
  #clearOpenTimer(): void {
    if (this.#openTimer === null) return;
    clearTimeout(this.#openTimer);
    this.#openTimer = null;
  }

  /** Échec définitif : `CLOSED`, sans reconnexion (§9.2.3). */
  #fail(): void {
    this.#clearOpenTimer();
    this.#readyState = NodefonySse.CLOSED;
    this.#controller = null;
    this.#emit(new Event("error"), this.onerror);
  }

  /**
   * Émet aux écouteurs, puis au gestionnaire `on…` correspondant.
   *
   * Une exception du gestionnaire est SIGNALÉE hors de la lecture, comme
   * `dispatchEvent` le fait pour un écouteur : levée ici, elle remonterait dans
   * la boucle de lecture, qui la prendrait pour une coupure et reconnecterait —
   * un défaut applicatif deviendrait une boucle de reconnexion.
   */
  #emit<E extends Event>(event: E, handler: ((event: E) => void) | null): void {
    this.dispatchEvent(event);
    if (handler === null) return;
    try {
      handler.call(this, event);
    } catch (error) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}
