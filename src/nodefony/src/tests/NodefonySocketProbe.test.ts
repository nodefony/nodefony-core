import { expect } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import {
  isProbeRefusal,
  probeRefusalNotice,
  type NodefonyNotice,
} from "../client/realtime/notice";
import {
  TransportState,
  type IRealtimeTransport,
} from "../realtime/IRealtimeTransport";

/**
 * #596 — la SONDE d'un échec d'ouverture. Le navigateur cache le statut d'un
 * handshake refusé : le client ne voit qu'un `1006`, le même qu'un serveur
 * éteint. Avant de retenter, il demande au serveur ce que le handshake aurait
 * décidé — et seul ce verdict distingue « refusé, j'arrête » de « panne, je
 * réessaie ». Transport et sonde MOCKÉS : pas de réseau, pas de navigateur.
 */
class MockTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  private _onOpen: (() => void) | null = null;
  private _onMessage: ((raw: string) => void) | null = null;
  private _onClose: ((code: number, reason: string) => void) | null = null;
  connect(): void {}
  send(): void {}
  close(code?: number, reason?: string): void {
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code ?? 1000, reason ?? "");
  }
  onOpen(cb: () => void): void {
    this._onOpen = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this._onMessage = cb;
  }
  onClose(cb: (code: number, reason: string) => void): void {
    this._onClose = cb;
  }
  onError(): void {}
  fireOpen(): void {
    this.readyState = TransportState.OPEN;
    this._onOpen?.();
    this._onMessage?.(
      JSON.stringify({ jsonrpc: "2.0", method: "realtime:welcome" }),
    );
  }
  fireClose(code = 1006, reason = ""): void {
    this.readyState = TransportState.CLOSED;
    this._onClose?.(code, reason);
  }
}

const delay = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));
/**
 * Au-delà du plancher de reconnexion (100 ms) : une reconnexion attendue a eu
 * lieu, une reconnexion interdite aurait eu le temps de se produire.
 */
const SETTLED = 150;

/** Une sonde pilotée : répond ce qu'on lui dit, et retient ce qu'on lui a demandé. */
function probeOf(answer: number | null | Promise<number | null>) {
  const calls: { url: string; token: string | null }[] = [];
  const probe = async (url: string, token: string | null) => {
    calls.push({ url, token });
    return answer;
  };
  return { probe, calls };
}

function setup(opts: Record<string, unknown> = {}) {
  const transports: MockTransport[] = [];
  const notices: NodefonyNotice[] = [];
  const client = new NodefonySocket(
    {
      url: "ws://x/nodefony/api/realtime",
      reconnectDelay: 10,
      reconnectDelayMax: 10,
      ...opts,
    },
    () => {
      const t = new MockTransport();
      transports.push(t);
      return t;
    },
  );
  client.onNotice((n) => notices.push(n));
  return { client, transports, notices };
}

/** Une tentative fermée AVANT d'ouvrir ; `connect()` rejette, la suite se joue en fond. */
async function failedOpening(
  client: NodefonySocket,
  transports: MockTransport[],
  code = 1006,
): Promise<Error> {
  const p = client.connect();
  transports[0]!.fireClose(code);
  return (await p.then(
    () => null,
    (e: unknown) => e,
  )) as Error;
}

describe("NodefonySocket — sonde d'un échec d'ouverture (#596)", () => {
  it("refus 401 : connect() rejette, état error, notice, AUCUNE reconnexion", async () => {
    const { probe, calls } = probeOf(401);
    const { client, transports, notices } = setup({ probe });
    const err = await failedOpening(client, transports);
    expect(err.message).toContain("fermée avant ouverture (code 1006)");
    await delay(SETTLED);
    expect(calls).toEqual([
      { url: "http://x/nodefony/api/realtime", token: null },
    ]);
    expect(client.state).toBe("error");
    expect(notices.map((n) => n.code)).toEqual([401]);
    expect(transports.length, "pas de nouvelle tentative").toBe(1);
  });

  it("refus 404 (pas de route) : définitif lui aussi", async () => {
    const { probe } = probeOf(404);
    const { client, transports, notices } = setup({ probe });
    await failedOpening(client, transports);
    await delay(SETTLED);
    expect(client.state).toBe("error");
    expect(notices[0]?.message).toContain("introuvable");
    expect(transports.length).toBe(1);
  });

  it("426 « admis » : le serveur est là, la reconnexion suit", async () => {
    const { probe } = probeOf(426);
    const { client, transports } = setup({ probe });
    await failedOpening(client, transports);
    await delay(SETTLED);
    expect(transports.length, "nouvelle tentative").toBe(2);
    expect(client.state).toBe("reconnecting");
  });

  it("aucune réponse (serveur absent) : la reconnexion suit", async () => {
    const { probe } = probeOf(null);
    const { client, transports } = setup({ probe });
    await failedOpening(client, transports);
    await delay(SETTLED);
    expect(transports.length).toBe(2);
  });

  it("une sonde qui lève est une absence de réponse", async () => {
    const { client, transports } = setup({
      probe: async () => {
        throw new Error("réseau");
      },
    });
    await failedOpening(client, transports);
    await delay(SETTLED);
    expect(transports.length).toBe(2);
  });

  it("un code posé par le serveur (1011) est déjà un motif : pas de sonde", async () => {
    const { probe, calls } = probeOf(401);
    const { client, transports } = setup({ probe });
    await failedOpening(client, transports, 1011);
    await delay(SETTLED);
    expect(calls.length).toBe(0);
    expect(transports.length, "1011 = transitoire, on retente").toBe(2);
  });

  it("une socket qui S'ÉTAIT ouverte puis tombe (1006) : pas de sonde, reconnexion", async () => {
    const { probe, calls } = probeOf(401);
    const { client, transports } = setup({ probe });
    const p = client.connect();
    transports[0]!.fireOpen();
    await p;
    transports[0]!.fireClose(1006);
    await delay(SETTLED);
    expect(calls.length).toBe(0);
    expect(transports.length).toBe(2);
  });

  it("probe:false : tout échec d'ouverture redevient une panne à retenter", async () => {
    const { client, transports } = setup({ probe: false });
    await failedOpening(client, transports);
    await delay(SETTLED);
    expect(transports.length).toBe(2);
  });

  it("le jeton voyage à part : hors de l'adresse sondée, donné à la sonde", async () => {
    const { probe, calls } = probeOf(401);
    const { client, transports } = setup({ probe, token: "jeton-secret" });
    await failedOpening(client, transports);
    await delay(SETTLED);
    expect(calls[0]?.url).toBe("http://x/nodefony/api/realtime");
    expect(calls[0]?.token).toBe("jeton-secret");
  });

  it("disconnect() pendant la sonde : l'état reste disconnected, rien ne repart", async () => {
    let answer: (s: number | null) => void = () => {};
    const pending = new Promise<number | null>((r) => (answer = r));
    const { probe } = probeOf(pending);
    const { client, transports, notices } = setup({ probe });
    await failedOpening(client, transports);
    client.disconnect();
    answer(401);
    await delay(SETTLED);
    expect(client.state).toBe("disconnected");
    expect(notices.length).toBe(0);
    expect(transports.length).toBe(1);
  });

  it("connect() pendant la sonde (ex. après login) ouvre une tentative que le verdict d'avant ne juge pas", async () => {
    let answer: (s: number | null) => void = () => {};
    const pending = new Promise<number | null>((r) => (answer = r));
    const { probe } = probeOf(pending);
    const { client, transports } = setup({ probe });
    await failedOpening(client, transports);
    const p2 = client.connect();
    expect(transports.length, "connect() n'est pas court-circuité").toBe(2);
    answer(401);
    await delay(10);
    transports[1]!.fireOpen();
    await p2;
    expect(client.state).toBe("connected");
  });
});

describe("isProbeRefusal — ce qu'un statut de sonde dit de la suite", () => {
  it("refus définitifs : 400, 401, 403, 404, 413", () => {
    for (const s of [400, 401, 403, 404, 413])
      expect(isProbeRefusal(s), String(s)).toBe(true);
  });

  it("à retenter : 426 admis, 408/429 transitoires, 5xx panne, 2xx/3xx/0 autre réponse", () => {
    for (const s of [426, 408, 429, 500, 503, 200, 302, 0])
      expect(isProbeRefusal(s), String(s)).toBe(false);
  });

  it("la notice porte le statut et un message qui dit le geste", () => {
    expect(probeRefusalNotice(401)).toMatchObject({
      level: "error",
      source: "realtime",
      code: 401,
    });
    expect(probeRefusalNotice(401).message).toContain("connexion requise");
    expect(probeRefusalNotice(418).message).toContain("418");
  });
});
