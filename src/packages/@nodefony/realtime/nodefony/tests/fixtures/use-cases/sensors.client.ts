import { NodefonySocket } from "nodefony/client";

/** L'écran de supervision LIT (ROLE_SUPERVISOR) ; il ne peut rien pousser. */
export function watchDashboard(show: (reading: unknown) => void): () => void {
  const screen = NodefonySocket.shared({ url: "/api/live/realtime" });
  const off = screen.on("sensor:dashboard", show);
  screen.subscribe("sensor:dashboard");
  return off;
}

/** Une passerelle d'atelier (script Node) : jeton de portée `telemetry:write`, rien d'autre. */
export function openGateway(token: string): NodefonySocket {
  const gateway = new NodefonySocket({
    url: "https://supervision.example/api/live/realtime",
    token,
    maxBufferedAmount: 64 * 1024, // une mesure périmée se jette, elle ne s'empile pas
  });
  gateway.connect().catch(() => {}); // la reconnexion automatique prend le relais
  return gateway;
}

export function report(
  gateway: NodefonySocket,
  probe: string,
  value: number,
): void {
  gateway.emit("sensor:reading", { probe, value });
}
