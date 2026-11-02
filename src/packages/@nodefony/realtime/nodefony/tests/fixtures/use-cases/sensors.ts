import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "../../../../index";

export class SensorRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("SensorRealtime", context);
  }

  // Écrire : réservé aux sondes, par la portée de leur jeton.
  @RealtimeInbound("sensor:reading", { scopes: ["telemetry:write"] })
  reading(params: unknown): void {
    if (!isReading(params)) return;
    getRealtimeHub().publish("sensor:dashboard", params);
  }

  // Lire : les écrans de supervision. Aucun gestionnaire entrant : le canal est en lecture seule.
  @RealtimeChannel("sensor:dashboard", { roles: ["ROLE_SUPERVISOR"] })
  dashboard(): () => void {
    return () => {};
  }
}

function isReading(value: unknown): value is { probe: string; value: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    "probe" in value &&
    "value" in value &&
    typeof value.probe === "string" &&
    typeof value.value === "number"
  );
}
