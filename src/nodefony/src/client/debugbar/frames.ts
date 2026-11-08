/**
 * Le SENS des trames du journal de socket — pur, isomorphe, testé seul.
 *
 * Le journal brut montre `chat:typing · 52 car.` dans les deux sens, avec un
 * `params: {}` en montant et `{ author }` en descendant : exact, et illisible
 * pour qui ne connaît pas JSON-RPC. Ce module met chaque trame en une phrase
 * et RELIE celles qui se répondent :
 *  - une réponse à sa requête, par l'`id` — lien EXACT ;
 *  - un accusé d'abonnement à sa demande, par le canal — lien exact au plus
 *    près ;
 *  - une poussée du serveur à l'émission de la page qui la précède sur le
 *    même canal — lien PROBABLE, et dit comme tel : un autre client a pu
 *    provoquer la même poussée.
 *
 * Rien ici ne connaît une application : les phrases se déduisent du protocole
 * (JSON-RPC 2.0, méthodes réservées `subscribe`, `realtime:*`, `api.request`).
 */
import type { RealtimeFrame } from "../realtime/NodefonySocket";
import { fmtClock } from "./format";

/** Au-delà de ce délai, une poussée n'est plus rapprochée d'une émission. */
export const ECHO_WINDOW_MS = 2000;

/** Méthodes du socle, que la page n'émet pas pour l'application. */
const SUBSCRIBE = "subscribe";
const UNSUBSCRIBE = "unsubscribe";
const PING = "ping";
const API_REQUEST = "api.request";

/** Un champ propre d'un objet inconnu, sans traverser le prototype. */
function own(value: unknown, key: string): unknown {
  return value !== null &&
    typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, key)
    ? Reflect.get(value, key)
    : undefined;
}

/** Les `params` de la trame (la charge journalisée EST la trame JSON-RPC). */
function paramsOf(fr: RealtimeFrame): unknown {
  return own(fr.payload, "params");
}

/** Une valeur scalaire courte, pour un résumé d'une ligne. */
function short(value: unknown): string | null {
  if (typeof value === "string")
    return value.length > 24 ? `${value.slice(0, 23)}…` : value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return null;
}

/**
 * Résumé des champs d'une charge : « aucun champ », ou les trois premiers
 * champs scalaires (`author: admin`), suivis du nombre des autres.
 *
 * @param params - les `params` de la trame
 * @returns le résumé, ou `""` quand il n'y a pas d'objet à résumer
 */
export function summarizeParams(params: unknown): string {
  if (params === undefined || params === null) return "aucun champ";
  if (typeof params !== "object" || Array.isArray(params)) return "";
  const keys = Object.keys(params);
  if (keys.length === 0) return "aucun champ";
  const shown: string[] = [];
  for (const key of keys) {
    if (shown.length === 3) break;
    const v = short(Reflect.get(params, key));
    shown.push(v === null ? key : `${key}: ${v}`);
  }
  const rest = keys.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}

/**
 * Le sens d'une trame, en une phrase.
 *
 * @param fr - la trame journalisée
 * @returns la phrase — qui émet, quoi, et si une réponse est attendue
 */
export function frameMeaning(fr: RealtimeFrame): string {
  const params = paramsOf(fr);
  const channel = fr.channel ?? short(own(params, "channel")) ?? "?";
  if (fr.dir === "out") {
    if (fr.kind === SUBSCRIBE)
      return `la page s'abonne au canal « ${channel} »`;
    if (fr.kind === UNSUBSCRIBE)
      return `la page se désabonne du canal « ${channel} »`;
    if (fr.kind === PING && fr.id === undefined)
      return "battement de cœur — garde la connexion ouverte, sans réponse";
    if (fr.kind === API_REQUEST) {
      const verb = short(own(params, "method")) ?? "GET";
      const path = short(own(params, "path")) ?? "?";
      return `la page appelle ${verb} ${path} par la socket — réponse attendue (#${fr.id ?? "?"})`;
    }
    if (fr.id !== undefined)
      return `la page appelle l'action « ${fr.kind} » — réponse attendue (#${fr.id})`;
    return `la page émet sur « ${fr.kind} » — notification, sans réponse ; ${summarizeParams(params)}`;
  }
  if (fr.kind === "realtime:welcome")
    return "le serveur accueille la connexion : identité, canaux et actions offerts";
  if (fr.kind === "realtime:subscribed")
    return `le serveur confirme l'abonnement au canal « ${channel} »`;
  if (fr.kind === "realtime:denied") {
    const reason = short(own(params, "reason"));
    return `le serveur refuse « ${channel} »${reason === null ? "" : ` (${reason})`}`;
  }
  if (fr.kind === "response") return `le serveur répond à #${fr.id ?? "?"}`;
  if (fr.kind === "error")
    return `le serveur répond à #${fr.id ?? "?"} par une erreur`;
  if (fr.kind === "stream")
    return `le serveur envoie un morceau du flux #${fr.id ?? "?"}`;
  return `le serveur pousse sur « ${fr.kind} » aux abonnés ; ${summarizeParams(params)}`;
}

/** Les sens d'une trame que la page émet pour l'application, hors socle. */
function isAppEmit(fr: RealtimeFrame): boolean {
  return (
    fr.dir === "out" &&
    fr.id === undefined &&
    fr.kind !== SUBSCRIBE &&
    fr.kind !== UNSUBSCRIBE &&
    fr.kind !== PING
  );
}

/** Une poussée du serveur sur un canal de l'application. */
function isAppPush(fr: RealtimeFrame): boolean {
  return (
    fr.dir === "in" &&
    fr.id === undefined &&
    fr.kind !== "response" &&
    fr.kind !== "error" &&
    fr.kind !== "stream" &&
    !fr.kind.startsWith("realtime:")
  );
}

/** L'autre trame d'un lien : son sens, et ce qu'elle est (« ↑ l'émission de 16:10:05.123 »). */
function ref(fr: RealtimeFrame, label: string): string {
  return `${fr.dir === "in" ? "↓" : "↑"} ${label} de ${fmtClock(fr.ts)}`;
}

/** L'autre trame d'un lien, par son seul instant (« ↓ à 16:10:05.140 »). */
function when(fr: RealtimeFrame): string {
  return `${fr.dir === "in" ? "↓" : "↑"} à ${fmtClock(fr.ts)}`;
}

/**
 * Les liens entre trames qui se répondent, indexés par la position de chaque
 * trame dans `frames` (ordre chronologique, la plus ancienne d'abord).
 *
 * Une passe, des tables bornées par le journal : la requête la plus récente
 * pour un `id`, la dernière demande d'abonnement et la dernière émission par
 * canal.
 *
 * @param frames - le journal, dans l'ordre où les trames sont passées
 * @returns pour chaque trame liée, la phrase du lien
 */
export function frameLinks(
  frames: readonly RealtimeFrame[],
): Map<number, string> {
  const links = new Map<number, string>();
  const add = (i: number, text: string): void => {
    const before = links.get(i);
    links.set(i, before === undefined ? text : `${before} · ${text}`);
  };
  const requests = new Map<number, number>();
  const subscribes = new Map<string, number>();
  const emits = new Map<string, number>();
  frames.forEach((fr, i) => {
    if (fr.dir === "out") {
      if (fr.id !== undefined) requests.set(fr.id, i);
      else if (fr.kind === SUBSCRIBE && fr.channel !== undefined)
        subscribes.set(fr.channel, i);
      else if (isAppEmit(fr)) emits.set(fr.kind, i);
      return;
    }
    if (
      fr.id !== undefined &&
      (fr.kind === "response" || fr.kind === "error" || fr.kind === "stream")
    ) {
      const r = requests.get(fr.id);
      const asked = r === undefined ? undefined : frames.at(r);
      if (r !== undefined && asked !== undefined) {
        add(i, `en réponse à ${ref(asked, `« ${asked.kind} »`)}`);
        if (fr.kind !== "stream")
          add(
            r,
            `${fr.kind === "error" ? "erreur reçue" : "réponse reçue"} ${when(fr)}`,
          );
      }
      return;
    }
    if (fr.kind === "realtime:subscribed" && fr.channel !== undefined) {
      const s = subscribes.get(fr.channel);
      const asked = s === undefined ? undefined : frames.at(s);
      if (s !== undefined && asked !== undefined) {
        add(i, `confirme ${ref(asked, "la demande")}`);
        add(s, `confirmé ${when(fr)}`);
        subscribes.delete(fr.channel);
      }
      return;
    }
    if (isAppPush(fr)) {
      const e = emits.get(fr.kind);
      const sent = e === undefined ? undefined : frames.at(e);
      if (
        e !== undefined &&
        sent !== undefined &&
        fr.ts - sent.ts >= 0 &&
        fr.ts - sent.ts <= ECHO_WINDOW_MS
      ) {
        add(
          i,
          `en retour probable de ${ref(sent, "l'émission")} (même canal, ${fr.ts - sent.ts} ms après)`,
        );
        add(e, `rediffusé par le serveur ${when(fr)} (probable)`);
        emits.delete(fr.kind);
      }
    }
  });
  return links;
}
