import { describe, it } from "vitest";
import { expect } from "chai";
import { pidFromNetstat } from "../helpers/pidListening.js";

/**
 * SPEC — « la sonde d'un banc est le premier suspect, pas ce qu'elle juge ».
 *
 * Le banc du superviseur Vite cherchait le process en écoute avec `lsof` seul.
 * Sous Windows l'outil n'existe pas : la sonde rendait `null`, et le test
 * annonçait « expected null to be a number » — un verdict qui accuse le
 * superviseur pour un défaut qui était celui de la mesure.
 *
 * Ces cas éprouvent la grammaire Windows depuis n'importe quel système, parce que
 * la fonction est PURE et reçoit la sortie au lieu de l'exécuter. C'est le seul
 * levier qui permet de vérifier cette branche sans machine Windows.
 */
describe("pidFromNetstat — lire `netstat -ano` sans machine Windows", () => {
  /** Sortie réelle de `netstat -ano -p TCP`, en-tête compris. */
  const SORTIE = [
    "",
    "Connexions actives",
    "",
    "  Proto  Adresse locale         Adresse distante       État            PID",
    "  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       968",
    // La connexion ÉTABLIE vient AVANT l'écoute, à dessein : dans l'ordre inverse,
    // la première correspondance serait la bonne par accident et le test resterait
    // vert même sans lire l'état — il ne prouverait alors rien.
    "  TCP    127.0.0.1:5173         127.0.0.1:61234        ESTABLISHED     7777",
    "  TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       4242",
    "  TCP    [::]:5174              [::]:0                 LISTENING       4343",
    "",
  ].join("\r\n");

  it("rend le PID du socket en ÉCOUTE sur ce port", () => {
    expect(pidFromNetstat(SORTIE, 5173)).to.equal(4242);
  });

  it("ignore une connexion ÉTABLIE sur le même port — ce n'est pas le serveur", () => {
    // Le PID 7777 est un CLIENT connecté à 5173 : le retenir tuerait le mauvais
    // process, et le banc conclurait que le superviseur n'a pas redémarré.
    expect(pidFromNetstat(SORTIE, 5173)).to.not.equal(7777);
  });

  it("lit aussi une écoute IPv6 (`[::]:port`)", () => {
    expect(pidFromNetstat(SORTIE, 5174)).to.equal(4343);
  });

  it("ne confond pas `:5173` avec `:51730` — la comparaison porte sur la FIN", () => {
    const sortie =
      "  TCP    0.0.0.0:51730          0.0.0.0:0              LISTENING       9999";
    expect(pidFromNetstat(sortie, 5173)).to.equal(null);
    expect(pidFromNetstat(sortie, 51730)).to.equal(9999);
  });

  it("aucun socket sur ce port → null, jamais une valeur au hasard", () => {
    expect(pidFromNetstat(SORTIE, 9090)).to.equal(null);
  });

  it("sortie vide ou illisible → null", () => {
    expect(pidFromNetstat("", 5173)).to.equal(null);
    expect(pidFromNetstat("commande introuvable", 5173)).to.equal(null);
  });
});
