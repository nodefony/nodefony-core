import { expect } from "chai";
import "mocha";
import {
  formatBytes,
  formatUptime,
  gauge,
  stripAnsi,
  sparklinePoints,
} from "../client/debugbar/format";
import { DebugBarModel } from "../client/debugbar/model";

describe("DebugBar — format helpers (purs)", () => {
  it("formatBytes : unités base 1024", () => {
    expect(formatBytes(0)).to.equal("0 B");
    expect(formatBytes(512)).to.equal("512 B");
    expect(formatBytes(1024)).to.equal("1.0 KB");
    expect(formatBytes(1536)).to.equal("1.5 KB");
    expect(formatBytes(1024 * 1024)).to.equal("1.0 MB");
    expect(formatBytes(-5)).to.equal("0 B");
    expect(formatBytes(Number.NaN)).to.equal("0 B");
  });

  it("formatUptime : h/m/s compact", () => {
    expect(formatUptime(0)).to.equal("0s");
    expect(formatUptime(45)).to.equal("45s");
    expect(formatUptime(72)).to.equal("1m 12s");
    expect(formatUptime(3700)).to.equal("1h 01m");
    expect(formatUptime(-1)).to.equal("0s");
  });

  it("gauge : paliers ok/warn/crit", () => {
    expect(gauge(10)).to.equal("ok");
    expect(gauge(75)).to.equal("warn");
    expect(gauge(95)).to.equal("crit");
    expect(gauge(60, 50, 200)).to.equal("warn");
    expect(gauge(Number.NaN)).to.equal("ok");
  });

  it("stripAnsi : retire les séquences couleur", () => {
    expect(stripAnsi("[31mERROR[39m boom")).to.equal("ERROR boom");
    expect(stripAnsi("plain")).to.equal("plain");
  });

  it("sparklinePoints : map les valeurs sur le viewBox", () => {
    expect(sparklinePoints([], 40, 16)).to.equal("");
    expect(sparklinePoints([5], 40, 16)).to.equal(""); // < 2 points
    // 2 points sur 100% : bas (0) → haut (max)
    const pts = sparklinePoints([0, 100], 100, 50, 100);
    expect(pts).to.equal("0,50 100,0");
  });
});

describe("DebugBar — DebugBarModel (pur)", () => {
  it("vue par défaut : valeurs neutres", () => {
    const v = new DebugBarModel().view;
    expect(v.state).to.equal("disconnected");
    expect(v.cpuPercent).to.equal(0);
    expect(v.heapPercent).to.equal(0);
    expect(v.logTotal).to.equal(0);
    expect(v.feed).to.have.length(0);
  });

  it("ingestStats : alimente vue + séries + peaks + heapPercent", () => {
    const m = new DebugBarModel();
    m.ingestStats({
      ts: 1,
      cpuPercent: 40,
      eventLoopMs: 3,
      uptime: 10,
      pid: 99,
      cpuCount: 8,
      instanceId: "w1",
      memory: { heapUsed: 50, heapLimit: 100, rss: 200 },
    });
    m.ingestStats({
      ts: 2,
      cpuPercent: 20,
      pid: 99,
      instanceId: "w1",
      memory: { heapUsed: 80, heapLimit: 100 },
    });
    const v = m.view;
    expect(v.cpuPercent).to.equal(20); // dernier tick
    expect(v.cpuPeak).to.equal(40); // peak conservé
    expect(v.heapPercent).to.equal(80);
    expect(v.heapPeak).to.equal(80);
    expect(v.cpuSeries).to.deep.equal([40, 20]);
    expect(v.heapSeries).to.deep.equal([50, 80]);
    expect(v.pid).to.equal(99);
    expect(v.instanceId).to.equal("w1");
  });

  it("ingestSyslog : réhydrate en Pdu, compte par sévérité + dropped + feed", () => {
    const m = new DebugBarModel();
    m.ingestSyslog({
      logs: [
        { severity: 3, payload: "boom", moduleName: "auth" },
        { severity: 4, payload: "warn" },
        { severity: 6, payload: "info" },
        { severity: 0, payload: "dead" },
      ],
      dropped: 7,
    });
    const v = m.view;
    expect(v.logTotal).to.equal(4);
    expect(v.errorCount).to.equal(2); // sev 3 + sev 0
    expect(v.warnCount).to.equal(1);
    expect(v.dropped).to.equal(7);
    expect(v.feed).to.have.length(4);
    // severityName + module dérivés du Pdu réhydraté (canonique, pas du wire).
    expect(v.feed[0]?.text).to.equal("boom");
    expect(v.feed[0]?.name).to.equal("ERROR");
    expect(v.feed[0]?.module).to.equal("auth");
  });

  it("ingestSyslog : sévérité hors RFC 5424 ignorée (Pdu throw)", () => {
    const m = new DebugBarModel();
    m.ingestSyslog({ logs: [{ severity: 99, payload: "x" }, { severity: 6, payload: "ok" }] });
    expect(m.view.logTotal).to.equal(1);
    expect(m.view.feed[0]?.text).to.equal("ok");
  });

  it("ingestSyslog : cumule dropped + ignore les sévérités non numériques", () => {
    const m = new DebugBarModel();
    m.ingestSyslog({ logs: [{}, { severity: 3 }], dropped: 2 });
    m.ingestSyslog({ dropped: 3 });
    const v = m.view;
    expect(v.logTotal).to.equal(1);
    expect(v.errorCount).to.equal(1);
    expect(v.dropped).to.equal(5);
  });

  it("ingestSyslog : strip ANSI dans le texte du feed", () => {
    const m = new DebugBarModel();
    m.ingestSyslog({ logs: [{ severity: 6, payload: "[32mok[39m" }] });
    expect(m.view.feed[0]?.text).to.equal("ok");
  });

  it("setState : reflété dans la vue", () => {
    const m = new DebugBarModel();
    m.setState("connected");
    expect(m.view.state).to.equal("connected");
  });
});
