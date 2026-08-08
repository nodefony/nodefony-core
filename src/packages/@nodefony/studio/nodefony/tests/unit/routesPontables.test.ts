import { describe, it, expect } from "vitest";
import "reflect-metadata";
import { Router } from "@nodefony/framework";
import "../../controller/StudioController.js";

/**
 * Ce que ce test prouve : les routes que la console appelle PAR LE SOCKET
 * déclarent le transport qui les rend joignables.
 *
 * Le pont `api.request` rejoue une route sur la connexion temps réel, et le
 * routeur résout alors sur le transport de cette connexion — `WEBSOCKET`. Une
 * route qui ne le déclare pas est refusée (405, « Method WEBSOCKET
 * Unauthorized ») alors même qu'elle existe, qu'elle est correcte et qu'un
 * `curl` la sert parfaitement.
 *
 * Le défaut était réel et invisible depuis le serveur : l'écran demandait son
 * instantané des sondes de processus, recevait une erreur, et n'affichait rien
 * de plus — aucun journal, aucune trace HTTP, puisque la requête ne passait pas
 * par HTTP. Il a fallu piloter la socket depuis une vraie page pour le voir.
 *
 * Ce test ne remplace pas le contrôle des DROITS : le transport dit par où l'on
 * entre, jamais qui a le droit d'entrer. La garde `@IsGranted` reste évaluée par
 * le pont, et un compte sans le rôle reçoit 403 — vérifié contre un serveur réel.
 */
const PONTABLES = ["/nodefony/studio/api/stats"];

describe("routes de la console — joignables par le pont du socket", () => {
  for (const chemin of PONTABLES) {
    it(`${chemin} déclare GET ET WEBSOCKET`, () => {
      const route = Router.routes.find((r) => r.path === chemin);
      expect(route, `route ${chemin} introuvable`).toBeDefined();
      const methods = route?.requirements?.methods;
      const liste = Array.isArray(methods) ? methods : [methods];
      expect(liste, chemin).toContain("GET");
      expect(liste, chemin).toContain("WEBSOCKET");
    });
  }
});
