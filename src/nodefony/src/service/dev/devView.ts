/**
 * Un onglet du plein écran : ce qu'il montre — un ou plusieurs canaux,
 * fusionnés — et ce qu'il garde quand on le quitte (ADR-0013 §11, #903).
 *
 * Un onglet est une DONNÉE, pas une sous-classe : tous défilent, se
 * sélectionnent et se rendent de la même façon (`devFrame.ts`), seuls leurs
 * canaux diffèrent. Un onglet neuf (Vite, un sous-agent) se déclare par son
 * filtre, sans rouvrir le terminal.
 */
import type { DevHistory, MergedTranscript } from "./devHistory";
import { FrameHeights, type IScrollAnchor, type ViewOutcome } from "./devFrame";
import type { PanelCursor } from "./devPanel";

/**
 * Ce qu'un onglet fait de ses canaux — le TYPE porte le comportement, pas
 * une sous-classe (#538, lot 2) :
 *
 * - `log` : il montre des canaux que d'autres alimentent (serveur, Vite, un
 *   sous-agent) ;
 * - `run` : il porte UN lancement de l'invite — sa sortie, son issue ✓ / ✗,
 *   et l'action en cours que Ctrl+C interrompt ; une saisie dans l'onglet
 *   fini relance dans le même onglet ;
 * - `panel` : un panneau à rubriques l'occupe, sans canal (`openPanel`).
 */
export type DevViewKind = "log" | "run" | "panel";

/** Ce qu'on donne pour ouvrir un onglet à la volée (`DevTerminal.addView`). */
export interface IDevViewSpec {
  /** Identifiant stable et unique (`agent:3`). */
  readonly id: string;
  /** Le libellé de l'onglet. */
  readonly title: string;
  /**
   * Son canal (`agent:3`), ou le filtre de ses canaux. Absent : un canal au
   * nom de l'onglet (`id`), créé avec lui — celui où écrit sa poignée.
   */
  readonly channels?: string | ((channel: string) => boolean);
  /** Son type, `log` par défaut ({@link DevViewKind}) ; `panel` passe par `openPanel`. */
  readonly kind?: Exclude<DevViewKind, "panel">;
}

/** La poignée d'un onglet ouvert à la volée : qui l'ouvre le referme. */
export interface IDevViewHandle {
  /** Le canal où écrit {@link IDevViewHandle.write} : `channels` s'il est un nom, l'`id` sinon. */
  readonly channel: string;
  /** Écrit dans son canal ; sans effet une fois l'onglet fermé. */
  write(text: string, stream?: "out" | "err"): void;
  /** Son travail est fini : ✓ ou ✗ après le titre, jusqu'à sa fermeture. */
  finish(outcome: ViewOutcome): void;
  /** Le referme et libère l'historique de ses canaux ; sans effet la 2ᵉ fois. */
  close(): void;
}

/**
 * Le canal d'invite d'un onglet (`prompt:server`, `prompt:vite`).
 *
 * @param viewId - l'identifiant de l'onglet.
 * @returns le canal où l'invite écrit quand cet onglet a le focus.
 */
export function promptChannelOf(viewId: string): string {
  return `prompt:${viewId}`;
}

/** Un onglet : ses canaux, sa position de lecture, ce qu'il n'a pas montré. */
export class DevView {
  readonly id: string;
  /** Le libellé de l'onglet. */
  readonly title: string;
  /** Ce qu'il fait de ses canaux ({@link DevViewKind}). */
  readonly kind: DevViewKind;
  /**
   * Le canal où l'invite écrit quand cet onglet a le focus : l'écho de la
   * saisie et la sortie de ce qu'elle lance restent sous les yeux de qui a
   * tapé, jamais dans l'onglet `serveur` par défaut.
   */
  readonly promptChannel: string;
  /** Dit si un canal appartient à l'onglet — un canal ouvert plus tard y entre seul. */
  readonly match: (channel: string) => boolean;
  /** Montré dès son ouverture, même vide (un onglet ouvert à la volée). */
  readonly alwaysShown: boolean;
  /** Ses canaux, fusionnés dans l'ordre des numéros. */
  readonly transcript: MergedTranscript;
  /** Son cache de repli : chaque onglet replie ses propres entrées. */
  readonly heights = new FrameHeights();
  /** Sa position de lecture, `null` = en direct — gardée quand on le quitte. */
  anchor: IScrollAnchor | null = null;
  /** Dernière entrée effacée par `ESC[2J` dans ses canaux (sa page propre). */
  floorSeq: number | undefined = undefined;
  /** Dernier numéro montré à l'écran ; au-delà, tant qu'il est caché, ça se compte. */
  seenSeq = 0;
  /** Une sortie d'erreur est arrivée pendant qu'il était caché. */
  alert = false;
  /** L'issue de son travail, `null` tant qu'il tourne. */
  outcome: ViewOutcome | null = null;
  /** Un panneau à rubriques l'occupe au lieu de ses canaux (#538, D9). */
  panel: PanelCursor | null = null;
  /**
   * L'action de l'invite qui tourne DANS cet onglet, qu'un Ctrl+C y
   * interrompt — une par onglet : un `build` dans le sien n'empêche pas un
   * `/status` ailleurs.
   */
  running: AbortController | null = null;
  /**
   * Onglet `run` : le libellé de la commande qu'il porte, AVANT tout suffixe
   * de doublon (`build` pour l'onglet `build 2`). Une saisie n'y relance que
   * la même commande ; une autre ouvre son propre onglet.
   */
  launch: string | null = null;

  /**
   * @param history - l'historique par canal.
   * @param id - identifiant stable de l'onglet.
   * @param title - son libellé.
   * @param match - ses canaux ; son canal d'invite (`promptChannel`) s'y
   *   ajoute toujours.
   * @param alwaysShown - montré même vide.
   * @param kind - son type, `log` par défaut.
   */
  constructor(
    history: DevHistory,
    id: string,
    title: string,
    match: (channel: string) => boolean,
    alwaysShown = false,
    kind: DevViewKind = "log",
  ) {
    this.id = id;
    this.title = title;
    this.kind = kind;
    const promptChannel = promptChannelOf(id);
    this.promptChannel = promptChannel;
    this.match = (channel) => channel === promptChannel || match(channel);
    this.alwaysShown = alwaysShown;
    this.transcript = history.merge(this.match);
  }

  /** Entrées arrivées depuis la dernière image qui l'a montré. */
  get unseen(): number {
    return this.transcript.countAfter(this.seenSeq);
  }

  /** Tout est vu : à appeler quand il est à l'écran. */
  markSeen(): void {
    this.seenSeq = this.transcript.lastSeq;
    this.alert = false;
  }
}
