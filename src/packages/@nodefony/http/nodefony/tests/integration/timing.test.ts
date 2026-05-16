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
import "mocha";

const BASE = { hostname: "127.0.0.1", port: 5152, rejectUnauthorized: false };

type PhaseDto = {
  name: string;
  startMs: number;
  endMs: number | null;
  durationMs: number | null;
};

function getTiming(path = "/nodefony/test/timing"): Promise<{ status: number; phases: PhaseDto[] }> {
  return new Promise((resolve, reject) => {
    const r = https.request({ ...BASE, method: "GET", path }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as { phases: PhaseDto[] };
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

describe("P1.1 — Context.phases (pipeline timing)", () => {
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
        expect(p.endMs).to.be.at.least(p.startMs, `phase ${p.name}: endMs must be >= startMs`);
        expect(p.durationMs).to.be.a("number");
        expect(p.durationMs!).to.be.at.least(0, `phase ${p.name}: durationMs must be >= 0`);
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
});
