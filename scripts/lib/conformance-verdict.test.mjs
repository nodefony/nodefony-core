import { describe, expect, it } from "vitest";
import {
  judge,
  parseJUnit,
  parseKnownFailing,
} from "./conformance-verdict.mjs";

// Forme exacte du rapport d'h2spec v2.6.0 (`reporter/junit_report.go`) :
// cas vides en balise ouvrante + fermante, contenu d'échec brut.
const REPORT = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="5.1. Stream States" package="http2/5.1" id="5.1" tests="3" skipped="1" failures="1" errors="0">
    <testcase package="http2/5.1" classname="idle: Sends a DATA frame" time="0.0010"></testcase>
    <testcase package="http2/5.1" classname="closed: Sends a &#34;DATA&#34; frame &amp; more" time="0.5000">
      <failure>Expect:
GOAWAY Frame (Error Code: STREAM_CLOSED)
Actual:
Timeout</failure>
    </testcase>
    <testcase package="http2/5.1" classname="idle: Sends a PRIORITY frame" time="0.0000">
      <skipped></skipped>
    </testcase>
  </testsuite>
  <testsuite name="6.7. PING" package="http2/6.7" id="6.7" tests="1" skipped="0" failures="0" errors="1">
    <testcase package="http2/6.7" classname="Sends a PING frame with ACK" time="0.0000">
      <error>connection reset by peer</error>
    </testcase>
  </testsuite>
</testsuites>`;

describe("parseJUnit — suites ordonnées, statut par cas", () => {
  it("garde l'ordre des cas, décode les entités, lit les trois statuts", () => {
    const suites = parseJUnit(REPORT);
    expect(suites.map((s) => s.package)).toEqual(["http2/5.1", "http2/6.7"]);
    const [states] = suites;
    expect(states?.cases.map((c) => c.status)).toEqual([
      "passed",
      "failed",
      "skipped",
    ]);
    expect(states?.cases[1]?.name).toBe('closed: Sends a "DATA" frame & more');
    expect(states?.cases[1]?.detail).toMatch(/^Expect:\nGOAWAY.*\nTimeout$/s);
  });

  it("une <error> est un échec : un cas qui n'a pas conclu n'a pas réussi", () => {
    const ping = parseJUnit(REPORT)[1];
    expect(ping?.cases[0]).toEqual({
      name: "Sends a PING frame with ACK",
      status: "failed",
      detail: "connection reset by peer",
    });
  });

  it("un rapport sans suite est refusé, jamais lu comme zéro échec", () => {
    expect(() => parseJUnit("<testsuites></testsuites>")).toThrow(
      /aucune suite/,
    );
  });

  it("un cas hors de toute suite est refusé", () => {
    expect(() => parseJUnit('<testcase classname="x"></testcase>')).toThrow(
      /hors de toute suite/,
    );
  });
});

describe("parseKnownFailing — un connu porte son motif", () => {
  it("lit identifiant et motif, ignore vides et commentaires", () => {
    const known = parseKnownFailing(
      "# en-tête\n\nhttp2/5.1/8   # nghttp2 attend au lieu de STREAM_CLOSED\r\ntls:http2/6.1/2 # timing\n",
    );
    expect([...known]).toEqual([
      [
        "http2/5.1/8",
        {
          reason: "nghttp2 attend au lieu de STREAM_CLOSED",
          indeterminate: false,
        },
      ],
      ["tls:http2/6.1/2", { reason: "timing", indeterminate: false }],
    ]);
  });

  it("`~` en tête déclare un cas indéterminé, préfixe de transport compris", () => {
    const known = parseKnownFailing(
      "~http2/7/2 # deux issues conformes\n~ h2c:http2/6.1/2 # course\n",
    );
    expect([...known]).toEqual([
      ["http2/7/2", { reason: "deux issues conformes", indeterminate: true }],
      ["h2c:http2/6.1/2", { reason: "course", indeterminate: true }],
    ]);
  });

  it("un indéterminé sans motif est refusé comme un connu", () => {
    expect(() => parseKnownFailing("~http2/7/2\n")).toThrow(/sans motif/);
  });

  it("un identifiant sans motif est refusé", () => {
    expect(() => parseKnownFailing("http2/5.1/8\n")).toThrow(/sans motif/);
  });

  it("un identifiant déclaré deux fois est refusé", () => {
    expect(() => parseKnownFailing("a # x\na # y\n")).toThrow(/deux fois/);
  });
});

/** @param {string} id @param {"passed"|"failed"|"skipped"} status */
const result = (id, status) => ({ id, name: id, status, detail: "" });

describe("judge — trois façons d'échouer", () => {
  const known = new Map([["c/2", { reason: "connu", indeterminate: false }]]);

  it("seuls des échecs connus : verdict vert", () => {
    const v = judge(
      [
        result("c/1", "passed"),
        result("c/2", "failed"),
        result("c/3", "skipped"),
      ],
      known,
    );
    expect(v).toMatchObject({
      ok: true,
      total: 3,
      passed: 1,
      failed: 1,
      skipped: 1,
    });
    expect(v.expected.map((r) => r.id)).toEqual(["c/2"]);
  });

  it("un échec non déclaré fait échouer, nommé", () => {
    const v = judge([result("c/1", "failed"), result("c/2", "failed")], known);
    expect(v.ok).toBe(false);
    expect(v.unexpected.map((r) => r.id)).toEqual(["c/1"]);
  });

  it("un connu qui PASSE fait échouer : la liste mentirait", () => {
    const v = judge([result("c/1", "passed"), result("c/2", "passed")], known);
    expect(v.ok).toBe(false);
    expect(v.fixed).toEqual([{ id: "c/2", name: "c/2", reason: "connu" }]);
  });

  it("un connu sauté n'est ni réparé ni en faute", () => {
    const v = judge([result("c/2", "skipped")], known);
    expect(v).toMatchObject({ ok: true, fixed: [], unexpected: [] });
  });

  it("un connu absent d'une passe complète fait échouer ; d'une passe filtrée, non", () => {
    expect(judge([result("c/1", "passed")], known).missing).toEqual([
      { id: "c/2", reason: "connu" },
    ]);
    expect(judge([result("c/1", "passed")], known).ok).toBe(false);
    expect(judge([result("c/1", "passed")], known, { partial: true }).ok).toBe(
      true,
    );
  });

  it("une passe sans aucun cas n'est jamais verte", () => {
    expect(judge([], new Map()).ok).toBe(false);
  });
});

describe("judge — un indéterminé ne fait jamais basculer la passe", () => {
  const known = new Map([
    ["c/9", { reason: "deux issues conformes", indeterminate: true }],
  ]);

  it("son échec est toléré, et compté à part des connus", () => {
    const v = judge([result("c/1", "passed"), result("c/9", "failed")], known);
    expect(v).toMatchObject({ ok: true, expected: [], unexpected: [] });
    expect(v.tolerated.map((r) => r.id)).toEqual(["c/9"]);
  });

  it("son succès n'est pas une réparation à retirer de la liste", () => {
    const v = judge([result("c/9", "passed")], known);
    expect(v).toMatchObject({ ok: true, fixed: [] });
  });

  it("absent d'une passe complète, il reste en faute : son identifiant ne désigne plus rien", () => {
    const v = judge([result("c/1", "passed")], known);
    expect(v.ok).toBe(false);
    expect(v.missing).toEqual([{ id: "c/9", reason: "deux issues conformes" }]);
  });
});
