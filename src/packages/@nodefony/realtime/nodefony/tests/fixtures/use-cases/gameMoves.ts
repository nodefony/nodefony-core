import type { ContextType } from "@nodefony/http";
import {
  RealtimeChannel,
  RealtimeController,
  RealtimeInbound,
  getRealtimeHub,
} from "../../../../index";
import type { IRealtimeConnection } from "../../../../index";

type Point = { x: number; y: number };

/** Dernière position connue de chaque joueur : un coup REMPLACE le précédent. */
export const positions = new Map<string, Point>();

export class ArenaRealtime extends RealtimeController {
  constructor(context: ContextType) {
    super("ArenaRealtime", context);
  }

  // Le rôle est contrôlé au premier coup, puis le verdict est retenu sur la connexion.
  @RealtimeInbound("game:move", { roles: ["ROLE_PLAYER"] })
  move(
    params: unknown,
    _reply: unknown,
    connection: IRealtimeConnection,
  ): void {
    if (connection.userId === null || !isPoint(params)) return;
    positions.set(connection.userId, { x: params.x, y: params.y });
  }

  @RealtimeChannel("game:state", { roles: ["ROLE_PLAYER"] })
  state(): () => void {
    return () => {};
  }
}

/** Le serveur diffuse l'état à SON rythme (`setInterval(tick, 50)`), pas à chaque coup. */
export function tick(): void {
  if (positions.size === 0) return;
  getRealtimeHub().publish("game:state", Object.fromEntries(positions));
}

function isPoint(value: unknown): value is Point {
  return (
    typeof value === "object" &&
    value !== null &&
    "x" in value &&
    "y" in value &&
    typeof value.x === "number" &&
    typeof value.y === "number"
  );
}
