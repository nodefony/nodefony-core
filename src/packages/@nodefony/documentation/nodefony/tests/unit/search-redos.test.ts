/**
 * La recherche ne doit pas s'effondrer sur un corpus hostile.
 *
 * `searchDocs` reçoit le corpus de documentation — des fichiers markdown que la
 * fonction ne contrôle pas — et, sur le site public, elle s'exécute **dans le
 * navigateur du lecteur** (le générateur sérialise son texte dans chaque page).
 * Une expression régulière au temps quadratique n'y est donc pas une lenteur de
 * serveur : c'est l'onglet du lecteur qui se fige.
 *
 * Deux expressions étaient dans ce cas (`js/polynomial-redos`), et l'une avait
 * un coût MESURÉ, pas théorique — le déréférencement des liens markdown, sur
 * une ligne de crochets ouvrants :
 *
 * | caractères | avant   | après  |
 * | ---------: | ------: | -----: |
 * |      5 000 |   17 ms | 0,1 ms |
 * |     20 000 |  279 ms | 0,2 ms |
 * |     50 000 | 1679 ms | 0,3 ms |
 *
 * Le temps quadruple quand l'entrée double et demie : c'est la signature du
 * quadratique. La correction retire l'ambiguïté qui le causait — le texte d'un
 * lien ne peut plus avaler un crochet OUVRANT, donc les départs possibles ne se
 * chevauchent plus.
 *
 * **Pourquoi un budget de temps, et pourquoi si large.** Ce qu'on veut prouver
 * est un ORDRE DE GRANDEUR, pas une performance : entre 1,7 seconde et 0,3
 * milliseconde, n'importe quel seuil intermédiaire tranche. Un budget d'une
 * seconde laisse donc une marge de plus de cent fois sur une machine lente,
 * tout en restant très en deçà du coût quadratique. Un seuil serré mesurerait
 * la charge de la machine, pas la complexité de l'expression.
 */
import { describe, it, expect } from "vitest";
import { searchDocs, type SearchableDoc } from "../../../index";

/** Le corpus hostile : une ligne de crochets ouvrants, porteuse du terme. */
const hostile = (repetitions: number): SearchableDoc[] => [
  {
    slug: "guides~hostile",
    title: "Page ordinaire",
    navTitle: "Page ordinaire",
    sectionLabel: "Guides",
    // La ligne doit porter le terme cherché, sinon elle n'atteint jamais le
    // déréférencement des liens — et le banc mesurerait un chemin non pris.
    body: `${"[".repeat(repetitions)} nodefony`,
  },
];

describe("searchDocs — un corpus hostile ne fige pas le lecteur", () => {
  it("traite 50 000 crochets ouvrants en bien moins d'une seconde", () => {
    const debut = performance.now();
    const resultat = searchDocs(hostile(50_000), "nodefony");
    const ecoule = performance.now() - debut;

    // La garde d'abord : sans elle, un chemin non pris rendrait le budget
    // trivialement tenu, et le banc serait vert sans avoir rien mesuré.
    expect(resultat.matched).toBe(1);
    expect(ecoule).toBeLessThan(1000);
  });

  // ⚠️ La SECONDE expression corrigée (l'extraction du titre de section) n'a
  // PAS de cas rouge ici, et le dire vaut mieux que de feindre une preuve.
  // Mesuré : 0,1 ms avant comme après, sur 50 000 espaces. Son coût quadratique
  // exige que `.+$` ÉCHOUE pour déclencher le retour en arrière, ce qui demande
  // un saut de ligne — or cette expression ne voit jamais qu'UNE ligne, déjà
  // découpée. La correction est donc PRÉVENTIVE : elle retire l'ambiguïté que
  // l'analyse signale, sans qu'un chemin d'exécution l'atteigne aujourd'hui.
  // Ce que le cas ci-dessous garde, c'est la SÉMANTIQUE — une ligne de
  // croisillons entièrement blanche ne doit pas devenir un titre de section.
  it("ne fabrique pas un titre de section depuis une ligne blanche", () => {
    const resultat = searchDocs(
      [
        {
          slug: "guides~blancs",
          title: "Page ordinaire",
          navTitle: "Page ordinaire",
          sectionLabel: "Guides",
          body: `##${" ".repeat(2_000)}\nUne ligne qui parle de nodefony.`,
        },
      ],
      "nodefony",
    );

    expect(resultat.matched).toBe(1);
    expect(resultat.hits[0]?.excerpts[0]?.section).toBeUndefined();
  });
});

describe("searchDocs — ce que la correction ne devait PAS changer", () => {
  const doc = (body: string): SearchableDoc[] => [
    {
      slug: "guides~exemple",
      title: "Page ordinaire",
      navTitle: "Page ordinaire",
      sectionLabel: "Guides",
      body,
    },
  ];

  it("garde le TEXTE d'un lien et jette sa cible", () => {
    const r = searchDocs(
      doc(
        "Voir [la page de configuration](../redis/configuration.md) du dépôt.",
      ),
      "configuration",
    );
    const extrait = r.hits[0]?.excerpts[0]?.text ?? "";
    expect(extrait).toContain("la page de configuration");
    expect(extrait).not.toContain("../redis/configuration.md");
  });

  it("situe toujours l'extrait sous son titre de section", () => {
    const r = searchDocs(
      doc(
        "## Démarrage rapide\nUne phrase qui parle de nodefony et de son boot.",
      ),
      "nodefony",
    );
    expect(r.hits[0]?.excerpts[0]?.section).toBe("Démarrage rapide");
  });

  it("accepte un titre de section suivi de plusieurs espaces", () => {
    const r = searchDocs(
      doc(
        "###   Démarrage   \nUne phrase qui parle de nodefony et de son boot.",
      ),
      "nodefony",
    );
    expect(r.hits[0]?.excerpts[0]?.section).toBe("Démarrage");
  });
});
