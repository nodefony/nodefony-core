import http2, { type Http2Session, type Http2Stream } from "node:http2";

/**
 * Délai avant de retenter un `PING` que Node a refusé (plafond de `PING` en vol
 * atteint par d'autres émetteurs de la session) : ceux-là reviennent en un
 * aller-retour, une boucle `setImmediate` brûlerait le processeur pendant ce
 * temps sur un lien lent.
 */
const PING_RETRY_MS = 10;

/**
 * Les flux d'une session qui attendent leur grâce. `inFlight` : couverts par le
 * `PING` en vol ; `next` : arrivés après son envoi, donc couverts par le
 * suivant — un `PING` envoyé AVANT leurs en-têtes ne prouve rien pour eux.
 */
class SessionGrace {
  inFlight: Http2Stream[] | null = null;
  next: Http2Stream[] | null = null;
}

/** Chemin d'erreur seulement : aucune session n'a d'entrée hors refus en cours. */
const graces = new WeakMap<Http2Session, SessionGrace>();

/** Coupe le flux en `NO_ERROR` s'il est encore ouvert et que le client émet encore. */
function decide(stream: Http2Stream): void {
  if (stream.closed || stream.destroyed || stream.state.remoteClose) return;
  stream.close(http2.constants.NGHTTP2_NO_ERROR);
}

function sendPing(session: Http2Session, grace: SessionGrace): void {
  if (session.destroyed) {
    // Session détruite : ses flux sont morts avec elle, rien à couper.
    graces.delete(session);
    return;
  }
  if (session.closed) {
    // Fermeture GRACIEUSE en cours (délai d'inactivité, arrêt) : Node refuse
    // tout `PING`, et la session attend la fin de ses flux — un client muet
    // la retiendrait ouverte. Coupe au tour de boucle suivant, le temps que
    // les réponses déjà soumises partent sur la socket.
    const pending = grace.inFlight;
    const later = grace.next;
    grace.inFlight = null;
    grace.next = null;
    graces.delete(session);
    setImmediate(() => {
      if (pending !== null) for (const stream of pending) decide(stream);
      if (later !== null) for (const stream of later) decide(stream);
    });
    return;
  }
  if (!session.ping(() => settle(session, grace))) {
    setTimeout(() => sendPing(session, grace), PING_RETRY_MS).unref();
  }
}

function settle(session: Http2Session, grace: SessionGrace): void {
  const batch = grace.inFlight;
  grace.inFlight = grace.next;
  grace.next = null;
  if (batch !== null) for (const stream of batch) decide(stream);
  if (grace.inFlight !== null) sendPing(session, grace);
  else graces.delete(session);
}

/**
 * Ferme en `NO_ERROR` un flux HTTP/2 dont la réponse est partie mais dont le
 * client émet encore, après la grâce d'un aller-retour (`PING`, RFC 9113 §6.7).
 *
 * RFC 9113 §8.1 : après une réponse complète, le serveur PEUT demander au
 * client d'arrêter d'émettre par un `RST_STREAM` `NO_ERROR`. La coupe ne doit
 * jamais précéder l'envoi de la réponse : un `RST_STREAM` soumis pendant que
 * les en-têtes attendent encore dans la file de nghttp2 les fait JETER, et le
 * client reçoit une fin de flux sans statut (un client gRPC la lit INTERNAL).
 * Le `PING` part derrière la réponse ; son écho prouve qu'elle est arrivée.
 *
 * **Un seul `PING` par session** couvre tous les flux qui attendent : un flux
 * arrivé pendant qu'un `PING` est en vol attend le suivant. Le plafond de
 * `PING` en vol de Node (10 par session) n'est donc jamais atteint par ce
 * chemin, et aucun flux n'est coupé sans grâce — ce que faisait la coupe
 * immédiate quand `ping()` rendait `false`, au-delà de 10 refus simultanés.
 *
 * Session en fermeture GRACIEUSE (délai d'inactivité, arrêt) : Node n'envoie
 * plus de `PING`, et la session attend la fin de ses flux — un client muet la
 * retiendrait. La coupe part alors au tour de boucle suivant, le temps que les
 * réponses déjà soumises quittent la file de nghttp2.
 *
 * Après la grâce : client qui a fini d'émettre → rien (le flux se ferme seul,
 * sans `RST_STREAM`) ; sinon → coupé. L'écho d'un `PING` passe avant les autres
 * trames (§6.7) : une trame DATA encore en route peut arriver après lui, la
 * coupe reste conforme (§8.1).
 *
 * Coût : chemin d'erreur seulement — une entrée de `WeakMap` par session tant
 * que des flux attendent, un `PING` par aller-retour et par session.
 *
 * @param stream - flux dont la réponse est ÉCRITE (`finish` passé).
 */
export function closeStreamAfterGrace(stream: Http2Stream): void {
  if (stream.closed || stream.destroyed || stream.state.remoteClose) return;
  const session = stream.session;
  if (session === undefined) return;
  let grace = graces.get(session);
  if (grace === undefined) {
    grace = new SessionGrace();
    graces.set(session, grace);
  }
  if (grace.inFlight === null) {
    grace.inFlight = [stream];
    sendPing(session, grace);
  } else if (grace.next === null) {
    grace.next = [stream];
  } else {
    grace.next.push(stream);
  }
}
