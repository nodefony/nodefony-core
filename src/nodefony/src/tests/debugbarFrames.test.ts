/**
 * Unit — le sens des trames du journal de socket (`client/debugbar/frames.ts`).
 *
 * Vécu sur /demo/chat : `chat:typing` passait dans les deux sens, `{}` en
 * montant et `{ author }` en descendant, sans que rien ne dise que l'un
 * provoque l'autre. Ce banc fige les phrases et les liens.
 */
import { describe, it, expect } from "vitest";
import type { RealtimeFrame } from "../client/realtime/NodefonySocket";
import {
  ECHO_WINDOW_MS,
  frameLinks,
  frameMeaning,
  summarizeParams,
} from "../client/debugbar/frames";

/** Une trame telle que la socket la journalise : la charge EST la trame JSON-RPC. */
function frame(
  dir: "in" | "out",
  ts: number,
  kind: string,
  extra: { id?: number; channel?: string; params?: unknown } = {},
): RealtimeFrame {
  const payload: Record<string, unknown> = { jsonrpc: "2.0" };
  if (extra.id !== undefined) payload.id = extra.id;
  if (kind !== "response" && kind !== "error") payload.method = kind;
  if (extra.params !== undefined) payload.params = extra.params;
  return {
    ts,
    dir,
    kind,
    id: extra.id,
    channel: extra.channel,
    payload,
    size: 50,
    binary: false,
  };
}

describe("frameMeaning — une phrase par trame", () => {
  it("le « j'écris » montant : une notification SANS champ", () => {
    const m = frameMeaning(frame("out", 0, "chat:typing", { params: {} }));
    expect(m).toBe(
      "la page émet sur « chat:typing » — notification, sans réponse ; aucun champ",
    );
  });

  it("sa rediffusion descendante : la poussée, et qui écrit", () => {
    const m = frameMeaning(
      frame("in", 0, "chat:typing", { params: { author: "admin" } }),
    );
    expect(m).toBe(
      "le serveur pousse sur « chat:typing » aux abonnés ; author: admin",
    );
  });

  it("abonnement, accusé, appel par le pont, réponse", () => {
    expect(
      frameMeaning(
        frame("out", 0, "subscribe", {
          channel: "chat:room",
          params: { channel: "chat:room" },
        }),
      ),
    ).toBe("la page s'abonne au canal « chat:room »");
    expect(
      frameMeaning(
        frame("in", 0, "realtime:subscribed", { channel: "chat:room" }),
      ),
    ).toBe("le serveur confirme l'abonnement au canal « chat:room »");
    expect(
      frameMeaning(
        frame("out", 0, "api.request", {
          id: 1,
          params: { method: "POST", path: "/demo/chat/send" },
        }),
      ),
    ).toBe(
      "la page appelle POST /demo/chat/send par la socket — réponse attendue (#1)",
    );
    expect(frameMeaning(frame("in", 0, "response", { id: 1 }))).toBe(
      "le serveur répond à #1",
    );
  });

  it("résumé borné : trois champs, puis le compte des autres", () => {
    expect(summarizeParams({ a: 1, b: "x", c: true, d: 2, e: 3 })).toBe(
      "a: 1, b: x, c: true +2",
    );
    expect(summarizeParams({ nested: { deep: 1 } })).toBe("nested");
    expect(summarizeParams(undefined)).toBe("aucun champ");
  });
});

describe("frameLinks — ce qui se répond", () => {
  it("🔴 le « j'écris » montant est relié à sa rediffusion, et dit PROBABLE", () => {
    const frames = [
      frame("out", 1000, "chat:typing", { params: {} }),
      frame("in", 1012, "chat:typing", { params: { author: "admin" } }),
    ];
    const links = frameLinks(frames);
    expect(links.get(1)).toContain("en retour probable de ↑ l'émission");
    expect(links.get(1)).toContain("12 ms après");
    expect(links.get(0)).toContain("rediffusé par le serveur ↓");
    expect(links.get(0)).toContain("(probable)");
  });

  it("une poussée hors fenêtre, ou d'un autre canal, n'est PAS reliée", () => {
    const frames = [
      frame("out", 0, "chat:typing", { params: {} }),
      frame("in", 1, "chat:room", { params: { text: "salut" } }),
      frame("in", ECHO_WINDOW_MS + 1, "chat:typing", {
        params: { author: "admin" },
      }),
    ];
    expect(frameLinks(frames).size).toBe(0);
  });

  it("une émission ne s'attribue qu'UNE rediffusion — la suivante vient d'ailleurs", () => {
    const frames = [
      frame("out", 0, "chat:typing", { params: {} }),
      frame("in", 5, "chat:typing", { params: { author: "admin" } }),
      frame("in", 9, "chat:typing", { params: { author: "bob" } }),
    ];
    const links = frameLinks(frames);
    expect(links.has(1)).toBe(true);
    expect(links.has(2)).toBe(false);
  });

  it("réponse ↔ requête par l'id (exact), accusé ↔ abonnement par le canal", () => {
    const frames = [
      frame("out", 0, "subscribe", { channel: "chat:room" }),
      frame("out", 1, "api.request", { id: 7, params: { path: "/h" } }),
      frame("in", 3, "realtime:subscribed", { channel: "chat:room" }),
      frame("in", 4, "response", { id: 7 }),
    ];
    const links = frameLinks(frames);
    expect(links.get(3)).toContain("en réponse à ↑ « api.request »");
    expect(links.get(1)).toContain("réponse reçue ↓");
    expect(links.get(2)).toContain("confirme ↑ la demande");
    expect(links.get(0)).toContain("confirmé ↓");
  });
});
