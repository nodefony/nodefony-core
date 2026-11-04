/// <reference types="node" />
/**
 * Integration e2e — rapports de violation CSP (ADR-0024 §C7, #699 lot 7).
 *
 * Prouve sur serveur live la boucle entière : une page DEMANDE ses rapports
 * (`report-uri`, `report-to`, `Reporting-Endpoints`), la route publique
 * `POST /nodefony/security/api/csp-report` les REÇOIT bornés (204 toujours,
 * 413 au-delà de 8 Ko, CSRF exemptée), et l'administrateur les LIT expurgés
 * sur `GET /nodefony/security/api/csp-reports` — un anonyme, jamais.
 *
 * Requires: server running on 5152 (https). Start: /start-server
 * Fixtures dev : admin/secret-de-dev-42 (ROLE_NODEFONY_ADMIN).
 */
import { expect } from "vitest";
import https from "node:https";
import { randomUUID } from "node:crypto";
import { CSP_REPORT_PATH } from "nodefony";
import type { ICspReportsSnapshot } from "nodefony";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };
const LOGIN = "/nodefony/security/api/auth/login";
const READ = "/nodefony/security/api/csp-reports";
const TIMEOUT = 10_000;

/** En-tête de réponse en texte (absent = chaîne vide). */
function headerText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

type Res = { status: number; headers: Record<string, unknown>; body: unknown };

/**
 * Une requête ; `body` chaîne = envoyé tel quel (`chunked` = sans
 * Content-Length), objet = JSON.
 */
function request(
  method: string,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
  chunked = false,
): Promise<Res> {
  return new Promise((resolve, reject) => {
    const payload =
      body === undefined
        ? undefined
        : typeof body === "string"
          ? body
          : JSON.stringify(body);
    const h: Record<string, string> = { ...headers };
    if (payload !== undefined) {
      h["content-type"] ??= "application/json";
      if (!chunked) h["content-length"] = String(Buffer.byteLength(payload));
    }
    const req = https.request({ ...BASE, path, method, headers: h }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        const raw = Buffer.concat(chunks).toString();
        let parsed: unknown = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          /* texte brut / vide */
        }
        resolve({
          status: res.statusCode!,
          headers: res.headers,
          body: parsed,
        });
      });
    });
    req.on("error", reject);
    req.setTimeout(TIMEOUT, () => req.destroy(new Error("http timeout")));
    if (payload !== undefined) {
      if (chunked) {
        // Deux écritures : pas de Content-Length, la borne doit mordre en flux.
        const half = Math.floor(payload.length / 2);
        req.write(payload.slice(0, half));
        req.write(payload.slice(half));
      } else {
        req.write(payload);
      }
    }
    req.end();
  });
}

async function loginAsAdmin(): Promise<string> {
  const res = await request(
    "POST",
    LOGIN,
    {},
    {
      username: "admin",
      password: "secret-de-dev-42",
    },
  );
  expect(res.status, "login admin").to.equal(200);
  const setCookie = res.headers["set-cookie"];
  const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(first, "login pose un cookie de session").to.be.a("string");
  return String(first).split(";")[0] ?? "";
}

async function readReports(): Promise<ICspReportsSnapshot> {
  const cookie = await loginAsAdmin();
  const res = await request("GET", READ, { cookie });
  expect(res.status, JSON.stringify(res.body)).to.equal(200);
  return res.body as ICspReportsSnapshot;
}

/** Un rapport `report-uri` dont la ressource bloquée est unique à ce run. */
function cspReport(marker: string): string {
  return JSON.stringify({
    "csp-report": {
      "document-uri": `https://127.0.0.1:5152/nodefony/test/index?token=${marker}#f`,
      "blocked-uri": `https://${marker}.example/x.js?k=v`,
      "effective-directive": "script-src-elem",
      "violated-directive": "script-src-elem",
      disposition: "enforce",
      "script-sample": `sample-${marker}`,
    },
  });
}

describe("Rapports de violation CSP — boucle live (ADR-0024 §C7)", () => {
  it("une page HTML demande ses rapports vers la route du framework", async () => {
    const res = await request("GET", "/nodefony/test/html");
    const csp = headerText(res.headers["content-security-policy"]);
    expect(csp).to.include(`report-uri ${CSP_REPORT_PATH}`);
    expect(csp).to.include("report-to nodefony-csp");
    expect(res.headers["reporting-endpoints"]).to.equal(
      `nodefony-csp="${CSP_REPORT_PATH}"`,
    );
  });

  it("application/csp-report : 204 no-store, lu expurgé par l'administrateur", async () => {
    const marker = `p${randomUUID().slice(0, 8)}`;
    const res = await request(
      "POST",
      CSP_REPORT_PATH,
      { "content-type": "application/csp-report", "user-agent": "banc-csp" },
      cspReport(marker),
    );
    expect(res.status).to.equal(204);
    expect(res.headers["cache-control"]).to.equal("no-store");
    const snap = await readReports();
    expect(snap.enabled).to.equal(true);
    const v = snap.items.find((i) => i.blockedURL?.includes(marker));
    expect(v, JSON.stringify(snap.items.slice(0, 3))).to.not.equal(undefined);
    expect(v?.blockedURL).to.equal(`https://${marker}.example/x.js`);
    expect(v?.documentURL).to.equal(
      "https://127.0.0.1:5152/nodefony/test/index",
    );
    expect(v?.userAgent).to.equal("banc-csp");
    expect(JSON.stringify(snap)).to.not.include(`sample-${marker}`);
    expect(JSON.stringify(snap)).to.not.include(`token=${marker}`);
  });

  it("application/reports+json, même posté cross-site : 204 (CSRF exemptée), gardé", async () => {
    const marker = `r${randomUUID().slice(0, 8)}`;
    const res = await request(
      "POST",
      CSP_REPORT_PATH,
      {
        "content-type": "application/reports+json",
        "sec-fetch-site": "cross-site",
      },
      [
        {
          type: "csp-violation",
          body: {
            documentURL: "https://127.0.0.1:5152/p",
            blockedURL: `https://${marker}.example/`,
            effectiveDirective: "img-src",
            disposition: "enforce",
          },
        },
      ],
    );
    expect(res.status).to.equal(204);
    const snap = await readReports();
    expect(snap.items.some((i) => i.blockedURL?.includes(marker))).to.equal(
      true,
    );
  });

  it("type de contenu étranger : 204 aussi, rien n'est gardé", async () => {
    const marker = `j${randomUUID().slice(0, 8)}`;
    const res = await request(
      "POST",
      CSP_REPORT_PATH,
      { "content-type": "application/json" },
      cspReport(marker),
    );
    expect(res.status).to.equal(204);
    const snap = await readReports();
    expect(snap.items.some((i) => i.blockedURL?.includes(marker))).to.equal(
      false,
    );
  });

  it("au-delà de 8 Ko : 413, annoncé ou en flux, rien n'est gardé", async () => {
    const marker = `b${randomUUID().slice(0, 8)}`;
    const big = cspReport(marker).replace(
      "enforce",
      `enforce${" ".repeat(9000)}`,
    );
    for (const chunked of [false, true]) {
      const res = await request(
        "POST",
        CSP_REPORT_PATH,
        { "content-type": "application/csp-report" },
        big,
        chunked,
      );
      expect(res.status, chunked ? "chunked" : "content-length").to.equal(413);
    }
    const snap = await readReports();
    expect(snap.items.some((i) => i.blockedURL?.includes(marker))).to.equal(
      false,
    );
  });

  it("la lecture reste réservée : un anonyme n'y lit rien", async () => {
    const res = await request("GET", READ);
    expect(res.status).to.not.equal(200);
    expect([401, 403]).to.include(res.status);
  });
});
