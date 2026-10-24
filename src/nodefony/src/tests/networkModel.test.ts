/**
 * Le compte des appels en échec de la barre de débogage : l'intercepteur
 * réémet le MÊME objet une fois modifié — le modèle doit compter l'erreur
 * quand même, et un WebSocket fermé sur un code anormal en est une.
 */
import { describe, expect, it } from "vitest";
import type { NetEntry } from "../client/debugbar/network";
import { NetworkModel } from "../client/debugbar/profile";

const appel = (id: number): NetEntry => ({
  id,
  method: "GET",
  url: "/x",
  path: "/x",
  status: null,
  ok: false,
  durationMs: null,
  startedAt: 0,
  requestId: null,
  traceparent: null,
  pending: true,
  error: null,
});

describe("NetworkModel — compte des échecs", () => {
  it("🔴 le même objet passé de « en attente » à « échec » est compté", () => {
    const m = new NetworkModel();
    const e = appel(1);
    m.ingest(e);
    e.pending = false;
    e.error = "Failed to fetch";
    m.ingest(e);
    expect(m.errors).toBe(1);
    e.error = null;
    e.status = 200;
    m.ingest(e);
    expect(m.errors).toBe(0);
  });

  it("un WebSocket fermé en 1006 est un échec, en 1000 non", () => {
    const m = new NetworkModel();
    const ws: NetEntry = {
      ...appel(2),
      method: "WS",
      pending: false,
      status: 101,
      stream: {
        kind: "ws",
        state: "closed",
        code: 1000,
        reason: null,
        reconnects: 0,
        closedAt: 1,
      },
    };
    m.ingest(ws);
    expect(m.errors).toBe(0);
    if (ws.stream) ws.stream.code = 1006;
    m.ingest(ws);
    expect(m.errors).toBe(1);
  });
});
