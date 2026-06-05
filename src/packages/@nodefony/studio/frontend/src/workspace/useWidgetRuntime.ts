import { useCallback } from "react";
import { useAuth, useStore, useUi } from "../stores";
import { useResource } from "../hooks";
import { normalize, type HealthPayload } from "../utils/realtimeHealth";
import type { WidgetRuntimeContext } from "./types";

/**
 * Contexte transverse fourni à TOUS les widgets, calculé UNE fois au niveau du bureau.
 * `cluster`/`instanceCount` dérivent de `realtime:health` (agrégée par le master en
 * cluster — la seule source juste, cf doc workspace §4). Snapshot HTTP (rafraîchi au
 * reload) : la topologie ne change pas en cours de session, inutile d'abonner un canal.
 */
export function useWidgetRuntime(): {
  ctx: WidgetRuntimeContext;
  reload: () => void;
} {
  const store = useStore();
  const ui = useUi();
  const auth = useAuth();
  const health = useResource(
    useCallback(
      () =>
        store.api.getAbsolute<HealthPayload>("/nodefony/realtime/api/health"),
      [store],
    ),
  );
  const norm = normalize(health.data);
  return {
    ctx: {
      live: ui.realtimeLive,
      cluster: norm?.cluster ?? false,
      instanceCount: norm?.instances.length ?? 1,
      roles: auth.roles,
    },
    reload: health.reload,
  };
}
