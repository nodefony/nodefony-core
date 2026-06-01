/**
 * **Présentation des étapes du cycle de vie** d'une requête / connexion.
 *
 * La CLASSIFICATION (quel log → quelle étape) vit dans le **core** (`pduFlowStep`,
 * `FLOW_STEPS`, importés de `nodefony`) → une SEULE logique, partagée par le filtre
 * back (`filterPdus`) et ce rendu front : front et back ne divergent jamais. Ce
 * module n'ajoute QUE la couche **présentation** (libellé FR, couleur Mantine,
 * explication) + les helpers du sélecteur d'étapes adaptatif au protocole.
 *
 * Pur (0 React) → réutilisable et testable. Consommé par l'Explorer (colonne
 * « Étape » + sélecteur), le drawer de détail, le rejeu de fichier et la légende
 * de l'onglet Backplane.
 */
import { pduFlowStep, FLOW_STEPS, type FlowStepId } from "nodefony";
import type { LogProtocol } from "nodefony";
import type { LogRecord } from "./logsTypes";

export type { FlowStepId } from "nodefony";

/** Une étape logique du cycle d'une requête (forme consommée par l'UI). */
export interface FlowStep {
  /** Libellé clair (français). */
  label: string;
  /** Rang logique dans le cycle (vient de `FLOW_STEPS`, structurel). */
  order: number;
  /** Couleur d'accent du badge. */
  color: string;
}

/** Présentation d'une étape : libellé FR, couleur, marqueur technique, sens. */
interface FlowLabel {
  /** Libellé clair affiché (badge + sélecteur). */
  label: string;
  /** Couleur d'accent Mantine. */
  color: string;
  /** Le(s) marqueur(s) tels qu'ils apparaissent dans les logs (légende). */
  event: string;
  /** Ce que l'étape signifie vraiment (lève les faux-amis comme « End »). */
  meaning: string;
}

/**
 * Mapping **id d'étape → présentation FR**. Seule source des libellés/couleurs ;
 * la classification (id) et l'ordre/protocole viennent du core (`FLOW_STEPS`).
 */
const FLOW_LABELS: Record<FlowStepId, FlowLabel> = {
  "request-in": {
    label: "Requête entrante",
    color: "blue",
    event: "onRequest (contexte)",
    meaning: "Le contexte HTTP démarre le traitement de la requête.",
  },
  "body-received": {
    label: "Corps reçu",
    color: "gray",
    event: "onRequestEnd",
    meaning:
      "Le corps de la requête est entièrement lu. Pour un GET (sans corps), ça arrive tout de suite → l'un des PREMIERS events, malgré le mot « End ».",
  },
  "route-matched": {
    label: "Route trouvée",
    color: "blue",
    event: "Match route",
    meaning: "Le routeur a associé l'URL à un controller + une action.",
  },
  "kernel-dispatch": {
    label: "Dispatch kernel",
    color: "blue",
    event: "onRequest (KERNEL)",
    meaning: "Le kernel passe la main au pipeline (firewall, controller…).",
  },
  session: {
    label: "Session",
    color: "grape",
    event: "NEW/MIGRATE/DESTROY SESSION, onSessionStart",
    meaning:
      "Une session est créée, rouverte, migrée ou détruite pour cette requête (HTTP ou WS).",
  },
  response: {
    label: "Réponse envoyée",
    color: "teal",
    event: "onSend / ADD COOKIE",
    meaning:
      "Les octets de réponse partent vers le client (cookies posés au passage).",
  },
  "session-saved": {
    label: "Session enregistrée",
    color: "grape",
    event: "onSaveSession / SAVE SESSION",
    meaning: "L'état de session modifié est persisté avant la réponse.",
  },
  "request-end": {
    label: "Bilan requête",
    color: "indigo",
    event: "req",
    meaning:
      "Ligne récapitulative de fin : méthode, statut, durée, IP, requestId. En WebSocket = fin du handshake.",
  },
  finish: {
    label: "Requête terminée",
    color: "gray",
    event: "onFinish",
    meaning: "Nettoyage post-réponse (hooks onAfterResponse). Vraie fin du cycle.",
  },
  "ws-open": {
    label: "Connexion ouverte",
    color: "teal",
    event: "onConnect / client connected",
    meaning: "Le handshake WebSocket est accepté — la socket est vivante.",
  },
  "ws-message": {
    label: "Message reçu",
    color: "cyan",
    event: "onMessage / subscribe",
    meaning:
      "Une frame entrante au fil de l'eau (message applicatif, abonnement à un canal, ping…).",
  },
  "ws-close": {
    label: "Connexion fermée",
    color: "gray",
    event: "onClose",
    meaning: "Le socket WebSocket se ferme.",
  },
};

/**
 * Décrit l'étape logique d'un enregistrement, ou `null` si la ligne n'est pas un
 * jalon du cycle (= un log applicatif libre, ex. `DB-DEMO`). Délègue la
 * classification au core (`pduFlowStep`) → identique au filtre back.
 */
export function describeFlow(rec: LogRecord): FlowStep | null {
  const id = pduFlowStep(rec);
  if (!id) return null;
  const lbl = FLOW_LABELS[id];
  return { label: lbl.label, color: lbl.color, order: FLOW_STEPS[id].order };
}

/** Libellé FR d'une étape (sélecteur, badges). */
export function flowLabel(id: FlowStepId): string {
  return FLOW_LABELS[id].label;
}

/**
 * Étapes pertinentes pour un protocole donné, **triées** par leur rang logique.
 * `"all"` = toutes (HTTP puis communes puis WS) ; `"http"`/`"ws"` = le protocole
 * + les étapes communes (`session`). Pilote le sélecteur adaptatif de l'Explorer.
 */
export function flowStepsForProtocol(
  protocol: "all" | LogProtocol,
): FlowStepId[] {
  const ids = (Object.keys(FLOW_LABELS) as FlowStepId[]).filter((id) => {
    const p = FLOW_STEPS[id].protocol;
    if (protocol === "all") return true;
    return p === protocol || p === "both";
  });
  // Tri : groupe protocole (http < both < ws) puis rang logique.
  const rank: Record<string, number> = { http: 0, both: 1, ws: 2 };
  return ids.sort((a, b) => {
    const pa = FLOW_STEPS[a].protocol;
    const pb = FLOW_STEPS[b].protocol;
    if (pa !== pb) return rank[pa]! - rank[pb]!;
    return FLOW_STEPS[a].order - FLOW_STEPS[b].order;
  });
}

/** Libellé de groupe par protocole (en-têtes du sélecteur + légende). */
const GROUP_LABEL: Record<LogProtocol | "both", string> = {
  http: "HTTP",
  both: "Commun (session)",
  ws: "WebSocket",
};

/** Un groupe d'options du sélecteur d'étapes (format Mantine `MultiSelect`). */
export interface FlowGroup {
  group: string;
  items: { value: FlowStepId; label: string }[];
}

/**
 * Options du sélecteur d'étapes **groupées par protocole** (HTTP / Commun / WS),
 * filtrées selon le protocole choisi. Vide pour un groupe sans étape → omis.
 */
export function flowSelectGroups(protocol: "all" | LogProtocol): FlowGroup[] {
  const ids = flowStepsForProtocol(protocol);
  const out: FlowGroup[] = [];
  for (const p of ["http", "both", "ws"] as const) {
    const items = ids
      .filter((id) => FLOW_STEPS[id].protocol === p)
      .map((id) => ({ value: id, label: FLOW_LABELS[id].label }));
    if (items.length) out.push({ group: GROUP_LABEL[p], items });
  }
  return out;
}

/** Une entrée du tableau de correspondance étape → sens (légende UI). */
export interface FlowLegendRow {
  /** Id stable de l'étape. */
  id: FlowStepId;
  /** Protocole d'appartenance (groupement de la légende). */
  protocol: LogProtocol | "both";
  /** Le(s) marqueur(s) tels qu'ils apparaissent dans les logs. */
  event: string;
  /** Le libellé clair affiché. */
  label: string;
  /** Ce que ça signifie vraiment. */
  meaning: string;
}

/**
 * Tableau de correspondance **event technique → étape logique**, groupé par
 * protocole (HTTP, commun, WS) puis ordre du cycle. Sert de **légende**
 * (documentation in-app) — le user voit d'où viennent les libellés « Étape ».
 */
export const FLOW_LEGEND: readonly FlowLegendRow[] = flowStepsForProtocol(
  "all",
).map((id) => ({
  id,
  protocol: FLOW_STEPS[id].protocol,
  event: FLOW_LABELS[id].event,
  label: FLOW_LABELS[id].label,
  meaning: FLOW_LABELS[id].meaning,
}));
