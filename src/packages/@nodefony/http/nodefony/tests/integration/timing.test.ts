/// <reference types="node" />
/**
 * P1.1 — Context.lifecycle: phase timing instrumentation.
 *
 * Validates that HttpKernel records canonical pipeline phases
 * (parse, resolve, action) on every Context, with monotonic
 * timestamps and non-negative durations.
 *
 * Live server: 127.0.0.1:5152 (HTTPS), route /nodefony/test/timing.
 */
import { expect } from "chai";
import https from "node:https";
import { IS_PROD_TARGET } from "../helpers/targetEnv";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };

type PhaseDto = {
  name: string;
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
};

function getTiming(
  path = "/nodefony/test/timing",
): Promise<{ status: number; phases: PhaseDto[] }> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
            phases: PhaseDto[];
          };
          resolve({ status: res.statusCode!, phases: body.phases });
        } catch (e) {
          reject(e);
        }
      });
    });
    r.on("error", reject);
    r.end();
  });
}

/** `x-request-id` de la réponse — la clé du profil côté serveur. */
function requestId(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, method: "GET", path }, (res) => {
      res.resume();
      res.on("end", () => {
        const id = res.headers["x-request-id"];
        if (typeof id === "string") resolve(id);
        else reject(new Error("pas de x-request-id"));
      });
    });
    r.on("error", reject);
    r.end();
  });
}

/** GET JSON authentifié (data plane `/nodefony/*` = zone admin). */
function getJson(
  path: string,
  cookie?: string,
): Promise<{
  status: number;
  headers: Record<string, unknown>;
  body: unknown;
}> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = cookie ? { cookie } : {};
    const r = https.request(
      { ...BASE, method: "GET", path, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const raw = Buffer.concat(chunks).toString();
          let body: unknown = raw;
          try {
            body = JSON.parse(raw);
          } catch {
            /* texte brut */
          }
          resolve({
            status: res.statusCode!,
            headers: res.headers as Record<string, unknown>,
            body,
          });
        });
      },
    );
    r.on("error", reject);
    r.end();
  });
}

/** Fixture dev : admin/secret (ROLE_NODEFONY_ADMIN) — cf provisionUsers. */
async function loginAsAdmin(): Promise<string> {
  const payload = JSON.stringify({ username: "admin", password: "secret" });
  const cookie = await new Promise<string>((resolve, reject) => {
    const r = https.request(
      {
        ...BASE,
        method: "POST",
        path: "/nodefony/security/api/auth/login",
        headers: {
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(payload)),
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => {
          const setCookie = res.headers["set-cookie"];
          const first = Array.isArray(setCookie) ? setCookie[0] : setCookie;
          if (typeof first !== "string") {
            reject(new Error(`login admin KO (status ${res.statusCode})`));
            return;
          }
          resolve(first.split(";")[0]!);
        });
      },
    );
    r.on("error", reject);
    r.write(payload);
    r.end();
  });
  return cookie;
}

// Dev-only : le profiler de phases est désactivé en production (perf) → la
// réponse ne porte pas de `phases`. Skip en prod (sonde /livez), tourne en dev.
describe.skipIf(IS_PROD_TARGET)(
  "P1.1 — Context.phases (pipeline timing)",
  () => {
    it("response includes phases array", async () => {
      const r = await getTiming();
      expect(r.status).to.equal(200);
      expect(r.phases).to.be.an("array");
      expect(r.phases.length).to.be.greaterThan(0);
    });

    it("at minimum 'parse', 'resolve' and 'action' phases are present", async () => {
      const r = await getTiming();
      const names = r.phases.map((p) => p.name);
      expect(names).to.include("parse");
      expect(names).to.include("resolve");
      expect(names).to.include("action");
    });

    it("phases appear in chronological order (startMs non-decreasing)", async () => {
      const r = await getTiming();
      for (let i = 1; i < r.phases.length; i++) {
        expect(r.phases[i].startMs).to.be.at.least(
          r.phases[i - 1].startMs,
          `phase[${i}].startMs (${r.phases[i].name}) must be >= phase[${i - 1}].startMs (${r.phases[i - 1].name})`,
        );
      }
    });

    it("closed phases have endMs >= startMs and durationMs >= 0", async () => {
      const r = await getTiming();
      for (const p of r.phases) {
        if (p.endMs !== null) {
          expect(p.endMs).to.be.at.least(
            p.startMs,
            `phase ${p.name}: endMs must be >= startMs`,
          );
          expect(p.durationMs).to.be.a("number");
          expect(p.durationMs!).to.be.at.least(
            0,
            `phase ${p.name}: durationMs must be >= 0`,
          );
        }
      }
    });

    it("'parse' and 'resolve' are closed (durationMs is a number)", async () => {
      const r = await getTiming();
      const parse = r.phases.find((p) => p.name === "parse")!;
      const resolveP = r.phases.find((p) => p.name === "resolve")!;
      expect(parse.durationMs).to.be.a("number");
      expect(resolveP.durationMs).to.be.a("number");
    });

    it("'action' is still open (endMs is null — controller runs inside it)", async () => {
      const r = await getTiming();
      const action = r.phases.find((p) => p.name === "action")!;
      expect(action).to.not.equal(undefined);
      expect(action.endMs).to.equal(null);
      expect(action.durationMs).to.equal(null);
    });

    it("two successive requests both produce independent phases", async () => {
      const r1 = await getTiming();
      const r2 = await getTiming();
      expect(r1.phases.length).to.equal(r2.phases.length);
      // start times are wall-clock, so r2 should be >= r1 (perf.now is monotonic per process)
      expect(r2.phases[0].startMs).to.be.at.least(r1.phases[0].startMs);
    });
  },
);

/**
 * Phases POST-ACTION (`initialize`, `send`) — invisibles depuis la réponse
 * elle-même : une réponse ne peut pas contenir le temps de son propre envoi. Le
 * Profiler, lui, collecte au TEARDOWN → c'est la seule vue complète (celle du
 * waterfall du Playground / de la page Trace).
 *
 * `initialize` = mise en place du controller (DI + hook `initialize()`),
 * `send` = `saveSession()` + `writeHead` + `write` (le poste où vit le coût du
 * store de session). Avant, le waterfall s'arrêtait à la fin de `action` : ces
 * deux temps-là n'étaient imputés à personne alors qu'ils sont bien réels.
 */
describe.skipIf(IS_PROD_TARGET)(
  "phases post-action (via le profiler — vue du teardown)",
  () => {
    async function profileOf(
      path: string,
      cookie: string,
    ): Promise<{ name: string; startMs: number; durationMs: number | null }[]> {
      const id = await requestId(path);
      // Course avec le teardown (le profil est collecté APRÈS la réponse).
      for (let i = 0; i < 10; i++) {
        const prof = await getJson(`/nodefony/profiler/api/${id}`, cookie);
        if (prof.status === 200) {
          const body = prof.body as {
            phases?: {
              name: string;
              startMs: number;
              durationMs: number | null;
            }[];
          };
          if (body.phases && body.phases.length > 0) return body.phases;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error(`profil introuvable pour ${id}`);
    }

    it("le profil porte 'initialize' et 'send', FERMÉES (le waterfall va jusqu'au fil)", async () => {
      const cookie = await loginAsAdmin();
      const phases = await profileOf("/nodefony/test/timing", cookie);
      const names = phases.map((p) => p.name);
      expect(names, `phases vues: ${names.join(", ")}`).to.include(
        "initialize",
      );
      expect(names, `phases vues: ${names.join(", ")}`).to.include("send");
      // Fermées = mesurées (une phase ouverte au teardown serait un bug d'appairage).
      for (const n of ["initialize", "action", "send"]) {
        const p = phases.find((x) => x.name === n)!;
        expect(p.durationMs, `${n}.durationMs`).to.be.a("number");
        expect(p.durationMs!).to.be.at.least(0);
      }
    });

    it("'send' démarre APRÈS 'action' (rendre ≠ écrire sur le fil)", async () => {
      const cookie = await loginAsAdmin();
      const phases = await profileOf("/nodefony/test/timing", cookie);
      const action = phases.find((p) => p.name === "action")!;
      const send = phases.find((p) => p.name === "send")!;
      expect(send.startMs).to.be.at.least(action.startMs);
    });

    it("route qui rend une VUE (Eta) → phase 'render' mesurée ; réponse JSON → pas de 'render'", async () => {
      const cookie = await loginAsAdmin();
      // `render` = le moteur de vue. Une route API (JSON) n'en a pas : son
      // `JSON.stringify` est du bruit devant un template, et l'inventer donnerait
      // une phase à 0 ms sur toutes les requêtes — du décor, pas de l'information.
      const view = await profileOf("/nodefony/test/route/ejs/claude", cookie);
      const render = view.find((p) => p.name === "render");
      expect(
        render,
        `phases vues: ${view.map((p) => p.name).join(", ")}`,
      ).to.not.equal(undefined);
      expect(render!.durationMs).to.be.a("number");

      const json = await profileOf("/nodefony/test/timing", cookie);
      expect(json.map((p) => p.name)).to.not.include("render");
    });
  },
);
