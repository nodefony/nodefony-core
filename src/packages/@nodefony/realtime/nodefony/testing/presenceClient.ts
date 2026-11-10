import {
  isPresenceFrame,
  ownField,
  PresenceView,
  REALTIME_PRESENCE_METHOD,
  type NumberedChangeOutcome,
  type RealtimePresenceFrame,
} from "nodefony";
import { RealtimeConnection } from "../src/server/RealtimeConnection";
import type {
  ChannelFrame,
  ChannelSink,
  RealtimeHub,
} from "../src/server/RealtimeHub";

/** Un client de présence branché sur un hub : ses trames `realtime:presence`, sa vue, et son départ. */
export interface IPresenceClient {
  /** Trames reçues, dans l'ordre. */
  frames: RealtimePresenceFrame[];
  /** Sort de chaque trame appliquée à {@link view} (même index que {@link frames}). */
  outcomes: NumberedChangeOutcome[];
  /**
   * Vue du canal tenue par la vue PURE du cœur — celle du navigateur (`NodefonySocket`) : ce que le serveur écrit, le navigateur le lit ainsi.
   */
  view: PresenceView;
  leave: () => void;
}

/**
 * Abonne à `channel` une connexion de `hub` — nommée `user`, ou anonyme (`null`) — et relève les trames de présence qu'elle reçoit, lues et appliquées par le lecteur et la vue du cœur, comme le ferait un navigateur. Une trame que le lecteur refuse est un défaut du serveur : le banc lève en la citant.
 */
export function presenceClient(
  hub: RealtimeHub,
  channel: string,
  user: string | null,
): IPresenceClient {
  const frames: RealtimePresenceFrame[] = [];
  const outcomes: NumberedChangeOutcome[] = [];
  const view = new PresenceView(channel);
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
        outcomes.push(view.apply(params));
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
    outcomes,
    view,
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
