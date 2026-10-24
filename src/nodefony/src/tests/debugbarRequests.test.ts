/**
 * Jointure de l'onglet « Requêtes » de la debug bar (#665) : une requête vue
 * par le navigateur porte ses lignes serveur, une ligne orpheline reste dans le
 * flux, une requête sans réponse reste une ligne — et l'ordre se lit sur
 * l'horloge de la PAGE, jamais sur celle du serveur.
 */
import { describe, expect, it } from "vitest";
import type { FeedLog } from "../client/debugbar/model";
import type { NetEntry } from "../client/debugbar/network";
import { joinRequests } from "../client/debugbar/requests";

function appel(
  id: number,
  startedAt: number,
  requestId: string | null,
): NetEntry {
  return {
    id,
    method: "GET",
    url: `https://127.0.0.1/api/${id}`,
    path: `/api/${id}`,
    status: requestId === null ? null : 200,
    ok: requestId !== null,
    durationMs: requestId === null ? null : 4,
    startedAt,
    requestId,
    traceparent: null,
    pending: requestId === null,
    error: null,
  };
}

function ligne(seq: number, at: number, requestId?: string, ts = 0): FeedLog {
  return {
    seq,
    at,
    severity: 6,
    name: "INFO",
    text: `ligne ${seq}`,
    module: "app",
    ts,
    uid: seq,
    msgid: "",
    pid: 1,
    console: false,
    requestId,
  };
}

describe("joinRequests", () => {
  it("rattache les lignes serveur à la requête de même requestId, dans leur ordre d'arrivée", () => {
    const rows = joinRequests(
      [appel(1, 10, "r1")],
      [ligne(1, 11, "r1"), ligne(2, 12, "r1")],
    );
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.kind).toBe("request");
    expect(row?.kind === "request" && row.logs.map((l) => l.seq)).toEqual([
      1, 2,
    ]);
  });

  it("garde dans le flux une ligne qu'aucune requête du navigateur ne réclame", () => {
    const rows = joinRequests(
      [appel(1, 10, "r1")],
      [ligne(1, 11, "r1"), ligne(2, 20, "autre-client"), ligne(3, 30)],
    );
    expect(rows.map((r) => r.kind)).toEqual(["log", "log", "request"]);
    expect(rows.filter((r) => r.kind === "log").map((r) => r.log.seq)).toEqual([
      3, 2,
    ]);
  });

  it("garde une requête sans réponse (pas encore de requestId), sans lignes", () => {
    const rows = joinRequests([appel(1, 10, null)], [ligne(1, 11, "r1")]);
    expect(rows.map((r) => r.kind)).toEqual(["log", "request"]);
    const req = rows.find((r) => r.kind === "request");
    expect(req?.kind === "request" && req.logs).toEqual([]);
  });

  it("ordonne sur l'horloge de la page, le plus récent en tête — jamais sur ts serveur", () => {
    // ts serveur à rebours exprès : il ne doit rien décider.
    const rows = joinRequests(
      [appel(1, 10, "r1"), appel(2, 30, "r2")],
      [ligne(1, 20, undefined, 9_999), ligne(2, 40, undefined, 1)],
    );
    expect(rows.map((r) => r.at)).toEqual([40, 30, 20, 10]);
  });
});
