import { Controller, Get, controller } from "@nodefony/framework";
import { Context } from "@nodefony/http";
import type { Pdu } from "nodefony";

/** Longueur maximale du texte d'une ligne poussée — un journal n'est pas un vidage. */
const MAX_TEXT = 400;

/**
 * Sévérité la plus BAVARDE poussée : INFO (RFC 5424, 6). Chaque requête produit
 * plusieurs lignes DEBUG (événements du noyau) ; poussées, elles noieraient le
 * journal d'une vitrine en une seconde.
 */
const MAX_SEVERITY = 6;

/** Lignes du tampon circulaire rejouées à l'ouverture, pour ne pas montrer un écran vide. */
const REPLAY = 20;

/**
 * Une ligne de journal telle que les vitrines la reçoivent — jamais le `Pdu`
 * entier : sa charge peut être une erreur avec sa pile, ou un objet arbitraire.
 */
interface ILiveLogLine {
  id: number;
  time: number;
  severity: string;
  msgid: string;
  text: string;
  requestId?: string | undefined;
}

/** Le texte d'une entrée, borné. Une charge non textuelle se résume, elle ne se sérialise pas. */
function lineOf(pdu: Pdu): ILiveLogLine {
  const payload: unknown = pdu.payload;
  const text =
    typeof payload === "string"
      ? payload
      : payload instanceof Error
        ? `${payload.name}: ${payload.message}`
        : `[${pdu.typePayload ?? typeof payload}]`;
  return {
    id: pdu.uid,
    time: pdu.timeStamp,
    severity: pdu.severityName,
    msgid: pdu.msgid,
    text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text,
    requestId: pdu.requestId,
  };
}

/**
 * Le journal du serveur, poussé en direct aux quatre vitrines de front par un
 * flux SSE — `GET /nodefony/test/api/syslog`.
 *
 * **Pourquoi sous `/nodefony/<ns>/api/`** : un journal d'exploitation est une
 * donnée d'administration (adresses, identifiants, `requestId`). Ce chemin
 * tombe dans la zone `nodefony-admin` du framework — session de la console et
 * rôle de plateforme exigés — sans une ligne de configuration de plus. Le canal
 * WebSocket équivalent (`nodefony:syslog`) est fermé aux anonymes pour la même
 * raison ; un flux ouvert aurait été une porte dérobée vers les mêmes données.
 * Un visiteur non connecté reçoit 401 : le client passe à `CLOSED`, et la
 * vitrine le dit.
 *
 * **Ce que la démonstration montre** : le serveur parle, le navigateur écoute,
 * sur une réponse HTTP ordinaire. Chaque ligne porte un `id:` — à la
 * reconnexion, le navigateur renvoie `Last-Event-ID` et ne reçoit que ce qu'il
 * a manqué, rejoué depuis le tampon circulaire du syslog.
 *
 * **Un client lent ne fait pas grossir le serveur** : tant qu'une écriture
 * attend son `drain`, les lignes suivantes sont COMPTÉES et jetées, et le
 * compte part avec la ligne suivante qui passe. L'écouteur `onLog` n'existe que
 * le temps du flux : retiré à la fermeture, quel que soit le bout qui ferme.
 */
@controller("/nodefony/test/api")
class LiveSyslogController extends Controller {
  constructor(context: Context) {
    super("LiveSyslogController", context);
  }

  /** Ouvre le flux : rejoue la fin du tampon, puis pousse chaque entrée. */
  @Get("/syslog")
  async stream() {
    const syslog = this.kernel?.syslog;
    const sse = await this.renderSse();
    if (!syslog) return sse.close();

    // Reprise : seules les entrées postérieures au dernier `id` reçu.
    const header = this.context?.request?.headers["last-event-id"];
    const after = Number.parseInt(typeof header === "string" ? header : "", 10);
    const ring = syslog.ringStack;
    const shown = ring.filter((pdu) => pdu.severity <= MAX_SEVERITY);
    const replay = Number.isFinite(after)
      ? shown.filter((pdu) => pdu.uid > after)
      : shown.slice(-REPLAY);

    let pending = false;
    let dropped = 0;
    const push = (pdu: Pdu): void => {
      if (sse.closed || pdu.severity > MAX_SEVERITY) return;
      if (pending) {
        dropped++;
        return;
      }
      const line = lineOf(pdu);
      const wait = sse.send(dropped > 0 ? { ...line, dropped } : line, {
        event: "log",
        id: String(line.id),
      });
      dropped = 0;
      if (wait) {
        pending = true;
        const release = (): void => {
          pending = false;
        };
        wait.then(release, release);
      }
    };

    for (const pdu of replay) push(pdu);
    syslog.on("onLog", push);
    sse.onClose(() => syslog.removeListener("onLog", push));
  }
}

export default LiveSyslogController;
