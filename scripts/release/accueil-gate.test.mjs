/**
 * La confrontation de l'accueil aux `dist-tags`, éprouvée SANS réseau.
 *
 * Le cœur du contrôle est une fonction pure, et c'est délibéré : le défaut qu'on
 * garde ici n'est pas une panne du registre, c'est une page d'accueil restée sur
 * le cran précédent. Chaque cas ci-dessous est un état RÉEL — celui du dépôt au
 * moment où ce contrôle a été écrit, ou celui qu'un oubli de bascule produirait.
 */
import { describe, expect, it } from "vitest";

import {
  basculerVersions,
  comparer,
  confronterAccueil,
  zonesDeCode,
} from "./accueil-gate.mjs";

/** Les étiquettes réellement servies par npm à l'écriture de ce contrôle. */
const TAGS = {
  "beta.0": "4.0.0-beta.0",
  latest: "7.0.2",
  alpha: "10.0.0-alpha.5",
};

const surface = (contenu, chemin = "README.md") => ({
  chemin,
  contenu,
  exigeVersion: true,
});

const genres = (ecarts) => ecarts.map((e) => e.genre);

describe("confronterAccueil — les versions citées", () => {
  it("laisse passer un accueil qui annonce le cran servi", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface("préversion `10.0.0-alpha.5` en ligne, canal `alpha`"),
      ],
      distTags: TAGS,
    });
    expect(ecarts).toEqual([]);
  });

  it("refuse l'état RÉEL du dépôt : accueil en alpha.4, registre en alpha.5", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface(
          "**État** — **préversion `10.0.0-alpha.4` en ligne**, sous le canal `alpha`",
        ),
      ],
      distTags: TAGS,
    });
    expect(genres(ecarts)).toEqual(["VERSION-PERIMEE"]);
    expect(ecarts[0].correction).toBe(
      "remplacer 10.0.0-alpha.4 par 10.0.0-alpha.5",
    );
    expect(ecarts[0].ligne).toBe(1);
  });

  it("refuse une version que le canal NE SERT PAS — annoncer avant de publier", () => {
    const ecarts = confronterAccueil({
      surfaces: [surface("préversion `10.0.0-alpha.6` en ligne")],
      distTags: TAGS,
    });
    expect(genres(ecarts)).toEqual(["VERSION-FANTOME"]);
    expect(ecarts[0].message).toContain("NE SERT PAS");
  });

  it("refuse une version dont le canal n'existe pas du tout sur le registre", () => {
    const ecarts = confronterAccueil({
      surfaces: [surface("préversion `10.0.0-rc.1` en ligne")],
      distTags: TAGS,
    });
    expect(genres(ecarts)).toEqual(["VERSION-FANTOME"]);
    expect(ecarts[0].message).toContain("n'existe pas");
  });

  it("compare les crans NUMÉRIQUEMENT — alpha.12 vient après alpha.5", () => {
    // Un tri lexical rendrait "10.0.0-alpha.12" < "10.0.0-alpha.5", donc
    // « périmée » là où la page est en AVANCE : deux verdicts opposés.
    expect(comparer("10.0.0-alpha.12", "10.0.0-alpha.5")).toBeGreaterThan(0);
    expect(comparer("10.0.0-alpha.5", "10.0.0-alpha.12")).toBeLessThan(0);
    expect(comparer("10.0.0-alpha.5", "10.0.0-alpha.5")).toBe(0);
    // Un canal passe avant l'autre par ordre alphabétique — alpha puis beta.
    expect(comparer("10.0.0-alpha.9", "10.0.0-beta.1")).toBeLessThan(0);
  });

  it("ancre chaque écart sur SA ligne", () => {
    const ecarts = confronterAccueil({
      surfaces: [surface("ligne 1\nligne 2\n`10.0.0-alpha.4` ici\n")],
      distTags: TAGS,
    });
    expect(ecarts[0].ligne).toBe(3);
  });
});

describe("confronterAccueil — le faux vert qu'on ne verrait jamais", () => {
  it("refuse une surface d'état qui ne cite AUCUNE version", () => {
    // Retirer la phrase est le moyen le plus simple de rendre le contrôle vert
    // sans rien corriger. Sans cette famille, personne ne le saurait.
    const ecarts = confronterAccueil({
      surfaces: [surface("Nodefony est un framework Node.js fullstack.")],
      distTags: TAGS,
    });
    expect(genres(ecarts)).toEqual(["SURFACE-MUETTE"]);
  });

  it("n'exige pas de version d'une surface qui n'affirme pas l'état", () => {
    const ecarts = confronterAccueil({
      surfaces: [{ chemin: "autre.md", contenu: "rien", exigeVersion: false }],
      distTags: TAGS,
    });
    expect(ecarts).toEqual([]);
  });
});

describe("confronterAccueil — « rien n'est publié »", () => {
  it("refuse l'affirmation quand un canal de la ligne 10 existe", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface("`10.0.0-alpha.5` — mais rien n'est encore sur npm à ce jour."),
      ],
      distTags: TAGS,
    });
    expect(genres(ecarts)).toContain("RIEN-PUBLIE");
  });

  it("attrape les trois tournures employées par l'accueil d'avant la 1ʳᵉ alpha", () => {
    for (const phrase of [
      "le paquet n'est pas encore publié",
      "version non publiée à ce jour",
      "aucun paquet `10` sur le registre",
    ]) {
      const ecarts = confronterAccueil({
        surfaces: [surface(`\`10.0.0-alpha.5\` · ${phrase}`)],
        distTags: TAGS,
      });
      expect(genres(ecarts), phrase).toContain("RIEN-PUBLIE");
    }
  });
});

describe("confronterAccueil — le canal nommé dans les commandes", () => {
  it("refuse une commande prescrite sans canal tant que latest n'est pas la 10", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface(
          "`10.0.0-alpha.5`\n\n```bash\nnpm create nodefony mon-app\n```\n",
        ),
      ],
      distTags: TAGS,
    });
    expect(genres(ecarts)).toEqual(["COMMANDE-SANS-CANAL"]);
    expect(ecarts[0].correction).toContain("@<canal>");
  });

  it("laisse passer la même commande quand elle nomme son canal", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface(
          "`10.0.0-alpha.5`\n\n```bash\nnpm create nodefony@alpha mon-app\n```\n",
        ),
      ],
      distTags: TAGS,
    });
    expect(ecarts).toEqual([]);
  });

  it("cesse d'exiger le canal le jour où latest EST la ligne 10", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface("`10.0.0-rc.1`\n\n```bash\nnpm create nodefony mon-app\n```\n"),
      ],
      distTags: {
        latest: "10.0.0",
        alpha: "10.0.0-alpha.5",
        rc: "10.0.0-rc.1",
      },
    });
    expect(ecarts).toEqual([]);
  });

  it("ignore `npm install` sans nom de paquet — ce sont les deps d'un clone", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface(
          "`10.0.0-alpha.5`\n\n```bash\ngit clone …\nnpm install && npm run build\n```\n",
        ),
      ],
      distTags: TAGS,
    });
    expect(ecarts).toEqual([]);
  });

  it("🔴 ne voit PAS une commande citée en PROSE entre deux blocs de code", () => {
    // Le faux positif qui a été constaté sur le README : la reprise du balayage
    // repartait SUR la ligne de clôture, relue comme une nouvelle ouverture, si
    // bien que la prose SÉPARANT deux blocs passait pour du code. La phrase
    // visée est précisément celle qui PRÉVIENT du piège — la signaler était le
    // contresens exact.
    const contenu = [
      "préversion `10.0.0-alpha.5`",
      "",
      "```bash",
      "npm create nodefony@alpha mon-app",
      "```",
      "",
      "et non la `7.0.2` que `npm install nodefony` sert encore",
      "",
      "```bash",
      "npm run dev",
      "```",
      "",
    ].join("\n");
    expect(
      confronterAccueil({ surfaces: [surface(contenu)], distTags: TAGS }),
    ).toEqual([]);
  });
});

describe("basculerVersions — ce qui empêche la dette de NAÎTRE", () => {
  it("réécrit une version périmée sur celle que le canal sert", () => {
    const { contenu, remplacements } = basculerVersions(
      "**État** — préversion `10.0.0-alpha.4` en ligne, canal `alpha`",
      TAGS,
    );
    expect(contenu).toContain("10.0.0-alpha.5");
    expect(contenu).not.toContain("10.0.0-alpha.4");
    expect(remplacements).toEqual([
      { de: "10.0.0-alpha.4", vers: "10.0.0-alpha.5" },
    ]);
  });

  it("réécrit TOUTES les occurrences, pas seulement la première", () => {
    // L'accueil en portait trois — deux dans le README, une dans AGENTS.md.
    // Une bascule qui n'en corrige qu'une laisse la page à moitié fausse, et le
    // contrôle qui suit la déclarerait encore en écart : la boucle ne fermerait
    // jamais.
    const { contenu, remplacements } = basculerVersions(
      "a `10.0.0-alpha.4` b `10.0.0-alpha.4` c",
      TAGS,
    );
    expect(remplacements).toHaveLength(2);
    expect(contenu).toBe("a `10.0.0-alpha.5` b `10.0.0-alpha.5` c");
  });

  it("est IDEMPOTENTE — relancée, elle ne trouve plus rien", () => {
    const une = basculerVersions("préversion `10.0.0-alpha.4`", TAGS);
    const deux = basculerVersions(une.contenu, TAGS);
    expect(deux.remplacements).toEqual([]);
    expect(deux.contenu).toBe(une.contenu);
  });

  it("n'écrase PAS une version en avance — ce serait effacer une intention", () => {
    // Une page qui annonce l'alpha.6 quand le registre sert l'alpha.5 décrit
    // peut-être le cran qu'on est en train de publier. Ce cas reste un refus,
    // jamais une réécriture silencieuse vers le passé.
    const { contenu, remplacements } = basculerVersions(
      "préversion `10.0.0-alpha.6`",
      TAGS,
    );
    expect(remplacements).toEqual([]);
    expect(contenu).toContain("10.0.0-alpha.6");
  });

  it("ne touche pas un canal que le registre ne sert pas", () => {
    const { remplacements } = basculerVersions("`10.0.0-rc.1`", TAGS);
    expect(remplacements).toEqual([]);
  });

  it("ne touche QUE la version — la prose autour est intacte", () => {
    const avant =
      "Elle s'installe en nommant ce canal, et non la `7.0.2` que\n" +
      "`npm install nodefony` sert encore : `10.0.0-alpha.4`.\n";
    const { contenu } = basculerVersions(avant, TAGS);
    expect(contenu).toBe(avant.replace("10.0.0-alpha.4", "10.0.0-alpha.5"));
  });

  it("bascule puis PASSE le contrôle — la boucle se ferme", () => {
    const avant = "**État** — préversion `10.0.0-alpha.4`, canal `alpha`";
    expect(
      confronterAccueil({ surfaces: [surface(avant)], distTags: TAGS }),
    ).toHaveLength(1);
    const { contenu } = basculerVersions(avant, TAGS);
    expect(
      confronterAccueil({ surfaces: [surface(contenu)], distTags: TAGS }),
    ).toEqual([]);
  });
});

describe("zonesDeCode", () => {
  it("rend une zone par bloc, sans avaler la prose intercalaire", () => {
    const contenu = "a\n```\nX\n```\nb\n```\nY\n```\nc\n";
    const zones = zonesDeCode(contenu);
    expect(zones).toHaveLength(2);
    const dedans = (i) => zones.some(([d, f]) => i >= d && i < f);
    expect(dedans(contenu.indexOf("X"))).toBe(true);
    expect(dedans(contenu.indexOf("Y"))).toBe(true);
    expect(dedans(contenu.indexOf("b"))).toBe(false);
    expect(dedans(contenu.indexOf("c"))).toBe(false);
  });

  it("va jusqu'à la fin du texte quand un bloc n'est jamais clôturé", () => {
    const contenu = "a\n```bash\nX\nY\n";
    const [[debut, fin]] = zonesDeCode(contenu);
    expect(contenu.slice(debut, fin)).toBe("X\nY\n");
  });

  it("traite les clôtures en tilde comme celles en accent grave", () => {
    const contenu = "a\n~~~bash\nX\n~~~\nb npm install nodefony\n";
    const zones = zonesDeCode(contenu);
    expect(zones).toHaveLength(1);
    expect(contenu.slice(zones[0][0], zones[0][1])).toBe("X\n");
  });
});
