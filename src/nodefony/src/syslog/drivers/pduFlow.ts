import type { IPduLike } from "./ILogDriver";
import type { LogProtocol } from "./pduProtocol";

/**
 * **Étape logique du cycle de vie d'une requête / connexion** — identifiant
 * STABLE (clé de filtre côté back ET clé de mapping libellé/couleur côté front).
 *
 * Les logs DEBUG du pipeline portent des noms d'events bruts (`onRequest`,
 * `onRequestEnd`, `onSend`…) peu parlants, et dont l'ordre d'apparition n'est pas
 * l'ordre intuitif (`onRequestEnd` = corps reçu, donc TÔT pour un GET malgré le
 * mot « End »). Chaque event est ici mappé vers une étape nommée — la base d'un
 * filtre fiable (≠ recherche texte, qui matchait par erreur les URL contenant le
 * marqueur) et d'une lecture « je comprends où en est la requête ».
 */
export type FlowStepId =
  // — Cycle d'une requête HTTP —
  | "request-in" // onRequest (contexte) : la requête entre dans le pipeline
  | "body-received" // onRequestEnd : corps entièrement lu (tôt pour un GET)
  | "route-matched" // Match route : URL → controller + action
  | "kernel-dispatch" // onRequest (KERNEL) : passage au pipeline (firewall, controller)
  | "response" // onSend / ADD COOKIE : octets de réponse envoyés
  | "request-end" // req : ligne-bilan (méthode, statut, durée, IP)
  | "finish" // onFinish : nettoyage post-réponse (vraie fin)
  // — Cycle d'une connexion WebSocket —
  | "ws-open" // onConnect / client connected : handshake accepté
  | "ws-message" // onMessage / subscribe : frame entrante
  | "ws-close" // onClose : socket fermé
  // — Commun aux deux (la session traverse HTTP et WS) —
  | "session" // NEW/MIGRATE/DESTROY SESSION, onSessionStart, CONTEXT CHANGE
  | "session-saved"; // onSaveSession / SAVE SESSION : état persisté

/**
 * Métadonnée **structurelle** d'une étape (jamais de présentation : libellé FR et
 * couleur vivent côté front, qui mappe l'`id`). `order` = rang logique dans le
 * cycle de SON protocole ; `protocol` = où l'étape apparaît (`"both"` = session).
 */
export interface FlowStepMeta {
  /** Rang logique dans le cycle (tri du sélecteur d'étapes). */
  order: number;
  /** Protocole d'appartenance — pilote le sélecteur adaptatif côté Studio. */
  protocol: LogProtocol | "both";
}

/**
 * Table des étapes — **source unique** de l'ordre et de l'appartenance protocole,
 * partagée back (filtre) et front (sélecteur groupé HTTP / WebSocket / Commun).
 */
export const FLOW_STEPS: Record<FlowStepId, FlowStepMeta> = {
  "request-in": { order: 1, protocol: "http" },
  "body-received": { order: 2, protocol: "http" },
  "route-matched": { order: 3, protocol: "http" },
  "kernel-dispatch": { order: 4, protocol: "http" },
  session: { order: 5, protocol: "both" },
  response: { order: 6, protocol: "http" },
  "session-saved": { order: 7, protocol: "both" },
  "request-end": { order: 8, protocol: "http" },
  finish: { order: 9, protocol: "http" },
  "ws-open": { order: 1, protocol: "ws" },
  "ws-message": { order: 2, protocol: "ws" },
  "ws-close": { order: 3, protocol: "ws" },
};

/**
 * Entrée minimale pour classer une étape — seuls `msgid`, `payload` et `msg`
 * comptent. Un `Pdu`, un {@link IPduLike} (msg requis) ET un record wire relu
 * (`ILogRecord` / miroir front, `msg` optionnel) la satisfont structurellement
 * → la classification est utilisable des deux côtés de la frontière isomorphe.
 */
export type FlowClassifiable = Pick<IPduLike, "msgid" | "payload"> & {
  msg?: string;
};

/** Retire les codes de couleur ANSI (les payloads en TTY peuvent en porter). */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Texte indexable d'un Pdu pour la classification (payload string sinon `msg`). */
function flowText(pdu: FlowClassifiable): string {
  const raw = typeof pdu.payload === "string" ? pdu.payload : pdu.msg || "";
  return stripAnsi(raw);
}

/**
 * Classe un Pdu en **étape de cycle de vie** (id stable) ou `null` si la ligne
 * n'est pas un jalon (log applicatif libre, ex. `DB-DEMO`). PUR, isomorphe,
 * 0 état — réutilisé par le filtre back ({@link filterPdus}) ET le rendu front
 * (colonne « Étape » + sélecteur) → une SEULE logique, jamais de divergence.
 *
 * Priorité aux marqueurs de **contenu** (route, session, cookie, bilan), puis au
 * **nom d'event** générique. `onRequest` est désambiguïsé par le msgid `KERNEL`
 * (dispatch kernel) vs contexte (entrée de requête).
 *
 * @param pdu - enregistrement (Pdu ou {@link IPduLike}, relu d'un JSONL aussi).
 * @returns l'`id` d'étape, ou `null` pour un log hors cycle.
 */
export function pduFlowStep(pdu: FlowClassifiable): FlowStepId | null {
  const msg = flowText(pdu);

  // Marqueurs de contenu (plus spécifiques que le nom d'event).
  if (/Match route/i.test(msg)) return "route-matched";
  if (
    /NEW SESSION|MIGRATE SESSION|DESTROY SESSION|SESSION CONTEXT CHANGE/i.test(
      msg,
    )
  )
    return "session";
  if (/SAVE SESSION/i.test(msg)) return "session-saved";
  if (/ADD COOKIE/i.test(msg)) return "response";
  if (/\bsubscribe\b/i.test(msg)) return "ws-message";
  if (/client connected/i.test(msg)) return "ws-open";
  if (pdu.msgid === "req") return "request-end"; // bilan (HTTP) / fin de handshake (WS)

  // Nom d'event générique (`onXxx`).
  const m = msg.match(/\bon([A-Z][A-Za-z]+)\b/);
  if (m) {
    const ev = `on${m[1]}`;
    if (ev === "onRequest" && pdu.msgid === "KERNEL") return "kernel-dispatch";
    switch (ev) {
      case "onRequestEnd":
        return "body-received";
      case "onRequest":
        return "request-in";
      case "onSessionStart":
        return "session";
      case "onConnect":
        return "ws-open";
      case "onSaveSession":
        return "session-saved";
      case "onSend":
        return "response";
      case "onClose":
        return "ws-close";
      case "onFinish":
        return "finish";
      case "onMessage":
        return "ws-message";
    }
  }
  return null;
}
