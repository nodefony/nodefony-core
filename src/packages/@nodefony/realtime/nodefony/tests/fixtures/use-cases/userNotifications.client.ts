import { NodefonySocket } from "nodefony/client";
import type { IRealtimeContract } from "nodefony/client";

// La forme du message se déclare dans le contrat : `note` est typé à l'arrivée.
interface BillingContract extends IRealtimeContract {
  serverToClient: {
    [channel: `user:${string}`]: { kind: "invoice:paid"; invoice: string };
  };
}

const socket = NodefonySocket.fromContract<BillingContract>({
  url: "/api/live/realtime",
});

/** Rien à connaître ni à construire : l'identifiant vient de l'accueil de la socket. */
export const stopListening = socket.onUser((note) =>
  console.log(`facture ${note.invoice} payée`),
);
