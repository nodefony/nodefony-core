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
import type { IPresenceSnapshot } from "../../realtime/presenceView";

/**
 * Ce qu'une socket sait de la présence d'un canal (ADR-0025) — pour un écran de
 * diagnostic, jamais pour une décision :
 * - `followed` : un écran de la page suit la présence (`onPresence`) ; la vue et sa
 *   version de référence (`null` hors synchronisation) ;
 * - `unfollowed` : des trames de présence arrivent, mais rien ne les suit ;
 * - `none` : aucune trame de présence n'est arrivée sur ce canal.
 */
export type SocketPresenceStatus =
  | {
      readonly kind: "followed";
      readonly view: IPresenceSnapshot;
      readonly version: number | null;
    }
  | { readonly kind: "unfollowed" }
  | { readonly kind: "none" };

/** État `unfollowed` — partagé, jamais modifié. */
export const PRESENCE_UNFOLLOWED: SocketPresenceStatus = Object.freeze({
  kind: "unfollowed",
});

/** État `none` — partagé, jamais modifié. */
export const PRESENCE_NONE: SocketPresenceStatus = Object.freeze({
  kind: "none",
});

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
  | "presenceStatus"
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
  /** La présence de chaque canal tenu, dans l'ordre de {@link SocketSnapshot.channels}. */
  presence: readonly SocketPresenceStatus[];
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
  const channels = client.subscribedChannels;
  return {
    url: client.url,
    state: client.state,
    codec: client.codec,
    channels,
    presence: channels.map((c) => client.presenceStatus(c)),
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

/** `n` suivi du mot, au pluriel au-delà de 1 (0 et 1 au singulier, en français). */
function counted(n: number, word: string): string {
  return `${n} ${word}${n > 1 ? "s" : ""}`;
}

/** Présents nommés montrés avant « +N » : la ligne tient dans une boîte étroite. */
const NAMED_SHOWN = 3;

/** Forme d'un UUID dans un nom (identité, canal `user:<uuid>`). */
const UUID_IN_TEXT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu;

/**
 * Raccourcit chaque UUID d'un texte (`cc64…c7a`) pour une colonne étroite —
 * le texte entier se garde au survol, côté écran.
 *
 * @param text - un nom de canal, une identité.
 * @returns le texte, UUID raccourcis.
 */
export function shortenIds(text: string): string {
  return text.replace(
    UUID_IN_TEXT,
    (id) => `${id.slice(0, 4)}…${id.slice(-3)}`,
  );
}

/** Qui lit : son identifiant de présence et le nom à montrer à sa place. */
export interface IPresenceReader {
  /** Identifiant tel que la présence le nomme (`RealtimeIdentity.id`). */
  readonly id: string;
  /** Nom lisible (`userIdentifier`). */
  readonly name: string;
}

/**
 * La présence d'un canal tenu, mise en mots — la même phrase dans la barre de
 * debug, la console du navigateur et les vitrines.
 *
 * Nommés d'abord (liste de la trame), sinon compte des comptes (au-delà du seuil
 * de membres nommés, la trame ne porte que des nombres), puis les anonymes.
 *
 * La présence nomme les comptes par leur IDENTIFIANT (souvent un UUID) : celui
 * du lecteur devient son nom suivi de « (vous) », les autres sont raccourcis.
 *
 * @param status - l'état de présence du canal (`SocketPresenceStatus`).
 * @param reader - qui lit, pour se reconnaître dans la liste (facultatif).
 * @returns par exemple « admin (vous) · 0 anonyme », « 3 comptes · 1 anonyme »,
 *   « présence non suivie par la page », « sans présence ».
 */
export function describePresence(
  status: SocketPresenceStatus,
  reader?: IPresenceReader,
): string {
  if (status.kind === "none") return "sans présence";
  if (status.kind === "unfollowed") return "présence non suivie par la page";
  const view = status.view;
  if (!view.ready) return "en attente de la liste";
  const named = view.members;
  let who: string;
  if (named.size > 0) {
    const shown: string[] = [];
    for (const [id, entry] of named) {
      if (shown.length === NAMED_SHOWN) break;
      const notes: string[] = [];
      let name: string;
      if (reader?.id === id) {
        notes.push("vous");
        name = reader.name;
      } else name = shortenIds(id);
      if (entry.tabs > 1) notes.push(`${entry.tabs} onglets`);
      shown.push(notes.length === 0 ? name : `${name} (${notes.join(", ")})`);
    }
    who =
      named.size > NAMED_SHOWN
        ? `${shown.join(", ")} +${named.size - NAMED_SHOWN}`
        : shown.join(", ");
  } else {
    who = counted(view.count, "compte");
  }
  const text = `${who} · ${counted(view.unnamed, "anonyme")}`;
  return view.partial ? `${text} · partielle` : text;
}

/**
 * La version de la vue de présence d'un canal : `v12`, « non synchronisée » (trou
 * de version, socket fermée, resynchronisation), ou `""` sans vue suivie.
 *
 * @param status - l'état de présence du canal (`SocketSnapshot.presence`).
 * @returns le texte de la version, vide quand il n'y a rien à versionner.
 */
export function describePresenceVersion(status: SocketPresenceStatus): string {
  if (status.kind !== "followed" || !status.view.ready) return "";
  return status.version === null ? "non synchronisée" : `v${status.version}`;
}

/**
 * Les trames perdues, mises en mots : « aucune perte » quand rien n'est perdu,
 * le détail par sorte sinon.
 *
 * @param snapshot - l'instantané de la socket.
 * @returns la phrase, et `lost` pour qu'un écran la signale.
 */
export function describeLosses(snapshot: SocketSnapshot): {
  text: string;
  lost: boolean;
} {
  const unreadable = snapshot.binaryDiscarded + snapshot.malformedDiscarded;
  if (snapshot.unsent + snapshot.dropped + unreadable === 0)
    return { text: "aucune perte", lost: false };
  return {
    text: `${snapshot.unsent} non envoyées · ${snapshot.dropped} jetées · ${unreadable} illisibles`,
    lost: true,
  };
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
 * L'état de la connexion, mis en mots — avec le compte à rebours d'une reconnexion.
 *
 * @param snapshot - l'instantané de la socket.
 * @param now - l'instant de lecture (ms epoch).
 * @returns par exemple « connecté », « reconnexion automatique… (tentative 2, dans 3 s) ».
 */
export function describeState(
  snapshot: SocketSnapshot,
  now: number = Date.now(),
): string {
  const retry = snapshot.nextRetryAt;
  return retry === null
    ? STATE_WORDS[snapshot.state]
    : `${STATE_WORDS[snapshot.state]} (tentative ${snapshot.reconnectAttempts}, dans ${Math.max(0, Math.ceil((retry - now) / 1000))} s)`;
}

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
  const reader =
    id?.authenticated === true && id.id
      ? { id: id.id, name: id.userIdentifier || id.id }
      : undefined;
  const held = snapshot.channels.map((c, i) => {
    const status = snapshot.presence[i] ?? PRESENCE_NONE;
    return status.kind === "none"
      ? c
      : `${c} (${describePresence(status, reader)})`;
  });
  return [
    {
      label: "adresse",
      value: snapshot.url ?? "—",
      hint: "Le point d'entrée WebSocket, résolu contre la page : une seule socket par adresse, partagée par tous les composants.",
    },
    {
      label: "état",
      value: describeState(snapshot, now),
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
      value: held.join(", ") || "aucun",
      hint: "Abonnements comptés par référence : dix composants sur le même canal, un seul abonnement réseau. Entre parenthèses, la présence du canal (qui est là) quand il en porte une.",
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
      value: describeLosses(snapshot).text,
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
