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
    // Ce qui se juge est la FORME de la courbe, jamais une durée : doubler
    // l'entrée doit doubler le temps (linéaire), pas le quadrupler. Un seuil
    // absolu mesurait la machine — `hrtime` compte le temps MURAL, et sur un
    // agent d'intégration saturé une préemption de 90 ms au milieu d'un chrono
    // de 0,3 ms est ordinaire. Vécu : rouge sur macOS à 96 ms pendant que les
    // cinq autres cases de la matrice passaient.
    const mesure = (taille: number, essais = 5): number => {
      const hostile = `Bearer ${" ".repeat(taille)}\n`;
      expect(bearerToken(hostile)).to.equal(null);
      // Chauffe : le premier appel s'exécute avant que la machine virtuelle
      // n'ait compilé la fonction — il mesure la montée en régime.
      for (let essai = 0; essai < 3; essai++) bearerToken(hostile);
      // Le MINIMUM, pas la moyenne : une préemption ne peut qu'AJOUTER du
      // temps, donc le plus petit relevé est le moins pollué de la série.
      let plusRapide = Infinity;
      for (let essai = 0; essai < essais; essai++) {
        const debut = process.hrtime.bigint();
        bearerToken(hostile);
        const ms = Number(process.hrtime.bigint() - debut) / 1e6;
        if (ms < plusRapide) plusRapide = ms;
      }
      return plusRapide;
    };

    // Garde de TERMINAISON, franchie avant d'atteindre les grandes tailles.
    // Elle existe parce qu'un motif à retour arrière ne rend JAMAIS la main sur
    // 200 k espaces : le test ne tomberait pas, il bloquerait le worker — et
    // rien ne peut interrompre du code synchrone (constaté : cinq minutes sans
    // verdict). Ce n'est pas un seuil de vitesse : le travail attendu ici est
    // de l'ordre de 0,1 ms, la marge est donc d'un facteur ~500, quand le même
    // motif y consomme déjà une demi-seconde.
    const petit = mesure(25_000, 3);
    expect(
      petit,
      `${petit.toFixed(3)} ms sur 25 k espaces — une implémentation à retour ` +
        `arrière y met des centaines de millisecondes`,
    ).to.be.below(50);

    const simple = mesure(200_000);
    const double = mesure(400_000);
    const facteur = double / simple;
    // Mesuré : 1,95 sur cette implémentation, 3,89 sur l'ancien motif. Le seuil
    // se pose entre les deux, et le quadratique s'en éloigne encore quand la
    // taille monte — la marge ne se referme jamais du mauvais côté.
    expect(
      facteur,
      `×${facteur.toFixed(2)} en doublant l'entrée ` +
        `(${simple.toFixed(3)} ms → ${double.toFixed(3)} ms) — ` +
        `linéaire ≈ 2, quadratique ≈ 4`,
    ).to.be.below(3);
  });

  it("un jeton légitime précédé de beaucoup d'espaces sort quand même", () => {
    const padded = `Bearer ${" ".repeat(50_000)}abc.def.ghi`;
    expect(bearerToken(padded)).to.equal("abc.def.ghi");
  });
});
