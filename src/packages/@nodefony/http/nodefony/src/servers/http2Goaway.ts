import { constants as http2constants } from "node:http2";
import type { ServerHttp2Session } from "node:http2";

/** Plus long délai d'annonce (ms) : un pair qui ne répond pas au PING ne retient pas la fermeture. */
export const ANNOUNCE_CAP_MS = 1000;

/** Dernier identifiant de flux possible (RFC 9113 §6.8) : « aucun flux n'est encore écarté ». */
const LAST_POSSIBLE_STREAM = 2 ** 31 - 1;

/**
 * Annonce à UNE session HTTP/2 qu'elle va fermer, SANS écarter un flux déjà en route.
 *
 * Un PING mesure l'aller-retour, puis GOAWAY à `2^31-1`, puis l'attente de cet
 * aller-retour : après elle, tout flux ouvert par le client avant l'annonce est
 * arrivé, et le GOAWAY définitif (`session.close()`, dernier flux traité) peut
 * suivre. RFC 9113 §6.8 : « SHOULD send an initial GOAWAY frame with the last
 * stream identifier set to 2^31-1 […] After allowing time for any in-flight
 * stream creation (at least one round-trip time) ». Sans annonce, un flux croisé
 * avec le GOAWAY est refusé alors qu'il aurait pu être servi.
 *
 * L'aller-retour se MESURE avant l'annonce : après un GOAWAY, un client Node ne
 * répond plus aux PING (constaté sur Node 26.13).
 *
 * @param session - la session à annoncer, ni fermée ni détruite
 * @param settle - appelé UNE fois : après l'attente, à la fermeture de la
 *   session, ou aussitôt si le PING ne part pas. Un pair muet ne l'appelle
 *   jamais — le délai maximal appartient à l'appelant.
 */
export function announceSessionClose(
  session: ServerHttp2Session,
  settle: () => void,
): void {
  let settled = false;
  let wait: ReturnType<typeof setTimeout> | null = null;
  const done = (): void => {
    if (settled) return;
    settled = true;
    if (wait !== null) clearTimeout(wait);
    session.removeListener("close", done);
    settle();
  };
  session.once("close", done);
  const sent = session.ping((error, rttMs) => {
    if (error !== null || settled || session.closed) return done();
    session.goaway(http2constants.NGHTTP2_NO_ERROR, LAST_POSSIBLE_STREAM);
    wait = setTimeout(done, Math.max(1, Math.ceil(rttMs)));
  });
  if (!sent) {
    session.goaway(http2constants.NGHTTP2_NO_ERROR, LAST_POSSIBLE_STREAM);
    done();
  }
}

/**
 * Ferme EN DOUCEUR une session HTTP/2 restée inactive au-delà du délai du serveur.
 *
 * RFC 9113 §9.1 : un serveur est « permitted to terminate idle connections »,
 * et « SHOULD first send a GOAWAY ». La fermeture suit l'annonce en deux temps
 * ({@link announceSessionClose}), puis `session.close()` : aucun nouveau flux,
 * mais les flux en cours vont à leur terme — un flux long et muet (abonnement
 * gRPC) n'est pas coupé, seuls les NOUVEAUX flux repartent sur une autre
 * connexion, ce que tout client HTTP/2 fait sur GOAWAY.
 *
 * Le délai de la session est désarmé d'abord : Node (26.13) marque une session
 * détruite AVANT de désarmer son minuteur, qui la retiendrait alors jusqu'à son
 * échéance (nodejs/node#66885).
 *
 * @param session - la session inactive
 * @param capMs - délai maximal d'attente de l'écho du PING (ms)
 */
export function closeIdleSession(
  session: ServerHttp2Session,
  capMs: number = ANNOUNCE_CAP_MS,
): void {
  if (session.closed || session.destroyed) return;
  session.setTimeout(0);
  let finished = false;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (!session.closed && !session.destroyed) session.close();
  };
  const timer = setTimeout(finish, capMs);
  announceSessionClose(session, finish);
}
