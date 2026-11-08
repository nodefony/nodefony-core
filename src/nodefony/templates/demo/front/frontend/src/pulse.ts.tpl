import type { IRealtimeContract } from "nodefony/client";

/**
 * Le pouls de la démo : l'état VIVANT des cartes de l'accueil, poussé par le
 * serveur sur UN canal d'état (`demo:pulse`), au plus une fois par seconde.
 *
 * Contrat PARTAGÉ : `DemoRealtimeController` le sert, la page le consomme
 * (`NodefonySocket.fromContract<DemoContract>()`). Des TYPES seulement — le
 * fichier disparaît à la construction, le navigateur n'embarque aucun code du
 * serveur. Une carte sans état n'en montre pas : une démo qui veut un compteur
 * ajoute ICI son champ, et le compilateur montre les deux bouts à compléter.
 *
 * Les compteurs sont ceux de CE processus depuis son démarrage : derrière
 * plusieurs exemplaires, chaque page lit celui qui la sert.
 */
export interface IDemoPulse {
  /** API entre programmes : appels authentifiés reçus par `/demo/api/partner`. */
  partner: { calls: number };
  /** Chat : messages envoyés au salon. */
  chat: { messages: number };
}

/** Adresse de la socket de la démo (`DemoRealtimeController`). */
export const DEMO_REALTIME_PATH = "/demo/realtime";

/** Le canal d'état du pouls — seule la dernière valeur compte. */
export const DEMO_PULSE_CHANNEL = "demo:pulse";

/** Méthode qui rend le pouls courant : l'état initial d'une page qui arrive. */
export const DEMO_PULSE_NOW = "demo:pulse:now";

export interface DemoContract extends IRealtimeContract {
  serverToClient: { "demo:pulse": IDemoPulse };
  serverMethods: {
    "demo:pulse:now": { in: Record<string, never>; out: IDemoPulse };
  };
}
