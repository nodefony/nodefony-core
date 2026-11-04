import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Container, CSP_REPORT_PATH, Event } from "nodefony";
import type { ICspReportsSnapshot, Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import { CspReportCollector } from "../../nodefony/src/cspReports";
import { reportUrlProblem, withViolationReports } from "../../nodefony/src/csp";
import { createSecurityAdminApi } from "../../nodefony/src/admin/SecurityAdminApi";

// ADR-0024 §C7 — rapports de violation : demandés par la politique, reçus
// bornés, expurgés, dédoublonnés, lus par l'administrateur (#699 lot 7).

const CSP_TYPE = "application/csp-report";
const REPORTS_TYPE = "application/reports+json";

function cspReport(fields: Record<string, unknown>): string {
  return JSON.stringify({
    "csp-report": {
      "document-uri": "https://app.example/page?token=s3cret#frag",
      "blocked-uri": "https://evil.example/x.js?k=v",
      "effective-directive": "script-src-elem",
      "violated-directive": "script-src-elem",
      "original-policy": "default-src 'self'",
      disposition: "enforce",
      "script-sample": "alert(document.cookie)",
      "status-code": 200,
      ...fields,
    },
  });
}

function collector(
  options: Partial<ConstructorParameters<typeof CspReportCollector>[0]> = {},
) {
  const logs: Array<[string, string]> = [];
  let now = 1_000_000;
  const c = new CspReportCollector({
    endpoint: CSP_REPORT_PATH,
    log: (m, s) => logs.push([m, s]),
    now: () => now,
    ...options,
  });
  return {
    c,
    logs,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe("withViolationReports — la politique demande ses rapports", () => {
  it("ajoute report-uri ET report-to en fin de politique", () => {
    const r = withViolationReports("default-src 'self';  ", "/r", "g");
    assert.deepEqual(r, {
      csp: "default-src 'self'; report-uri /r; report-to g",
      added: true,
    });
  });

  it("une politique qui déclare déjà report-uri ou report-to est rendue telle quelle", () => {
    for (const csp of [
      "default-src 'self'; report-uri https://mine.example/c",
      "default-src 'self'; REPORT-TO mine",
    ]) {
      assert.deepEqual(withViolationReports(csp, "/r", "g"), {
        csp,
        added: false,
      });
    }
  });

  it("politique vide (posée au proxy) : rien", () => {
    assert.deepEqual(withViolationReports(" ", "/r", "g"), {
      csp: " ",
      added: false,
    });
  });
});

describe("reportUrlProblem — l'URL d'un collecteur écrite par l'application", () => {
  it("accepte un chemin absolu et une URL http(s)", () => {
    for (const ok of ["/csp", "https://c.example/r", "http://localhost:9/r"]) {
      assert.equal(reportUrlProblem(ok), null, ok);
    }
  });

  it("refuse ce qu'un en-tête ou une directive ne peut pas porter", () => {
    for (const bad of [
      "",
      "//c.example/r",
      "/r; script-src *",
      "/r x",
      '/r"',
      "/r,other",
      "javascript:alert(1)",
      "relatif",
      "/é",
    ]) {
      assert.notEqual(reportUrlProblem(bad), null, bad);
    }
  });
});

describe("CspReportCollector — réception d'une porte publique", () => {
  it("application/csp-report : URL expurgées, extrait jamais gardé", () => {
    const { c } = collector();
    assert.equal(
      c.receive(`${CSP_TYPE}; charset=utf-8`, cspReport({}), "1.1.1.1", "UA"),
      "stored",
    );
    const [v] = c.snapshot().items;
    assert.ok(v);
    assert.equal(v.documentURL, "https://app.example/page");
    assert.equal(v.blockedURL, "https://evil.example/x.js");
    assert.equal(v.effectiveDirective, "script-src-elem");
    assert.equal(v.disposition, "enforce");
    assert.equal(v.statusCode, 200);
    assert.equal(v.userAgent, "UA");
    assert.ok(!JSON.stringify(c.snapshot()).includes("cookie"));
    assert.ok(!JSON.stringify(c.snapshot()).includes("s3cret"));
  });

  it("identifiants d'URL retirés ; schéma seul hors HTTP(S) ; mot-clé gardé", () => {
    const { c } = collector();
    c.receive(
      CSP_TYPE,
      cspReport({
        "document-uri": "https://u:p@app.example/a",
        "blocked-uri": "data:text/html,<script>",
        "source-file": "https://app.example/s.js?v=1",
        "line-number": 12,
      }),
      "1.1.1.1",
    );
    c.receive(CSP_TYPE, cspReport({ "blocked-uri": "inline" }), "1.1.1.1");
    const [inline, data] = c.snapshot().items;
    assert.equal(data?.documentURL, "https://app.example/a");
    assert.equal(data?.blockedURL, "data");
    assert.equal(data?.sourceFile, "https://app.example/s.js");
    assert.equal(data?.lineNumber, 12);
    assert.equal(inline?.blockedURL, "inline");
  });

  it("CSP2 sans effective-directive : la directive vient de violated-directive", () => {
    const { c } = collector();
    c.receive(
      CSP_TYPE,
      cspReport({
        "effective-directive": undefined,
        "violated-directive": "img-src 'self' data:",
      }),
      "1.1.1.1",
    );
    assert.equal(c.snapshot().items[0]?.effectiveDirective, "img-src");
  });

  it("application/reports+json : seuls les csp-violation sont lus", () => {
    const { c } = collector();
    const body = JSON.stringify([
      { type: "deprecation", body: { id: "x" } },
      {
        type: "csp-violation",
        url: "https://app.example/p?q=1",
        body: {
          documentURL: "https://app.example/p?q=1",
          blockedURL: "wss://rt.example/socket?ticket=t",
          effectiveDirective: "connect-src",
          disposition: "report",
          sample: "secret",
        },
      },
    ]);
    assert.equal(c.receive(REPORTS_TYPE, body, "1.1.1.1"), "stored");
    const snap = c.snapshot();
    assert.equal(snap.items.length, 1);
    assert.equal(snap.items[0]?.blockedURL, "wss");
    assert.equal(snap.items[0]?.disposition, "report");
  });

  it("type de contenu, JSON ou forme refusés : écartés et comptés", () => {
    const { c } = collector();
    assert.equal(
      c.receive("application/json", cspReport({}), "a"),
      "unsupported",
    );
    assert.equal(c.receive(null, cspReport({}), "a"), "unsupported");
    assert.equal(c.receive(CSP_TYPE, "{", "a"), "malformed");
    assert.equal(c.receive(CSP_TYPE, "[]", "a"), "malformed");
    assert.equal(
      c.receive(CSP_TYPE, cspReport({ "document-uri": "pas une url" }), "a"),
      "malformed",
    );
    assert.equal(
      c.receive(
        CSP_TYPE,
        cspReport({
          "effective-directive": "<script>",
          "violated-directive": "<b>",
        }),
        "a",
      ),
      "malformed",
    );
    assert.equal(
      c.receive(REPORTS_TYPE, '{"type":"csp-violation"}', "a"),
      "malformed",
    );
    const snap = c.snapshot();
    assert.equal(snap.items.length, 0);
    assert.equal(snap.received, 7);
    assert.equal(snap.rejected, 7);
  });

  it("dédoublonnage : une répétition compte, ne s'ajoute pas, ne journalise pas", () => {
    const { c, logs, advance } = collector();
    c.receive(CSP_TYPE, cspReport({}), "a");
    advance(500);
    assert.equal(c.receive(CSP_TYPE, cspReport({}), "b"), "duplicate");
    const [v] = c.snapshot().items;
    assert.equal(v?.count, 2);
    assert.equal(v?.lastSeen - v.firstSeen, 500);
    assert.equal(logs.length, 1);
    assert.match(
      logs[0]?.[0] ?? "",
      /script-src-elem refuse https:\/\/evil\.example\/x\.js/,
    );
  });

  it("mémoire bornée : la violation la moins récemment vue part d'abord", () => {
    const { c } = collector({ capacity: 2 });
    const at = (n: number) =>
      cspReport({ "blocked-uri": `https://h${n}.example/` });
    c.receive(CSP_TYPE, at(1), "a");
    c.receive(CSP_TYPE, at(2), "a");
    c.receive(CSP_TYPE, at(1), "a"); // 1 revue : 2 devient la plus ancienne
    c.receive(CSP_TYPE, at(3), "a");
    const blocked = c.snapshot().items.map((v) => v.blockedURL);
    assert.deepEqual(blocked, ["https://h3.example/", "https://h1.example/"]);
  });

  it("quota par adresse : au-delà, écarté ; une autre adresse passe ; la fenêtre se rouvre", () => {
    const { c, advance } = collector({ perMinute: 2 });
    c.receive(CSP_TYPE, cspReport({}), "a");
    c.receive(CSP_TYPE, cspReport({}), "a");
    assert.equal(c.receive(CSP_TYPE, cspReport({}), "a"), "limited");
    assert.equal(c.receive(CSP_TYPE, cspReport({}), "b"), "duplicate");
    advance(60_000);
    assert.equal(c.receive(CSP_TYPE, cspReport({}), "a"), "duplicate");
    assert.equal(c.snapshot().items[0]?.count, 4);
  });

  it("journal borné : au-delà du budget de la minute, un résumé à la suivante", () => {
    const { c, logs, advance } = collector({ logPerMinute: 2 });
    for (let i = 0; i < 5; i++) {
      c.receive(
        CSP_TYPE,
        cspReport({ "blocked-uri": `https://h${i}.example/` }),
        "a",
      );
    }
    assert.equal(logs.length, 2);
    advance(60_000);
    c.receive(
      CSP_TYPE,
      cspReport({ "blocked-uri": "https://later.example/" }),
      "a",
    );
    assert.equal(logs.length, 4);
    assert.deepEqual(logs[2], [
      "CSP : 3 violation(s) neuve(s) non journalisée(s) la minute précédente — liste complète : GET /nodefony/security/api/csp-reports",
      "NOTICE",
    ]);
  });

  it("User-Agent : contrôles retirés, tronqué", () => {
    const { c } = collector();
    c.receive(
      CSP_TYPE,
      cspReport({}),
      "a",
      `Moz\u001b[31m\nilla${"x".repeat(400)}`,
    );
    const ua = c.snapshot().items[0]?.userAgent ?? "";
    assert.ok(!/[\u0000-\u001f]/u.test(ua), ua);
    assert.ok(ua.startsWith("Moz[31milla"), ua);
    assert.equal(ua.length, 200);
  });

  it("la photo est une copie : la modifier ne touche pas le collecteur", () => {
    const { c } = collector();
    c.receive(CSP_TYPE, cspReport({}), "a");
    const snap = c.snapshot();
    (snap.items[0] as { count: number }).count = 99;
    assert.equal(c.snapshot().items[0]?.count, 1);
  });
});

/** Un pare-feu réel, seul : ses en-têtes de page, son conteneur, son journal. */
function boot(options: unknown) {
  const container = new Container();
  const kernel = Object.assign(new EventEmitter(), {
    container,
    runProfile: { servers: false },
  });
  container.set("kernel", kernel);
  const fw = new Firewall({
    container,
    notificationsCenter: new Event(),
    options,
  } as unknown as Module);
  const errors: string[] = [];
  const log = fw.log.bind(fw);
  fw.log = ((msg: unknown, severity?: unknown, ...rest: unknown[]) => {
    if (severity === "ERROR") errors.push(String(msg));
    return log(msg as never, severity as never, ...(rest as never[]));
  }) as typeof fw.log;
  kernel.emit("onBoot");
  const headersFor = (contentType?: string) => {
    const headers: Record<string, string> = {};
    fw.applySecurityHeaders(
      {
        cspNonce: "N0nce==",
        cspDirectives: null,
        response: {
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        },
      } as unknown as ContextType,
      contentType,
    );
    return headers;
  };
  return { container, errors, headersFor };
}

describe("Firewall — headers.cspReport (ADR-0024 §C7)", () => {
  it("par défaut : report-uri + report-to vers la route du framework, Reporting-Endpoints, collecteur posé", () => {
    const { container, headersFor } = boot({});
    const page = headersFor("text/html");
    const csp = page["Content-Security-Policy"] ?? "";
    assert.ok(
      csp.endsWith(`report-uri ${CSP_REPORT_PATH}; report-to nodefony-csp`),
      csp,
    );
    assert.equal(
      page["Reporting-Endpoints"],
      `nodefony-csp="${CSP_REPORT_PATH}"`,
    );
    assert.equal(
      headersFor("text/javascript")["Reporting-Endpoints"],
      `nodefony-csp="${CSP_REPORT_PATH}"`,
    );
    // La politique étroite (JSON, image…) ne désigne aucun groupe.
    const json = headersFor("application/json");
    assert.equal(json["Reporting-Endpoints"], undefined);
    assert.ok(!(json["Content-Security-Policy"] ?? "").includes("report-"));
    assert.ok(container.get("cspReports") instanceof CspReportCollector);
  });

  it("false : aucune directive, aucun en-tête, aucun collecteur", () => {
    const { container, headersFor } = boot({ headers: { cspReport: false } });
    const page = headersFor("text/html");
    assert.ok(!(page["Content-Security-Policy"] ?? "").includes("report-"));
    assert.equal(page["Reporting-Endpoints"], undefined);
    assert.equal(container.get("cspReports"), null);
  });

  it("URL de l'application : les directives la désignent, pas de collecteur local", () => {
    const url = "https://collect.example/csp";
    const { container, headersFor } = boot({ headers: { cspReport: url } });
    const page = headersFor("text/html");
    assert.ok(
      (page["Content-Security-Policy"] ?? "").includes(`report-uri ${url}`),
    );
    assert.equal(page["Reporting-Endpoints"], `nodefony-csp="${url}"`);
    assert.equal(container.get("cspReports"), null);
  });

  it("URL malformée : retirée et dite, l'application démarre sans rapports", () => {
    const { container, errors, headersFor } = boot({
      headers: { cspReport: "/r; script-src *" },
    });
    const page = headersFor("text/html");
    assert.ok(!(page["Content-Security-Policy"] ?? "").includes("report-"));
    assert.ok(
      !(page["Content-Security-Policy"] ?? "").includes("script-src *"),
    );
    assert.equal(container.get("cspReports"), null);
    assert.equal(errors.length, 1, errors.join("\n"));
    assert.match(errors[0] ?? "", /headers\.cspReport .* IGNORÉE/);
  });

  it("politique de l'application qui a son collecteur : rendue telle quelle", () => {
    const csp = "default-src 'self'; report-uri https://mine.example/c";
    const { container, headersFor } = boot({ headers: { csp } });
    const page = headersFor("text/html");
    assert.ok(
      (page["Content-Security-Policy"] ?? "").includes(
        "report-uri https://mine.example/c",
      ),
    );
    assert.ok(
      !(page["Content-Security-Policy"] ?? "").includes(CSP_REPORT_PATH),
    );
    assert.equal(page["Reporting-Endpoints"], undefined);
    assert.equal(container.get("cspReports"), null);
  });

  it('politique au proxy (csp: "") : ni politique ni rapports', () => {
    const { container, headersFor } = boot({ headers: { csp: "" } });
    assert.deepEqual(
      Object.keys(headersFor("text/html")).filter((h) =>
        /Security-Policy|Reporting/.test(h),
      ),
      [],
    );
    assert.equal(container.get("cspReports"), null);
  });
});

describe("GET /nodefony/security/api/csp-reports — lecture d'administration", () => {
  function endpoint(container: Container) {
    const ep = createSecurityAdminApi(container)
      .adminEndpoints()
      .find((e) => e.path === "csp-reports");
    assert.ok(ep);
    return ep;
  }

  it("réservée à l'administrateur, rend la photo du collecteur", async () => {
    const { container } = boot({});
    const collector = container.get<CspReportCollector>("cspReports");
    collector?.receive(CSP_TYPE, cspReport({}), "a");
    const ep = endpoint(container);
    assert.equal(ep.method, "GET");
    assert.equal(ep.role, "ROLE_NODEFONY_ADMIN");
    const snap = (await ep.handler({} as never)) as ICspReportsSnapshot;
    assert.equal(snap.enabled, true);
    assert.equal(snap.endpoint, CSP_REPORT_PATH);
    assert.equal(snap.items.length, 1);
  });

  it("sans collecteur : réponse honnête, jamais une erreur", async () => {
    const { container } = boot({ headers: { cspReport: false } });
    const snap = (await endpoint(container).handler(
      {} as never,
    )) as ICspReportsSnapshot;
    assert.deepEqual(snap, {
      enabled: false,
      endpoint: null,
      capacity: 0,
      received: 0,
      rejected: 0,
      items: [],
    });
  });
});
