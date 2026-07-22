import { useNodefonyChannelData, useNodefonyState } from "nodefony/react";
import {
  normalize,
  type HealthPayload,
  type NormalizedHealth,
} from "../../utils/realtimeHealth";
import { PLATFORM_CHANNELS } from "nodefony";

/* ════════════════════════════════════════════════════════════════════════
 * twinLive — superpose la VIE du serveur sur la topologie du Jumeau.
 *
 * Même canal `nodefony:socket` que la topologie (snapshot HTTP au 1er paint,
 * canal WS quand le temps réel est activé) — abonnement ref-compté : monté
 * = sonde active, démonté = coupée (pattern « 0 ticker quand OFF »).
 *
 * Charte « temps réel CALME » : le mouvement est RARE et porteur de sens. Seuls
 * les WORKERS respirent (ce sont les seuls process vivants) ; le kernel a un
 * point d'état FIXE (le pivot) ; les modules n'ont aucune donnée live (le code
 * ne « vit » pas individuellement). Au plus 2 métriques par worker (CPU, Heap)
 * → on ne noie pas la vue (« trop d'info tue l'info »).
 * ════════════════════════════════════════════════════════════════════════ */

export interface TwinLiveSnapshot {
  normalized: NormalizedHealth | null;
  clientState: ReturnType<typeof useNodefonyState>;
}

/** Abonnement live (ref-compté). Démonter le composant coupe la sonde. */
export function useTwinLive(): TwinLiveSnapshot {
  const rt = useNodefonyChannelData<HealthPayload>(PLATFORM_CHANNELS.socket);
  const clientState = useNodefonyState();
  return { normalized: normalize(rt), clientState };
}
