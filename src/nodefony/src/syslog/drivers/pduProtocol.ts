import type { IPduLike } from "./ILogDriver";

/** Protocole d'origine d'un enregistrement de log. */
export type LogProtocol = "ws" | "http";

/**
 * msgid forcé par défaut sur **tout** log émis dans un contexte WebSocket
 * (`WebsocketContext.log()` côté `@nodefony/http`). C'est le marqueur fiable du
 * protocole — pas de parsing de message.
 */
const WS_MSGID = "WEBSOCKET CONTEXT";

/**
 * Classe un Pdu par **protocole** d'origine — `"ws"` ou `"http"` — de façon PURE,
 * isomorphe et 0-alloc (une seule comparaison de `msgid`).
 *
 * Critère FIABLE : tout log émis dans un contexte WebSocket porte le msgid
 * `"WEBSOCKET CONTEXT"` (forcé par défaut dans `WebsocketContext.log()`). Tout le
 * reste du pipeline (req/http2/router/firewall/kernel/applicatif) est classé HTTP.
 * Une seule logique → front et back ne divergent plus (le front filtrait par texte,
 * source de faux positifs).
 *
 * Seul `msgid` compte → accepte un `Pdu`, un {@link IPduLike} ou un record wire
 * relu (`ILogRecord` / miroir front) indifféremment.
 *
 * @param pdu - tout objet portant un `msgid`.
 * @returns `"ws"` si le log provient d'une socket WebSocket, sinon `"http"`.
 */
export function pduProtocol(pdu: Pick<IPduLike, "msgid">): LogProtocol {
  return pdu.msgid === WS_MSGID ? "ws" : "http";
}
