/**
 * Décorateurs realtime de Nodefony — style déclaratif (NestJS-like) pour les
 * endpoints WebSocket JSON-RPC 2.0 portés par {@link RealtimeController}.
 *
 * Les décorateurs **posent des métadonnées** sur le constructeur de la classe
 * (via `reflect-metadata`, comme {@link controller}/{@link route} dans framework).
 * La base {@link RealtimeController} les lit au handshake et fusionne avec les
 * overrides classiques (`realtimeActions()` / `realtimeChannels()` /
 * `realtimeInbound()` / `createRealtimeChannel()`) → coexistence sans casse.
 *
 * ── Pourquoi un nouveau fichier (pas dans framework/routerDecorators) ──
 *  Les décorateurs HTTP (`route`, `controller`) appartiennent au framework, qui
 *  ne dépend PAS de realtime (cycle interdit). Le realtime, qui PEUT dépendre du
 *  framework via peerDep, héberge ses propres décorateurs ici.
 *
 * ── Coût ──
 *  Lecture des métadonnées = 1× au handshake (cold path). Aucun coût par frame.
 *  Une classe sans décorateur (cas legacy) → Reflect.getMetadata renvoie
 *  `undefined` (pas d'allocation), fallback sur les overrides classiques.
 */
import "reflect-metadata";
import type { RpcActionHandler } from "nodefony";
import type {
  RealtimePublish,
  RealtimeInboundHandler,
} from "../interfaces/IRealtimeController";
import type { IChannelPolicy } from "../interfaces/IChannelPolicy";

/** Clés de métadonnées posées sur le constructor de la classe controller. */
const ACTIONS_KEY = "realtime:actions";
const CHANNELS_KEY = "realtime:channels";
const INBOUND_KEY = "realtime:inbound";
// Registre UNIQUE des politiques d'autorisation (canaux `@RealtimeChannel` ET
// méthodes inbound `@RealtimeInbound`), indexé par NOM de canal/méthode. Séparé
// des maps nom→méthode ci-dessus : la policy est attachée au NOM (ce que le
// firewall security résout), pas à la méthode TS qui l'implémente.
const POLICIES_KEY = "realtime:policies";

/** Enregistre (idempotent) une politique non vide sous son nom de canal/méthode. */
function definePolicy(
  ctor: object,
  name: string,
  policy?: IChannelPolicy,
): void {
  // Pas de politique, ou objet vide (aucune contrainte) → ne rien stocker : le
  // canal reste libre, `resolveChannelPolicy` renverra `undefined` (0 alloc).
  if (
    !policy ||
    (policy.authenticated === undefined &&
      policy.roles === undefined &&
      policy.scopes === undefined)
  ) {
    return;
  }
  const map =
    (Reflect.getMetadata(POLICIES_KEY, ctor) as
      Record<string, IChannelPolicy> | undefined) ?? {};
  map[name] = policy;
  Reflect.defineMetadata(POLICIES_KEY, map, ctor);
}

/**
 * Politique appliquée à une action RPC dont l'auteur n'a rien déclaré :
 * **exiger une connexion authentifiée**. Une action est une méthode que le pair
 * APPELLE et qui AGIT — le défaut sûr est de la fermer, pas de l'ouvrir.
 * Pour une action délibérément publique, l'écrire : `{ authenticated: false }`.
 */
export const DEFAULT_ACTION_POLICY: IChannelPolicy = Object.freeze({
  authenticated: true,
});

/** Une politique est-elle DÉJÀ déclarée sous ce nom ? */
function hasPolicy(ctor: object, name: string): boolean {
  const map = Reflect.getMetadata(POLICIES_KEY, ctor) as
    Record<string, IChannelPolicy> | undefined;
  return map ? Object.prototype.hasOwnProperty.call(map, name) : false;
}

/**
 * Factory d'un provider de canal — appelée par la base au 1ᵉʳ `subscribe`.
 *
 * Signature alignée sur {@link RealtimeController.createRealtimeChannel} (la
 * méthode override historique) pour qu'une migration d'une override `switch` vers
 * des méthodes décorées reste un copier-coller : même `channel` (nom EXACT du
 * sous-canal demandé, parfois suffixé `:<ms>` côté client mais ici on matche
 * **strict**, cf {@link RealtimeChannel}) et même `publish`.
 *
 * Retour : `dispose` (idempotent) appelé au dernier `unsubscribe` ET au close
 * de la connexion qui hébergeait le sink. `null` impossible pour une méthode
 * décorée (un match exact réussi DOIT démarrer un provider) — c'est le contrat.
 */
export type RealtimeChannelFactory = (
  channel: string,
  publish: RealtimePublish,
) => () => void;

/**
 * Décorateur **méthode** — expose une **action RPC** request→response du
 * controller realtime sous le nom `method` (ex. `"kernel:ping"`, `"chat:send"`).
 *
 * La méthode décorée devient le handler appelé sur une requête entrante AVEC `id` ;
 * sa valeur de retour est sérialisée comme `result`. Sync OU async (Promise) ;
 * un throw est mappé sur `-32603 internal error` (Zero Trust — message générique
 * au pair, détail loggé via `onError`).
 *
 * Le `this` est lié à l'instance de controller (`handler.bind(instance)` au
 * handshake). La méthode peut donc lire `this.context`, `this.kernel`, etc.
 *
 * **Autorisation — FERMÉE PAR DÉFAUT.** Une action sans `policy` exige une
 * connexion **authentifiée**. C'est délibéré : une action est une méthode que le
 * pair appelle et qui AGIT (`kernel:gc`, `scaffold:run`, `orders:quote`), et le
 * verrou de frame laisse passer tout ce qu'aucune politique ne couvre — sans ce
 * défaut, toute action applicative serait publique sans que rien ne le dise.
 * Pour une action délibérément ouverte, l'écrire : `{ authenticated: false }`.
 *
 * Si une politique est **déjà déclarée sous ce nom** (canal homonyme via
 * `@RealtimeChannel`/`@RealtimeInbound`), elle est conservée : le défaut ne
 * rétrograde jamais une politique existante, souvent plus stricte.
 *
 * ⚠️ Le NOM peut primer sur ta politique : le plancher système de
 * `@nodefony/security` réserve les préfixes plateforme (`kernel:`, `syslog:`…)
 * **et** tout nom contenant `:health` ou `:stats`. Une action ainsi nommée reste
 * réservée même déclarée `{ authenticated: false }`.
 *
 * @param method - nom RPC exposé au pair.
 * @param policy - politique d'autorisation ; par défaut `{ authenticated: true }`.
 *
 * @example
 *   class ChatController extends RealtimeController {
 *     @RealtimeAction("chat:ping")                       // authentifié requis
 *     ping(): { pong: true; ts: number } {
 *       return { pong: true, ts: Date.now() };
 *     }
 *
 *     @RealtimeAction("admin:purge", { roles: ["ROLE_ADMIN"] })
 *     purge(): void {}
 *
 *     @RealtimeAction("catalog:browse", { authenticated: false })  // ouvert, assumé
 *     browse(): string { return "ok"; }
 *   }
 */
export function RealtimeAction(
  method: string,
  policy?: IChannelPolicy,
): MethodDecorator {
  return function (target, propertyKey) {
    // `target` = prototype de la classe instance. On stocke sur le constructor
    // (target.constructor) → la même clé qu'utilisera la base au handshake.
    const ctor = (target as { constructor: object }).constructor;
    const map =
      (Reflect.getMetadata(ACTIONS_KEY, ctor) as
        Record<string, string | symbol> | undefined) ?? {};
    map[method] = propertyKey;
    Reflect.defineMetadata(ACTIONS_KEY, map, ctor);
    // Politique explicite de l'auteur, sinon le défaut FERMÉ — et jamais par
    // dessus une politique déjà posée sous ce nom.
    if (policy) {
      definePolicy(ctor, method, policy);
    } else if (!hasPolicy(ctor, method)) {
      definePolicy(ctor, method, DEFAULT_ACTION_POLICY);
    }
  };
}

/**
 * Décorateur **méthode** — expose un **canal pub/sub** sous le nom `channel`
 * (match EXACT, sans préfixe `:<ms>` ni regex). La méthode décorée DOIT renvoyer
 * un `dispose: () => void` (la base le mémorise et l'appelle au dernier
 * désabonné, comme avec l'override classique).
 *
 * v1 — match EXACT uniquement. Les canaux à pattern (`/^orm:rich@(\d+)/`) ou à
 * suffixe de granularité (`dashboard:stats:1000`) restent dans l'override
 * `createRealtimeChannel()` (la base donne PRIORITÉ aux décorateurs, puis tombe
 * sur l'override en fallback — coexistence sans casse). Un mode `pattern: RegExp`
 * arrivera plus tard sans rompre cette API.
 *
 * Le `this` est lié à l'instance ; le factory peut donc lire `this.kernel`, etc.
 * Mais ATTENTION : un provider est **partagé** entre toutes les connexions au
 * même canal (cf `RealtimeHub.subscribe`) — il survit à la connexion qui l'a
 * créé. Capturer des **valeurs long-lived** (broker, syslog) dans la closure,
 * jamais `this.context` (lié à la connexion créatrice qui peut fermer).
 *
 * @example
 *   class ChatController extends RealtimeController {
 *     @RealtimeChannel("chat:room42")
 *     room42(_channel: string, publish: RealtimePublish): () => void {
 *       const timer = setInterval(() => publish("chat:room42", { ts: Date.now() }), 1000);
 *       return () => clearInterval(timer);
 *     }
 *   }
 */
export function RealtimeChannel(
  channel: string,
  policy?: IChannelPolicy,
): MethodDecorator {
  return function (target, propertyKey) {
    const ctor = (target as { constructor: object }).constructor;
    const map =
      (Reflect.getMetadata(CHANNELS_KEY, ctor) as
        Record<string, string | symbol> | undefined) ?? {};
    map[channel] = propertyKey;
    Reflect.defineMetadata(CHANNELS_KEY, map, ctor);
    // Politique d'autorisation (opt-in) — lue par `@nodefony/security` au
    // `subscribe`. Absente = canal libre. Cf {@link IChannelPolicy}.
    definePolicy(ctor, channel, policy);
  };
}

/**
 * Décorateur **méthode** — déclare un **canal FULL-DUPLEX entrant** (méthode WS
 * inverse : le client pousse via une notification `method: <name>`, params libres,
 * sans `id`). La méthode décorée reçoit `(params, reply)` :
 *  - `params` : NON FIABLE (entrée client) — valider AVANT d'agir.
 *  - `reply(payload)` : push serveur→client sur le MÊME canal, vers CETTE connexion.
 *
 * Équivalent décoratif de `realtimeInbound()` override. Sécurité : un canal n'est
 * inbound QUE s'il est explicitement déclaré (défaut sûr — un client ne peut rien
 * pousser tant qu'aucun handler n'est enregistré ici). Cf seam P13.8a
 * (`beforeDispatch`) pour la gate sécurité par voter P6.
 *
 * @example
 *   class ChatController extends RealtimeController {
 *     @RealtimeInbound("chat:send")
 *     onChatSend(params: unknown, reply: (payload: unknown) => void): void {
 *       const text = (params as { text?: unknown })?.text;
 *       if (typeof text !== "string") return;
 *       reply({ ok: true, echoed: text });
 *     }
 *   }
 */
export function RealtimeInbound(
  method: string,
  policy?: IChannelPolicy,
): MethodDecorator {
  return function (target, propertyKey) {
    const ctor = (target as { constructor: object }).constructor;
    const map =
      (Reflect.getMetadata(INBOUND_KEY, ctor) as
        Record<string, string | symbol> | undefined) ?? {};
    map[method] = propertyKey;
    Reflect.defineMetadata(INBOUND_KEY, map, ctor);
    // Même politique que les canaux : un client ne peut pousser sur un canal
    // inbound protégé sans satisfaire la policy (vérif côté security).
    definePolicy(ctor, method, policy);
  };
}

/** Lecture (lazy, au handshake) du registre des actions décorées. */
export function getRealtimeActions(
  instance: object,
): Record<string, RpcActionHandler> | null {
  const map = Reflect.getMetadata(ACTIONS_KEY, instance.constructor) as
    Record<string, string | symbol> | undefined;
  if (!map) return null;
  const out: Record<string, RpcActionHandler> = {};
  for (const [name, prop] of Object.entries(map)) {
    const fn = (instance as Record<string | symbol, unknown>)[prop];
    if (typeof fn === "function") {
      out[name] = (fn as RpcActionHandler).bind(instance);
    }
  }
  return out;
}

/** Lecture (lazy, au handshake) du registre des canaux décorés. */
export function getRealtimeChannels(
  instance: object,
): Record<string, RealtimeChannelFactory> | null {
  const map = Reflect.getMetadata(CHANNELS_KEY, instance.constructor) as
    Record<string, string | symbol> | undefined;
  if (!map) return null;
  const out: Record<string, RealtimeChannelFactory> = {};
  for (const [name, prop] of Object.entries(map)) {
    const fn = (instance as Record<string | symbol, unknown>)[prop];
    if (typeof fn === "function") {
      out[name] = (fn as RealtimeChannelFactory).bind(instance);
    }
  }
  return out;
}

/** Lecture (lazy, au handshake) du registre des canaux inbound décorés. */
export function getRealtimeInbound(
  instance: object,
): Record<string, RealtimeInboundHandler> | null {
  const map = Reflect.getMetadata(INBOUND_KEY, instance.constructor) as
    Record<string, string | symbol> | undefined;
  if (!map) return null;
  const out: Record<string, RealtimeInboundHandler> = {};
  for (const [name, prop] of Object.entries(map)) {
    const fn = (instance as Record<string | symbol, unknown>)[prop];
    if (typeof fn === "function") {
      out[name] = (fn as RealtimeInboundHandler).bind(instance);
    }
  }
  return out;
}

/**
 * Lecture (lazy, au handshake) des politiques d'autorisation déclarées
 * (`@RealtimeChannel`/`@RealtimeInbound` avec opts). `null` si aucune → le
 * controller n'enregistre rien au hub (0 alloc). Donnée pure (pas de `bind` :
 * une policy n'est pas une méthode), renvoyée telle quelle pour publication au
 * hub realtime, qui l'expose à `@nodefony/security`.
 */
export function getRealtimeChannelPolicies(
  instance: object,
): Record<string, IChannelPolicy> | null {
  const map = Reflect.getMetadata(POLICIES_KEY, instance.constructor) as
    Record<string, IChannelPolicy> | undefined;
  return map ?? null;
}
