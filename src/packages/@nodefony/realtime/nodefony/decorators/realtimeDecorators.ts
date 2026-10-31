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
import { BootConfigurationError, Injector } from "nodefony";
import type {
  ChannelAdmissionClass,
  ChannelAllow,
  RpcActionHandler,
} from "nodefony";
import type {
  RealtimePublish,
  RealtimeInboundHandler,
} from "../interfaces/IRealtimeController";
import type { IChannelPolicy } from "../interfaces/IChannelPolicy";
import type {
  ContractPolicyNames,
  RealtimeContractOf,
} from "../src/server/ContractRealtimeController";
import { isCallable, isRecord } from "../src/guards";

/** Clés de métadonnées posées sur le constructor de la classe controller. */
const ACTIONS_KEY = "realtime:actions";
const CHANNELS_KEY = "realtime:channels";
const INBOUND_KEY = "realtime:inbound";
// Registre UNIQUE des politiques d'autorisation (canaux `@RealtimeChannel` ET
// méthodes inbound `@RealtimeInbound`), indexé par NOM de canal/méthode. Séparé
// des maps nom→méthode ci-dessus : la policy est attachée au NOM (ce que le
// firewall security résout), pas à la méthode TS qui l'implémente.
const POLICIES_KEY = "realtime:policies";

/**
 * Lit une métadonnée de classe posée par ces décorateurs : un objet nom → valeur,
 * ou `undefined` quand la classe n'en porte pas. Les valeurs restent `unknown` :
 * `Reflect.defineMetadata` est public, n'importe qui peut écrire sous ces clés.
 * Lu au démarrage et à la poignée de main, jamais par frame.
 */
function readMetadataMap(
  key: string,
  ctor: object,
): Record<string, unknown> | undefined {
  const raw: unknown = Reflect.getMetadata(key, ctor);
  return isRecord(raw) ? raw : undefined;
}

/** Vrai si la valeur est un tableau de chaînes. */
function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((v: unknown) => typeof v === "string")
  );
}

/**
 * Clés qu'une politique de canal peut porter — toute autre est refusée : une
 * faute de frappe (`role`, `alow`) dans une règle de sécurité ne s'ignore pas.
 */
const POLICY_KEYS: ReadonlySet<string> = new Set([
  "authenticated",
  "roles",
  "scopes",
  "allow",
  "anonymous",
]);

/**
 * `allow` désigne-t-il une classe d'admission (`@injectable`) plutôt qu'une flèche ?
 *
 * Tranché par la métadonnée `@injectable`, jamais par le texte de la fonction
 * (`class …`), qu'un minifieur réécrit (ADR-0021 §S10 bis).
 *
 * @param allow - valeur du membre `allow` d'une politique déjà validée.
 * @returns `true` pour une classe à résoudre par l'injecteur.
 */
export function isAdmissionClass(
  allow: ChannelAllow,
): allow is ChannelAdmissionClass {
  return Injector.isInjectable(allow);
}

/**
 * Défaut d'une politique de canal, ou `null` si elle est recevable — en clair, pour que le refus au démarrage dise QUOI corriger.
 *
 * @param value - valeur lue sous la métadonnée des politiques (`unknown` :
 *   `Reflect.defineMetadata` est public).
 * @returns la raison du refus, ou `null`.
 */
export function channelPolicyDefect(value: unknown): string | null {
  if (!isRecord(value)) return "la politique n'est pas un objet";
  for (const key of Object.keys(value)) {
    if (!POLICY_KEYS.has(key)) {
      return `clé inconnue « ${key} » (clés admises : ${[...POLICY_KEYS].join(", ")})`;
    }
  }
  const { authenticated, roles, scopes, allow, anonymous } = value;
  if (authenticated !== undefined && typeof authenticated !== "boolean") {
    return "« authenticated » doit être un booléen";
  }
  if (roles !== undefined && !isStringArray(roles)) {
    return "« roles » doit être un tableau de chaînes";
  }
  if (scopes !== undefined && !isStringArray(scopes)) {
    return "« scopes » doit être un tableau de chaînes";
  }
  if (anonymous !== undefined && typeof anonymous !== "boolean") {
    return "« anonymous » doit être un booléen";
  }
  if (allow === undefined) {
    // Sans `allow`, l'anonyme se règle par `authenticated` : la clé ne
    // changerait rien, et laisserait croire à une admission qui n'existe pas.
    return anonymous === undefined
      ? null
      : "« anonymous » n'a de sens qu'avec « allow »";
  }
  if (typeof allow !== "function") {
    return "« allow » doit être une fonction ou une classe @injectable";
  }
  if (anonymous === true && authenticated === true) {
    return "« anonymous: true » contredit « authenticated: true »";
  }
  // Une classe oubliée sans `@injectable` serait APPELÉE comme une flèche et
  // lèverait à chaque abonné — un refus de 100 % sans un mot. Reconnue à sa
  // méthode `allow` de prototype, qu'une flèche n'a pas.
  const proto: unknown = Reflect.get(allow, "prototype");
  if (
    !Injector.isInjectable(allow) &&
    isRecord(proto) &&
    typeof proto.allow === "function"
  ) {
    return `« allow » est une classe (${allow.name}) sans @injectable`;
  }
  return null;
}

/**
 * Exige que chaque entrée du registre soit une politique recevable — sinon le démarrage s'arrête en nommant la classe, le canal et le défaut.
 *
 * Une politique illisible ne se laisse jamais tomber : sans elle, le canal
 * s'ouvrirait à qui la politique fermait (fail-closed).
 */
function assertPolicyMap(
  owner: string,
  map: Record<string, unknown>,
): asserts map is Record<string, IChannelPolicy> {
  for (const name in map) {
    const defect = channelPolicyDefect(map[name]);
    if (defect !== null) {
      throw new BootConfigurationError(
        `${owner} : politique du canal temps réel « ${name} » refusée — ${defect}`,
      );
    }
  }
}

/** Méthode de l'instance que désigne une entrée de registre, ou `undefined`. */
function methodOf(instance: object, prop: unknown): unknown {
  return typeof prop === "string" || typeof prop === "symbol"
    ? Reflect.get(instance, prop)
    : undefined;
}

/** La politique porte-t-elle au moins une clé propre non `undefined` ? */
function hasDefinedKey(policy: object): boolean {
  for (const key of Object.keys(policy)) {
    if (Reflect.get(policy, key) !== undefined) return true;
  }
  return false;
}

/** Libération d'un canal dont la fabrique décorée n'en a rendu aucune. */
const NO_DISPOSE = (): void => {};

/** Enregistre (idempotent) une politique non vide sous son nom de canal/méthode. */
function definePolicy(
  ctor: object,
  name: string,
  policy?: IChannelPolicy,
): void {
  // Pas de politique, ou objet vide (aucune contrainte) → ne rien stocker : le
  // canal reste libre, `resolveChannelPolicy` renverra `undefined` (0 alloc).
  // Vide = aucune clé PROPRE définie : un `{ allow }` seul est une politique
  // (l'oublier ici ouvrait le canal à tous), et une clé inconnue est gardée
  // pour être REFUSÉE au démarrage, pas effacée.
  if (!policy || !hasDefinedKey(policy)) return;
  // Copie : sur une sous-classe, la lecture rend l'objet du PARENT.
  const map = { ...readMetadataMap(POLICIES_KEY, ctor) };
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
  const map = readMetadataMap(POLICIES_KEY, ctor);
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
 * controller realtime sous le nom `method` (ex. `"nodefony:kernel:ping"`, `"chat:send"`).
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
 * pair appelle et qui AGIT (`nodefony:kernel:gc`, `nodefony:scaffold:run`, `orders:quote`), et le
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
    // Copie : sur une sous-classe, la lecture rend l'objet du PARENT.
    const map = { ...readMetadataMap(ACTIONS_KEY, ctor) };
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
 * Noms d'une table de politiques absents du contrat de la classe décorée —
 * `never` quand tous y sont, ou que la classe n'a pas de contrat.
 */
type NamesNotInContract<P, T> = [RealtimeContractOf<T>] extends [never]
  ? never
  : Exclude<keyof P, ContractPolicyNames<RealtimeContractOf<T>>>;

/**
 * Contrainte posée sur la classe décorée : aucune si les noms sont tous dans le
 * contrat ; sinon un membre `notInContract` exigé, que l'erreur affiche avec les
 * noms fautifs.
 */
type PolicyNamesCheck<P, T> = [NamesNotInContract<P, T>] extends [never]
  ? unknown
  : { readonly notInContract: NamesNotInContract<P, T> };

/**
 * Décorateur de **classe** — pose les politiques d'accès d'actions ou de canaux
 * par leur NOM, sans déclarer de handler.
 *
 * C'est la voie des actions servies par la table de `realtimeActions()` : cette
 * table ne sait pas porter de politique, et un `@RealtimeAction` ajouté pour la
 * seule politique ferait fabriquer, à chaque connexion, un handler aussitôt
 * écrasé par la table (et contournerait l'injection de ses paramètres décorés).
 * Ici, rien par connexion : les politiques sont écrites UNE fois, à la
 * définition de la classe, dans le même registre que celles des décorateurs de
 * méthode. Une action de la table sans politique garde le défaut FERMÉ
 * (connexion authentifiée).
 *
 * Un nom qui porte `*` est un motif (famille de canaux), comme partout ailleurs.
 *
 * **Sur un contrôleur de contrat** (`extends ContractRealtimeController<C>`), le
 * décorateur lit le contrat sur la classe qu'il décore : chaque nom doit être
 * une méthode ou un canal de `C`, sinon la classe ne compile pas, et l'erreur
 * nomme le fautif (`notInContract`). Le contrat ne se répète pas. Sur un
 * contrôleur sans contrat, tout nom est accepté. Vérification à la compilation
 * seulement : coût d'exécution nul.
 *
 * @param policies - nom d'action ou de canal → politique.
 *
 * @example
 *   @RealtimePolicy({ "orders:quote": { roles: ["ROLE_SALES"] } })
 *   class OrdersRt extends ContractRealtimeController<OrdersContract> { … }
 */
export function RealtimePolicy<
  P extends { readonly [name: string]: IChannelPolicy | undefined },
>(
  policies: P,
): <T extends abstract new (...args: never[]) => object>(
  target: T & PolicyNamesCheck<P, T>,
) => void {
  return function (target) {
    for (const [name, policy] of Object.entries(policies)) {
      definePolicy(target, name, policy);
    }
  };
}

/**
 * Décorateur **méthode** — expose un **canal pub/sub** sous le nom `channel`
 * (match EXACT, sans préfixe `:<ms>` ni regex). La méthode décorée DOIT renvoyer
 * un `dispose: () => void` (la base le mémorise et l'appelle au dernier
 * désabonné, comme avec l'override classique).
 *
 * v1 — match EXACT uniquement. Les canaux à pattern (`/^nodefony:orm:rich@(\d+)/`) ou à
 * suffixe de granularité (`nodefony:dashboard:1000`) restent dans l'override
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
    // Copie : sur une sous-classe, la lecture rend l'objet du PARENT.
    const map = { ...readMetadataMap(CHANNELS_KEY, ctor) };
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
    // Copie : sur une sous-classe, la lecture rend l'objet du PARENT.
    const map = { ...readMetadataMap(INBOUND_KEY, ctor) };
    map[method] = propertyKey;
    Reflect.defineMetadata(INBOUND_KEY, map, ctor);
    // Même politique que les canaux : un client ne peut pousser sur un canal
    // inbound protégé sans satisfaire la policy (vérif côté security).
    definePolicy(ctor, method, policy);
  };
}

/**
 * Méthode d'action liée à son instance, appelable avec ses arguments réels —
 * plusieurs quand ses paramètres sont décorés (`@Body`, `@CurrentUser`…).
 */
export type RealtimeActionMethod = (...args: unknown[]) => unknown;

/**
 * Enveloppe posée sur une action décorée au handshake : reçoit la méthode liée
 * et son nom de propriété, rend le handler JSON-RPC à enregistrer.
 */
export type RealtimeActionWrapper = (
  method: RealtimeActionMethod,
  propertyKey: string | symbol,
) => RpcActionHandler;

/**
 * Lecture (lazy, au handshake) du registre des actions décorées.
 *
 * @param instance - le contrôleur de la connexion
 * @param wrap - enveloppe optionnelle de chaque action (résolution des
 *   paramètres décorés) ; sans elle, l'action reçoit la charge JSON-RPC brute
 * @returns les handlers par nom d'action, ou `null` si aucune n'est décorée
 */
export function getRealtimeActions(
  instance: object,
  wrap?: RealtimeActionWrapper,
): Record<string, RpcActionHandler> | null {
  const map = readMetadataMap(ACTIONS_KEY, instance.constructor);
  if (!map) return null;
  const out: Record<string, RpcActionHandler> = {};
  for (const [name, prop] of Object.entries(map)) {
    if (typeof prop !== "string" && typeof prop !== "symbol") continue;
    const fn = methodOf(instance, prop);
    if (isCallable(fn)) {
      const bound = fn.bind(instance);
      out[name] = wrap !== undefined ? wrap(bound, prop) : bound;
    }
  }
  return out;
}

/** Lecture (lazy, au handshake) du registre des canaux décorés. */
export function getRealtimeChannels(
  instance: object,
): Record<string, RealtimeChannelFactory> | null {
  const map = readMetadataMap(CHANNELS_KEY, instance.constructor);
  if (!map) return null;
  const out: Record<string, RealtimeChannelFactory> = {};
  for (const [name, prop] of Object.entries(map)) {
    const fn = methodOf(instance, prop);
    if (!isCallable(fn)) continue;
    const factory = fn.bind(instance);
    // Appelée à l'ouverture du canal (1ᵉʳ abonné), jamais par frame : la
    // libération rendue se vérifie ici plutôt que de la croire sur parole.
    out[name] = (channel, publish) => {
      const dispose = factory(channel, publish);
      return isCallable(dispose) ? (): void => void dispose() : NO_DISPOSE;
    };
  }
  return out;
}

/** Lecture (lazy, au handshake) du registre des canaux inbound décorés. */
export function getRealtimeInbound(
  instance: object,
): Record<string, RealtimeInboundHandler> | null {
  const map = readMetadataMap(INBOUND_KEY, instance.constructor);
  if (!map) return null;
  const out: Record<string, RealtimeInboundHandler> = {};
  for (const [name, prop] of Object.entries(map)) {
    const fn = methodOf(instance, prop);
    if (isCallable(fn)) out[name] = fn.bind(instance);
  }
  return out;
}

/**
 * La classe déclare-t-elle une ACTION (`@RealtimeAction`) sous ce nom ? Sert à refuser un `allow` posé sur une action, que rien n'appliquerait.
 *
 * @param ctor - constructeur du contrôleur.
 * @param name - nom d'action ou de canal.
 */
export function declaresAction(ctor: object, name: string): boolean {
  const map = readMetadataMap(ACTIONS_KEY, ctor);
  return map !== undefined && Object.prototype.hasOwnProperty.call(map, name);
}

/**
 * Politiques d'autorisation déclarées sur une CLASSE de contrôleur (`@RealtimeChannel`/`@RealtimeInbound`/`@RealtimePolicy` avec politique), validées — lues au démarrage du noyau, jamais par trame.
 *
 * @param ctor - constructeur du contrôleur.
 * @returns nom de canal ou de méthode → politique, ou `null` si la classe n'en
 *   déclare aucune (0 allocation).
 * @throws BootConfigurationError Une politique est illisible : la classe, le
 *   canal et le défaut sont nommés.
 */
export function getChannelPoliciesOf(
  ctor: object,
): Record<string, IChannelPolicy> | null {
  const map = readMetadataMap(POLICIES_KEY, ctor);
  if (map === undefined) return null;
  assertPolicyMap(typeof ctor === "function" ? ctor.name : "(contrôleur)", map);
  return map;
}

/**
 * Politiques déclarées sur la classe d'une instance de contrôleur — même lecture que {@link getChannelPoliciesOf}.
 *
 * @param instance - contrôleur instancié.
 * @returns nom → politique, ou `null` si aucune.
 */
export function getRealtimeChannelPolicies(
  instance: object,
): Record<string, IChannelPolicy> | null {
  return getChannelPoliciesOf(instance.constructor);
}

/**
 * Préfixes de canaux **broadcast** déclarés statiquement, tous controllers
 * confondus. Rempli à l'IMPORT des classes (le décorateur s'exécute au
 * chargement du module), donc connu **avant** tout trafic. `Set` : la
 * déclaration est idempotente et deux endpoints peuvent partager un préfixe.
 */
const declaredBroadcastPrefixes = new Set<string>();

/**
 * Décorateur **classe** — déclare les préfixes de canaux **broadcast**
 * (cross-process) servis par cet endpoint : leurs publications traversent le
 * {@link IBackplane} au lieu de rester dans le processus.
 *
 * POURQUOI STATIQUE (trouvé sur un banc multi-pods) : la politique de forward
 * est une propriété du code, pas de l'instant. Déclarée seulement au handshake
 * — via l'override `realtimeBroadcastChannels()` — elle laissait un pod qui
 * publie **sans abonné local** (job planifié, webhook, worker) ne rien
 * propager : `publish` évaluait « pas broadcast », en silence. Ici la
 * déclaration existe dès l'import de la classe ; le service l'applique au hub
 * au boot, identiquement sur tous les pods.
 *
 * @example
 *   \@RealtimeBroadcast("chat:", "presence:")
 *   \@controller("/api/chat")
 *   class ChatController extends RealtimeController { … }
 *
 * @param prefixes - préfixes de canal (`"chat:"` couvre `chat:room1:1000`).
 */
export function RealtimeBroadcast(...prefixes: string[]): ClassDecorator {
  return function (): void {
    for (const prefix of prefixes) declaredBroadcastPrefixes.add(prefix);
  };
}

/** Préfixes broadcast déclarés par décorateur (introspection / tests). */
export function getDeclaredBroadcastPrefixes(): string[] {
  return [...declaredBroadcastPrefixes];
}

/**
 * Applique au hub les préfixes broadcast déclarés statiquement. Appelé au boot
 * par `RealtimeService` — avant tout trafic, donc la politique est en place que
 * le pod ait ou non reçu une connexion. Idempotent
 * ({@link RealtimeHub.markBroadcastChannel} l'est déjà).
 *
 * @param hub - hub à configurer (celui du processus).
 */
export function applyDeclaredBroadcastPrefixes(hub: {
  markBroadcastChannel(prefix: string): void;
}): void {
  for (const prefix of declaredBroadcastPrefixes) {
    hub.markBroadcastChannel(prefix);
  }
}
