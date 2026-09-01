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
    // Les entrées se construisent UNE fois. `" ".repeat(1_600_000)` alloue plus
    // d'un mégaoctet ; le refaire à chaque appel plaçait une allocation — donc
    // un passage possible du ramasse-miettes — juste avant la fenêtre
    // chronométrée, et la paire la plus grande en payait deux fois plus que la
    // petite. Le ratio mesurait alors le ramasse-miettes autant que le motif.
    const entrees = new Map<number, string>();
    const entree = (taille: number): string => {
      let hostile = entrees.get(taille);
      if (hostile === undefined) {
        hostile = `Bearer ${" ".repeat(taille)}\n`;
        entrees.set(taille, hostile);
      }
      return hostile;
    };

    const mesure = (taille: number, essais = 5): number => {
      const hostile = entree(taille);
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

    // Le ratio MINIMAL sur plusieurs PAIRES, et non le ratio d'une seule.
    //
    // Le minimum interne à `mesure` ne suffit pas : il écarte une préemption
    // ponctuelle, pas une machine lente pendant toute la série. Une
    // implémentation à retour arrière, elle, est lente à CHAQUE paire :
    // prendre la meilleure ne peut donc pas l'innocenter.
    //
    // Les tailles ne sont pas cosmétiques, c'est ce qui décide si le cas tient.
    // À 200 k/400 k le travail utile durait ~1 ms, soit l'ORDRE DE GRANDEUR du
    // bruit d'un agent partagé : une préemption de 1,2 ms sur la grande moitié
    // suffisait à afficher un ratio de 3, sans qu'aucune courbe ait changé.
    // Vécu deux fois, sur deux cases différentes de la matrice — ×4,05
    // (1,146 → 4,639 ms) sur ubuntu/Node 24, puis ×3,03 (1,181 → 3,582 ms) sur
    // ubuntu/Node 26. Le remède n'est pas de relever le seuil, qui grignoterait
    // la marge du côté fautif : c'est de porter le SIGNAL au-dessus du bruit.
    // À 800 k/1,6 M le travail dure ~2 et ~4 ms, et la même préemption ne
    // déplace plus le ratio que de 2,0 à 2,6 — sous le seuil.
    // Les deux minima se prennent SÉPARÉMENT, colonne par colonne — et non le
    // ratio d'une paire.
    //
    // C'est la même idée que le minimum interne à `mesure`, poussée d'un cran :
    // une préemption ne peut qu'AJOUTER du temps, donc le plus petit relevé de
    // chaque taille est le moins pollué. Retenir la meilleure PAIRE exigeait
    // que les deux mesures soient propres EN MÊME TEMPS — de probabilité p²
    // quand p est celle d'une mesure propre ; retenir les deux colonnes
    // séparément ne demande qu'une mesure propre dans chacune, ce que cinq
    // tirages rendent très probable. Vécu : ×3,03 sur macOS/Node 26 (2,535 ms
    // → 7,676 ms), la petite colonne propre et la grande préemptée de ~2,7 ms.
    // C'est le TROISIÈME flake de ce cas, après un seuil absolu abandonné puis
    // un relèvement des tailles.
    //
    // Cela n'innocente pas une implémentation fautive, et c'est ce qui autorise
    // le geste : son coût est INTRINSÈQUE, pas du bruit — elle est lente à
    // CHAQUE tirage, donc le minimum de sa grande colonne reste ~4× celui de sa
    // petite. Ce que le minimum retire, c'est l'ordonnanceur ; ce qu'il garde,
    // c'est la courbe.
    let simple = Infinity;
    let double = Infinity;
    for (let paire = 0; paire < 5; paire++) {
      simple = Math.min(simple, mesure(800_000));
      double = Math.min(double, mesure(1_600_000));
    }
    const facteur = double / simple;
    const meilleur = { simple, double };
    // Mesuré sur cette implémentation : ×1,95 (1,876 → 3,651 ms). Le témoin
    // fautif ne se mesure PAS ici — il quadruple à chaque doublement (×4,01 à
    // 8 k, ×4,07 à 16 k, ×4,06 à 32 k) et mettrait une trentaine de secondes sur
    // 800 k. C'est la garde de terminaison ci-dessus qui l'arrête : 868 ms
    // relevées à 32 k, quand elle refuse au-delà de 50 ms à 25 k. Ce second
    // filet vise donc la régression DISCRÈTE, celle qui resterait sous la garde
    // de terminaison tout en cessant d'être linéaire.
    expect(
      facteur,
      `×${facteur.toFixed(2)} en doublant l'entrée, meilleure de 5 paires ` +
        `(${meilleur.simple.toFixed(3)} ms → ${meilleur.double.toFixed(3)} ms) — ` +
        `linéaire ≈ 2, quadratique ≈ 4`,
    ).to.be.below(3);
    // Le délai d'EXÉCUTION de ce cas — pas une assertion de vitesse. Les deux
    // gardes réelles restent inchangées : terminaison sous 50 ms, ratio sous 3.
    // Motif : sous instrumentation de couverture, ce fichier tourne en parallèle
    // de 74 autres et le temps MURAL du cas entier dépasse les 5 s par défaut.
    // Constaté : vert seul avec couverture (6/6), vert en suite sans couverture
    // (1034 tests), rouge seulement à l'intersection des deux. Élargir ce délai
    // n'affaiblit donc aucun seuil — il empêche un verdict qui ne portait pas
    // sur le motif mais sur l'ordonnanceur.
  }, 30_000);

  it("un jeton légitime précédé de beaucoup d'espaces sort quand même", () => {
    const padded = `Bearer ${" ".repeat(50_000)}abc.def.ghi`;
    expect(bearerToken(padded)).to.equal("abc.def.ghi");
  });
});
