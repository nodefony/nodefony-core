/**
 * Les lignes de l'onglet « Requêtes » de la debug bar (#665), mises à plat.
 * Vue Page : les appels de la page, dépliés sur les lignes RELUES au serveur.
 * Vue Journaux : la réponse groupée du serveur telle quelle, enrichie par
 * l'appel du navigateur de même requestId. Aucune jointure sur le flux entier.
 */
import { describe, expect, it } from "vitest";
import type { FeedLog } from "../client/debugbar/model";
import type { NetEntry } from "../client/debugbar/network";
import type { ILogRecord } from "../syslog/drivers/ILogDriver";
import {
  flowKey,
  pageItems,
  recordToLine,
  serverItems,
  type LinesState,
} from "../client/debugbar/requests";

function appel(
  id: number,
  requestId: string | null,
  path = `/api/${id}`,
): NetEntry {
  return {
    id,
    method: "GET",
    url: `https://127.0.0.1${path}`,
    path,
    status: requestId === null ? null : 200,
    ok: requestId !== null,
    durationMs: requestId === null ? null : 4,
    startedAt: id,
    requestId,
    traceparent: null,
    pending: requestId === null,
    error: null,
  };
}

function enregistrement(
  uid: number,
  payload: string,
  requestId?: string,
  extra: Partial<ILogRecord> = {},
): ILogRecord {
  return {
    uid,
    severity: 6,
    severityName: "INFO",
    moduleName: "app",
    msgid: "",
    msg: "",
    timeStamp: 1_700_000_000_000 + uid,
    pid: 1,
    payload,
    ...(requestId === undefined ? {} : { requestId }),
    ...extra,
  };
}

const sans = {
  expanded: null,
  lines: new Map<string, LinesState>(),
  keep: (): boolean => true,
};

describe("vue Page — les requêtes de la page", () => {
  it("une ligne par appel, dans l'ordre reçu (le plus récent en tête)", () => {
    const items = pageItems([appel(2, "r2"), appel(1, "r1")], "", sans);
    expect(items.map(flowKey)).toEqual(["r2", "r1"]);
  });

  it("🔴 dépliée, une requête montre ses lignes RELUES, en retrait, filtrées", () => {
    const lines = new Map<string, LinesState>([
      [
        "r1",
        [
          recordToLine(enregistrement(10, "lecture", "r1")),
          recordToLine(enregistrement(11, "bavard", "r1", { severity: 7 })),
        ],
      ],
    ]);
    const items = pageItems([appel(1, "r1")], "", {
      expanded: new Set(["r1"]),
      lines,
      keep: (l: FeedLog) => l.severity <= 6,
    });
    expect(items.map(flowKey)).toEqual(["r1", "r1.10"]);
    const req = items[0];
    expect(req && "kind" in req && req.kind === "request" && req.count).toBe(1);
  });

  it("dépliée mais pas encore relue : la requête seule, compte inconnu", () => {
    const items = pageItems([appel(1, "r1")], "", {
      ...sans,
      expanded: new Set(["r1"]),
      lines: new Map<string, LinesState>([["r1", "loading"]]),
    });
    expect(items.map(flowKey)).toEqual(["r1"]);
  });

  it("la recherche porte sur la méthode, le chemin, le statut et le requestId", () => {
    const net = [appel(1, "r1", "/api/articles"), appel(2, "r2", "/api/users")];
    expect(pageItems(net, "articles", sans).map(flowKey)).toEqual(["r1"]);
    expect(pageItems(net, "r2", sans).map(flowKey)).toEqual(["r2"]);
  });
});

describe("vue Journaux — la recherche groupée du serveur", () => {
  it("🔴 une ligne de groupe est une requête : sa ligne d'accès lue, son compte", () => {
    const rows = [
      enregistrement(5, "GET 200 https://h/logo.png 2.2ms", "rid-logo", {
        msgid: "req",
        lines: 3,
      }),
    ];
    const [item] = serverItems(rows, [], sans);
    if (!item || !("kind" in item) || item.kind !== "request")
      throw new Error("une requête était attendue");
    expect(item.access).toEqual({
      method: "GET",
      status: 200,
      path: "/logo.png",
      duration: "2.2ms",
    });
    expect(item.count).toBe(3);
    expect(item.net).toBeNull();
  });

  it("l'appel du navigateur de même requestId enrichit la ligne", () => {
    const rows = [
      enregistrement(5, "GET 200 https://h/api/1 3ms", "r1", { msgid: "req" }),
    ];
    const [item] = serverItems(rows, [appel(1, "r1")], sans);
    if (!item || !("kind" in item) || item.kind !== "request")
      throw new Error("une requête était attendue");
    expect(item.net?.id).toBe(1);
  });

  it("une ligne sans requestId reste une ligne serveur, au premier niveau", () => {
    const [item] = serverItems([enregistrement(7, "tâche de fond")], [], sans);
    if (!item || "kind" in item) throw new Error("une ligne était attendue");
    expect(item.text).toBe("tâche de fond");
  });
});
