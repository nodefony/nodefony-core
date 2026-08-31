/**
 * Transport **montant** des journaux du navigateur : il écoute le `Syslog` client, met
 * les `Pdu` en tampon et les pousse par lots sur un canal entrant de la socket, où le
 * pod les réinjecte dans son propre journal.
 *
 * Ce qu'il n'est PAS : un puits {@link ILogSink}. Celui-ci reçoit des **chaînes déjà
 * formatées** — au point où il intervient, la sévérité, le module et le `requestId` sont
 * fondus dans du texte. Les faire transiter par là obligerait à reparser ce qu'on vient
 * de sérialiser, et le `requestId` serait extrait d'un format d'affichage. Le transport
 * écoute donc l'événement `"onLog"`, qui porte le `Pdu` **lui-même** : la même structure
 * des deux côtés du fil, ce qui est tout l'intérêt d'un cœur isomorphe.
 *
 * Coût quand il n'est pas installé : **zéro**. `Syslog.log()` ne déclenche `fire("onLog")`
 * que si `listenerCount("onLog") > 0`.
 *
 * Coût quand il l'est : un test de sévérité par entrée, un `push` dans un tableau alloué
 * au premier journal retenu, et **un** minuteur de regroupement quel que soit le débit.
 * La sérialisation n'a lieu qu'à l'envoi, jamais à la capture.
 */

import type Pdu from "../../syslog/Pdu";
import type Syslog from "../../syslog/Syslog";
import { PLATFORM_INBOUND } from "../../realtime/platformChannels";
import { getPageId } from "./context";

/** Le strict nécessaire pour pousser — n'impose pas `RealtimeClient` à l'appelant. */
export interface UplinkPublisher {
  publish(channel: string, payload?: unknown): void;
}

/** Une entrée de journal telle qu'elle voyage sur le fil (plate, sérialisable). */
export interface WireLogEntry {
  /** Sévérité RFC 5424 (0-7). */
  severity: number;
  /** Nom de la sévérité (`"ERROR"`, `"INFO"`…). */
  severityName: string;
  /** Module émetteur **tel que le client le prétend** — le pod ne le croit pas. */
  moduleName: string;
  msgid: string;
  msg: string;
  /** Horloge du NAVIGATEUR (ms epoch) — jamais celle du pod. */
  timeStamp: number;
  /** Requête connue au moment du journal, absente si elle ne l'était pas. */
  requestId?: string;
  /** Charge normalisée : une `Error` devient `{name, message, stack}`. */
  payload: unknown;
}

/** Enveloppe d'un lot poussé sur le canal montant. */
export interface UplinkBatch {
  /** Identifiant de ce chargement de page — la clé de regroupement d'un onglet. */
  pageId: string;
  /** Les entrées, dans l'ordre d'émission. */
  entries: WireLogEntry[];
  /** Entrées perdues depuis le dernier lot (tampon plein). `0` omis. */
  dropped?: number;
}

export interface SyslogUplinkOptions {
  /** Le journal client à écouter. */
  syslog: Syslog;
  /** La socket par laquelle pousser (typiquement le `RealtimeClient` partagé). */
  publisher: UplinkPublisher;
  /**
   * Sévérité maximale retenue (RFC 5424 : plus le nombre est petit, plus c'est grave).
   * Défaut `4` (WARNING) — remonter le DEBUG d'un navigateur en production est un
   * excellent moyen de noyer un journal d'exploitation.
   */
  maxSeverity?: number;
  /** Fenêtre de regroupement, en ms. Défaut `2000`. */
  batchMs?: number;
  /** Entrées par lot au maximum ; au-delà, on envoie sans attendre. Défaut `50`. */
  maxBatch?: number;
  /** Profondeur du tampon ; au-delà, la plus ANCIENNE est perdue. Défaut `200`. */
  maxQueue?: number;
  /** Longueur maximale d'une chaîne transportée (message, pile). Défaut `4096`. */
  maxStringLength?: number;
  /** Canal montant. Défaut {@link PLATFORM_INBOUND.syslogUplink}. */
  channel?: string;
}

/**
 * Catégorie (`msgid`) réservée à ce que le transport dit de LUI-MÊME. Les entrées qui la
 * portent sont **exclues** de la remontée : sans cette exclusion, un envoi qui échoue
 * journalise son échec, ce qui produit une entrée, qui déclenche un envoi, qui échoue.
 *
 * La marque porte sur le `msgid` et non sur le module : `Syslog.log()` ne permet pas de
 * fixer `moduleName` par appel — il appartient aux `settings` du logger.
 */
export const UPLINK_MSGID = "CLIENT_UPLINK";

/** Tronque une chaîne en signalant la coupe — un log tronqué en silence ment. */
function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}… [+${s.length - max}]`;
}

/**
 * Rend une charge de journal sérialisable en JSON **sans perdre l'essentiel**.
 *
 * Le cas qui compte : `JSON.stringify(new Error("x"))` rend `{}`. Une remontée d'erreurs
 * qui n'aplatit pas les `Error` transporte donc des objets vides — et le journal du pod
 * se remplit d'entrées sans message ni pile, ce qui est pire que rien.
 */
function normalizePayload(payload: unknown, maxLen: number): unknown {
  if (payload === null || payload === undefined) return payload;
  if (payload instanceof Error) {
    return {
      name: payload.name,
      message: clamp(payload.message, maxLen),
      stack: payload.stack ? clamp(payload.stack, maxLen) : undefined,
    };
  }
  const t = typeof payload;
  if (t === "string") return clamp(payload as string, maxLen);
  if (t === "number" || t === "boolean") return payload;
  if (t === "function" || t === "symbol" || t === "bigint") {
    return clamp(String(payload), maxLen);
  }
  try {
    // Un cycle, un getter qui jette, un DOM node : on ne laisse pas l'échec de
    // sérialisation remonter jusqu'au `publish` — il tuerait le lot entier.
    return JSON.parse(
      clamp(JSON.stringify(payload) ?? "null", maxLen),
    ) as unknown;
  } catch {
    return clamp(String(payload), maxLen);
  }
}

/**
 * Installe la remontée des journaux du navigateur vers le pod.
 *
 * @param opts - journal à écouter, socket par laquelle pousser, et les bornes.
 * @returns la fonction de retrait — détache le listener, annule le minuteur et pousse
 *   une dernière fois ce qui restait en tampon.
 */
export function installSyslogUplink(opts: SyslogUplinkOptions): () => void {
  const {
    syslog,
    publisher,
    maxSeverity = 4,
    batchMs = 2000,
    maxBatch = 50,
    maxQueue = 200,
    maxStringLength = 4096,
    channel = PLATFORM_INBOUND.syslogUplink,
  } = opts;

  // Lazy : rien n'est alloué tant qu'aucune entrée n'est retenue.
  let queue: WireLogEntry[] | null = null;
  let dropped = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const flush = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (queue === null || queue.length === 0) return;
    const batch: UplinkBatch = { pageId: getPageId(), entries: queue };
    if (dropped > 0) batch.dropped = dropped;
    queue = null;
    dropped = 0;
    try {
      publisher.publish(channel, batch);
    } catch {
      // Socket fermée, transport en reconnexion : le lot est perdu, et c'est le bon
      // choix. Le remettre en tampon ferait grossir la file à chaque échec — un
      // journal n'est pas une file de messages garantie.
    }
  };

  const onLog = (pdu: Pdu): void => {
    if (disposed) return;
    if (pdu.severity > maxSeverity) return;
    // Anti-boucle : ce que le transport dit de lui-même ne repart pas par le transport.
    if (pdu.msgid === UPLINK_MSGID) return;

    if (queue === null) queue = [];
    if (queue.length >= maxQueue) {
      queue.shift();
      dropped += 1;
    }
    const entry: WireLogEntry = {
      severity: pdu.severity,
      severityName: pdu.severityName,
      moduleName: pdu.moduleName,
      msgid: pdu.msgid,
      msg: clamp(pdu.msg ?? "", maxStringLength),
      timeStamp: pdu.timeStamp,
      payload: normalizePayload(pdu.payload, maxStringLength),
    };
    if (pdu.requestId !== undefined) entry.requestId = pdu.requestId;
    queue.push(entry);

    if (queue.length >= maxBatch) {
      flush();
      return;
    }
    // UN seul minuteur en vol, quel que soit le débit d'entrées.
    if (timer === null) timer = setTimeout(flush, batchMs);
  };

  syslog.on("onLog", onLog);

  return () => {
    if (disposed) return;
    disposed = true;
    syslog.removeListener("onLog", onLog);
    // Un dernier envoi : ce qui est déjà en tampon a été journalisé, le perdre au
    // démontage effacerait précisément les entrées d'une page qui se ferme.
    flush();
  };
}
