/**
 * La confrontation de l'accueil aux `dist-tags`, éprouvée SANS réseau.
 *
 * Le cœur du contrôle est une fonction pure, et c'est délibéré : le défaut qu'on
 * garde ici n'est pas une panne du registre, c'est une page d'accueil restée sur
 * le cran précédent. Chaque cas ci-dessous est un état RÉEL — celui du dépôt au
 * moment où ce contrôle a été écrit, ou celui qu'un oubli de bascule produirait.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "../lib/repo-root.mjs";

import {
  basculerVersions,
  comparer,
  confronterAccueil,
  estDansLeCorpus,
  garderVersions,
  lireSurfaces,
  pointeDeLaLigne,
  projeter,
  SURFACES,
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

  it("🔴 laisse passer une REPRISE : la page du commit tagué annonce déjà la version reprise", () => {
    // Vécu (10.0.0-beta.4) : trois paquets en ligne, la suite refusée. La
    // bascule se fait désormais à l'estampille : la relance trouve une page
    // qui annonce la version en cours, que le canal sert déjà.
    const ecarts = confronterAccueil({
      surfaces: [
        surface("préversion `10.0.0-alpha.5` en ligne, canal `alpha`"),
      ],
      distTags: TAGS,
      enCours: "10.0.0-alpha.5",
    });
    expect(ecarts).toEqual([]);
  });

  it("…mais refuse une page NON basculée, même en reprise : son tarball porterait l'ancienne", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface("préversion `10.0.0-alpha.4` en ligne, canal `alpha`"),
      ],
      distTags: TAGS,
      enCours: "10.0.0-alpha.5",
    });
    expect(genres(ecarts)).toEqual(["VERSION-PERIMEE"]);
  });

  it("…et une bascule OUBLIÉE : la correction vise la version qu'on publie", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface("préversion `10.0.0-alpha.4` en ligne, canal `alpha`"),
      ],
      distTags: TAGS,
      enCours: "10.0.0-alpha.6",
    });
    expect(genres(ecarts)).toEqual(["VERSION-PERIMEE"]);
    expect(ecarts[0].correction).toBe(
      "remplacer 10.0.0-alpha.4 par 10.0.0-alpha.6",
    );
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

describe("confronterAccueil — ce que l'APPLICATION GÉNÉRÉE affiche (#784)", () => {
  /** Une source ou un gabarit : pas de bloc clôturé, tout ce qui s'affiche est prescrit. */
  const code = (contenu, chemin = "loginPage.ts") => ({
    chemin,
    contenu,
    exigeVersion: false,
    code: true,
  });

  it("🔴 refuse la commande `npx` de l'écran de connexion d'avant la correction", () => {
    const contenu =
      '<div class="install"><span class="p">$</span><span>npx nodefony create app</span></div>';
    const ecarts = confronterAccueil({
      surfaces: [code(contenu)],
      distTags: TAGS,
    });
    expect(genres(ecarts)).toEqual(["COMMANDE-SANS-CANAL"]);
    expect(ecarts[0].correction).toContain("npm create nodefony@<canal>");
  });

  it("refuse aussi une commande `npm create` sans canal, hors de tout bloc", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        code("<span>npm create nodefony mon-app</span>", "App.tsx.tpl"),
      ],
      distTags: TAGS,
    });
    expect(genres(ecarts)).toEqual(["COMMANDE-SANS-CANAL"]);
  });

  it("laisse passer la commande CALCULÉE — aucun littéral à juger", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        code("<span>${INSTALL_COMMAND}</span>"),
        code(
          "<span><%= it.installCommand %> <b>mon-app</b></span>",
          "App.tsx.tpl",
        ),
      ],
      distTags: TAGS,
    });
    expect(ecarts).toEqual([]);
  });

  it("ne vise pas les `npx nodefony …` lancés DANS une application", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        code("npx nodefony development && npx nodefony create module blog"),
      ],
      distTags: TAGS,
    });
    expect(ecarts).toEqual([]);
  });

  it("cesse d'exiger le canal le jour où `latest` EST la ligne 10", () => {
    const ecarts = confronterAccueil({
      surfaces: [code("<span>npx nodefony create app</span>")],
      distTags: { latest: "10.0.0" },
    });
    expect(ecarts).toEqual([]);
  });

  it("en markdown, la forme `npx` citée en PROSE reste une mise en garde, pas une commande", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface(
          "`10.0.0-alpha.5` — et `npx nodefony create app` hors d'une app sert la 7.\n",
        ),
      ],
      distTags: TAGS,
    });
    expect(ecarts).toEqual([]);
  });

  it("déclare les deux surfaces de l'application, et elles disent vrai aujourd'hui", () => {
    const declarees = SURFACES.filter((s) => s.code === true);
    expect(declarees.map((s) => s.chemin)).toEqual([
      "src/packages/@nodefony/framework/nodefony/src/loginPage.ts",
      "src/nodefony/templates/demo/front/frontend/src/App.tsx.tpl",
    ]);
    const surfaces = declarees.map((s) =>
      code(
        fs.readFileSync(path.join(REPO_ROOT, ...s.chemin.split("/")), "utf8"),
        s.chemin,
      ),
    );
    expect(confronterAccueil({ surfaces, distTags: TAGS })).toEqual([]);
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

describe("confronterAccueil — le changement de CANAL (CANAL-DEPASSE)", () => {
  /** Le jour de la stable : `latest` sert la 10, `beta` sert encore la dernière bêta. */
  const STABLE = {
    latest: "10.0.0",
    beta: "10.0.0-beta.7",
    alpha: "10.0.0-alpha.9",
  };
  /** L'accueil tel qu'il est AUJOURD'HUI, resté en l'état le jour de la stable. */
  const ACCUEIL_BETA =
    "préversion `10.0.0-beta.7` en ligne, canal `beta`\n\n" +
    "```bash\nnpm create nodefony@beta mon-app\n```\n";

  it("🔴 refuse une page restée sur `@beta` le jour où `latest` sert la 10 — que VERSION-PERIMEE juge à jour", () => {
    // Le trou constaté au passage alpha → beta : chaque version est comparée à
    // SON canal, et `beta` sert toujours la beta.7 — la page paraissait juste.
    const ecarts = confronterAccueil({
      surfaces: [surface(ACCUEIL_BETA)],
      distTags: STABLE,
    });
    expect(genres(ecarts)).toEqual(["CANAL-DEPASSE"]);
    expect(ecarts[0].ligne).toBe(4);
    expect(ecarts[0].correction).toMatch(/sans canal/);
  });

  it("refuse aussi une commande citée en PROSE — elle prescrit autant qu'un bloc", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface(
          "`10.0.0` en ligne. Générer : `npm create nodefony@beta <app>`.",
        ),
      ],
      distTags: STABLE,
    });
    expect(genres(ecarts)).toEqual(["CANAL-DEPASSE"]);
  });

  it("refuse `@alpha` quand la bêta l'a dépassé, et propose le canal qui mène", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface(
          "préversion `10.0.0-beta.7`\n\n```bash\nnpm create nodefony@alpha x\n```\n",
        ),
      ],
      distTags: {
        latest: "7.0.2",
        alpha: "10.0.0-alpha.9",
        beta: "10.0.0-beta.7",
      },
    });
    expect(genres(ecarts)).toEqual(["CANAL-DEPASSE"]);
    expect(ecarts[0].correction).toBe("écrire npm create nodefony@beta");
  });

  it("laisse passer l'accueil d'AUJOURD'HUI — `@beta` mène tant que `latest` n'est pas la 10", () => {
    const ecarts = confronterAccueil({
      surfaces: [surface(ACCUEIL_BETA)],
      distTags: {
        "beta.0": "4.0.0-beta.0",
        latest: "7.0.2",
        alpha: "10.0.0-alpha.9",
        beta: "10.0.0-beta.7",
      },
    });
    expect(ecarts).toEqual([]);
  });

  it("ne voit pas une MENTION de l'ancien canal — elle informe, elle ne prescrit rien", () => {
    // La page Docker Hub : « `alpha` — l'ancien canal, figé sur 10.0.0-alpha.9 ».
    const ecarts = confronterAccueil({
      surfaces: [
        surface(
          "| `10.0.0-beta.7` | précise |\n| `alpha` | l'ancien canal, figé sur `10.0.0-alpha.9` |\n",
        ),
      ],
      distTags: {
        latest: "7.0.2",
        alpha: "10.0.0-alpha.9",
        beta: "10.0.0-beta.7",
      },
    });
    expect(ecarts).toEqual([]);
  });

  it("🔴 ignore `next` — la répétition de la stable ne s'annonce jamais au public", () => {
    // #27 : la 10.0.0 part sous `next`, s'installe depuis le registre, puis passe
    // en `latest`. Pendant ce temps, l'accueil reste sur `@beta`.
    const ecarts = confronterAccueil({
      surfaces: [surface(ACCUEIL_BETA)],
      distTags: { latest: "7.0.2", next: "10.0.0", beta: "10.0.0-beta.7" },
    });
    expect(ecarts).toEqual([]);
  });

  it("🔴 refuse une REPRISE de la stable dont la page est restée sur `@beta`", () => {
    // L'ancienne tolérance laissait passer ce cas — c'est-à-dire publier un
    // tarball 10.0.0 dont le README prescrit encore la bêta.
    const ecarts = confronterAccueil({
      surfaces: [surface(ACCUEIL_BETA)],
      distTags: STABLE,
      enCours: "10.0.0",
    });
    expect(genres(ecarts)).toEqual(["CANAL-DEPASSE"]);
  });
});

describe("--en-cours — la page du TARBALL annonce la version qu'il accompagne (#47)", () => {
  /** Ce que npm sert la veille de la beta.8, et la page d'accueil de ce jour. */
  const VEILLE = {
    latest: "7.0.2",
    alpha: "10.0.0-alpha.9",
    beta: "10.0.0-beta.7",
  };
  const ACCUEIL =
    "préversion `10.0.0-beta.7` en ligne, canal `beta`\n\n" +
    "```bash\nnpm create nodefony@beta mon-app\n```\n";

  it("projette le canal de la préversion, et `latest` pour une stable", () => {
    expect(projeter(VEILLE, "10.0.0-beta.8").beta).toBe("10.0.0-beta.8");
    expect(projeter(VEILLE, "10.0.0").latest).toBe("10.0.0");
    expect(projeter(VEILLE, "10.0.0-rc.1").rc).toBe("10.0.0-rc.1");
    expect(projeter(VEILLE, null)).toBe(VEILLE);
    expect(VEILLE.beta).toBe("10.0.0-beta.7"); // entrée intacte
  });

  it("ne RECULE jamais un canal", () => {
    expect(projeter(VEILLE, "10.0.0-beta.6")).toBe(VEILLE);
    expect(projeter(VEILLE, "10.0.0-beta.7")).toBe(VEILLE);
  });

  it("🔴 refuse d'empaqueter la page de la VEILLE — le défaut constaté sur la beta.7", () => {
    // Le README de `nodefony@10.0.0-beta.7`, lu au registre, annonçait la beta.6.
    const ecarts = confronterAccueil({
      surfaces: [surface(ACCUEIL)],
      distTags: VEILLE,
      enCours: "10.0.0-beta.8",
    });
    expect(genres(ecarts)).toEqual(["VERSION-PERIMEE"]);
    expect(ecarts[0].correction).toBe(
      "remplacer 10.0.0-beta.7 par 10.0.0-beta.8",
    );
  });

  it("bascule vers la version EN COURS, puis passe — la page annonce ce que le canal ne sert pas encore", () => {
    const { contenu, remplacements } = basculerVersions(
      ACCUEIL,
      projeter(VEILLE, "10.0.0-beta.8"),
    );
    expect(remplacements).toEqual([
      { de: "10.0.0-beta.7", vers: "10.0.0-beta.8" },
    ]);
    expect(
      confronterAccueil({
        surfaces: [surface(contenu)],
        distTags: VEILLE,
        enCours: "10.0.0-beta.8",
      }),
    ).toEqual([]);
    // Sans la version en cours, la même page est une annonce prématurée.
    expect(
      genres(
        confronterAccueil({ surfaces: [surface(contenu)], distTags: VEILLE }),
      ),
    ).toEqual(["VERSION-FANTOME"]);
  });

  it("🔴 STABLE : la bascule seule ne suffit pas — la prose `@beta` est refusée avant l'estampille", () => {
    const { contenu } = basculerVersions(ACCUEIL, projeter(VEILLE, "10.0.0"));
    expect(
      genres(
        confronterAccueil({
          surfaces: [surface(contenu)],
          distTags: VEILLE,
          enCours: "10.0.0",
        }),
      ),
    ).toEqual(["CANAL-DEPASSE"]);
  });

  it("STABLE : accepte la prose de la stable alors que `latest` sert encore la 7", () => {
    const stable =
      "Version `10.0.0` en ligne.\n\n" +
      "```bash\nnpm create nodefony@latest mon-app\nnpm install nodefony\n```\n";
    expect(
      confronterAccueil({
        surfaces: [surface(stable)],
        distTags: { ...VEILLE, next: "10.0.0" },
        enCours: "10.0.0",
      }),
    ).toEqual([]);
    // Hors de la passe qui la publie, la même page est fausse : `latest` sert la 7
    // — `@latest` compris, qui ne nomme aucun canal et installe la 7 comme la
    // forme nue.
    expect(
      genres(
        confronterAccueil({ surfaces: [surface(stable)], distTags: VEILLE }),
      ),
    ).toEqual(["SURFACE-MUETTE", "COMMANDE-SANS-CANAL", "COMMANDE-SANS-CANAL"]);
  });
});

describe("comparer / pointeDeLaLigne — la stable vient après ses préversions", () => {
  it("place 10.0.0 après 10.0.0-rc.3 et 10.0.0-beta.7 (SemVer §11)", () => {
    expect(comparer("10.0.0", "10.0.0-rc.3")).toBeGreaterThan(0);
    expect(comparer("10.0.0-beta.7", "10.0.0")).toBeLessThan(0);
    expect(comparer("10.0.0", "10.0.0")).toBe(0);
    expect(comparer("10.0.1-alpha.1", "10.0.0")).toBeGreaterThan(0);
  });

  it("rend le canal qui mène la ligne 10, et ignore la ligne 7", () => {
    expect(
      pointeDeLaLigne({
        latest: "7.0.2",
        beta: "10.0.0-beta.7",
        alpha: "10.0.0-alpha.9",
      }),
    ).toEqual({ canal: "beta", version: "10.0.0-beta.7" });
    expect(
      pointeDeLaLigne({ latest: "10.0.0", beta: "10.0.0-beta.7" }),
    ).toEqual({ canal: "latest", version: "10.0.0" });
    expect(pointeDeLaLigne({ latest: "7.0.2" })).toBeNull();
  });
});

describe("confronterAccueil — la page du cran STABLE n'est pas muette", () => {
  it("compte `10.0.0` comme annonce une fois `latest` sur la 10", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        surface(
          "Version `10.0.0` en ligne.\n\n```bash\nnpm create nodefony mon-app\n```\n",
        ),
      ],
      distTags: { latest: "10.0.0", beta: "10.0.0-beta.7" },
    });
    expect(ecarts).toEqual([]);
  });

  it("…mais pas avant : `10.0.0` n'est alors que le numéro du package.json", () => {
    const ecarts = confronterAccueil({
      surfaces: [surface("version `10.0.0` (package.json)")],
      distTags: { latest: "7.0.2", beta: "10.0.0-beta.7" },
    });
    expect(genres(ecarts)).toEqual(["SURFACE-MUETTE"]);
  });
});

describe("garderVersions — ce que le registre peut faire écrire dans l'accueil", () => {
  it("garde les étiquettes réelles, `beta.0` comprise", () => {
    expect(garderVersions(TAGS)).toEqual(TAGS);
  });

  it("🔴 écarte une valeur qui porterait du texte jusqu'au README publié", () => {
    const recu = {
      ...TAGS,
      beta: "10.0.0-beta.7\n\n[installer ici](https://exemple.invalid)",
    };
    const gardees = garderVersions(recu);
    expect(gardees).not.toHaveProperty("beta");
    // La bascule ne peut donc plus rien en écrire : sans canal, la page reste.
    const page = "Préversion `10.0.0-beta.6` en ligne.";
    expect(basculerVersions(page, gardees).contenu).toBe(page);
  });

  it("écarte une valeur non textuelle et une étiquette malformée", () => {
    expect(
      garderVersions({ latest: "7.0.2", alpha: 10, "<b>": "10.0.0" }),
    ).toEqual({ latest: "7.0.2" });
  });

  it("rend null quand il ne reste rien — un contrôle aveugle, pas un vert", () => {
    expect(garderVersions({ beta: "pas une version" })).toBeNull();
    expect(garderVersions(null)).toBeNull();
    expect(garderVersions("10.0.0")).toBeNull();
  });
});

describe("le corpus de PROSE — les commandes qu'une page prescrit, hors de l'accueil", () => {
  const STABLE = { latest: "10.0.0", beta: "10.0.0-beta.9" };
  const prose = (contenu, chemin = "docs/guides/x.md") => ({
    chemin,
    contenu,
    exigeVersion: false,
    commandesSeules: true,
  });

  it("🔴 refuse un canal dépassé dans une page de doc — le tutoriel resté sur `@beta` le jour de la stable", () => {
    const ecarts = confronterAccueil({
      surfaces: [prose("```bash\nnpm create nodefony@beta mon-app\n```\n")],
      distTags: STABLE,
    });
    expect(genres(ecarts)).toEqual(["CANAL-DEPASSE"]);
  });

  it("ne juge NI les versions citées NI « pas encore publié » — une procédure n'affirme pas l'état", () => {
    const ecarts = confronterAccueil({
      surfaces: [
        prose(
          "La `10.0.0-alpha.3` a introduit ce réglage. La migration n'est pas encore publiée.",
        ),
      ],
      distTags: STABLE,
    });
    expect(ecarts).toEqual([]);
  });

  it("borne le corpus : la doc vivante, les README et skills des paquets — jamais l'historique", () => {
    for (const chemin of [
      "SECURITY.md",
      "docs/tutoriels/premiere-application.md",
      "src/packages/create-nodefony/README.md",
      "src/packages/@nodefony/drizzle/README.md",
      "src/packages/@nodefony/realtime/docs/cookbook-chat.md",
      "src/packages/@nodefony/devkit/skills/nodefony-upgrade/SKILL.md",
      "src/nodefony/docs/kernel.md",
    ])
      expect(estDansLeCorpus(chemin), chemin).toBe(true);
    for (const chemin of [
      "CHANGELOG.md",
      "src/nodefony/CHANGELOG.md",
      "docs/archives/migration-status-2026-09-19.md",
      "docs/session-retros/2026-09-09.md",
      "docs/adr/0026-service-grpc-declare-par-un-module.md",
      "docs/release/nodefony-10.md",
      "src/packages/@nodefony/http/MEMORY.md",
      "src/packages/@nodefony/http/CLAUDE.md",
      "src/packages/@nodefony/http/node_modules/x/README.md",
      "src/packages/@nodefony/http/dist/README.md",
      "src/nodefony/src/cli/README.md",
    ])
      expect(estDansLeCorpus(chemin), chemin).toBe(false);
  });

  it("découvre le corpus RÉEL — les pages qui ont porté `@beta` jusqu'à la stable y sont", () => {
    // La VÉRITÉ du corpus se juge à la publication (`--en-cours`), pas ici :
    // entre la prose de la stable et son tag, elle serait fausse contre le
    // registre du jour. Ce test prouve que la découverte VOIT ces pages.
    const { surfaces } = lireSurfaces();
    const corpus = surfaces
      .filter((s) => s.commandesSeules)
      .map((s) => s.chemin);
    expect(corpus.length).toBeGreaterThan(100);
    expect(corpus).toEqual(
      expect.arrayContaining([
        "SECURITY.md",
        "docs/tutoriels/premiere-application.md",
        "src/packages/create-nodefony/README.md",
        "src/packages/@nodefony/devkit/skills/nodefony-upgrade/SKILL.md",
      ]),
    );
    expect(corpus.some((c) => /CHANGELOG|\/adr\/|archives/.test(c))).toBe(
      false,
    );
  });

  it("🔴 refuse `@latest` dans un bloc tant que `latest` sert la 7 — il ne nomme aucun canal", () => {
    const ecarts = confronterAccueil({
      surfaces: [prose("```bash\nnpm create nodefony@latest mon-app\n```\n")],
      distTags: { latest: "7.0.2", beta: "10.0.0-beta.9" },
    });
    expect(genres(ecarts)).toEqual(["COMMANDE-SANS-CANAL"]);
  });

  it("…et l'accepte le jour où `latest` EST la 10", () => {
    const ecarts = confronterAccueil({
      surfaces: [prose("```bash\nnpm create nodefony@latest mon-app\n```\n")],
      distTags: STABLE,
    });
    expect(ecarts).toEqual([]);
  });
});
