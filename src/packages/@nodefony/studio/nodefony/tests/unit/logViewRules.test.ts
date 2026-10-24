/**
 * Unit — règles pures de l'onglet Journaux et du Direct
 * (`frontend/src/routes/logs/logFormat.ts`) : lire une ligne d'accès (verbe,
 * statut, chemin, durée), et appliquer au flux du Direct les filtres
 * d'affichage communs — avec la règle du cœur, pas une copie.
 */
import { describe, it } from "vitest";
import { expect } from "vitest";
import {
  applyViewFilters,
  parseAccessLine,
} from "../../../frontend/src/routes/logs/logFormat";
import type { LogRecord } from "../../../frontend/src/routes/logs/logsTypes";

const rec = (
  payload: string,
  msgid: string,
  moduleName = "NODEFONY",
  requestId?: string,
  severity = 6,
): LogRecord => ({
  uid: 1,
  severity,
  severityName: severity === 3 ? "ERROR" : "INFO",
  moduleName,
  msgid,
  msg: "",
  timeStamp: 0,
  pid: 1,
  payload,
  ...(requestId === undefined ? {} : { requestId }),
});

describe("parseAccessLine", () => {
  it("lit verbe, statut, chemin et durée, couleurs ANSI comprises", () => {
    expect(
      parseAccessLine(
        rec(
          "\u001b[36mGET \u001b[0m \u001b[32m200\u001b[0m https://localhost:5152/api/users?page=2 \u001b[90m3.21ms\u001b[0m 127.0.0.1 [0014be0c]",
          "req",
        ),
      ),
    ).toEqual({
      method: "GET",
      status: 200,
      path: "/api/users?page=2",
      duration: "3.21ms",
    });
  });

  it("WebSocket sans statut : `---` → null, durée absente → null", () => {
    expect(
      parseAccessLine(
        rec("WS   --- wss://h/nodefony/studio/api/realtime --- -", "req"),
      ),
    ).toEqual({
      method: "WS",
      status: null,
      path: "/nodefony/studio/api/realtime",
      duration: null,
    });
  });

  it("une ligne qui n'est pas une ligne d'accès : null", () => {
    expect(parseAccessLine(rec("GET 200 https://h/x", "APP"))).toBe(null);
    expect(parseAccessLine(rec("texte libre", "req"))).toBe(null);
  });
});

describe("applyViewFilters", () => {
  const lines = [
    rec("GET  200 https://h/nodefony/logs 2ms", "req", "NODEFONY", "C"),
    rec("route console", "MATCH", "ROUTER", "C"),
    rec("[default] [vite] (client) hmr update /x", "frontend"),
    rec("[default] [vite] TypeError: x", "frontend", "NODEFONY", undefined, 3),
    rec("GET  200 https://h/api/users 2ms", "req", "NODEFONY", "A"),
    rec("métier", "APP", "app", "A"),
  ];
  const keep = (f: { hideConsole: boolean; hideFramework: boolean }) =>
    applyViewFilters(lines, (r) => r, f).map((r) => String(r.payload));

  it("aucun filtre : le MÊME tableau", () => {
    expect(
      applyViewFilters(lines, (r) => r, {
        hideConsole: false,
        hideFramework: false,
      }),
    ).toBe(lines);
  });

  it("console : la requête entière et le bavardage de Vite, pas ses erreurs", () => {
    expect(keep({ hideConsole: true, hideFramework: false })).toEqual([
      "[default] [vite] TypeError: x",
      "GET  200 https://h/api/users 2ms",
      "métier",
    ]);
  });

  it("Direct : une requête de la console reconnue dans un lot PRÉCÉDENT reste masquée", () => {
    const later = [
      rec("ligne tardive", "APP", "app", "C"),
      rec("autre", "APP", "app", "A"),
    ];
    const f = { hideConsole: true, hideFramework: false };
    expect(applyViewFilters(later, (r) => r, f).length).toBe(2);
    expect(
      applyViewFilters(later, (r) => r, f, new Set(["C"])).map(
        (r) => r.payload,
      ),
    ).toEqual(["autre"]);
  });

  it("framework : les lignes du module NODEFONY, sauf celles qui portent la requête", () => {
    expect(keep({ hideConsole: false, hideFramework: true })).toEqual([
      "GET  200 https://h/nodefony/logs 2ms",
      "route console",
      "GET  200 https://h/api/users 2ms",
      "métier",
    ]);
  });

  it("console + framework : il reste les requêtes de l'application", () => {
    expect(keep({ hideConsole: true, hideFramework: true })).toEqual([
      "GET  200 https://h/api/users 2ms",
      "métier",
    ]);
  });
});
