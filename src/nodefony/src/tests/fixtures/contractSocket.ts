/**
 * Banc d'une socket typée par un contrat, sur un transport factice : ce que les
 * tests des liaisons de vue passent EN TÊTE d'un hook (`useNodefonyChannelData(chat, …)`).
 *
 * Le transport rejoue ce que fait le serveur réel à l'ouverture : il enchaîne
 * `realtime:welcome`, sans quoi les abonnements posés avant ne seraient jamais
 * rejoués — un mock qui s'arrête à l'ouverture décrit un serveur qui n'existe pas.
 */
import { NodefonySocket } from "../../client/realtime/NodefonySocket";
import {
  TransportState,
  type IRealtimeTransport,
} from "../../realtime/IRealtimeTransport";
import type { IRealtimeContract } from "../../realtime/RealtimeEventMap";

/** Transport qui note ce que la socket envoie et pousse ce que le serveur diffuserait. */
export class ContractBenchTransport implements IRealtimeTransport {
  readyState: number = TransportState.CONNECTING;
  sent: string[] = [];
  private _open: (() => void) | null = null;
  private _msg: ((raw: string) => void) | null = null;
  connect(): void {}
  send(raw: string): void {
    this.sent.push(raw);
  }
  close(): void {
    this.readyState = TransportState.CLOSED;
  }
  onOpen(cb: () => void): void {
    this._open = cb;
  }
  onMessage(cb: (raw: string) => void): void {
    this._msg = cb;
  }
  onClose(): void {}
  onError(): void {}
  fireOpen(): void {
    this.readyState = TransportState.OPEN;
    this._open?.();
    this._msg?.(JSON.stringify({ jsonrpc: "2.0", method: "realtime:welcome" }));
  }
  /** Diffuse `payload` sur `channel`, comme le hub le ferait. */
  push(channel: string, payload: unknown): void {
    this._msg?.(
      JSON.stringify({ jsonrpc: "2.0", method: channel, params: payload }),
    );
  }
}

/** Le contrat des bancs : un canal de messages et un canal de présence. */
export interface BenchContract extends IRealtimeContract {
  serverToClient: {
    "chat:room": { from: string; text: string };
    "chat:presence": { present: string[] };
  };
}

/**
 * Socket typée par {@link BenchContract}, CONNECTÉE, et son transport.
 *
 * @returns la socket et le transport qui pousse les messages du serveur.
 */
export async function connectedContractSocket(): Promise<{
  socket: ReturnType<typeof NodefonySocket.fromContract<BenchContract>>;
  transport: ContractBenchTransport;
}> {
  const transport = new ContractBenchTransport();
  const socket = NodefonySocket.fromContract<BenchContract>(
    { url: "ws://loopback/realtime" },
    () => transport,
  );
  const opening = socket.connect();
  transport.fireOpen();
  await opening;
  return { socket, transport };
}

/**
 * Socket NON paramétrée, CONNECTÉE — celle qu'accepte le Provider d'une page.
 *
 * @returns la socket et le transport qui pousse les messages du serveur.
 */
export async function connectedPlainSocket(): Promise<{
  socket: NodefonySocket;
  transport: ContractBenchTransport;
}> {
  const transport = new ContractBenchTransport();
  const socket = new NodefonySocket(
    { url: "ws://loopback/realtime" },
    () => transport,
  );
  const opening = socket.connect();
  transport.fireOpen();
  await opening;
  return { socket, transport };
}
