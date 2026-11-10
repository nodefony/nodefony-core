import { REALTIME_PRESENCE_METHOD, type RealtimePresenceFrame } from "nodefony";
import { RealtimeConnection } from "../../src/server/RealtimeConnection";
import type {
  ChannelFrame,
  ChannelSink,
  RealtimeHub,
} from "../../src/server/RealtimeHub";

/** Un client de présence branché sur un hub : ses trames `realtime:presence`, et son départ. */
export interface IPresenceClient {
  frames: RealtimePresenceFrame[];
  leave: () => void;
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
        const msg = JSON.parse(data) as {
          method: string;
          params: RealtimePresenceFrame;
        };
        if (msg.method === REALTIME_PRESENCE_METHOD) frames.push(msg.params);
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
