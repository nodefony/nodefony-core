import { expect } from "chai";
import {
  NetworkModel,
  computeWaterfall,
  isError,
  phaseTier,
  type ProfilePhase,
} from "../client/debugbar/profile";
import type { NetEntry } from "../client/debugbar/network";

/** Fabrique une NetEntry minimale. */
function net(over: Partial<NetEntry> = {}): NetEntry {
  return {
    id: 1,
    method: "GET",
    url: "https://x/api/users?a=1",
    path: "/api/users",
    status: 200,
    ok: true,
    durationMs: 12,
    startedAt: 0,
    requestId: "req-1",
    traceparent: null,
    pending: false,
    error: null,
    ...over,
  };
}

describe("DebugBar Network — modèle (pur)", () => {
  it("isError : status ≥ 400 ou erreur réseau", () => {
    expect(isError(net({ status: 200 }))).to.equal(false);
    expect(isError(net({ status: 404 }))).to.equal(true);
    expect(isError(net({ status: 500 }))).to.equal(true);
    expect(isError(net({ status: null, error: "boom" }))).to.equal(true);
    expect(isError(net({ status: null, error: null }))).to.equal(false);
  });

  it("ingest : compte total + entries récent→ancien", () => {
    const m = new NetworkModel();
    m.ingest(net({ id: 1 }));
    m.ingest(net({ id: 2 }));
    expect(m.total).to.equal(2);
    const e = m.entries();
    expect(e[0]!.id).to.equal(2);
    expect(e[1]!.id).to.equal(1);
  });

  it("ingest : upsert même id (pending → résolu) ne double pas le total", () => {
    const m = new NetworkModel();
    m.ingest(net({ id: 7, pending: true, status: null }));
    m.ingest(net({ id: 7, pending: false, status: 200 }));
    expect(m.total).to.equal(1);
    expect(m.pending).to.equal(0);
  });

  it("ingest : bascule du compteur d'erreurs sur transition de statut", () => {
    const m = new NetworkModel();
    m.ingest(net({ id: 1, pending: true, status: null }));
    expect(m.errors).to.equal(0);
    m.ingest(net({ id: 1, pending: false, status: 500 }));
    expect(m.errors).to.equal(1);
  });

  it("cache de profils : set/get d'état", () => {
    const m = new NetworkModel();
    expect(m.profileState("a")).to.equal(undefined);
    m.setProfileState("a", { status: "loading" });
    expect(m.profileState("a")!.status).to.equal("loading");
  });

  it("clear : réinitialise tout", () => {
    const m = new NetworkModel();
    m.ingest(net({ id: 1, status: 500 }));
    m.setProfileState("req-1", { status: "missing" });
    m.clear();
    expect(m.total).to.equal(0);
    expect(m.errors).to.equal(0);
    expect(m.entries()).to.have.length(0);
    expect(m.profileState("req-1")).to.equal(undefined);
  });
});

describe("DebugBar Network — waterfall (pur)", () => {
  const phases: ProfilePhase[] = [
    { name: "resolve", startMs: 0, durationMs: 2 },
    { name: "action", startMs: 2, durationMs: 6 },
    { name: "send", startMs: 8, durationMs: 2 },
  ];

  it("positionne les barres proportionnellement au span", () => {
    const bars = computeWaterfall(phases);
    expect(bars).to.have.length(3);
    expect(bars[0]!.leftPct).to.equal(0);
    // action démarre à 2/10 = 20%, dure 6/10 = 60%
    expect(bars[1]!.leftPct).to.equal(20);
    expect(bars[1]!.widthPct).to.equal(60);
    expect(bars[2]!.leftPct).to.equal(80);
  });

  it("plancher de largeur pour une phase ~0ms (visibilité)", () => {
    const bars = computeWaterfall([
      { name: "resolve", startMs: 0, durationMs: 10 },
      { name: "send", startMs: 10, durationMs: 0 },
    ]);
    expect(bars[1]!.widthPct).to.be.greaterThan(0);
  });

  it("span nul → pas de division par zéro", () => {
    const bars = computeWaterfall([{ name: "x", startMs: 5, durationMs: 0 }]);
    expect(bars[0]!.leftPct).to.equal(0);
    expect(Number.isFinite(bars[0]!.widthPct)).to.equal(true);
  });

  it("liste vide → aucune barre", () => {
    expect(computeWaterfall([])).to.have.length(0);
  });

  it("phaseTier : phases canoniques + défaut", () => {
    expect(phaseTier("action")).to.equal("action");
    expect(phaseTier("initialize")).to.equal("init");
    expect(phaseTier("inconnue")).to.equal("other");
  });
});
