import { expect } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import {
  TransportState,
  type IRealtimeTransport,
  type RealtimeFrameData,
  type RealtimeOutboundData,
} from "../realtime/IRealtimeTransport";

/**
 * Deux défauts du client vus par la démo « Temps réel binaire » :
 *
 * 1. Un navigateur signale la fermeture d'une WebSocket APRÈS `close()`. Un
 *    `disconnect()` suivi d'un `connect()` immédiat — ce que fait le double
 *    montage de React en développement — voyait la fermeture tardive de
 *    l'ANCIEN transport effacer le NOUVEAU : socket « connected », mais muette.
 * 2. Une requête en vol sur une connexion que le serveur ferme (1009, 1006…)
 *    attendait son délai (30 s) alors que sa réponse ne pouvait plus venir :
 *    les identifiants JSON-RPC vivent par connexion, et rien ne se rejoue.
 *
 * Le transport simulé ici ferme EN DIFFÉRÉ, comme un vrai navigateur.
 */
class LateCloseTransport implements IRealtimeTransport {
  sent: string[] = [];
  readyState: number = TransportState.CONNECTING;
  closeRequested = false;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: RealtimeFrameData) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;

  connect(): void {}
  send(raw: RealtimeOutboundData): void {
    if (typeof raw === "string") this.sent.push(raw);
  }
  /** Comme un navigateur : la fermeture sera signalée plus tard (`fireClose`). */
  close(): void {
    this.closeRequested = true;
    this.readyState = TransportState.CLOSING;
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: RealtimeFrameData) => void): void {
    this._onMessage = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
  }
  onError(): void {}
  /** Ouverture, puis l'accueil du serveur. */
  fireOpen(): void {
    this.readyState = TransportState.OPEN;
    this._onOpen?.();
    this._onMessage?.(
      JSON.stringify({ jsonrpc: "2.0", method: "realtime:welcome" }),
    );
  }
  fireClose(code = 1000, reason = ""): void {
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code, reason);
  }
}

function setup(opts: Record<string, unknown> = {}) {
  const transports: LateCloseTransport[] = [];
  const client = new NodefonySocket(
    { url: "ws://x/api/realtime", banner: false, ...opts },
    () => {
      const t = new LateCloseTransport();
      transports.push(t);
      return t;
    },
  );
  return { client, transports };
}

/** La promesse se règle-t-elle avant `ms` ? */
function settlesWithin(promise: Promise<unknown>, ms: number) {
  return Promise.race([
    promise.then(
      () => "résolue",
      (error: unknown) =>
        `rejetée : ${error instanceof Error ? error.message : String(error)}`,
    ),
    new Promise<string>((resolve) =>
      setTimeout(() => resolve("en attente"), ms),
    ),
  ]);
}

describe("NodefonySocket — un transport remplacé ne touche plus à la socket", () => {
  it("la fermeture TARDIVE de l'ancien transport n'efface pas le nouveau : la socket parle encore", async () => {
    const { client, transports } = setup({ autoReconnect: false });
    const first = client.connect();
    transports[0]?.fireOpen();
    await first;
    // Double montage : on se déconnecte et on se reconnecte AVANT que le
    // navigateur n'ait signalé la fermeture du premier transport.
    client.disconnect();
    expect(transports[0]?.closeRequested).toBe(true);
    const second = client.connect();
    transports[1]?.fireOpen();
    await second;
    transports[0]?.fireClose(1000, "client disconnect");

    expect(client.state).toBe("connected");
    const request = client.request("demo:echo", {}, 200);
    expect(
      transports[1]?.sent.some((frame) => frame.includes("demo:echo")),
    ).toBe(true);
    // Pas de « RPC non émis (transport indisponible) » : la trame est partie.
    expect(await settlesWithin(request, 20)).toBe("en attente");
    client.disconnect();
    transports[1]?.fireClose(1000);
  });

  it("l'ouverture TARDIVE d'un transport déjà remplacé ne se fait pas passer pour la connexion", async () => {
    const { client, transports } = setup({ autoReconnect: false });
    const first = client.connect();
    client.disconnect();
    const second = client.connect();
    // Le premier s'ouvre APRÈS avoir été remplacé : il est refermé, sans effet.
    transports[0]?.fireOpen();
    await first.catch(() => {});
    expect(transports[0]?.closeRequested).toBe(true);
    expect(client.state).toBe("connecting");
    transports[1]?.fireOpen();
    await second;
    expect(client.state).toBe("connected");
    client.disconnect();
  });
});

describe("NodefonySocket — une requête en vol meurt avec sa connexion", () => {
  it("le serveur ferme en 1009 : la requête rejette TOUT DE SUITE, le code dans le message", async () => {
    const { client, transports } = setup({ autoReconnect: false });
    const opened = client.connect();
    transports[0]?.fireOpen();
    await opened;
    const request = client.request("demo:digest", {}, 30_000);
    transports[0]?.fireClose(1009, "Max payload size exceeded");
    const outcome = await settlesWithin(request, 50);
    expect(outcome).toMatch(/^rejetée : .*1009/u);
    expect(outcome).toContain("Max payload size exceeded");
  });

  it("coupure réseau avec reconnexion : la requête en vol rejette aussi, la nouvelle connexion ne lui répondra pas", async () => {
    const { client, transports } = setup({
      reconnectDelay: 1,
      reconnectDelayMax: 4,
    });
    const opened = client.connect();
    transports[0]?.fireOpen();
    await opened;
    const request = client.request("demo:digest", {}, 30_000);
    transports[0]?.fireClose(1006);
    expect(await settlesWithin(request, 50)).toMatch(/^rejetée : .*1006/u);
    client.disconnect();
  });
});
