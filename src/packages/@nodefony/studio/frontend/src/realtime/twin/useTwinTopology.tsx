import { useCallback } from "react";
import { useStore } from "../../stores";
import { useResource } from "../../hooks";
import {
  normalize,
  type HealthPayload,
  type NormalizedHealth,
} from "../../utils/realtimeHealth";

/* ════════════════════════════════════════════════════════════════════════
 * useTwinTopology — le SNAPSHOT combiné qui alimente le « Jumeau Vivant ».
 *
 * Source = UNIQUEMENT des contrats DÉJÀ servis (0 nouveau seam backend) :
 *  - `/nodefony/kernel/api/info`           → identité du kernel (version, env, pid…)
 *  - `/nodefony/kernel/api/modules`        → les modules chargés (= le code)
 *  - `/nodefony/realtime/api/health`       → les instances/workers (= les process)
 *  - `/nodefony/orm/api/connection/health` → les connecteurs de bases connus
 *
 * Le rendu spatial (briques + liens) vit dans `twinSchemas`/`TwinMap` ; ici on
 * ne fait QUE charger la matière première (santé normalisée mono ↔ cluster).
 * ════════════════════════════════════════════════════════════════════════ */

const INFO_URL = "/nodefony/kernel/api/info";
const MODULES_URL = "/nodefony/kernel/api/modules";
const HEALTH_URL = "/nodefony/realtime/api/health";
const CONNECTORS_URL = "/nodefony/orm/api/connection/health";

/** Sous-ensemble de `/nodefony/kernel/api/info` (miroir, frontière isomorphe). */
export interface KernelInfo {
  version: string;
  environment: string;
  debug: boolean;
  domain: string;
  pid: number;
  node: string;
  platform: string;
  uptime: number;
  modules: number;
  cluster?: { isCluster: boolean };
  /** Fonds de panier (backplanes) : ici celui des LOGS. */
  backplanes?: { log?: { driver?: string; sink?: string } };
  git?: { branch?: string; commit?: string };
}

/** Entrée de `/nodefony/kernel/api/modules` (miroir, cf page Modules). */
export interface ModuleRow {
  key: string;
  name: string;
  version: string | null;
  isApp: boolean;
  path: string | null;
}

/** Un connecteur de base de données (miroir de `/nodefony/orm/api/connection/health`). */
export interface ConnectorRow {
  instanceId: string;
  name: string;
  vendor: string;
  driver: string;
  target: string;
  version: string;
  connected: boolean;
}

/** Snapshot combiné — la matière première du graphe. */
export interface TwinSnapshot {
  info: KernelInfo;
  modules: ModuleRow[];
  /** Santé normalisée (mono ET cluster ramenés au même modèle). `null` si l'endpoint a échoué. */
  normalized: NormalizedHealth | null;
  /** Connecteurs de bases CONNUS (best-effort ; round-robin en cluster). */
  connectors: ConnectorRow[];
}

/**
 * Charge le snapshot combiné (info + modules + santé + connecteurs) en 1 passe.
 * `info` et `modules` sont requis ; santé et connecteurs sont best-effort (le
 * Jumeau s'affiche même si la sonde socket est coupée).
 */
export function useTwinTopology() {
  const store = useStore();
  const fetcher = useCallback(async (): Promise<TwinSnapshot> => {
    const [info, modules, health, connectors] = await Promise.all([
      store.api.getAbsolute<KernelInfo>(INFO_URL),
      store.api.getAbsolute<ModuleRow[]>(MODULES_URL),
      store.api.getAbsolute<HealthPayload>(HEALTH_URL).catch(() => null),
      store.api.getAbsolute<ConnectorRow[]>(CONNECTORS_URL).catch(() => []),
    ]);
    return { info, modules, normalized: normalize(health), connectors };
  }, [store]);
  return useResource<TwinSnapshot>(fetcher);
}
