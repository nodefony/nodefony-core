import { controller, route } from "@nodefony/framework";
import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "../../../../index";

// Sa socket : `/api/sensor/realtime` (préfixe + route). Elle ne sert que les canaux déclarés ici.
@controller("/api/sensor")
export class SensorRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("SensorRealtime", context);
  }

  // Le point d'entrée : `handleRealtime` fait tout le protocole et route vers les décorateurs.
  @route("sensor-realtime", {
    path: "/realtime",
    requirements: { methods: ["WEBSOCKET"] },
  })
  async realtime(message: string | Uint8Array | null): Promise<void> {
    this.handleRealtime(message);
  }

  // Écrire : réservé aux sondes, par la portée de leur jeton.
  @RealtimeInbound("sensor:reading", { scopes: ["telemetry:write"] })
  reading(params: unknown): void {
    if (!SensorRealtime.isReading(params)) return;
    getRealtimeHub().publish("sensor:dashboard", params);
  }

  // Lire : les écrans de supervision. Aucun gestionnaire entrant : le canal est en lecture seule.
  @RealtimeChannel("sensor:dashboard", { roles: ["ROLE_SUPERVISOR"] })
  dashboard(): () => void {
    return () => {};
  }

  /** Ce qui arrive du réseau n'est pas fiable : une sonde et une valeur, ou rien. */
  private static isReading(
    value: unknown,
  ): value is { probe: string; value: number } {
    return (
      typeof value === "object" &&
      value !== null &&
      "probe" in value &&
      "value" in value &&
      typeof value.probe === "string" &&
      typeof value.value === "number"
    );
  }
}
