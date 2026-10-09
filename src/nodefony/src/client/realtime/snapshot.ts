/**
 * snapshot — l'instantané qu'une socket donne d'ELLE-MÊME, et sa mise en mots.
 *
 * Séparé d'`observe.ts` pour une raison de graphe : `NodefonySocket` décrit sa
 * socket dans la console avec {@link describeSocket}, et `observe.ts` importe
 * `NodefonySocket`. Ce fichier n'importe que des TYPES — les deux le lisent sans
 * cycle.
 *
 * @module nodefony/client
 */
import type {
  NodefonySocket,
  RealtimeIdentity,
  RealtimeState,
} from "./NodefonySocket";

/**
 * Ce qu'une socket doit savoir dire d'elle-même pour être photographiée — la
 * FORME, pas la classe : une socket typée par ses cartes d'événements
 * (`NodefonySocket<E, …>`) s'y lit comme une socket nue.
 */
export type SnapshotSource = Pick<
  NodefonySocket,
  | "url"
  | "state"
  | "subscribedChannels"
  | "framesReceived"
  | "framesUnsent"
  | "lastFrameMethod"
  | "lastFrameAt"
  | "reconnectAttempts"
  | "nextRetryAt"
  | "identity"
  | "serverChannels"
  | "serverMethods"
>;

/**
 * Ce que le client sait de sa PROPRE socket, à un instant donné.
 *
 * Pourquoi ce contrat existe : quatre écrans lisaient déjà `subscribedChannels`,
 * `framesReceived`, `lastFrameAt` et `lastFrameMethod` à la main pour afficher
 * la même chose — c'est-à-dire quatre lectures qui divergeront. La donnée est
 * parfaitement agnostique ; seule sa mise en page appartient à la vue.
 *
 * La frontière est là, et elle est nette : **l'instantané est ici, la boîte qui
 * l'affiche reste chez chaque front**. Publier un composant obligerait à en
 * écrire un par framework de vue, et ferait entrer du DOM dans un module dont
 * toute la valeur est de n'en avoir aucun.
 */
export interface SocketSnapshot {
  /** L'adresse du serveur temps réel — de QUELLE socket cet instantané parle. */
  url: string | null;
  /** État de la connexion. */
  state: RealtimeState;
  /** Canaux effectivement tenus par cette connexion. */
  channels: readonly string[];
  /** Trames reçues depuis l'ouverture. */
  frames: number;
  /** Trames perdues faute de transport ouvert — un silence qui se compte. */
  unsent: number;
  /** Méthode et horodatage de la dernière trame reçue (`null` si aucune). */
  lastFrame: { method: string | null; at: number | null };
  /** Tentatives de reconnexion depuis la dernière connexion réussie. */
  reconnectAttempts: number;
  /** Échéance de la prochaine tentative (ms epoch), `null` hors reconnexion. */
  nextRetryAt: number | null;
  /** Identité résolue par le serveur, `null` avant le premier welcome. */
  identity: RealtimeIdentity | null;
  /** Canaux que le serveur annonce à l'accueil, `null` avant le premier welcome. */
  serverChannels: readonly string[] | null;
  /** Actions que le serveur annonce à l'accueil, `null` avant le premier welcome. */
  serverMethods: readonly string[] | null;
}

/**
 * Lit l'instantané courant. Purement local : aucune trame n'est émise, rien
 * n'est demandé au serveur — afficher cet état ne coûte donc rien au réseau.
 */
export function socketSnapshot(client: SnapshotSource): SocketSnapshot {
  return {
    url: client.url,
    state: client.state,
    channels: client.subscribedChannels,
    frames: client.framesReceived,
    unsent: client.framesUnsent,
    lastFrame: { method: client.lastFrameMethod, at: client.lastFrameAt },
    reconnectAttempts: client.reconnectAttempts,
    nextRetryAt: client.nextRetryAt,
    identity: client.identity,
    serverChannels: client.serverChannels,
    serverMethods: client.serverMethods,
  };
}

/** Une ligne de la description d'une socket : ce qu'on lit, et pourquoi ça compte. */
export interface SocketDetailRow {
  /** Libellé affiché. */
  label: string;
  /** Valeur, déjà mise en mots pour un humain. */
  value: string;
  /** Une phrase qui dit ce que la valeur signifie, ou ce qu'elle garantit. */
  hint: string;
}

/** L'état de la connexion, dit en français — un écran ne parle pas machine. */
const STATE_WORDS: Record<RealtimeState, string> = {
  connected: "connecté",
  connecting: "connexion…",
  reconnecting: "reconnexion automatique…",
  disconnected: "coupé",
  error: "erreur",
};

/**
 * Ce que le client sait de SA socket, mis en mots — la même description pour
 * le tableau de la console du navigateur et pour la vignette qu'une page
 * affiche.
 *
 * Une seule source pour les deux : écrit dans chaque front, le texte des
 * explications divergerait de celui de la console à la première retouche. La
 * description est un tableau de lignes, pas un composant : la boîte qui
 * l'affiche reste chez chaque framework de vue.
 *
 * @param snapshot - l'instantané, tel que {@link socketSnapshot} le rend.
 * @returns les lignes, dans l'ordre où un humain les lit.
 */
export function describeSocket(snapshot: SocketSnapshot): SocketDetailRow[] {
  const id = snapshot.identity;
  const list = (v: readonly string[] | null, none: string): string =>
    v === null ? "— (avant l'accueil)" : v.join(", ") || none;
  return [
    {
      label: "adresse",
      value: snapshot.url ?? "—",
      hint: "Le point d'entrée WebSocket, résolu contre la page : une seule socket par adresse, partagée par tous les composants.",
    },
    {
      label: "état",
      value: STATE_WORDS[snapshot.state],
      hint: "Coupée, la socket se reconnecte seule et rejoue ses abonnements : la page n'a rien à écrire pour ça.",
    },
    {
      label: "identité",
      value: id?.authenticated
        ? id.userIdentifier || "authentifié"
        : id === null
          ? "— (avant l'accueil)"
          : "anonyme",
      hint: "Résolue par le SERVEUR à l'accueil (realtime:welcome), d'après la session ou le jeton — le navigateur ne la décide jamais.",
    },
    {
      label: "canaux tenus",
      value: snapshot.channels.join(", ") || "aucun",
      hint: "Abonnements comptés par référence : dix composants sur le même canal, un seul abonnement réseau.",
    },
    {
      label: "canaux offerts",
      value: list(snapshot.serverChannels, "aucun"),
      hint: "Ce que le serveur annonce à l'accueil — ce qu'on PEUT écouter, filtré par les droits de cette identité.",
    },
    {
      label: "actions",
      value: list(snapshot.serverMethods, "aucune"),
      hint: "Les actions de contrôleur joignables par la socket (api.request) — une route ne l'est que si elle le déclare.",
    },
    {
      label: "trames reçues",
      value: String(snapshot.frames),
      hint: "Comptées par le client lui-même : lire ce tableau ne coûte aucune trame.",
    },
    {
      label: "dernière trame",
      value:
        snapshot.lastFrame.at === null
          ? "—"
          : `${snapshot.lastFrame.method ?? "?"} à ${new Date(snapshot.lastFrame.at).toLocaleTimeString()}`,
      hint: "Une socket qui se tait n'est pas morte : le serveur ne parle que s'il a quelque chose à dire.",
    },
  ];
}
