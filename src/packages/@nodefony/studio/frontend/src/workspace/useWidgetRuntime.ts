import { useCallback } from "react";
import { useAuth, useStore, useUi } from "../stores";
import { useResource } from "../hooks";
import { normalize, type HealthPayload } from "../utils/realtimeHealth";
import { useIsAdmin } from "../auth/roles";
import type { WidgetRuntimeContext } from "./types";

/**
 * Contexte transverse fourni à TOUS les widgets, calculé UNE fois au niveau du bureau.
 * `cluster`/`instanceCount` dérivent de `nodefony:socket` (agrégée par le master en
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
  // Le plan d'administration du temps réel est réservé aux administrateurs :
  // un autre compte n'en recevrait qu'un 403 en console. Sans lui, le bureau
  // retombe sur une instance unique, hors cluster.
  const isAdmin = useIsAdmin();
  const health = useResource(
    useCallback(
      () =>
        isAdmin
          ? store.api.getAbsolute<HealthPayload>(
              "/nodefony/realtime/api/health",
            )
          : Promise.resolve(null),
      [store, isAdmin],
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
