import { describe, it, expect, beforeEach, vi } from "vitest";
import { Syslog, Pdu } from "nodefony";
import {
  createSyslogUplinkHandler,
  BROWSER_ORIGIN,
  MAX_CLIENT_SEVERITY,
} from "../../src/server/syslogUplink";

const PAGE = "01234567-89ab-cdef-0123-456789abcdef";
const noReply = (): void => {};

/** Un journal neuf + le tableau de ce qu'il a accepté. */
function bench() {
  const syslog = new Syslog();
  const seen: Pdu[] = [];
  syslog.on("onLog", (pdu: Pdu) => seen.push(pdu));
  return { syslog, seen };
}

function entry(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    severity: 3,
    severityName: "ERROR",
    moduleName: "browser",
    msgid: "BROWSER_ERROR",
    msg: "",
    timeStamp: Date.now(),
    payload: "boum",
    ...over,
  };
}

describe("syslogUplink — borne 1 : l'origine est FORCÉE", () => {
  it("ignore le module que le client prétend être", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({ syslog });
    handler(
      { pageId: PAGE, entries: [entry({ moduleName: "kernel" })] },
      noReply,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]!.moduleName).toBe(BROWSER_ORIGIN);
    expect(seen[0]!.moduleName).not.toBe("kernel");
  });
});

describe("syslogUplink — borne 2 : taille et débit bornés", () => {
  it("ne retient que maxEntriesPerBatch entrées d'un lot", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({
      syslog,
      maxEntriesPerBatch: 2,
    });
    handler(
      { pageId: PAGE, entries: [entry(), entry(), entry(), entry()] },
      noReply,
    );
    expect(seen).toHaveLength(2);
  });

  it("cesse d'accepter au-delà de la fenêtre, puis repart à la suivante", () => {
    vi.useFakeTimers();
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({
      syslog,
      maxEntriesPerWindow: 3,
      windowMs: 1000,
      maxEntriesPerBatch: 99,
    });
    handler(
      { pageId: PAGE, entries: [entry(), entry(), entry(), entry(), entry()] },
      noReply,
    );
    expect(seen).toHaveLength(3);
    handler({ pageId: PAGE, entries: [entry()] }, noReply);
    expect(seen).toHaveLength(3); // toujours dans la fenêtre
    vi.advanceTimersByTime(1500);
    handler({ pageId: PAGE, entries: [entry()] }, noReply);
    expect(seen).toHaveLength(4); // fenêtre suivante
    vi.useRealTimers();
  });

  it("compte PAR CONNEXION — un onglet bavard n'en muselle pas un autre", () => {
    const { syslog, seen } = bench();
    const a = createSyslogUplinkHandler({ syslog, maxEntriesPerWindow: 1 });
    const b = createSyslogUplinkHandler({ syslog, maxEntriesPerWindow: 1 });
    a({ pageId: PAGE, entries: [entry(), entry()] }, noReply);
    b({ pageId: PAGE, entries: [entry()] }, noReply);
    expect(seen).toHaveLength(2); // 1 pour chacun, pas 1 en tout
  });

  it("tronque une chaîne trop longue — le client n'est pas cru sur parole", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({ syslog, maxStringLength: 10 });
    handler(
      { pageId: PAGE, entries: [entry({ msg: "x".repeat(500) })] },
      noReply,
    );
    expect(seen[0]!.msg).toHaveLength(10);
  });
});

describe("syslogUplink — borne 3 : la sévérité est plafonnée", () => {
  it("ramène EMERGENCY à ERROR — un onglet ne déclenche pas d'alerte", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({ syslog });
    handler({ pageId: PAGE, entries: [entry({ severity: 0 })] }, noReply);
    expect(seen[0]!.severity).toBe(MAX_CLIENT_SEVERITY);
    expect(seen[0]!.severityName).toBe("ERROR");
  });

  it("laisse passer les niveaux moins graves", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({ syslog });
    handler({ pageId: PAGE, entries: [entry({ severity: 6 })] }, noReply);
    expect(seen[0]!.severityName).toBe("INFO");
  });

  it("refuse une sévérité qui n'est pas un entier exploitable", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({ syslog });
    handler({ pageId: PAGE, entries: [entry({ severity: "grave" })] }, noReply);
    expect(seen[0]!.severity).toBe(MAX_CLIENT_SEVERITY);
  });
});

describe("syslogUplink — ce qui entre est NON FIABLE", () => {
  it("porte le requestId déclaré quand il a une forme d'identifiant", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({ syslog });
    handler(
      { pageId: PAGE, entries: [entry({ requestId: "req-abc-123" })] },
      noReply,
    );
    expect(seen[0]!.requestId).toBe("req-abc-123");
  });

  it("retombe sur le pageId si le requestId est malformé", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({ syslog });
    handler(
      {
        pageId: PAGE,
        entries: [entry({ requestId: "avec espace\net saut" })],
      },
      noReply,
    );
    expect(seen[0]!.requestId).toBe(PAGE);
  });

  it("jette un lot sans pageId exploitable", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({ syslog });
    handler({ entries: [entry()] }, noReply);
    handler({ pageId: 42, entries: [entry()] }, noReply);
    handler({ pageId: "", entries: [entry()] }, noReply);
    expect(seen).toHaveLength(0);
  });

  it("ne bronche pas sur une charge absurde", () => {
    const { syslog, seen } = bench();
    const handler = createSyslogUplinkHandler({ syslog });
    expect(() => {
      handler(null, noReply);
      handler("texte", noReply);
      handler({ pageId: PAGE }, noReply);
      handler({ pageId: PAGE, entries: [] }, noReply);
      handler({ pageId: PAGE, entries: [null, 7, "x"] }, noReply);
    }).not.toThrow();
    expect(seen).toHaveLength(0);
  });
});
