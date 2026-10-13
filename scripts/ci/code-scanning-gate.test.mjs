/**
 * Gate — l'analyse de code rougit tant qu'une alerte reste ouverte.
 *
 * Ce que la suite prouve : le verdict ne dépend QUE des alertes ouvertes, les
 * plus graves sont nommées en tête, et une liste vide (ou absente) est le seul
 * vert. La partie réseau (`gh api`) est hors de cette preuve.
 */
import { describe, expect, it } from "vitest";
import { verdictAlertes } from "./code-scanning-gate.mjs";

const alerte = (number, gravite, state = "open") => ({
  number,
  state,
  rule: { id: "js/file-system-race", security_severity_level: gravite },
  most_recent_instance: { location: { path: "src/a.ts", start_line: 12 } },
});

describe("code-scanning-gate — verdict sur les alertes ouvertes", () => {
  it("aucune alerte → vert", () => {
    expect(verdictAlertes([]).verdict).toBe("vert");
    expect(verdictAlertes(undefined).verdict).toBe("vert");
  });

  it("🔴 une seule alerte ouverte, même moyenne, suffit à rougir", () => {
    const v = verdictAlertes([alerte(7, "medium")]);
    expect(v.verdict).toBe("rouge");
    expect(v.lignes).toEqual(["#7 medium js/file-system-race — src/a.ts:12"]);
  });

  it("une alerte fermée ou écartée ne compte pas", () => {
    expect(
      verdictAlertes([
        alerte(1, "high", "dismissed"),
        alerte(2, "high", "fixed"),
      ]).verdict,
    ).toBe("vert");
  });

  it("les plus graves sont nommées en tête", () => {
    const v = verdictAlertes([
      alerte(1, "medium"),
      alerte(2, "critical"),
      alerte(3, "high"),
    ]);
    expect(v.lignes.map((l) => l.split(" ")[0])).toEqual(["#2", "#3", "#1"]);
  });
});
