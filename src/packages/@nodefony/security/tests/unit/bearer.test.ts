/// <reference types="node" />
/**
 * `bearerToken` — extraction du jeton d'un en-tête `Authorization`, et la raison
 * pour laquelle elle ne passe plus par une expression régulière.
 *
 * Le motif remplacé, `/^bearer\s+(.+)$/i`, était **quadratique** : deux
 * quantificateurs adjacents laissent le moteur essayer chaque découpage. Comme
 * `supports()` s'exécute avant toute authentification, n'importe qui pouvait
 * faire brûler du temps sur la boucle d'événements — unique — en envoyant des
 * espaces.
 */
import { expect } from "chai";
import { bearerToken } from "../../nodefony/src/authenticator/bearer";

describe("bearerToken — extraction du porteur (RFC 9110 §5.6.3)", () => {
  it("extrait le jeton, quelle que soit la casse du schéma", () => {
    expect(bearerToken("Bearer abc.def.ghi")).to.equal("abc.def.ghi");
    expect(bearerToken("bearer abc")).to.equal("abc");
    expect(bearerToken("BEARER abc")).to.equal("abc");
    expect(bearerToken("BeArEr abc")).to.equal("abc");
  });

  it("tolère plusieurs séparateurs, et les espaces de queue", () => {
    expect(bearerToken("Bearer   abc")).to.equal("abc");
    expect(bearerToken("Bearer\tabc")).to.equal("abc");
    expect(bearerToken("Bearer abc   ")).to.equal("abc");
  });

  it("refuse ce qui n'est pas un porteur — sans jamais lever", () => {
    expect(bearerToken(undefined)).to.equal(null);
    expect(bearerToken(null)).to.equal(null);
    expect(bearerToken(42)).to.equal(null);
    expect(bearerToken("")).to.equal(null);
    expect(bearerToken("Basic dXNlcjpwYXNz")).to.equal(null);
    // Pas de séparateur : `bearertoken` n'est pas un schéma suivi d'un jeton.
    expect(bearerToken("Bearerabc")).to.equal(null);
    // Schéma seul, ou schéma suivi de vide.
    expect(bearerToken("Bearer")).to.equal(null);
    expect(bearerToken("Bearer ")).to.equal(null);
    expect(bearerToken("Bearer     ")).to.equal(null);
  });

  it("le séparateur est SP ou HTAB, pas n'importe quel blanc", () => {
    // `\s` acceptait retour à la ligne et espaces Unicode — plus permissif que
    // la norme, pour aucun bénéfice. Un en-tête ne contient pas de saut de ligne
    // brut : l'accepter revenait à valider une valeur déjà malformée.
    expect(bearerToken("Bearer\nabc")).to.equal(null);
    expect(bearerToken("Bearer\u00A0abc")).to.equal(null); // espace insécable
  });

  it("reste LINÉAIRE sur l'entrée qui faisait exploser l'ancien motif", () => {
    // Le pire cas se CONSTRUIT : des espaces seuls ne suffisent pas (le motif
    // réussissait, donc ne rétrogradait pas — mesuré à 0,3 ms). Il faut forcer
    // l'ÉCHEC final par un caractère que `.` ne matche pas, et alors le moteur
    // essaie chaque découpage entre `\s+` et `(.+)`. Mesuré sur l'ancien motif :
    // 136 ms à 10 k, 2,2 s à 40 k, 8,7 s à 80 k — le temps quadruple quand la
    // taille double, signature du quadratique.
    //
    // Atteignable depuis le réseau ? Pas aujourd'hui : Node refuse un saut de
    // ligne brut dans une valeur d'en-tête. La garde qui protégeait ce chemin
    // était donc EXTÉRIEURE au framework et nulle part énoncée — elle tombe dès
    // qu'un porteur arrive d'ailleurs que du parseur HTTP (frame, banc, appel
    // direct). C'est la raison de ce cas : ne pas dépendre d'une protection
    // qu'on ne possède pas.
    const hostile = `Bearer ${" ".repeat(100_000)}\n`;
    const started = process.hrtime.bigint();
    expect(bearerToken(hostile)).to.equal(null);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
    expect(
      elapsedMs,
      `${elapsedMs.toFixed(1)} ms sur 100 k espaces`,
    ).to.be.below(50);
  });

  it("un jeton légitime précédé de beaucoup d'espaces sort quand même", () => {
    const padded = `Bearer ${" ".repeat(50_000)}abc.def.ghi`;
    expect(bearerToken(padded)).to.equal("abc.def.ghi");
  });
});
