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

/** Ce qu'on donne pour ouvrir un onglet à la volée (`DevTerminal.addView`). */
export interface IDevViewSpec {
  /** Identifiant stable et unique (`agent:3`). */
  readonly id: string;
  /** Le libellé de l'onglet. */
  readonly title: string;
  /** Son canal (`agent:3`), ou le filtre de ses canaux. */
  readonly channels: string | ((channel: string) => boolean);
}

/** La poignée d'un onglet ouvert à la volée : qui l'ouvre le referme. */
export interface IDevViewHandle {
  /** Son travail est fini : ✓ ou ✗ après le titre, jusqu'à sa fermeture. */
  finish(outcome: ViewOutcome): void;
  /** Le referme et libère l'historique de ses canaux ; sans effet la 2ᵉ fois. */
  close(): void;
}

/** Un onglet : ses canaux, sa position de lecture, ce qu'il n'a pas montré. */
export class DevView {
  readonly id: string;
  /** Le libellé de l'onglet. */
  readonly title: string;
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
   * @param history - l'historique par canal.
   * @param id - identifiant stable de l'onglet.
   * @param title - son libellé.
   * @param match - ses canaux.
   * @param alwaysShown - montré même vide.
   */
  constructor(
    history: DevHistory,
    id: string,
    title: string,
    match: (channel: string) => boolean,
    alwaysShown = false,
  ) {
    this.id = id;
    this.title = title;
    this.match = match;
    this.alwaysShown = alwaysShown;
    this.transcript = history.merge(match);
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
