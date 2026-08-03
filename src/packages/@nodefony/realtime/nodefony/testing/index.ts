/**
 * `@nodefony/realtime/testing` — **harnais de test d'un controller temps réel**.
 *
 * Écrire un test de socket demandait jusqu'ici une centaine de lignes de
 * plomberie FRAMEWORK avant la première assertion : un faux `ContextType` qui ne
 * fournit que ce que la base touche, un pont vers `handleRealtime` (qui est
 * `protected`), la remise à zéro du hub — singleton par process — entre deux
 * cas, et la pose d'une identité au handshake. Cette plomberie se périme au
 * premier changement de signature de la base ; recopiée dans chaque application,
 * elle y aurait vieilli sans que personne ne le sache. Elle vit donc ICI, avec
 * le code dont elle dépend.
 *
 * Le harnais pilote le **côté serveur** : il injecte des frames JSON-RPC 2.0
 * telles qu'un client les enverrait, et lit celles qui sortent. Il n'embarque
 * PAS `RealtimeClient` — le client est un artefact navigateur du cœur, et le
 * tirer ici le ferait entrer dans le paquet serveur publié. Ce qu'on veut
 * prouver d'un controller (ses canaux, ses actions, son plein-duplex, son
 * nettoyage) s'observe entièrement aux frames.
 *
 * ```ts
 * import { createRealtimeHarness } from "@nodefony/realtime/testing";
 *
 * const h = createRealtimeHarness((ctx) => new ChatController(ctx));
 * await h.connect();
 * await h.subscribe("chat:ticker");
 * expect(h.messages("chat:ticker")).to.have.length.greaterThan(0);
 * h.dispose();
 * ```
 *
 * @packageDocumentation
 */
import type { ContextType } from "@nodefony/http";
import type { RealtimeController } from "../src/server/RealtimeController";
import {
  getRealtimeHub,
  type RealtimeHub,
  type FrameAuthorizer,
} from "../src/server/RealtimeHub";
import type { IRealtimeToken } from "../interfaces/IRealtimeToken";
import type { IRealtimeAuthenticator } from "../interfaces/IRealtimeAuthenticator";

/** `readyState` d'une connexion WebSocket ouverte (`ws` / DOM). */
const OPEN = 1;

/**
 * Frame JSON-RPC 2.0 telle qu'elle circule sur la socket, dans les deux sens.
 *
 * Volontairement permissive : un test lit `method`, `params`, `result` ou
 * `error` selon ce qu'il éprouve, et le harnais ne présume pas de la forme du
 * métier transporté.
 */
export interface IRealtimeFrame {
  readonly jsonrpc?: string;
  readonly id?: number | string;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { code: number; message: string; data?: unknown };
}

/** Fermeture demandée par le serveur (code RFC 6455 + raison). */
export interface IHarnessClose {
  readonly code?: number;
  readonly reason?: string;
}

/** Refus d'abonnement notifié au client (`realtime:denied`). */
export interface IHarnessDenied {
  readonly channel: string;
  readonly reason: string;
}

/** Écart au décor par défaut du harnais. */
export interface IRealtimeHarnessOptions {
  /**
   * URL de la connexion, telle que la verraient les matchers d'authenticator
   * (seam #3). Défaut `/realtime`.
   */
  readonly url?: string;
  /** `Origin` du handshake — ce que juge la politique CSRF (seam #4). Défaut `""`. */
  readonly origin?: string;
  /** En-têtes de la requête d'upgrade. */
  readonly headers?: Record<string, string | undefined>;
  /** Cookies de la requête d'upgrade, à la forme du contexte HTTP. */
  readonly cookies?: Record<string, { value: string }>;
  /**
   * Identité posée au handshake (seam #2). Sans elle, la base pose le token
   * anonyme — c'est le repli Zero Trust, et c'est ce qu'il faut pour éprouver
   * qu'un canal refuse un visiteur non identifié.
   */
  readonly identity?: IRealtimeToken;
  /**
   * Verrou de frame (seam #1). Neutre par construction : `@nodefony/realtime`
   * ne connaît pas `@nodefony/security`. Une application qui charge la sécurité
   * passe ici son `buildFrameAuthorizer(...)` pour éprouver une politique de
   * canal ou une action gardée par rôle — sans lui, une `policy` déclarée n'est
   * appliquée par personne, exactement comme au runtime.
   */
  readonly frameAuthorizer?: FrameAuthorizer;
  /**
   * Remet le hub à zéro à la création (défaut `true`). Le hub est un singleton
   * par process : sans ce reset, un canal ouvert par un cas précédent fausse le
   * suivant. Passer `false` pour monter deux connexions sur le MÊME hub — c'est
   * ainsi qu'on éprouve un fan-out.
   */
  readonly resetHub?: boolean;
}

/**
 * Vue de test d'un controller temps réel connecté : ce qu'il a reçu, ce qu'il a
 * émis, et de quoi le piloter frame par frame.
 *
 * @typeParam C - le type du controller éprouvé, rendu tel quel par `controller`.
 */
export interface IRealtimeHarness<C extends RealtimeController> {
  /** L'instance éprouvée, du type rendu par la fabrique. */
  readonly controller: C;
  /** Le hub du process — pour poser une politique de canal ou lire une sonde. */
  readonly hub: RealtimeHub;
  /** Toutes les frames sorties, dans l'ordre d'émission. */
  readonly received: readonly IRealtimeFrame[];
  /** Les fermetures demandées par le serveur (un refus d'Origin y laisse 4003). */
  readonly closes: readonly IHarnessClose[];
  /**
   * Les avertissements de plateforme émis DEPUIS le handshake — dont celui qui
   * dit qu'un canal servi dynamiquement ne porte aucune politique.
   */
  readonly notices: readonly string[];
  /**
   * Ouvre la socket (message `null` → `realtime:welcome`).
   *
   * @returns la frame de bienvenue — elle annonce les canaux, les méthodes et
   *   l'identité retenue.
   * @throws Si aucun welcome n'arrive (Origin refusée, authentification en
   *   échec) : lire `closes` pour en connaître la cause.
   */
  connect(): Promise<IRealtimeFrame>;
  /** Demande un canal, comme le ferait un client. */
  subscribe(channel: string): Promise<void>;
  /** Rend un canal — le provider est disposé au dernier abonné. */
  unsubscribe(channel: string): Promise<void>;
  /**
   * Appelle une action (requête → réponse), appariée par identifiant.
   *
   * @returns le `result` de l'action.
   * @throws L'erreur JSON-RPC rendue, ou un délai dépassé si rien ne répond.
   */
  call<T = unknown>(method: string, params?: unknown): Promise<T>;
  /** Envoie une notification cliente (plein-duplex entrant). */
  notify(method: string, params?: unknown): Promise<void>;
  /** Injecte une frame brute — pour éprouver un protocole malformé. */
  send(frame: Record<string, unknown>): Promise<void>;
  /** Les charges utiles reçues sur un canal, dans l'ordre. */
  messages(channel: string): readonly unknown[];
  /** Les refus d'abonnement notifiés (`realtime:denied`). */
  denials(): readonly IHarnessDenied[];
  /** Ferme la socket côté client : la base dispose alors tous ses providers. */
  close(): void;
  /** `close()` puis remise à zéro du hub. À appeler en fin de cas. */
  dispose(): void;
}

/** Laisse tourner les microtâches et les timers immédiats. */
const tick = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Attend qu'une condition devienne vraie, en bornant l'attente.
 *
 * Les chemins du controller mêlent synchrone (refus d'Origin) et asynchrone
 * (authentification, action `async`) : attendre un nombre FIXE de tours rend un
 * test fragile dans un sens et lent dans l'autre.
 *
 * @returns `true` si la condition s'est réalisée avant la borne.
 */
async function waitFor(
  predicate: () => boolean,
  ticks: number,
): Promise<boolean> {
  for (let i = 0; i < ticks; i++) {
    if (predicate()) return true;
    await tick();
  }
  return predicate();
}

/** Le point d'entrée du protocole, que la base garde `protected`. */
interface IRealtimeControllerBridge {
  handleRealtime(message: string | Buffer | null): void;
}

/**
 * Monte un controller temps réel sur une fausse connexion et rend de quoi le
 * piloter.
 *
 * La fabrique reçoit le contexte à passer au constructeur : c'est la seule
 * chose que le harnais ne peut pas deviner, puisque le nom du service et les
 * dépendances injectées appartiennent au controller.
 *
 * @param create  - construit le controller à partir du contexte fourni.
 * @param options - écarts au décor par défaut (identité, Origin, verrou…).
 * @returns le harnais, prêt pour `connect()`.
 */
export function createRealtimeHarness<C extends RealtimeController>(
  create: (context: ContextType) => C,
  options: IRealtimeHarnessOptions = {},
): IRealtimeHarness<C> {
  const hub = getRealtimeHub();
  if (options.resetHub !== false) hub.clear();

  if (options.identity !== undefined) {
    const token = options.identity;
    const authenticator: IRealtimeAuthenticator = {
      name: "harness",
      supports: () => true,
      authenticate: () => Promise.resolve(token),
    };
    hub.useAuthenticator({ pattern: /.*/u }, authenticator);
  }
  if (options.frameAuthorizer !== undefined) {
    hub.setFrameAuthorizer(options.frameAuthorizer);
  }

  const url = options.url ?? "/realtime";
  const received: IRealtimeFrame[] = [];
  const closes: IHarnessClose[] = [];
  const notices: string[] = [];
  let onFinish: (() => void) | null = null;
  let closed = false;

  // Faux Context : ne fournit QUE ce que la base touche — la connexion brute,
  // `once("onFinish")` pour le nettoyage, et de quoi bâtir le handshake. Le
  // reste (container, journal) est créé par `Service` quand il est absent.
  const connection = {
    readyState: OPEN,
    send: (data: string, cb?: (err?: Error) => void): void => {
      received.push(JSON.parse(data) as IRealtimeFrame);
      cb?.();
    },
    close: (code?: number, reason?: string): void => {
      closes.push({ code, reason });
    },
  };
  const context = {
    connection,
    once: (event: string, fn: () => void): void => {
      if (event === "onFinish") onFinish = fn;
    },
    request: { headers: options.headers ?? {}, url },
    cookies: options.cookies ?? {},
    url,
    remoteAddress: "127.0.0.1",
    origin: options.origin ?? "",
  };

  const controller = create(context as unknown as ContextType);
  // `handleRealtime` est `protected` : la route générée l'appelle depuis la
  // sous-classe. Un test n'a pas cette position — le pont est absorbé ici, une
  // fois, plutôt que recopié dans chaque application.
  const bridge = controller as unknown as IRealtimeControllerBridge;

  let nextId = 1;

  const feed = async (frame: Record<string, unknown> | null): Promise<void> => {
    bridge.handleRealtime(frame === null ? null : JSON.stringify(frame));
    await tick();
  };

  const rpc = (payload: Record<string, unknown>): Record<string, unknown> => ({
    jsonrpc: "2.0",
    ...payload,
  });

  return {
    controller,
    hub,
    received,
    closes,
    notices,

    async connect(): Promise<IRealtimeFrame> {
      await feed(null);
      // Le controller pose SON journal sur le hub pendant le handshake : le
      // nôtre vient donc après, sinon il serait écrasé. Les avertissements qui
      // comptent pour un test (canal dynamique sans politique) naissent de
      // toute façon plus tard, au premier abonnement.
      hub.onPlatformNotice((message: string): void => {
        notices.push(message);
      });
      const welcome = await waitFor(
        () => received.some((f) => f.method === "realtime:welcome"),
        10,
      );
      if (!welcome) {
        const cause =
          closes.length > 0
            ? `socket fermée (code ${String(closes[0]?.code)})`
            : "aucune frame émise";
        throw new Error(
          `createRealtimeHarness: pas de realtime:welcome — ${cause}. ` +
            `Vérifier l'Origin (seam #4) et l'authenticator (seam #2).`,
        );
      }
      return received.find((f) => f.method === "realtime:welcome")!;
    },

    async subscribe(channel: string): Promise<void> {
      await feed(rpc({ method: "subscribe", params: { channel } }));
    },

    async unsubscribe(channel: string): Promise<void> {
      await feed(rpc({ method: "unsubscribe", params: { channel } }));
    },

    async call<T = unknown>(method: string, params?: unknown): Promise<T> {
      const id = nextId++;
      await feed(
        rpc(params === undefined ? { id, method } : { id, method, params }),
      );
      const answered = await waitFor(
        () => received.some((f) => f.id === id),
        20,
      );
      const response = received.find((f) => f.id === id);
      if (!answered || response === undefined) {
        throw new Error(
          `createRealtimeHarness: aucune réponse à l'action "${method}".`,
        );
      }
      if (response.error !== undefined) {
        throw Object.assign(
          new Error(
            `${method} → ${response.error.message} (${String(response.error.code)})`,
          ),
          { rpc: response.error },
        );
      }
      return response.result as T;
    },

    async notify(method: string, params?: unknown): Promise<void> {
      await feed(rpc(params === undefined ? { method } : { method, params }));
    },

    async send(frame: Record<string, unknown>): Promise<void> {
      await feed(frame);
    },

    messages(channel: string): readonly unknown[] {
      return received
        .filter((f) => f.method === channel && f.id === undefined)
        .map((f) => f.params);
    },

    denials(): readonly IHarnessDenied[] {
      return received
        .filter((f) => f.method === "realtime:denied")
        .map((f) => f.params as IHarnessDenied);
    },

    close(): void {
      if (closed) return;
      closed = true;
      connection.readyState = 3; // CLOSED — plus rien ne doit partir
      onFinish?.();
    },

    dispose(): void {
      this.close();
      hub.clear();
    },
  };
}
