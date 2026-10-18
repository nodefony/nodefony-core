import { describe, it, expect } from "vitest";
import { JsonRpcPeer, type IRealtimeSubscribed } from "nodefony";
import { subscribedAckFrame } from "../../src/server/subscribedAck.js";

/**
 * La trame d'acquittement est écrite d'un bloc (`subscribedAck.ts`) au lieu de
 * passer par `JsonRpcPeer.notify` — une SECONDE écriture du format. Ce test est
 * ce qui empêche les deux de diverger : octet pour octet, sur tous les noms de
 * canal qu'un réseau peut envoyer.
 */

const HOSTILE = [
  "app:flux",
  "",
  'guillemet"dedans',
  "barre\\oblique",
  "retour\nà\rla\tligne",
  "contrôle\u0000\u001f\u007f",
  "unicode é ü 漢字 🚀",
  "séparateurs  ",
  "</script><script>alert(1)</script>",
  '{"jsonrpc":"2.0"}',
  "x".repeat(4096),
  "\ud800 demi-paire orpheline",
];

describe("subscribedAckFrame — même trame que JsonRpcPeer.buildNotification", () => {
  it.each(HOSTILE.map((c) => [JSON.stringify(c).slice(0, 40), c]))(
    "canal %s → octet pour octet identique",
    (_label, channel) => {
      const payload: IRealtimeSubscribed = { channel };
      expect(subscribedAckFrame(channel)).toBe(
        JSON.stringify(
          JsonRpcPeer.buildNotification("realtime:subscribed", payload),
        ),
      );
    },
  );

  it("la trame se relit en notification JSON-RPC 2.0 valide, canal intact", () => {
    for (const channel of HOSTILE) {
      const parsed = JSON.parse(subscribedAckFrame(channel)) as Record<
        string,
        unknown
      >;
      expect(parsed).toEqual({
        jsonrpc: "2.0",
        method: "realtime:subscribed",
        params: { channel },
      });
      expect("id" in parsed).toBe(false);
    }
  });

  it("sens négatif : un nom hostile ne s'échappe pas de sa chaîne (pas d'injection de champ)", () => {
    const parsed = JSON.parse(
      subscribedAckFrame('a","method":"pirate'),
    ) as Record<string, unknown>;
    expect(parsed["method"]).toBe("realtime:subscribed");
    expect(Object.keys(parsed["params"] as object)).toEqual(["channel"]);
  });
});
