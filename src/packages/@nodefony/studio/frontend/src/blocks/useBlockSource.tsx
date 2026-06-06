import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNodefonyChannelData } from "nodefony/react";
import { DataState } from "../components/ui";
import { useStore } from "../stores";
import { useResource } from "../hooks";
import type {
  IWidgetDef,
  WidgetData,
  WidgetRuntimeContext,
  WidgetSource,
} from "../workspace/types";

/* ════════════════════════════════════════════════════════════════════════
 * Cœur PARTAGÉ d'un BLOC — extrait du `WidgetHost` pour être monté à
 * l'identique dans les 3 contenants (page / widget de bureau / dialog).
 *
 * Un bloc = un `IWidgetDef` (le registre de widgets EST le registre de blocs).
 * `useBlockSource` = la récupération de données (snapshot HTTP 1er paint + live
 * conditionnel, le patron sonde+hub). `BlockBody` = le rendu (live feed +
 * DataState + composant pur). Les enveloppes (Card widget, Modal dialog, Paper
 * page) se contentent d'entourer `BlockBody`.
 * ════════════════════════════════════════════════════════════════════════ */

/** Où le bloc est monté — influe sur quelques détails de présentation. */
export type BlockContainer = "page" | "widget" | "dialog";

/** Abonnement live monté SEULEMENT quand le live est ON (ref-compté, unsubscribe auto). */
export function BlockLiveFeed({
  channel,
  onData,
}: {
  channel: string;
  onData: (d: unknown) => void;
}): ReactNode {
  const d = useNodefonyChannelData<unknown>(channel);
  useEffect(() => {
    if (d != null) onData(d);
  }, [d, onData]);
  return null;
}

export interface BlockSourceState {
  source: WidgetData<unknown>;
  channel: string | null;
  liveOn: boolean;
  liveOnlyOff: boolean;
  setLiveData: (d: unknown) => void;
}

/** Récupère les données d'un bloc : snapshot HTTP au 1ᵉʳ paint + live conditionnel. */
export function useBlockSource(
  source: WidgetSource,
  live: boolean,
): BlockSourceState {
  const store = useStore();
  const endpoint = source.kind !== "live" ? source.endpoint : null;
  const channel = source.kind !== "snapshot" ? source.channel : null;
  const fetcher = useCallback(
    () =>
      endpoint
        ? store.api.getAbsolute<unknown>(endpoint)
        : Promise.resolve<unknown>(null),
    [store, endpoint],
  );
  const snap = useResource(fetcher);
  const [liveData, setLiveData] = useState<unknown>(null);
  const liveOn = !!channel && live;
  useEffect(() => {
    if (!liveOn) setLiveData(null);
  }, [liveOn]);
  const fromLive = liveOn && liveData != null;
  const data = fromLive ? liveData : snap.data;
  return {
    source: {
      data,
      loading: snap.loading && data == null,
      error: snap.error,
      fromLive,
      reload: snap.reload,
    },
    channel,
    liveOn,
    liveOnlyOff: source.kind === "live" && !live,
    setLiveData,
  };
}

/** Rendu d'un bloc (live feed + état + composant pur). PARTAGÉ par les 3 contenants. */
export function BlockBody({
  def,
  state,
  ctx,
  span,
  container,
}: {
  def: IWidgetDef;
  state: BlockSourceState;
  ctx: WidgetRuntimeContext;
  span: number;
  container: BlockContainer;
}): ReactNode {
  const Render = def.render;
  const endpoint = def.source.kind !== "live" ? def.source.endpoint : null;
  return (
    <>
      {state.liveOn && state.channel ? (
        <BlockLiveFeed channel={state.channel} onData={state.setLiveData} />
      ) : null}
      <DataState
        loading={state.source.loading}
        error={state.source.error}
        empty={state.liveOnlyOff || state.source.data == null}
        emptyMessage={
          state.liveOnlyOff
            ? "Active le temps réel pour ce bloc."
            : "Aucune donnée."
        }
        onRetry={endpoint ? state.source.reload : undefined}
        minHeight={container === "widget" ? 40 : 80}
      >
        <Render source={state.source} ctx={ctx} span={span} />
      </DataState>
    </>
  );
}
