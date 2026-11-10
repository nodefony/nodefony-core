import {
  ownField,
  REALTIME_PRESENCE_METHOD,
  type RealtimePresenceFrame,
} from "nodefony";
import { RealtimeConnection } from "../src/server/RealtimeConnection";
import type {
  ChannelFrame,
  ChannelSink,
  RealtimeHub,
} from "../src/server/RealtimeHub";

/** Un client de présence branché sur un hub : ses trames `realtime:presence`, et son départ. */
export interface IPresenceClient {
  frames: RealtimePresenceFrame[];
  leave: () => void;
}

/**
 * Forme d'une trame `realtime:presence` reçue — les champs communs à toutes ses variantes (liste, changements, nombres seuls). Le banc lit ce que le serveur produit : une trame qui y manque est un défaut à nommer, pas une valeur à convertir.
 */
function isPresenceFrame(value: unknown): value is RealtimePresenceFrame {
  return (
    typeof ownField(value, "channel") === "string" &&
    typeof ownField(value, "version") === "number" &&
    typeof ownField(value, "count") === "number" &&
    typeof ownField(value, "unnamed") === "number"
  );
}

/**
 * Abonne à `channel` une connexion de `hub` — nommée `user`, ou anonyme (`null`) — et relève les trames de présence qu'elle reçoit, comme le ferait un navigateur.
 */
export function presenceClient(
  hub: RealtimeHub,
  channel: string,
  user: string | null,
): IPresenceClient {
  const frames: RealtimePresenceFrame[] = [];
  const codec = hub.textFrameCodec;
  const conn = new RealtimeConnection(
    {
      impose: () => {},
      end: () => false,
      send: (frame: ChannelFrame) => {
        const data = frame.encodeFor(codec);
        if (typeof data !== "string") return;
        const msg: unknown = JSON.parse(data);
        if (ownField(msg, "method") !== REALTIME_PRESENCE_METHOD) return;
        const params = ownField(msg, "params");
        if (!isPresenceFrame(params))
          throw new Error(`trame de présence mal formée : ${data}`);
        frames.push(params);
      },
    },
    () => ({
      type: user === null ? "anonymous" : "test",
      authenticated: user !== null,
      id: user,
      userIdentifier: user ?? "anon.",
      roles: [],
      scopes: [],
      issuer: null,
      account: user !== null,
    }),
  );
  const sink: ChannelSink = () => {};
  if (!hub.subscribeClient(channel, sink, () => () => {}, undefined, conn))
    throw new Error(`abonnement à « ${channel} » refusé`);
  hub.presenceSubscribed(channel, conn);
  return {
    frames,
    leave: () => {
      hub.unsubscribe(channel, sink);
    },
  };
}

/** Présents nommés d'un canal vus par `hub` (identité → onglets), triés. */
export function presenceView(
  hub: RealtimeHub,
  channel: string,
): Record<string, number> {
  const v = hub.presence(channel);
  const out: Record<string, number> = {};
  if (v !== null)
    for (const [k, e] of [...v.members].sort(([a], [b]) => a.localeCompare(b)))
      out[k] = e.tabs;
  return out;
}
