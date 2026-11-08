/**
 * snapshot — l'instantané qu'une socket donne d'ELLE-MÊME, et sa mise en mots.
 *
 * Séparé d'`observe.ts` pour une raison de graphe : `NodefonySocket` décrit sa
 * socket dans la console avec {@link describeSocket}, et `observe.ts` importe
 * `NodefonySocket`. Ce fichier n'importe que des TYPES et une constante sans
 * dépendance — les deux le lisent sans cycle.
 *
 * @module nodefony/client
 */
import type {
  NodefonySocket,
  RealtimeIdentity,
  RealtimeState,
} from "./NodefonySocket";
import { JSON_PROTOCOL } from "../../realtime/IFrameCodec";

/**
 * Ce qu'une socket doit savoir dire d'elle-même pour être photographiée — la
 * FORME, pas la classe : une socket typée par ses cartes d'événements
 * (`NodefonySocket<E, …>`) s'y lit comme une socket nue.
 */
export type SnapshotSource = Pick<
  NodefonySocket,
  | "url"
  | "state"
  | "codec"
  | "subscribedChannels"
  | "framesReceived"
  | "framesUnsent"
  | "framesDropped"
  | "binaryFramesDiscarded"
  | "malformedFramesDiscarded"
  | "frameLogSince"
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
  /** Sous-protocole du codec en vigueur — `nodefony.jsonrpc.v1` tant que l'accueil n'en annonce pas d'autre. */
  codec: string;
  /** Canaux effectivement tenus par cette connexion. */
  channels: readonly string[];
  /** Notifications reçues depuis l'ouverture (accueil compris) — les réponses aux appels n'y entrent pas. */
  frames: number;
  /** Trames perdues faute de transport ouvert — un silence qui se compte. */
  unsent: number;
  /** Trames jetées par la contre-pression du client (`maxBufferedAmount`) — `0` sans borne. */
  dropped: number;
  /** Trames binaires reçues puis écartées, faute de lecteur. */
  binaryDiscarded: number;
  /** Trames texte reçues puis écartées parce qu'elles ne sont pas du JSON. */
  malformedDiscarded: number;
  /** Depuis quand le journal des trames retient (ms epoch), `null` s'il est éteint. */
  frameLogSince: number | null;
  /** Méthode et horodatage de la dernière notification reçue (`null` si aucune). */
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
    codec: client.codec,
    channels: client.subscribedChannels,
    frames: client.framesReceived,
    unsent: client.framesUnsent,
    dropped: client.framesDropped,
    binaryDiscarded: client.binaryFramesDiscarded,
    malformedDiscarded: client.malformedFramesDiscarded,
    frameLogSince: client.frameLogSince,
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

/**
 * Le format des frames d'une connexion, mis en mots — la MÊME phrase dans la
 * console, la vignette d'une page, la barre de debug et le diagnostic du noyau.
 *
 * @param protocol - sous-protocole du codec en vigueur (`NodefonySocket.codec`).
 * @returns par exemple « JSON-RPC 2.0 · binaire (nodefony.jsonrpc.cbor.v1) ».
 */
export function describeCodec(protocol: string): string {
  return `JSON-RPC 2.0 · ${protocol === JSON_PROTOCOL ? "texte" : "binaire"} (${protocol})`;
}

/** Le format d'une connexion en deux mots, pour des pastilles. */
export interface ICodecBadges {
  /** `binaire` ou `texte` : la nature des trames sur le fil. */
  nature: "binaire" | "texte";
  /** Le codec, sans le préfixe commun : `json`, `cbor`. */
  codec: string;
}

/**
 * Le format d'une connexion en deux mots — la nature des trames et le nom
 * du codec — pour l'en-tête d'un panneau ; `describeCodec` en fait la phrase.
 *
 * @param protocol - sous-protocole du codec en vigueur (`NodefonySocket.codec`).
 * @returns par exemple `{ nature: "binaire", codec: "cbor" }`.
 */
export function codecBadges(protocol: string): ICodecBadges {
  if (protocol === JSON_PROTOCOL) return { nature: "texte", codec: "json" };
  const codec = protocol
    .replace(/^nodefony\.jsonrpc\./u, "")
    .replace(/\.v\d+$/u, "");
  return { nature: "binaire", codec: codec === "" ? protocol : codec };
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
 * @param now - l'instant de lecture (ms epoch), pour le compte à rebours d'une reconnexion.
 * @returns les lignes, dans l'ordre où un humain les lit.
 */
export function describeSocket(
  snapshot: SocketSnapshot,
  now: number = Date.now(),
): SocketDetailRow[] {
  const id = snapshot.identity;
  const list = (v: readonly string[] | null, none: string): string =>
    v === null ? "— (avant l'accueil)" : v.join(", ") || none;
  const clock = (at: number): string => new Date(at).toLocaleTimeString();
  const retry = snapshot.nextRetryAt;
  const unreadable = snapshot.binaryDiscarded + snapshot.malformedDiscarded;
  return [
    {
      label: "adresse",
      value: snapshot.url ?? "—",
      hint: "Le point d'entrée WebSocket, résolu contre la page : une seule socket par adresse, partagée par tous les composants.",
    },
    {
      label: "état",
      value:
        retry === null
          ? STATE_WORDS[snapshot.state]
          : `${STATE_WORDS[snapshot.state]} (tentative ${snapshot.reconnectAttempts}, dans ${Math.max(0, Math.ceil((retry - now) / 1000))} s)`,
      hint: "Coupée, la socket se reconnecte seule et rejoue ses abonnements : la page n'a rien à écrire pour ça.",
    },
    {
      label: "format",
      value: describeCodec(snapshot.codec),
      hint: "Choisi par le serveur parmi l'offre du client, annoncé à l'accueil ; en binaire, les octets passent sans base64.",
    },
    {
      label: "identité",
      value: id?.authenticated
        ? [id.userIdentifier || "authentifié", id.type, id.roles.join(", ")]
            .filter(Boolean)
            .join(" · ")
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
      label: "notifications reçues",
      value: String(snapshot.frames),
      hint: "Poussées par le serveur, accueil compris, et comptées par le client lui-même. Les réponses aux appels n'y entrent pas : elles se lisent au journal.",
    },
    {
      label: "trames perdues",
      value: `${snapshot.unsent} non envoyées · ${snapshot.dropped} jetées · ${unreadable} illisibles`,
      hint: "Non envoyées : transport fermé à l'émission. Jetées : contre-pression du client (maxBufferedAmount). Illisibles : binaire sans lecteur ou texte non JSON — la première de chaque sorte lève un incident.",
    },
    {
      label: "dernière notification",
      value:
        snapshot.lastFrame.at === null
          ? "—"
          : `${snapshot.lastFrame.method ?? "?"} à ${clock(snapshot.lastFrame.at)}`,
      hint: "Une socket qui se tait n'est pas morte : le serveur ne parle que s'il a quelque chose à dire.",
    },
    {
      label: "journal",
      value:
        snapshot.frameLogSince === null
          ? "éteint"
          : `tenu depuis ${clock(snapshot.frameLogSince)}`,
      hint: "Hors développement, le journal ne retient rien — coût nul par trame — jusqu'à sa première lecture : les trames antérieures n'y sont pas.",
    },
  ];
}
