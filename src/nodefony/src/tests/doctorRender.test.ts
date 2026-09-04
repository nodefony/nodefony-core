/**
 * `doctor` — le DOCUMENT qu'un humain lit, éprouvé ligne par ligne.
 *
 * Le rendu est une fonction pure (`rendreRapport`) : largeur, couleur et
 * instant lui sont donnés, il rend des lignes. C'est ce qui permet de vérifier
 * ici ce qu'aucun test ne pouvait atteindre tant que le rapport s'écrivait au
 * fil de l'eau sur la sortie standard — la mise en page elle-même.
 *
 * Ce qu'ils protègent, par ordre d'importance :
 *
 * 1. **Aucune ligne verte pour un contrôle qui n'a rien regardé.** Le reste est
 *    de la présentation ; celui-là est un mensonge.
 * 2. **Rien ne déborde.** Un rapport qui dépasse la largeur se replie sur la
 *    marge du terminal et devient illisible au moment précis où on en a besoin.
 * 3. **Aucune séquence ANSI hors terminal.** Un journal de CI plein de `[33m`
 *    ne se lit pas.
 */
import { describe, it } from "vitest";
import { assert } from "chai";
import {
  rendreRapport,
  grouperParRaison,
  aFaireEnsuite,
  type IOptionsRendu,
} from "../kernel/checks/renderReport";
import {
  doitColorer,
  FAMILLES,
  unitesInsecables,
  type CheckFamily,
  type IExecution,
} from "../kernel/checks/report";
import { usage, parseCheckArgv } from "../kernel/checks/runCheck";
import {
  creerPalette,
  TITRES,
  COUNTED_FAMILIES,
} from "../kernel/checks/report";
import { readFileSync as lireFichier } from "node:fs";
import cheminDeFichier from "node:path";
import { fileURLToPath as versChemin } from "node:url";
import type { ICheckReport } from "../kernel/checks/runCheck";

/** Retire les séquences ANSI pour mesurer la LARGEUR VUE, pas celle écrite. */
const nu = (s: string): string =>
  // eslint-disable-next-line no-control-regex
  s.replace(/\[[0-9;]*m/gu, "");

const ANSI = /\[/u;

/** Un rapport complet, ajusté par ce que le cas veut éprouver. */
const rapport = (patch: Partial<ICheckReport> = {}): ICheckReport => ({
  root: "/app",
  appName: "mon-app 1.0.0",
  scanned: 3,
  findings: [],
  wiring: { scanned: 12, findings: [] },
  readiness: {
    findings: [],
    catalogUnreadable: false,
    portsProbed: [],
    trackedUnknown: null,
  },
  freshness: { findings: [], notComparable: false },
  // Le décor de surface : rien d'ouvert, rien à contredire. Il est EXPLICITE
  // parce que le rapport le porte — un champ absent faisait lever le compteur
  // de manquements, et le test accusait la mise en page.
  surface: {
    findings: [],
    openings: [],
    scanned: 1,
    dialect: "sqlite" as const,
    dialectFrom: "défaut du connecteur",
    entitiesScanned: 0,
  },
  guards: {
    findings: [],
    armed: 5,
    linterUnreadable: false,
    manifestUnreadable: false,
  },
  lastBoots: [],
  exceptions: 0,
  // Toutes les familles ont « tourné » dans ce décor par défaut : ces tests
  // portent sur la MISE EN PAGE, et une famille sautée y ajouterait une section
  // qu'ils ne mesurent pas. Les cas de l'étage 2 vivent dans `doctorLive`.
  // DÉRIVÉ de `FAMILLES` (cf `etats`) : la liste écrite à la main devenait
  // incomplète à chaque famille nouvelle, et le décor mentait sans le dire.
  execution: etats({ ran: true }),
  ...patch,
});

const options = (patch: Partial<IOptionsRendu> = {}): IOptionsRendu => ({
  largeur: 80,
  couleur: false,
  now: Date.parse("2026-09-04T12:00:00Z"),
  strict: false,
  ...patch,
});

/**
 * L'état d'exécution des familles, DÉRIVÉ de `FAMILLES`.
 *
 * Jamais listé à la main : chaque décor écrit en dur devenait incomplet dès
 * qu'une famille naissait, et le rendu tombait sur un `undefined.ran` — quatre
 * décors d'un coup, le jour où l'étage 2 est arrivé.
 *
 * @param defaut - l'état donné à toutes les familles non nommées
 * @param patch - les familles qui font exception
 */
const etats = (
  defaut: IExecution,
  patch: Partial<Record<CheckFamily, IExecution>> = {},
): Record<CheckFamily, IExecution> => {
  const out = {} as Record<CheckFamily, IExecution>;
  for (const f of FAMILLES) out[f] = patch[f] ?? defaut;
  return out;
};

/** Tous les contrôles d'état sautés — le décor « hors application ». */
const horsApplication = (): ICheckReport =>
  rapport({
    scanned: 0,
    wiring: { scanned: 0, findings: [] },
    appName: "",
    execution: etats({
      ran: false,
      reason: "pas d'app",
      short: "hors app",
      unlock: "va dans une app",
    }),
  });

describe("doctor — le rapport ne ment jamais par sa mise en page", () => {
  it("🔴 un contrôle qui n'a rien regardé n'affiche AUCUN signe de succès", () => {
    const lignes = rendreRapport(horsApplication(), options()).map(nu);
    const sommaire = lignes.filter((l) => /^ {2}[✓✗—!] {2}\S/u.test(l));
    assert.isNotEmpty(sommaire, "le sommaire doit exister");
    for (const l of sommaire) {
      assert.notInclude(l, "✓", `ligne verte pour un contrôle non fait : ${l}`);
    }
  });

  it("🔴 le bilan final ne dit pas « rien à signaler » quand rien n'a été fait", () => {
    const lignes = rendreRapport(horsApplication(), options()).map(nu);
    const bilan = lignes.findLast((l) => l.trim() !== "") ?? "";
    assert.include(bilan, "Aucun contrôle n'a pu être fait");
    assert.notInclude(bilan, "Rien à signaler");
    assert.include(bilan, "non contrôlés");
  });

  it("la section « NON CONTRÔLÉ » apparaît MÊME quand tout le reste est vert", () => {
    // Le cas le plus dangereux : un rapport sans le moindre manquement, dont
    // une famille n'a pourtant rien pu ouvrir. Sans cette section, il se lit
    // comme un quitus complet.
    const r = rapport({
      execution: etats(
        { ran: true },
        {
          envCatalog: {
            ran: false,
            reason: "catalogue illisible",
            short: "illisible",
            unlock: "`npm run build`",
          },
        },
      ),
    });
    const texte = rendreRapport(r, options()).map(nu).join("\n");
    assert.include(texte, "NON CONTRÔLÉ");
    assert.include(texte, "catalogue illisible");
    assert.include(texte, "npm run build");
    // Et la conclusion reste juste : ce qui n'a pas été regardé n'est pas
    // « rien à signaler ».
    assert.include(texte, "Rien à signaler parmi les");
  });

  it("🔴 aucune ligne ne dépasse la largeur demandée", () => {
    // Une ligne trop longue se replie sur la marge du terminal : l'indentation
    // saute, et le rapport devient illisible exactement quand on en a besoin.
    const r = rapport({
      freshness: {
        notComparable: false,
        findings: [
          {
            kind: "dist-stale",
            message: `${"des sources ont changé APRÈS le dernier build ".repeat(4)} → \`npm run build\``,
            file: `/un/chemin/vraiment/tres/long/${"segment/".repeat(12)}index.ts`,
          },
        ],
      },
      lastBoots: [
        {
          status: "failed",
          timestamp: "2026-09-04T11:00:00.000Z",
          profile: "console",
          command: "orm:migrate",
          environment: "production",
          phase: "onPreBoot",
          pid: 1,
          node: "v26.0.0",
          criticals: ["firewall : ".padEnd(220, "x")],
          error: { name: "BootError", message: "cause ".repeat(40) },
        },
      ] as ICheckReport["lastBoots"],
      // Un contrôle sauté à raison LONGUE : sans lui, la section « non
      // contrôlé » n'est pas rendue et son repli n'est jamais éprouvé — un
      // décor incomplet fait passer un test qui ne mesure rien.
      execution: etats(
        { ran: true },
        {
          envCatalog: {
            ran: false,
            reason: `${"le catalogue des variables se lit dans le dist ".repeat(3)}`,
            short: "illisible",
            unlock: `${"un geste assez long pour devoir se replier ".repeat(2)}`,
          },
        },
      ),
    });
    // Les DEUX décors : celui qui a des manquements, et celui où tout est
    // sauté — ce dernier joint quatre titres sur une seule ligne, et c'est
    // précisément le genre de ligne qu'on oublie de replier.
    const decors = [r, horsApplication()];
    for (const largeur of [48, 60, 80, 96]) {
      for (const l of decors.flatMap((d) =>
        rendreRapport(d, options({ largeur, strict: true })),
      )) {
        const vue = nu(l);
        // Un chemin d'un seul tenant ne se coupe pas : c'est voulu (le couper
        // le rendrait incopiable). Seul le texte doit tenir.
        if (/^\s*\S+$/u.test(vue)) continue;
        assert.isAtMost(
          vue.length,
          largeur,
          `ligne de ${vue.length} colonnes sur ${largeur} :\n${vue}`,
        );
      }
    }
  });

  it("🔴 hors terminal, PAS une seule séquence ANSI", () => {
    const texte = rendreRapport(
      horsApplication(),
      options({ couleur: false }),
    ).join("\n");
    assert.notMatch(
      texte,
      ANSI,
      "un journal de CI ne doit pas recevoir d'ANSI",
    );
  });

  it("dans un terminal, la couleur est bien émise", () => {
    // L'inverse compte autant : une palette qui ne colore jamais serait un
    // « propre » obtenu en perdant l'information.
    const texte = rendreRapport(
      horsApplication(),
      options({ couleur: true }),
    ).join("\n");
    assert.match(texte, ANSI);
  });

  it("`NO_COLOR` gagne sur tout, `FORCE_COLOR` gagne sur l'absence de terminal", () => {
    assert.isFalse(doitColorer({ NO_COLOR: "1", FORCE_COLOR: "1" }, true));
    assert.isTrue(doitColorer({ FORCE_COLOR: "1" }, false));
    assert.isFalse(doitColorer({ FORCE_COLOR: "0" }, false));
    assert.isTrue(doitColorer({}, true));
    assert.isFalse(doitColorer({}, false));
    // `NO_COLOR=""` ne compte pas : la spécification parle de sa PRÉSENCE avec
    // une valeur, et une variable vide est un accident de script courant.
    assert.isTrue(doitColorer({ NO_COLOR: "" }, true));
  });

  it("le geste est sur SA ligne, jamais noyé dans le constat", () => {
    const r = rapport({
      freshness: {
        notComparable: false,
        findings: [
          {
            kind: "dist-missing",
            message: "l'application n'est pas construite → `npm run build`",
          },
        ],
      },
    });
    const lignes = rendreRapport(r, options()).map(nu);
    // Le geste porte un CHEVRON, pas une flèche : la ligne se lit comme une
    // commande à taper, et le marqueur ne ressemble plus à la ponctuation du
    // constat, où la flèche apparaît aussi.
    const geste = lignes.find((l) => l.includes("▸"));
    assert.isDefined(geste);
    assert.include(geste ?? "", "npm run build");
    assert.notInclude(
      geste ?? "",
      "pas construite",
      "le constat ne doit pas être sur la ligne du geste",
    );
  });

  it("🔴 un mot entre accents graves ne se disloque pas au repli", () => {
    // Vécu : `@entity`, devenait deux unités, que le repli rejoignait par un
    // espace — « `@entity` , ». La ponctuation collée doit suivre son mot.
    assert.deepEqual(unitesInsecables("a `@x`, `@y` b"), [
      "a",
      "`@x`,",
      "`@y`",
      "b",
    ]);
    // Un segment contenant des espaces reste d'un seul tenant.
    assert.deepEqual(unitesInsecables("→ `npm run build`"), [
      "→",
      "`npm run build`",
    ]);
  });

  it("les contrôles sautés pour la MÊME raison ne se répètent pas", () => {
    const groupes = grouperParRaison([
      { famille: "freshness", titre: "A", reason: "r", unlock: "u" },
      { famille: "readiness", titre: "B", reason: "r", unlock: "u" },
      { famille: "deps", titre: "C", reason: "autre", unlock: "u" },
    ]);
    assert.lengthOf(groupes, 2);
    assert.deepEqual(groupes[0]?.titres, ["A", "B"]);
    assert.deepEqual(groupes[1]?.titres, ["C"]);
  });

  it("le sommaire et le détail annoncent les familles dans le MÊME ordre", () => {
    // Deux ordres différents pour les mêmes contrôles, et le lecteur cesse de
    // faire le lien entre ce qu'il a vu en haut et ce qu'il lit en bas.
    const r = rapport({
      execution: etats(
        { ran: true },
        {
          envCatalog: { ran: false, reason: "x", short: "x" },
          wiring: { ran: false, reason: "y", short: "y" },
        },
      ),
    });
    const lignes = rendreRapport(r, options()).map(nu);
    const rang = (mot: string): number =>
      lignes.findIndex((l) => l.includes(mot));
    assert.isBelow(
      rang("Variables déclarées"),
      rang("Câblage"),
      "le sommaire liste Variables déclarées avant Câblage",
    );
    // Et la section « non contrôlé » garde le même ordre.
    const section = lignes.slice(rang("NON CONTRÔLÉ"));
    assert.isBelow(
      section.findIndex((l) => l.includes("Variables déclarées")),
      section.findIndex((l) => l.includes("Câblage")),
    );
  });

  it("le mode strict s'ANNONCE — un code de sortie sans explication se subit", () => {
    const texte = rendreRapport(horsApplication(), options({ strict: true }))
      .map(nu)
      .join("\n");
    assert.include(texte, "mode strict");
  });

  it("sans contrôle sauté, aucune section « non contrôlé » ne s'invite", () => {
    const texte = rendreRapport(rapport(), options()).map(nu).join("\n");
    assert.notInclude(texte, "NON CONTRÔLÉ");
    // Le compte est DÉRIVÉ : les familles comptées (les sous-règles de
    // `readiness` n'en sont pas). L'écrire en dur le rendait faux à la
    // première famille ajoutée, et le test accusait la mise en page.
    assert.include(
      texte,
      `Rien à signaler sur ${COUNTED_FAMILIES.length} contrôles`,
    );
  });

  it("l'en-tête dit d'où l'on a lancé quand ce n'est pas la racine auscultée", () => {
    // Un rapport qui porte sur un autre dossier que celui qu'on croit se lit
    // de travers, dans les deux sens.
    const texte = rendreRapport(
      rapport(),
      options({ lanceDepuis: "/app/modules/blog" }),
    )
      .map(nu)
      .join("\n");
    assert.include(texte, "lancé depuis /app/modules/blog");
    // Et se tait quand c'est le même dossier.
    const memeDossier = rendreRapport(
      rapport(),
      options({ lanceDepuis: "/app" }),
    )
      .map(nu)
      .join("\n");
    assert.notInclude(memeDossier, "lancé depuis");
  });
});

/**
 * Ce que la refonte de la mise en page doit GARDER.
 *
 * Un rendu se juge sur trois questions, dans cet ordre : est-ce que ça va ?
 * qu'est-ce qui ne va pas ? qu'est-ce que je tape ? Les trois réponses doivent
 * être trouvables sans lire le reste — et la troisième doit se copier.
 */
describe("doctor — le rendu répond dans l'ordre des questions", () => {
  const rang = (lignes: string[], motif: string): number =>
    lignes.findIndex((l) => l.includes(motif));

  // 🔴 LE défaut que la refonte corrige : le verdict était en DERNIÈRE ligne.
  // La question qu'on se pose en lançant un diagnostic est « est-ce que ça
  // va ? », et elle n'obtenait sa réponse qu'après soixante lignes de détail.
  it("le verdict précède le détail", () => {
    const lignes = rendreRapport(
      rapport({
        freshness: {
          findings: [{ kind: "dist-stale" as const, message: "x" }],
          notComparable: false,
        },
      }),
      options(),
    ).map(nu);
    const verdict = rang(lignes, "PROBLÈME");
    assert.notEqual(verdict, -1, "le verdict doit être annoncé");
    assert.isBelow(
      verdict,
      rang(lignes, "ÉTAT"),
      "le verdict doit venir AVANT le tableau des contrôles",
    );
  });

  // Un lecteur qui corrige le problème annoncé doit savoir, à la même seconde,
  // que le rapport n'a pas tout regardé — sinon il croira avoir tout vu.
  it("le verdict dit AUSSI les angles morts", () => {
    const r = rapport({
      freshness: {
        findings: [{ kind: "dist-stale" as const, message: "x" }],
        notComparable: false,
      },
      execution: {
        ...rapport().execution,
        migrations: { ran: false, reason: "non demandé", onDemand: true },
      },
    });
    // La ligne se CHERCHE, elle ne se compte pas : l'en-tête fait trois ou
    // quatre lignes selon qu'on a lancé la commande ailleurs que dans l'app,
    // et un index en dur ferait échouer ce test pour une raison sans rapport.
    const bandeau =
      rendreRapport(r, options())
        .map(nu)
        .find((l) => l.includes("PROBLÈME") && !l.includes("─")) ?? "";
    assert.include(bandeau, "PROBLÈME");
    assert.include(bandeau, "angle mort");
  });

  it("tout va bien : le rendu le dit en tête, sans emphase inutile", () => {
    const lignes = rendreRapport(rapport(), options()).map(nu);
    assert.notEqual(rang(lignes, "RIEN À SIGNALER"), -1);
    assert.equal(rang(lignes, "PROBLÈMES"), -1, "aucune section de problèmes");
  });
});

describe("doctor — les gestes, dédoublonnés et copiables", () => {
  // Le même `npm run build` pouvait apparaître sous trois problèmes. Un lecteur
  // qui veut agir devait relire tout le rapport pour reconstituer la liste.
  it("un geste répété n'est listé qu'UNE fois", () => {
    const r = rapport({
      freshness: {
        findings: [
          { kind: "dist-stale" as const, message: "a → `npm run build`" },
        ],
        notComparable: false,
      },
      wiring: {
        scanned: 1,
        findings: [
          {
            kind: "orphan-entity" as const,
            file: "x.ts",
            message: "b → `npm run build`",
          },
        ],
      },
    });
    const gestes = aFaireEnsuite(r, []);
    assert.lengthOf(gestes, 1);
    assert.equal(gestes[0]?.commande, "npm run build");
  });

  it("les gestes des contrôles SAUTÉS y figurent aussi", () => {
    const r = horsApplication();
    const commandes = aFaireEnsuite(
      r,
      grouperParRaison([
        {
          famille: "migrations",
          titre: "Migrations de schéma",
          reason: "il faut démarrer",
          unlock: "`nodefony doctor --live`",
        },
      ]).flatMap((g) => [
        {
          famille: "migrations" as CheckFamily,
          titre: g.titres[0] ?? "",
          reason: g.reason,
          unlock: g.unlock,
        },
      ]),
    ).map((g) => g.commande);
    assert.include(commandes, "nodefony doctor --live");
  });

  // 🔴 Un accent grave collé part AVEC la commande quand on la copie, et le
  // terminal se plaint ensuite d'un fichier introuvable.
  it("aucun accent grave dans la ligne du geste", () => {
    const r = rapport({
      freshness: {
        findings: [
          { kind: "dist-stale" as const, message: "a → `npm run build`" },
        ],
        notComparable: false,
      },
    });
    const lignes = rendreRapport(r, options({ couleur: false })).map(nu);
    const geste = lignes.find((l) => l.includes("▸"));
    assert.isDefined(geste);
    assert.notInclude(geste ?? "", "`");
    assert.include(geste ?? "", "npm run build");
  });

  it("la gouttière tient toutes les lignes d'un même problème", () => {
    const r = rapport({
      freshness: {
        findings: [
          {
            kind: "dist-stale" as const,
            message:
              "une phrase assez longue pour se replier sur au moins trois " +
              "lignes du terminal, ce qui est exactement le cas où l'on perd " +
              "de vue à quel problème elle appartient → `npm run build`",
            file: "env.ts",
          },
        ],
        notComparable: false,
      },
    });
    const lignes = rendreRapport(r, options({ largeur: 60, couleur: false }))
      .map(nu)
      .filter((l) => l.includes("│"));
    assert.isAbove(lignes.length, 2, "le constat doit s'être replié");
    // Toutes à la MÊME colonne : une gouttière qui saute ne relie plus rien.
    const colonnes = new Set(lignes.map((l) => l.indexOf("│")));
    assert.lengthOf([...colonnes], 1);
  });
});

/**
 * L'aide (`doctor --help`) — le premier écran, et souvent le seul qu'on lise.
 *
 * Elle se lit dans deux situations opposées : on découvre la commande, ou l'on
 * vient de se tromper de drapeau. Elle doit donc porter les deux réponses, sans
 * jamais décrire un outil qui n'existe plus.
 */
describe("doctor --help", () => {
  const p = creerPalette(false);

  // 🔴 Une liste écrite en dur vieillit au premier contrôle ajouté, et l'aide
  // se met à décrire autre chose que le produit. Le compteur du bilan a déjà
  // eu ce défaut : il ignorait l'étage 2.
  it("nomme CHAQUE famille de contrôles, sans en oublier une", () => {
    const texte = usage(p, 96);
    for (const famille of COUNTED_FAMILIES) {
      assert.include(
        texte,
        TITRES[famille],
        `« ${TITRES[famille]} » est contrôlé mais l'aide n'en parle pas`,
      );
    }
  });

  // L'aide est la TROISIÈME déclaration des options (avec le parseur et
  // commander) : une option qui n'y figure pas est invisible de qui tape
  // `--help`, c'est-à-dire de tout le monde.
  it("nomme chaque option que le parseur accepte", () => {
    const source = lireFichier(
      cheminDeFichier.join(
        cheminDeFichier.dirname(versChemin(import.meta.url)),
        "../kernel/checks/runCheck.ts",
      ),
      "utf8",
    );
    const zone = source.slice(source.indexOf("export function parseCheckArgv"));
    const drapeaux = new Set(
      [...zone.matchAll(/word === "(--[a-z-]+)"/gu)].map((m) => m[1]),
    );
    drapeaux.delete("--help");
    const texte = usage(p, 96);
    for (const drapeau of drapeaux) {
      assert.include(
        texte,
        drapeau,
        `${drapeau} est accepté mais absent de l'aide`,
      );
    }
  });

  it("porte des exemples et les codes de sortie", () => {
    const texte = usage(p, 96);
    assert.include(texte, "EXEMPLES");
    assert.include(texte, "nodefony doctor --env production");
    assert.include(texte, "CODES DE SORTIE");
    assert.include(texte, "64");
  });

  // Le jargon d'un mainteneur n'est pas celui d'un lecteur : « sous CI » ne dit
  // rien à qui ne connaît pas la variable d'environnement.
  it("explique ce qu'est `CI` au lieu de l'invoquer", () => {
    // Les blancs sont NORMALISÉS avant de chercher : l'aide se replie, et une
    // expression peut être coupée par un retour à la ligne. Chercher dans le
    // texte brut ferait échouer ce test pour une raison de mise en page.
    const plat = usage(p, 96).replace(/\s+/gu, " ");
    assert.include(plat, "variable d'environnement");
  });

  it("ne déborde à AUCUNE largeur", () => {
    for (const largeur of [48, 58, 80, 96]) {
      for (const ligne of usage(p, largeur).split("\n")) {
        if (/^\s*\S+$/u.test(ligne)) continue;
        assert.isAtMost(
          [...ligne].length,
          largeur,
          `aide de ${[...ligne].length} colonnes sur ${largeur} :\n${ligne}`,
        );
      }
    }
  });

  it("`--help` est reconnu par le parseur, jamais rejeté", () => {
    const parsed = parseCheckArgv(["doctor", "--help"]);
    assert.notProperty(parsed, "error");
    assert.isTrue((parsed as { help: boolean }).help);
  });
});
