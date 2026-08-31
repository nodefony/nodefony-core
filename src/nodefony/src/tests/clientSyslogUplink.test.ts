import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import Syslog from "../syslog/Syslog";
import Pdu from "../syslog/Pdu";
import {
  installSyslogUplink,
  UPLINK_MSGID,
  type UplinkBatch,
} from "../client/syslog/uplink";
import {
  getPageId,
  withRequestId,
  getCurrentRequestId,
  installRequestIdProvider,
  resetClientLogContext,
} from "../client/syslog/context";
import {
  installErrorCapture,
  BROWSER_ERROR_MSGID,
  BROWSER_REJECTION_MSGID,
} from "../client/syslog/errors";
import { PLATFORM_INBOUND } from "../realtime/platformChannels";

/** Puits d'envoi : garde les lots au lieu de les pousser sur une socket. */
function recorder() {
  const sent: { channel: string; batch: UplinkBatch }[] = [];
  return {
    sent,
    publish(channel: string, payload?: unknown): void {
      sent.push({ channel, batch: payload as UplinkBatch });
    },
  };
}

describe("client/syslog — identités de corrélation", () => {
  afterEach(() => resetClientLogContext());

  it("le pageId est stable pour la durée du document", () => {
    const a = getPageId();
    expect(a).toMatch(/^[0-9a-f-]{36}$/);
    expect(getPageId()).toBe(a);
  });

  it("withRequestId ne vaut que dans sa portée, et restaure l'englobante", () => {
    expect(getCurrentRequestId()).toBeUndefined();
    withRequestId("rid-1", () => {
      expect(getCurrentRequestId()).toBe("rid-1");
      withRequestId("rid-2", () => expect(getCurrentRequestId()).toBe("rid-2"));
      expect(getCurrentRequestId()).toBe("rid-1");
    });
    expect(getCurrentRequestId()).toBeUndefined();
  });

  it("restaure la portée même si le travail JETTE", () => {
    expect(() =>
      withRequestId("rid-x", () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(getCurrentRequestId()).toBeUndefined();
  });

  it("un Pdu ne porte un requestId QUE dans une portée connue", () => {
    const dispose = installRequestIdProvider();
    const orphan = new Pdu("hors portée", "INFO");
    expect(orphan.requestId).toBeUndefined();
    const known = withRequestId("rid-42", () => new Pdu("dedans", "INFO"));
    expect(known.requestId).toBe("rid-42");
    dispose();
    // Retiré : on ne laisse pas un provider branché derrière soi.
    expect(Pdu.requestIdProvider).toBeNull();
  });
});

describe("client/syslog — transport montant", () => {
  let syslog: Syslog;

  beforeEach(() => {
    vi.useFakeTimers();
    syslog = new Syslog();
    resetClientLogContext();
  });
  afterEach(() => {
    vi.useRealTimers();
    resetClientLogContext();
  });

  it("regroupe N journaux en UN seul envoi, sur le canal de la table", () => {
    const pub = recorder();
    const dispose = installSyslogUplink({ syslog, publisher: pub });
    syslog.log("un", "ERROR");
    syslog.log("deux", "ERROR");
    syslog.log("trois", "ERROR");
    expect(pub.sent).toHaveLength(0); // rien n'est parti avant la fenêtre
    vi.advanceTimersByTime(2000);
    expect(pub.sent).toHaveLength(1);
    expect(pub.sent[0].channel).toBe(PLATFORM_INBOUND.syslogUplink);
    expect(pub.sent[0].batch.entries).toHaveLength(3);
    expect(pub.sent[0].batch.pageId).toBe(getPageId());
    dispose();
  });

  it("laisse tomber ce qui est moins grave que le seuil", () => {
    const pub = recorder();
    const dispose = installSyslogUplink({ syslog, publisher: pub });
    syslog.log("bavardage", "DEBUG");
    syslog.log("info", "INFO");
    syslog.log("avertissement", "WARNING");
    vi.advanceTimersByTime(2000);
    expect(pub.sent[0].batch.entries.map((e) => e.severityName)).toEqual([
      "WARNING",
    ]);
    dispose();
  });

  it("envoie SANS attendre quand le lot est plein", () => {
    const pub = recorder();
    const dispose = installSyslogUplink({
      syslog,
      publisher: pub,
      maxBatch: 2,
    });
    syslog.log("a", "ERROR");
    expect(pub.sent).toHaveLength(0);
    syslog.log("b", "ERROR");
    expect(pub.sent).toHaveLength(1); // parti sans que le minuteur ait couru
    expect(pub.sent[0].batch.entries).toHaveLength(2);
    dispose();
  });

  it("borne le tampon : perd la PLUS ANCIENNE et le DIT", () => {
    const pub = recorder();
    const dispose = installSyslogUplink({
      syslog,
      publisher: pub,
      maxQueue: 2,
      maxBatch: 99,
    });
    syslog.log("vieille", "ERROR");
    syslog.log("milieu", "ERROR");
    syslog.log("recente", "ERROR");
    vi.advanceTimersByTime(2000);
    const batch = pub.sent[0].batch;
    expect(batch.entries).toHaveLength(2);
    expect(batch.entries[0].payload).toBe("milieu");
    expect(batch.dropped).toBe(1);
    dispose();
  });

  it("aplatit une Error — sinon le pod reçoit un objet VIDE", () => {
    const pub = recorder();
    const dispose = installSyslogUplink({ syslog, publisher: pub });
    syslog.log(new Error("ça casse"), "ERROR");
    vi.advanceTimersByTime(2000);
    const payload = pub.sent[0].batch.entries[0].payload as {
      name: string;
      message: string;
      stack?: string;
    };
    expect(JSON.stringify(new Error("ça casse"))).toBe("{}"); // le piège, démontré
    expect(payload.message).toBe("ça casse");
    expect(payload.name).toBe("Error");
    expect(payload.stack).toContain("Error");
    dispose();
  });

  it("porte le requestId quand il est su, et rien quand il ne l'est pas", () => {
    const pub = recorder();
    const disposeProvider = installRequestIdProvider();
    const dispose = installSyslogUplink({ syslog, publisher: pub });
    withRequestId("rid-7", () => syslog.log("dedans", "ERROR"));
    syslog.log("dehors", "ERROR");
    vi.advanceTimersByTime(2000);
    const [a, b] = pub.sent[0].batch.entries;
    expect(a.requestId).toBe("rid-7");
    expect(b.requestId).toBeUndefined();
    dispose();
    disposeProvider();
  });

  it("ne fait pas remonter ce que le transport dit de LUI-MÊME (anti-boucle)", () => {
    const pub = recorder();
    const dispose = installSyslogUplink({ syslog, publisher: pub });
    syslog.log("envoi impossible", "ERROR", UPLINK_MSGID);
    syslog.log("vraie erreur", "ERROR");
    vi.advanceTimersByTime(2000);
    expect(pub.sent[0].batch.entries).toHaveLength(1);
    expect(pub.sent[0].batch.entries[0].payload).toBe("vraie erreur");
    dispose();
  });

  it("un envoi qui ÉCHOUE ne propage pas et ne réempile pas", () => {
    const dispose = installSyslogUplink({
      syslog,
      publisher: {
        publish(): void {
          throw new Error("socket fermée");
        },
      },
    });
    syslog.log("perdue", "ERROR");
    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    dispose();
  });

  it("le retrait détache le listener ET pousse ce qui restait", () => {
    const pub = recorder();
    const dispose = installSyslogUplink({ syslog, publisher: pub });
    syslog.log("dernier souffle", "ERROR");
    expect(syslog.listenerCount("onLog")).toBe(1);
    dispose();
    expect(syslog.listenerCount("onLog")).toBe(0);
    expect(pub.sent).toHaveLength(1);
    expect(pub.sent[0].batch.entries[0].payload).toBe("dernier souffle");
    // Plus rien ne remonte après le retrait.
    syslog.log("après", "ERROR");
    vi.advanceTimersByTime(5000);
    expect(pub.sent).toHaveLength(1);
  });

  it("ne coûte RIEN tant qu'il n'est pas installé", () => {
    expect(syslog.listenerCount("onLog")).toBe(0);
  });
});

describe("client/syslog — capture des erreurs du navigateur", () => {
  let syslog: Syslog;
  let seen: Pdu[];
  let restoreWindow: () => void;

  beforeEach(() => {
    syslog = new Syslog();
    seen = [];
    syslog.on("onLog", (pdu: Pdu) => seen.push(pdu));
    // Faux `window` : un EventTarget suffit, le code n'utilise que add/remove.
    const target = new EventTarget();
    const g = globalThis as { window?: unknown };
    const had = "window" in g;
    const before = g.window;
    g.window = target;
    restoreWindow = () => {
      if (had) g.window = before;
      else delete g.window;
    };
  });
  afterEach(() => restoreWindow());

  it("verse une exception non rattrapée dans le journal, avec son emplacement", () => {
    const dispose = installErrorCapture({ syslog });
    const err = new Error("plantage");
    (globalThis as { window: EventTarget }).window.dispatchEvent(
      Object.assign(new Event("error"), {
        message: "plantage",
        filename: "https://x/app.js",
        lineno: 12,
        colno: 3,
        error: err,
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].severityName).toBe("ERROR");
    expect(seen[0].msgid).toBe(BROWSER_ERROR_MSGID);
    expect(seen[0].msg).toBe("https://x/app.js:12:3");
    expect(seen[0].payload).toBe(err);
    dispose();
  });

  it("verse une promesse rejetée sans catch", () => {
    const dispose = installErrorCapture({ syslog });
    (globalThis as { window: EventTarget }).window.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), {
        reason: new Error("promesse morte"),
      }),
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].msgid).toBe(BROWSER_REJECTION_MSGID);
    dispose();
  });

  it("tait la MÊME erreur répétée dans la fenêtre — sinon elle noie le journal", () => {
    const dispose = installErrorCapture({ syslog, dedupeMs: 1000 });
    const fire = () =>
      (globalThis as { window: EventTarget }).window.dispatchEvent(
        Object.assign(new Event("error"), {
          message: "en boucle",
          filename: "a.js",
          lineno: 1,
          colno: 1,
          error: new Error("en boucle"),
        }),
      );
    fire();
    fire();
    fire();
    expect(seen).toHaveLength(1);
    dispose();
  });

  it("le retrait rend le window muet", () => {
    const dispose = installErrorCapture({ syslog });
    dispose();
    (globalThis as { window: EventTarget }).window.dispatchEvent(
      Object.assign(new Event("error"), {
        message: "après",
        filename: "a.js",
        lineno: 1,
        colno: 1,
        error: new Error("après"),
      }),
    );
    expect(seen).toHaveLength(0);
  });
});
