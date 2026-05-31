/**
 * **Traduction des events techniques en étapes logiques** du cycle d'une requête.
 *
 * Les logs DEBUG du pipeline portent des noms d'events bruts (`EVENT CONTEXT
 * onRequest`, `onRequestEnd`, `onSend`, `Match route : …`) — peu parlants, et dont
 * l'ordre d'apparition n'est pas l'ordre « intuitif » (`onRequestEnd` = corps reçu,
 * donc TÔT pour un GET, malgré le mot « End »). Ce module mappe chaque event vers
 * un **libellé clair en français** + un **rang logique** dans le cycle, pour rendre
 * la trace d'une requête lisible d'un coup d'œil.
 *
 * Pur (0 React) → réutilisable et testable. Réutilisé par l'Explorer (colonne
 * « Étape ») et la légende de l'onglet Backplane (le tableau de correspondance).
 */
import type { LogRecord } from "./logsTypes";
import { recordMessage } from "./logFormat";

/** Une étape logique du cycle d'une requête. */
export interface FlowStep {
  /** Libellé clair (français). */
  label: string;
  /** Rang logique dans le cycle (1 = tout début … 10 = finalisation). */
  order: number;
  /** Couleur d'accent du badge. */
  color: string;
}

/** Retire les codes de couleur ANSI d'une chaîne de log. */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Étapes reconnues par **nom d'event** (`on…`). */
const BY_EVENT: Record<string, FlowStep> = {
  onRequestEnd: { label: "Corps reçu", order: 1, color: "gray" },
  onRequest: { label: "Requête entrante", order: 2, color: "blue" },
  onSessionStart: { label: "Session ouverte", order: 4, color: "grape" },
  onConnect: { label: "WebSocket accepté", order: 5, color: "teal" },
  onSaveSession: { label: "Session enregistrée", order: 6, color: "grape" },
  onSend: { label: "Réponse envoyée", order: 7, color: "teal" },
  onClose: { label: "Connexion fermée", order: 8, color: "gray" },
  onFinish: { label: "Requête terminée", order: 9, color: "gray" },
  // Phase 2 d'une socket WS : messages entrants au fil de l'eau (subscribe, ping…).
  onMessage: { label: "Message reçu", order: 10, color: "cyan" },
};

/**
 * Décrit l'étape logique d'un enregistrement de log, ou `null` si la ligne n'est
 * pas un jalon du cycle (= un log applicatif libre, ex. `DB-DEMO`).
 *
 * Priorité aux marqueurs de **contenu** (route, session, cookie, bilan), puis au
 * **nom d'event** générique. `onRequest` est désambiguïsé par le msgid `KERNEL`
 * (dispatch kernel) vs contexte (entrée de requête).
 */
export function describeFlow(rec: LogRecord): FlowStep | null {
  const msg = stripAnsi(recordMessage(rec));

  // Marqueurs de contenu (plus spécifiques que le nom d'event).
  if (/Match route/i.test(msg)) {
    return { label: "Route trouvée", order: 3, color: "blue" };
  }
  if (/NEW SESSION/i.test(msg)) {
    return { label: "Nouvelle session", order: 4, color: "grape" };
  }
  if (/MIGRATE SESSION/i.test(msg)) {
    return { label: "Migration session", order: 4, color: "grape" };
  }
  if (/DESTROY SESSION/i.test(msg)) {
    return { label: "Session détruite", order: 4, color: "grape" };
  }
  if (/SESSION CONTEXT CHANGE/i.test(msg)) {
    return { label: "Contexte session", order: 4, color: "grape" };
  }
  if (/SAVE SESSION/i.test(msg)) {
    return { label: "Session sauvegardée", order: 6, color: "grape" };
  }
  if (/ADD COOKIE/i.test(msg)) {
    return { label: "Cookie posé", order: 7, color: "teal" };
  }
  if (/\bsubscribe\b/i.test(msg)) {
    return { label: "Abonnement canal", order: 10, color: "cyan" };
  }
  if (/client connected/i.test(msg)) {
    return { label: "Client WS connecté", order: 5, color: "teal" };
  }
  if (rec.msgid === "req") {
    // En WS, la ligne `req` (« WS 1000 … ») = fin du HANDSHAKE, pas de la
    // connexion (qui vit ensuite via les messages). En HTTP = bilan de fin.
    const isWs = /^\s*WS\b/.test(msg);
    return isWs
      ? { label: "Handshake terminé", order: 9, color: "indigo" }
      : { label: "Bilan requête", order: 9, color: "indigo" };
  }

  // Nom d'event générique (`onXxx`).
  const m = msg.match(/\bon([A-Z][A-Za-z]+)\b/);
  if (m) {
    const ev = `on${m[1]}`;
    if (ev === "onRequest" && rec.msgid === "KERNEL") {
      return { label: "Dispatch kernel", order: 2, color: "blue" };
    }
    const step = BY_EVENT[ev];
    if (step) return step;
  }
  return null;
}

/** Une entrée du tableau de correspondance event → étape (légende UI). */
export interface FlowLegendRow {
  /** Le marqueur tel qu'il apparaît dans les logs. */
  event: string;
  /** Le libellé clair affiché. */
  label: string;
  /** Ce que ça signifie vraiment (lève les faux-amis comme « End »). */
  meaning: string;
}

/**
 * Tableau de correspondance **event technique → étape logique**, dans l'ordre du
 * cycle d'une requête. Sert de **légende** (documentation in-app) — le user voit
 * d'où viennent les libellés de la colonne « Étape ».
 */
export const FLOW_LEGEND: readonly FlowLegendRow[] = [
  {
    event: "onRequestEnd",
    label: "Corps reçu",
    meaning:
      "Le corps de la requête entrante est entièrement lu. Pour un GET (sans corps), ça arrive tout de suite → c'est l'un des PREMIERS events, malgré le mot « End ».",
  },
  {
    event: "Match route",
    label: "Route trouvée",
    meaning: "Le routeur a associé l'URL à un controller + une action.",
  },
  {
    event: "onRequest (contexte)",
    label: "Requête entrante",
    meaning: "Le contexte HTTP/WS démarre le traitement de la requête.",
  },
  {
    event: "onRequest (KERNEL)",
    label: "Dispatch kernel",
    meaning: "Le kernel passe la main au pipeline (firewall, controller…).",
  },
  {
    event: "NEW SESSION / onSessionStart",
    label: "Session ouverte",
    meaning: "Une session est créée ou rouverte pour cette requête.",
  },
  {
    event: "(logs du controller)",
    label: "—",
    meaning:
      "Entre l'ouverture et la réponse : tes propres logs applicatifs (ex. DB-DEMO, requêtes SQL). Pas de libellé d'étape = c'est ton métier.",
  },
  {
    event: "onSaveSession",
    label: "Session enregistrée",
    meaning: "L'état de session modifié est persisté avant la réponse.",
  },
  {
    event: "onSend / ADD COOKIE",
    label: "Réponse envoyée",
    meaning: "Les octets de réponse partent vers le client (cookies posés au passage).",
  },
  {
    event: "onClose",
    label: "Connexion fermée",
    meaning: "Le socket de cette requête se ferme.",
  },
  {
    event: "req",
    label: "Bilan requête",
    meaning: "Ligne récapitulative de fin : méthode, statut, durée, IP, requestId.",
  },
  {
    event: "onFinish",
    label: "Requête terminée",
    meaning: "Nettoyage post-réponse (hooks onAfterResponse). Vraie fin du cycle.",
  },
] as const;
