/**
 * observeSse — **socle agnostique des liaisons de vue** du client SSE.
 *
 * Même contrat que les observateurs de la socket (`realtime/observe.ts`) :
 *
 * ```
 * observeSse(url, emit, options) → dispose
 * ```
 *
 * `emit` reçoit l'état courant du flux ; `dispose` le ferme. Les quatre
 * liaisons (`useNodefonySse` React et Vue, `injectNodefonySse` Angular,
 * `nodefonySse` Svelte) ne contiennent que la traduction *rappel + libération →
 * réactivité locale* : l'ouverture, les écouteurs, la forme de l'état et la
 * fermeture n'existent qu'ICI. Écrites quatre fois, elles divergeraient — et la
 * fermeture oubliée laisse une connexion HTTP ouverte que personne ne lit.
 *
 * Une différence avec la socket, et elle est voulue : **un flux n'est pas
 * partagé**. Chaque observation ouvre SA requête et la ferme à sa libération.
 * Un flux SSE est la réponse à UNE requête — ses en-têtes, son corps, son
 * `Last-Event-ID` lui appartiennent ; deux composants qui lisent le même flux
 * avec des en-têtes différents ne lisent pas la même chose.
 *
 * Zéro dépendance à un framework de vue, zéro DOM.
 *
 * @module nodefony/client
 */
import { NodefonySse, type NodefonySseOptions } from "./NodefonySse";
import type { ISseEvent } from "./SseParser";
import type { Dispose, Emit } from "../realtime/observe";

/**
 * L'état d'un flux observé — ce qu'une vue affiche.
 *
 * Un objet NEUF à chaque changement : une liaison qui compare par référence
 * (état React, `shallowRef` Vue, `signal` Angular) voit chaque transition.
 */
export interface SseSnapshot {
  /** 0 `CONNECTING`, 1 `OPEN`, 2 `CLOSED` — les constantes de {@link NodefonySse}. */
  readonly readyState: number;
  /** Le dernier événement reçu d'un des types écoutés, `null` tant qu'aucun. */
  readonly lastEvent: ISseEvent | null;
  /**
   * La dernière transition était-elle une coupure ? Remis à `false` à chaque
   * ouverture. Avec `readyState` : `CONNECTING` = le client se reconnecte ;
   * `CLOSED` = le serveur a refusé le flux (statut ≠ 200, autre type) et le
   * client a abandonné.
   */
  readonly error: boolean;
}

/** Réglages de {@link observeSse} : ceux de {@link NodefonySse}, plus deux. */
export interface ObserveSseOptions extends NodefonySseOptions {
  /**
   * Types d'événements écoutés — le champ `event:` du serveur. Défaut :
   * `["message"]`, le type d'un bloc qui n'en porte pas. Un flux qui nomme ses
   * événements (`event: log`) n'est entendu que si son type figure ici, comme
   * avec `addEventListener` d'`EventSource`.
   */
  events?: readonly string[] | undefined;
  /**
   * Appelé pour CHAQUE événement reçu, avant la mise à jour de l'état.
   *
   * L'état ne garde que le dernier : une vue qui tient un journal (accumuler
   * les lignes) le fait ici. Une liaison qui regroupe ses rendus (React)
   * perdrait sinon les événements arrivés dans le même tour.
   */
  onEvent?: ((event: ISseEvent) => void) | undefined;
}

/** L'état d'un flux qu'on n'ouvre pas (adresse `null`). */
const IDLE: SseSnapshot = Object.freeze({
  readyState: NodefonySse.CLOSED,
  lastEvent: null,
  error: false,
});

/**
 * L'état d'un flux AVANT que {@link observeSse} ne l'ouvre — la valeur
 * initiale qu'une liaison affiche au premier rendu : `CONNECTING` pour une
 * adresse, `CLOSED` sans erreur pour `null`.
 */
export function initialSseSnapshot(url: string | URL | null): SseSnapshot {
  return url === null
    ? IDLE
    : { readyState: NodefonySse.CONNECTING, lastEvent: null, error: false };
}

/**
 * Clé de **ré-ouverture** d'un flux : l'adresse et les types écoutés, et rien
 * d'autre. Le rappel `onEvent` et les objets d'options changent d'identité à
 * chaque rendu dans la plupart des frameworks ; rouvrir à chaque rendu
 * couperait le flux en boucle. Les autres réglages (en-têtes, corps) sont lus
 * à l'ouverture.
 */
export function sseRebindKey(
  url: string | URL | null,
  options: ObserveSseOptions = {},
): string {
  if (url === null) return "";
  return `${String(url)}\n${(options.events ?? ["message"]).join("\n")}`;
}

/**
 * Observe un flux `text/event-stream` : l'ouvre, rend son état à `emit` à
 * chaque transition et à chaque événement, et le ferme à la libération.
 *
 * `emit` reçoit l'état initial (`CONNECTING`) immédiatement. Une adresse
 * `null` n'ouvre rien — `emit` reçoit un état `CLOSED` sans erreur — ce qui
 * laisse une vue suspendre l'écoute sans démonter son composant.
 *
 * @param url - adresse du flux, ou `null` pour ne rien ouvrir.
 * @param emit - reçoit chaque nouvel état.
 * @param options - réglages du client, types écoutés et rappel par événement.
 * @returns la libération : ferme le flux et retire les écouteurs. Idempotente.
 * @throws TypeError quand l'adresse ne se résout pas, ou n'est pas en http(s).
 */
export function observeSse(
  url: string | URL | null,
  emit: Emit<SseSnapshot>,
  options: ObserveSseOptions = {},
): Dispose {
  if (url === null) {
    emit(initialSseSnapshot(null));
    return () => undefined;
  }
  const { events = ["message"], onEvent, ...init } = options;
  const sse = new NodefonySse(url, init);
  let lastEvent: ISseEvent | null = null;
  let error = false;
  const publish = (): void =>
    emit({ readyState: sse.readyState, lastEvent, error });

  const onOpen = (): void => {
    error = false;
    publish();
  };
  const onError = (): void => {
    error = true;
    publish();
  };
  const onMessage = (event: Event): void => {
    // `NodefonySse` n'émet que des `MessageEvent` sur ces types ; un autre
    // émetteur (dispatchEvent extérieur) n'a rien à livrer.
    if (!(event instanceof MessageEvent)) return;
    lastEvent = {
      type: event.type,
      data: String(event.data),
      lastEventId: event.lastEventId,
    };
    onEvent?.(lastEvent);
    publish();
  };

  sse.addEventListener("open", onOpen);
  sse.addEventListener("error", onError);
  for (const type of events) sse.addEventListener(type, onMessage);
  publish();

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    sse.close();
    sse.removeEventListener("open", onOpen);
    sse.removeEventListener("error", onError);
    for (const type of events) sse.removeEventListener(type, onMessage);
  };
}
