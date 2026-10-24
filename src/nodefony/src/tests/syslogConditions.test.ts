/**
 * Conditions de filtrage du journal, compilées en un prédicat : ce que la
 * forme typée a corrigé en chemin.
 */
import { describe, it, expect } from "vitest";
import Syslog, { type conditionsInterface } from "../syslog/Syslog";
import type Pdu from "../syslog/Pdu";

function journal(): Syslog {
  const syslog = new Syslog({ moduleName: "cond-test" });
  syslog.log("urgence", "EMERGENCY", "A");
  syslog.log("erreur", "ERROR", "B");
  syslog.log("info", "INFO", "A");
  syslog.log("bavard", "DEBUG", "C");
  return syslog;
}

const payloads = (pdus: Pdu[]): unknown[] => pdus.map((pdu) => pdu.payload);

describe("Syslog — conditions compilées", () => {
  it("un même objet de conditions resert : il n'est plus muté", () => {
    const syslog = journal();
    const conditions: conditionsInterface = {
      severity: { operator: "<=", data: "ERROR" },
      msgid: { data: "A,B" },
    };
    const snapshot = structuredClone(conditions);
    const first = syslog.getLogs(conditions);
    const second = syslog.getLogs(conditions);
    expect(payloads(first)).toEqual(["urgence", "erreur"]);
    expect(payloads(second)).toEqual(payloads(first));
    expect(conditions).toEqual(snapshot);
  });

  it("une sévérité 0 désigne EMERGENCY, elle n'est plus écartée", () => {
    const syslog = journal();
    const logs = syslog.getLogs({ severity: { operator: "==", data: 0 } });
    expect(payloads(logs)).toEqual(["urgence"]);
  });

  it("la logique || retient la ligne qui satisfait l'une des clés", () => {
    const syslog = journal();
    const logs = syslog.getLogs({
      checkConditions: "||",
      severity: { data: "EMERGENCY" },
      msgid: { data: "C" },
    });
    expect(payloads(logs)).toEqual(["urgence", "bavard"]);
  });

  it("une clé inconnue ne retient rien, un opérateur inconnu lève", () => {
    const syslog = journal();
    expect(syslog.getLogs({ inconnue: { data: 1 } })).toEqual([]);
    // Un appelant JavaScript : la valeur arrive d'ailleurs, le type ne la filtre pas.
    const fromJs: conditionsInterface = JSON.parse(
      '{"severity":{"operator":"toString","data":3}}',
    );
    expect(() => syslog.getLogs(fromJs)).toThrow(
      "Contitions bad operator : toString",
    );
  });

  it("l'opérateur RegExp face à une chaîne ne lève plus à chaque ligne", () => {
    const syslog = journal();
    expect(
      syslog.getLogs({ msgid: { operator: "RegExp", data: "A" } }),
    ).toEqual([]);
  });

  it("des conditions qui ne retiennent rien n'ajoutent aucun écouteur", () => {
    const syslog = new Syslog({ moduleName: "cond-test" });
    const before = syslog.listenerCount("onLog");
    syslog.listenWithConditions({ inconnue: { data: 1 } }, () => {});
    expect(syslog.listenerCount("onLog")).toBe(before);
    const seen: unknown[] = [];
    syslog.listenWithConditions({ severity: { data: "ERROR" } }, (pdu) =>
      seen.push(pdu.payload),
    );
    expect(syslog.listenerCount("onLog")).toBe(before + 1);
    syslog.log("pas retenue", "INFO");
    syslog.log("retenue", "ERROR");
    expect(seen).toEqual(["retenue"]);
  });

  it("une pile relue refuse une sévérité hors échelle avec le message du Pdu", () => {
    const syslog = new Syslog({ moduleName: "cond-test" });
    expect(() =>
      syslog.loadStack(JSON.stringify([{ payload: "x", severity: 99 }])),
    ).toThrow("Not a valid nodefony syslog severity: 99");
    const loaded = syslog.loadStack(JSON.stringify([{ payload: "y" }]));
    expect(loaded).toHaveLength(1);
  });
});
