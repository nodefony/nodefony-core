/// <reference types="node" />
import { expect } from "chai";
import {
  isPortInUseMessage,
  startupTimeoutMessage,
} from "../../service/ViteProcessSupervisor";

/**
 * Détection du conflit de port Vite.
 *
 * Ce banc existe à cause d'un bug vécu : lancer une 2ᵉ app Nodefony faisait mourir
 * TOUT son frontend. Le superviseur savait pourtant retenter sur `port + 1` — mais
 * il ne reconnaissait pas le message. Il cherchait « Port X **is in use** » là où
 * Vite écrit « Port X is **already** in use ». Une regex à un mot près, et la
 * résilience entière était morte.
 *
 * La leçon est verrouillée ici : les formulations RÉELLES observées, plus les
 * variantes plausibles.
 */
describe("Vite — reconnaître un port occupé", () => {
  it("la formulation RÉELLE de Vite (celle qui a cassé la 2ᵉ app)", () => {
    // Copiée telle quelle des logs : c'est le cas qui échouait.
    expect(
      isPortInUseMessage(
        "[vite] Error: Port 5173 is already in use\n    at httpServerStart",
      ),
    ).to.equal(true);
  });

  /**
   * 🔴 Les DEUX textes que vite écrit sans échouer. Ce banc affirmait le
   * contraire du premier (« formulation SANS `already`, versions antérieures »)
   * — une supposition, jamais confrontée au source. Elle est fausse : les trois
   * textes coexistent dans la MÊME version, et `already` est le seul
   * discriminant. Relu dans `httpServerStart` (vite 8.3.0,
   * `node_modules/vite/dist/node/chunks/node.js`) : `throw` pour « already »,
   * `logger.info`/`logger.warn` pour les deux autres — dont le second est émis
   * sur un `listen` RÉUSSI.
   *
   * Les confondre ne coûte rien sur un poste (vite meurt vite), et coûte quatre
   * échéances de démarrage sur un agent partagé et lent : le texte survit dans
   * le tampon, `startupTimeoutMessage` le relit à l'échéance, et le superviseur
   * replie sur un démarrage qui n'avait aucun conflit.
   */
  it("« trying another one » n'est PAS un conflit : vite se décale tout seul", () => {
    expect(
      isPortInUseMessage("Port 5173 is in use, trying another one..."),
    ).to.equal(false);
  });

  it("« on a wildcard address » n'est PAS un conflit : vite a RÉUSSI son listen", () => {
    expect(
      isPortInUseMessage(
        "Port 5173 is in use on a wildcard address, but localhost:5173 is " +
          "available. There may be another server running on a wildcard IP on port 5173.",
      ),
    ).to.equal(false);
  });

  it("le code système brut", () => {
    expect(
      isPortInUseMessage("listen EADDRINUSE: address already in use"),
    ).to.equal(true);
  });

  it("« address already in use » seul", () => {
    expect(isPortInUseMessage("Error: address already in use")).to.equal(true);
  });

  it("insensible à la casse et au bruit autour", () => {
    expect(isPortInUseMessage("  PORT 8080 IS ALREADY IN USE  ")).to.equal(
      true,
    );
  });

  it("une erreur SANS rapport ne déclenche pas de retry de port", () => {
    // Sinon on masquerait une vraie panne (config invalide, plugin manquant) en
    // la retentant sur un autre port — l'échec deviendrait incompréhensible.
    expect(isPortInUseMessage("Failed to resolve import './App'")).to.equal(
      false,
    );
    expect(isPortInUseMessage("vite exited (code=1) before ready")).to.equal(
      false,
    );
    expect(isPortInUseMessage("")).to.equal(false);
  });

  it("un port SANS numéro n'est pas un conflit de port", () => {
    expect(isPortInUseMessage("port is in a weird state")).to.equal(false);
  });

  /**
   * Deuxième trou du même mécanisme, trouvé après coup : la détection était
   * branchée sur la SORTIE du child, mais pas sur l'échéance de démarrage. Un
   * vite qui annonce le port occupé puis reste pendu — ce qui arrive dès que le
   * pré-bundling d'une application réelle tient plus longtemps que l'échéance —
   * échouait sous un libellé neutre, et le retry de port ne se déclenchait pas.
   * La façon dont on cesse d'attendre ne doit rien changer à ce qu'on a OBSERVÉ.
   */
  describe("échéance de démarrage — ce que vite a dit prime sur la façon d'échouer", () => {
    it("un timeout APRÈS un port occupé annoncé reste rattrapable par le retry", () => {
      const msg = startupTimeoutMessage(
        20_000,
        "[vite] error when starting dev server:\nError: Port 5173 is already in use",
      );
      expect(isPortInUseMessage(msg)).to.equal(true);
      expect(msg).to.contain("20000ms"); // l'échéance reste dans le message
    });

    /**
     * 🔴 LE CAS MESURÉ SUR LA FORGE, réduit à ce qui le produit. Un agent
     * partagé où un tiers tient le port sur l'adresse générique : vite AVERTIT,
     * puis sert quand même sur l'hôte demandé. Si l'échéance est dépassée
     * ensuite (l'agent est lent, le pré-bundling déborde), c'est ce tampon-là
     * que l'échec relit.
     *
     * Le confondre avec un conflit fait replier `spawnWithPortRetry` sur un
     * démarrage qui n'en avait aucun — et comme le repli repart pour une
     * échéance entière, le coût est `(portRetryAttempts + 1) × startupTimeoutMs`,
     * soit 80 s avec les défauts. C'est ce qui a tué le cas d'intégration du
     * décalage de port à 60 s sous Windows, quand les cinq autres cas du même
     * fichier tenaient en moins d'une seconde.
     */
    it("un timeout après un AVERTISSEMENT wildcard ne part PAS en repli de port", () => {
      const msg = startupTimeoutMessage(
        20_000,
        "Port 5173 is in use on a wildcard address, but localhost:5173 is available.",
      );
      expect(isPortInUseMessage(msg)).to.equal(false);
      expect(msg).to.not.contain("EADDRINUSE");
    });

    it("un timeout SANS rien d'observé n'invente pas un conflit de port", () => {
      // Sinon un boot lent (plugin, pré-bundling) partirait en sarabande de
      // ports au lieu d'annoncer sa vraie panne.
      expect(isPortInUseMessage(startupTimeoutMessage(20_000, ""))).to.equal(
        false,
      );
      expect(
        isPortInUseMessage(
          startupTimeoutMessage(20_000, "optimizing dependencies…"),
        ),
      ).to.equal(false);
    });
  });
});
