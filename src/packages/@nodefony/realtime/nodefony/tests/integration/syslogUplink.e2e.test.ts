import { describe, it, expect, beforeEach, afterEach } from "vitest";
import "reflect-metadata";
import { RealtimeController } from "../../src/server/RealtimeController.js";
import { getRealtimeHub } from "../../src/server/RealtimeHub.js";
import { BROWSER_ORIGIN } from "../../src/server/syslogUplink.js";
import type { ContextType } from "@nodefony/http";
import type Pdu from "../../../../../../nodefony/src/syslog/Pdu.js";
// Les DEUX bords en SOURCE : le client isomorphe et son journal, tels qu'un
// navigateur les exécute.
import { RealtimeClient } from "../../../../../../nodefony/src/client/realtime/RealtimeClient.js";
import {
  TransportState,
  type IRealtimeTransport,
} from "../../../../../../nodefony/src/realtime/IRealtimeTransport.js";
import Syslog from "../../../../../../nodefony/src/syslog/Syslog.js";
import { installSyslogUplink } from "../../../../../../nodefony/src/client/syslog/uplink.js";
import {
  withRequestId,
  installRequestIdProvider,
  resetClientLogContext,
} from "../../../../../../nodefony/src/client/syslog/context.js";
import { installErrorCapture } from "../../../../../../nodefony/src/client/syslog/errors.js";
import { PLATFORM_INBOUND } from "../../../../../../nodefony/src/realtime/platformChannels.js";

/**
 * Pose un faux `window` et rend son retrait. Il DOIT passer par `afterEach` : une
 * assertion qui jette avant un retrait écrit à la main laisse un `window` sans
 * `location`, et le `RealtimeClient` des tests SUIVANTS meurt en le lisant —
 * l'échec se déplace alors sur des cas qui n'ont rien fait de mal.
 */
let restoreWindow: (() => void) | null = null;
function fakeWindow(): EventTarget {
  const g = globalThis as { window?: unknown };
  const had = "window" in g;
  const before = g.window;
  const target = new EventTarget();
  g.window = target;
  restoreWindow = () => {
    if (had) g.window = before;
    else delete g.window;
  };
  return target;
}

/**
 * BOUT-EN-BOUT du canal MONTANT des journaux (#35) — un vrai `Syslog` de
 * navigateur, un vrai `RealtimeClient`, un vrai `RealtimeController`, et le
 * journal du pod à l'arrivée.
 *
 * POURQUOI cette suite, alors que les deux bords sont déjà testés : parce qu'ils
 * l'étaient CHACUN FACE À SON IDÉE DE L'AUTRE. C'est exactement la configuration
 * qui a laissé passer le défaut de #127 — seize cas verts contre un serveur
 * imaginaire, dont un nommé « ré-abonnement automatique » qui prouvait l'inverse
 * de son titre. Ici rien n'est simulé au-dessus du transport : les frames sont
 * sérialisées en chaîne et délivrées en asynchrone, comme sur un réseau.
 */

const OPEN = 1;
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** Câble loopback : aiguille les frames STRING entre les deux pairs. */
class Wire {
  feedServer: ((raw: string | null) => void) | null = null;
  pumpClient: ((raw: string) => void) | null = null;
  closeClient: ((code: number, reason: string) => void) | null = null;
  serverConnOpen = true;
  deliverToClient(raw: string): void {
    queueMicrotask(() => this.pumpClient?.(raw));
  }
  deliverToServer(raw: string): void {
    queueMicrotask(() => this.feedServer?.(raw));
  }
}

class LoopbackTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  private _onOpen: (() => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  constructor(private readonly wire: Wire) {}
  connect(): void {
    this.readyState = TransportState.OPEN;
    queueMicrotask(() => {
      this._onOpen?.();
      this.wire.feedServer?.(null);
    });
  }
  send(raw: string): void {
    if (this.readyState !== TransportState.OPEN) return;
    this.wire.deliverToServer(raw);
  }
  close(code = 1000, reason = ""): void {
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code, reason);
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this.wire.pumpClient = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
    this.wire.closeClient = cb;
  }
  onError(): void {}
}

/**
 * Contrôleur nu : il ne déclare AUCUN canal entrant. Tout ce que ce banc observe
 * vient donc du câblage de la BASE — c'est lui qu'on éprouve, pas une déclaration
 * écrite pour le test.
 */
class UplinkRt extends RealtimeController {
  constructor(ctx: ContextType) {
    super("uplink-rt", ctx);
  }
  feed(raw: string | null): void {
    this.handleRealtime(raw);
  }
}

/** Monte le pair complet ; `serverSeen` reçoit les Pdu réinjectés dans le pod. */
async function connectPair(): Promise<{
  client: RealtimeClient;
  rt: UplinkRt;
  serverSeen: Pdu[];
}> {
  const wire = new Wire();
  const conn = {
    get readyState() {
      return wire.serverConnOpen ? OPEN : TransportState.CLOSED;
    },
    bufferedAmount: 0,
    send: (raw: string, cb?: (err?: Error) => void) => {
      wire.deliverToClient(raw);
      cb?.();
    },
    close: () => {
      wire.serverConnOpen = false;
    },
  };
  const ctx = {
    connection: conn,
    once: () => {},
    request: { headers: {}, url: "/realtime" },
    cookies: {},
    url: "/realtime",
    remoteAddress: "127.0.0.1",
    origin: "",
  };
  const rt = new UplinkRt(ctx as unknown as ContextType);
  const serverSeen: Pdu[] = [];
  // Le contrôleur journalise AUSSI sa propre vie (connexion, nettoyage) dans ce
  // même journal. On ne retient donc que ce qui porte l'origine navigateur — et
  // ce filtre est lui-même une assertion : ce qui n'a pas traversé le canal
  // n'apparaît pas ici.
  rt.syslog?.on("onLog", (pdu: Pdu) => {
    if (pdu.moduleName === BROWSER_ORIGIN) serverSeen.push(pdu);
  });
  wire.feedServer = (raw) => rt.feed(raw);
  const transport = new LoopbackTransport(wire);
  const client = new RealtimeClient(
    { url: "ws://loopback/realtime", autoReconnect: false },
    () => transport,
  );
  await client.connect();
  await flush();
  await flush();
  return { client, rt, serverSeen };
}

/** Bornes ouvertes, comme `RealtimeService.init()` le ferait depuis la config. */
function openUplink(): void {
  getRealtimeHub().setClientLogsLimits({
    maxEntriesPerBatch: 50,
    maxEntriesPerWindow: 300,
    windowMs: 10000,
    maxStringLength: 4096,
  });
}

describe("Journaux du navigateur — bout-en-bout, sur une vraie socket", () => {
  beforeEach(() => {
    getRealtimeHub().clear();
    getRealtimeHub().setClientLogsLimits(null);
    resetClientLogContext();
  });

  afterEach(() => {
    restoreWindow?.();
    restoreWindow = null;
  });

  it("une entrée journalisée dans la page arrive dans le journal du pod", async () => {
    openUplink();
    const { client, serverSeen } = await connectPair();
    const browser = new Syslog();
    const dispose = installSyslogUplink({
      syslog: browser,
      publisher: client,
      batchMs: 1,
    });

    browser.log("le panier a refusé la quantité", "ERROR");
    await new Promise((r) => setTimeout(r, 20));
    await flush();

    expect(serverSeen).toHaveLength(1);
    expect(serverSeen[0]!.payload).toBe("le panier a refusé la quantité");
    expect(serverSeen[0]!.severityName).toBe("ERROR");
    dispose();
  });

  it("le requestId SU dans la page se retrouve sur le Pdu du pod — la corrélation", async () => {
    openUplink();
    const { client, serverSeen } = await connectPair();
    const browser = new Syslog();
    const disposeProvider = installRequestIdProvider();
    const dispose = installSyslogUplink({
      syslog: browser,
      publisher: client,
      batchMs: 1,
    });

    // Ce que fait une page qui vient de lire `x-request-id` sur une réponse.
    withRequestId("req-du-serveur-42", () => {
      browser.log(new Error("rendu impossible"), "ERROR");
    });
    await new Promise((r) => setTimeout(r, 20));
    await flush();

    expect(serverSeen).toHaveLength(1);
    expect(serverSeen[0]!.requestId).toBe("req-du-serveur-42");
    // L'Error a traversé le fil sans se vider (JSON.stringify(new Error()) === "{}").
    expect((serverSeen[0]!.payload as { message: string }).message).toBe(
      "rendu impossible",
    );
    dispose();
    disposeProvider();
  });

  it("une exception NON RATTRAPÉE de la page fait tout le trajet", async () => {
    openUplink();
    const { client, serverSeen } = await connectPair();
    const browser = new Syslog();

    const win = fakeWindow();

    const disposeCapture = installErrorCapture({ syslog: browser });
    const dispose = installSyslogUplink({
      syslog: browser,
      publisher: client,
      batchMs: 1,
    });

    win.dispatchEvent(
      Object.assign(new Event("error"), {
        message: "x is not a function",
        filename: "https://app/main.js",
        lineno: 42,
        colno: 7,
        error: new TypeError("x is not a function"),
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    await flush();

    expect(serverSeen).toHaveLength(1);
    expect(serverSeen[0]!.msg).toBe("https://app/main.js:42:7");
    expect((serverSeen[0]!.payload as { name: string }).name).toBe("TypeError");

    disposeCapture();
    dispose();
  });

  it("l'ORIGINE est celle que le pod constate, pas celle que la page annonce", async () => {
    openUplink();
    const { client, serverSeen } = await connectPair();
    // On pousse la main : un lot forgé qui se prétend émis par le noyau.
    client.publish(PLATFORM_INBOUND.syslogUplink, {
      pageId: "01234567-89ab-cdef-0123-456789abcdef",
      entries: [
        {
          severity: 3,
          moduleName: "kernel",
          msgid: "BOOT",
          msg: "",
          timeStamp: Date.now(),
          payload: "je suis le noyau",
        },
      ],
    });
    await flush();
    await flush();

    expect(serverSeen).toHaveLength(1);
    expect(serverSeen[0]!.moduleName).toBe(BROWSER_ORIGIN);
  });

  it("🔴 PREUVE NÉGATIVE — interrupteur fermé, RIEN n'arrive", async () => {
    // Pas de `openUplink()` : la config n'a pas ouvert le canal.
    const { client, serverSeen } = await connectPair();
    const browser = new Syslog();
    const dispose = installSyslogUplink({
      syslog: browser,
      publisher: client,
      batchMs: 1,
    });

    browser.log("personne ne doit voir ça", "ERROR");
    await new Promise((r) => setTimeout(r, 20));
    await flush();

    expect(serverSeen).toHaveLength(0);
    dispose();
  });

  it("🔴 le canal fermé n'est pas « un handler qui refuse » — il n'EXISTE pas", async () => {
    const { client, rt } = await connectPair();
    // Le serveur n'annonce aucune capacité entrante, et la frame est droppée
    // comme n'importe quelle méthode inconnue : aucune erreur ne remonte.
    expect(() =>
      client.publish(PLATFORM_INBOUND.syslogUplink, {
        pageId: "x",
        entries: [],
      }),
    ).not.toThrow();
    await flush();
    expect(rt).toBeDefined();
  });
});
