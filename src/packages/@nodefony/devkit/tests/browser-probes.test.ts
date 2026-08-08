import { describe, it, expect } from "vitest";
import { chargerModule, fonctionDe } from "./browser-outils";

/**
 * Ce que ces tests prouvent : la grammaire de la ligne de commande des sondes
 * REFUSE ce qui doit l'être — une famille inconnue, une sonde malformée, une
 * largeur absurde — au lieu de l'avaler.
 *
 * Le cas « toString » n'est pas un caprice : une allowlist interrogée par `in`
 * accepte toute propriété héritée du prototype, et une « famille » toString
 * passerait sans exister. Le test tient l'implémentation à `Object.hasOwn`.
 */
const probes = await chargerModule(
  "../skills/nodefony-browser/scripts/lib/probes.mjs",
);

interface IParseFamilies {
  retenues: string[];
  inconnues: string[];
}
interface IParseProbes {
  sondes: { label: string; sel: string }[];
  rejetees: string[];
}
interface IParseWidths {
  largeurs: number[];
  invalides: string[];
}

const FAMILLES = probes["FAMILLES"] as Record<string, string>;
const parseFamilies = fonctionDe<
  (brut: string | undefined, defaut?: string[]) => IParseFamilies
>(probes, "parseFamilies");
const parseProbes = fonctionDe<(brut: string | undefined) => IParseProbes>(
  probes,
  "parseProbes",
);
const parseWidths = fonctionDe<(brut: string | undefined) => IParseWidths>(
  probes,
  "parseWidths",
);
const verdictGlobal = fonctionDe<(verdicts: string[]) => string>(
  probes,
  "verdictGlobal",
);
const mediane = fonctionDe<(valeurs: number[]) => number | null>(
  probes,
  "mediane",
);
const ordreNavigateurs = fonctionDe<
  (explicite: string | undefined) => string[]
>(probes, "ordreNavigateurs");
const defautsDecor = fonctionDe<
  (decor: { dansConteneur: boolean; base?: string; out?: string }) => {
    base: string;
    out: string;
  }
>(probes, "defautsDecor");
const parseColorScheme = fonctionDe<
  (brut: string | undefined) => {
    schema: string | null;
    invalide: string | null;
  }
>(probes, "parseColorScheme");
const parseStorage = fonctionDe<
  (brut: string | undefined) => {
    entrees: { cle: string; valeur: string }[];
    rejetees: string[];
  }
>(probes, "parseStorage");
// Le rapport d'axe-core est une structure ouverte et versionnée par son
// éditeur : la modéliser en détail ici périmerait au premier changement de
// leur schéma. Le contrat qu'on éprouve est celui de NOTRE résumé.
const resumeLighthouse = fonctionDe<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forme externe
  (lhr: any, seuil?: number) => any
>(probes, "resumeLighthouse");
const resumeAxe = fonctionDe<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forme externe
  (rapport: any) => any
>(probes, "resumeAxe");

describe("parseFamilies — l'allowlist", () => {
  it("retient les familles connues, dans l'ordre demandé", () => {
    expect(parseFamilies("a11y, perf")).toEqual({
      retenues: ["a11y", "perf"],
      inconnues: [],
    });
  });

  it("« toutes » déplie l'allowlist entière", () => {
    expect(parseFamilies("toutes").retenues).toEqual(Object.keys(FAMILLES));
  });

  it("vide rend le défaut, sans invention", () => {
    expect(parseFamilies(undefined, ["rendu"]).retenues).toEqual(["rendu"]);
    expect(parseFamilies("", []).retenues).toEqual([]);
  });

  it("sens négatif : une famille inconnue est RENDUE, jamais avalée", () => {
    const r = parseFamilies("a11y,inexistante");
    expect(r.retenues).toEqual(["a11y"]);
    expect(r.inconnues).toEqual(["inexistante"]);
  });

  it("sens négatif : « toString » n'est PAS une famille (piège du prototype)", () => {
    expect(parseFamilies("toString").inconnues).toEqual(["toString"]);
  });

  it("dédoublonne", () => {
    expect(parseFamilies("perf,perf").retenues).toEqual(["perf"]);
  });
});

describe("parseProbes — libellé=sélecteur", () => {
  it("découpe les entrées bien formées", () => {
    expect(parseProbes("titre=h1, bouton=button[type=submit]")).toEqual({
      sondes: [
        { label: "titre", sel: "h1" },
        { label: "bouton", sel: "button[type=submit]" },
      ],
      rejetees: [],
    });
  });

  it("sens négatif : une entrée malformée est RENDUE, jamais avalée", () => {
    const r = parseProbes("sansEgal,=h1,ok=body");
    expect(r.sondes).toEqual([{ label: "ok", sel: "body" }]);
    expect(r.rejetees).toEqual(["sansEgal", "=h1"]);
  });

  it("vide rend vide", () => {
    expect(parseProbes(undefined)).toEqual({ sondes: [], rejetees: [] });
  });
});

describe("parseWidths — largeurs d'écran", () => {
  it("retient des entiers plausibles, dédoublonnés", () => {
    expect(parseWidths("360,768,360")).toEqual({
      largeurs: [360, 768],
      invalides: [],
    });
  });

  it("sens négatif : zéro, négatif, texte et hors bornes sont RENDUS invalides", () => {
    const r = parseWidths("0,-5,abc,10000,240,4000");
    expect(r.largeurs).toEqual([240, 4000]);
    expect(r.invalides).toEqual(["0", "-5", "abc", "10000"]);
  });
});

describe("verdictGlobal — l'agrégat n'efface jamais une alerte", () => {
  it("OK seulement si tout est OK", () => {
    expect(verdictGlobal(["OK", "OK"])).toBe("OK");
  });

  it("sens négatif : une seule ALERTE suffit à basculer", () => {
    expect(verdictGlobal(["OK", "ALERTE", "OK"])).toBe("ALERTE");
  });

  it("un verdict non-OK inconnu bascule aussi — le doute n'est pas un OK", () => {
    expect(verdictGlobal(["OK", "REFUSÉ"])).toBe("ALERTE");
  });
});

describe("mediane — la statistique d'un RTT", () => {
  it("série vide rend null, jamais un zéro inventé", () => {
    expect(mediane([])).toBeNull();
  });

  it("impaire : l'élément central ; paire : la moyenne des deux centraux", () => {
    expect(mediane([3, 1, 2])).toBe(2);
    expect(mediane([4, 1, 3, 2])).toBe(2.5);
  });

  it("sens négatif : un aberrant ne déplace PAS la médiane (c'est son intérêt)", () => {
    expect(mediane([2, 3, 2, 3, 5000])).toBe(3);
  });

  it("ne mute pas la série d'entrée", () => {
    const serie = [3, 1, 2];
    mediane(serie);
    expect(serie).toEqual([3, 1, 2]);
  });
});

/**
 * Ce que ces tests prouvent : le choix du THÈME ne s'improvise pas.
 *
 * Un défaut d'interface peut n'exister que dans un schéma de couleurs — vécu :
 * un libellé de menu à 1,62:1 en clair, impeccable en sombre. La sonde doit
 * donc pouvoir DEMANDER un thème ; et si elle accepte en silence une valeur
 * qu'elle ne sait pas appliquer, elle mesure l'autre thème en croyant tenir
 * celui-là — le pire des verdicts, un vert qui n'a rien vu.
 */
describe("parseColorScheme — demander un thème, ou refuser", () => {
  it("rien de demandé ne force rien — null, pas un défaut inventé", () => {
    expect(parseColorScheme(undefined).schema).toBeNull();
    expect(parseColorScheme("").schema).toBeNull();
  });

  it("accepte les valeurs de la média query standard, casse comprise", () => {
    expect(parseColorScheme("light").schema).toBe("light");
    expect(parseColorScheme(" DARK ").schema).toBe("dark");
    expect(parseColorScheme("no-preference").schema).toBe("no-preference");
  });

  it("sens négatif : une valeur inconnue est RENDUE, jamais avalée", () => {
    const r = parseColorScheme("sombre");
    expect(r.schema).toBeNull();
    expect(r.invalide).toBe("sombre");
  });

  it("le vocabulaire d'une bibliothèque n'est pas celui de la norme", () => {
    // « auto » est courant dans les trousses d'interface, absent de la norme.
    expect(parseColorScheme("auto").invalide).toBe("auto");
  });
});

/**
 * Ce que ces tests prouvent : la clé de stockage vient de l'APPELANT.
 *
 * Une application qui mémorise son thème n'obéit plus à `prefers-color-scheme`,
 * et la clé qu'elle emploie lui appartient. Coder celle d'une bibliothèque
 * rendrait la sonde juste pour une seule et faussement rassurante pour toutes
 * les autres.
 */
describe("parseStorage — la précision vit dans l'argument", () => {
  it("découpe des entrées clé=valeur", () => {
    const r = parseStorage("theme=light,langue=fr");
    expect(r.entrees).toEqual([
      { cle: "theme", valeur: "light" },
      { cle: "langue", valeur: "fr" },
    ]);
  });

  it("une valeur peut contenir « = » — seul le PREMIER sépare", () => {
    // Un jeton encodé ou un JSON en valeur : le découper au dernier « = »
    // tronquerait la valeur sans rien dire.
    expect(parseStorage("jeton=a=b=c").entrees).toEqual([
      { cle: "jeton", valeur: "a=b=c" },
    ]);
  });

  it("sens négatif : une entrée sans « = » est REJETÉE, pas devinée", () => {
    const r = parseStorage("theme,x=1");
    expect(r.rejetees).toEqual(["theme"]);
    expect(r.entrees).toEqual([{ cle: "x", valeur: "1" }]);
  });

  it("une clé vide est rejetée — poser « =light » n'a aucun sens", () => {
    expect(parseStorage("=light").rejetees).toEqual(["=light"]);
  });
});

/**
 * Ce que ces tests prouvent : le résumé d'un audit ne PERD pas de défauts.
 *
 * C'est la seule partie qu'on écrit soi-même autour du moteur, donc la seule
 * qui puisse mentir. Deux fautes possibles, toutes deux vécues : ne montrer
 * qu'une cible par règle (on croit le travail fini après la première), et
 * compter comme manquement ce que le moteur a REFUSÉ de trancher.
 */
describe("resumeAxe — restituer sans perdre ni inventer", () => {
  const violation = (id: string, impact: string, n: number) => ({
    id,
    impact,
    help: `aide ${id}`,
    tags: ["wcag2aa", "wcag143"],
    helpUrl: `https://exemple.test/${id}`,
    nodes: Array.from({ length: n }, (_, i) => ({
      target: [`#cible-${i}`],
      html: `<span>${i}</span>`,
      any: [{ message: `constat ${i}` }],
    })),
  });

  it("aucun manquement ⇒ OK", () => {
    expect(
      resumeAxe({ violations: [], passes: [], incomplete: [] }).verdict,
    ).toBe("OK");
  });

  it("sens négatif : un seul manquement bascule en ALERTE", () => {
    expect(
      resumeAxe({ violations: [violation("color-contrast", "serious", 1)] })
        .verdict,
    ).toBe("ALERTE");
  });

  it("« à vérifier » N'EST PAS un manquement — le moteur dit qu'il ne conclut pas", () => {
    const r = resumeAxe({
      violations: [],
      incomplete: [violation("color-contrast", null, 3)],
    });
    expect(r.verdict).toBe("OK");
    expect(r.aVerifier).toHaveLength(1);
  });

  it("rend PLUSIEURS cibles par règle — huit défauts ne se corrigent pas d'un geste", () => {
    const r = resumeAxe({
      violations: [violation("color-contrast", "serious", 8)],
    });
    expect(r.plusGraves[0].exemples).toHaveLength(5);
    expect(r.plusGraves[0].cibles).toBe(8);
    // Ce qui dépasse est ANNONCÉ : une troncature muette se lit « tout est là ».
    expect(r.plusGraves[0].autresCibles).toBe(3);
  });

  it("trie par gravité — le critique se lit en premier", () => {
    const r = resumeAxe({
      violations: [
        violation("mineur", "minor", 1),
        violation("critique", "critical", 1),
        violation("serieux", "serious", 1),
      ],
    });
    expect(r.plusGraves.map((v: { regle: string }) => v.regle)).toEqual([
      "critique",
      "serieux",
      "mineur",
    ]);
    expect(r.manquements.parGravite.critical).toBe(1);
  });

  it("un rapport sans passes ni incomplete ne fait pas planter le compte", () => {
    const r = resumeAxe({ violations: [violation("x", "moderate", 1)] });
    expect(r.reglesJouees).toBe(1);
    expect(r.conformes).toBe(0);
  });
});

/**
 * Ce que ces tests prouvent : la sonde tourne aux DEUX endroits, et le sait
 * parce qu'on le lui dit.
 *
 * L'enjeu n'est pas cosmétique. `127.0.0.1` désigne le conteneur LUI-MÊME
 * quand on s'exécute dedans : se tromper de côté fait mesurer une connexion
 * refusée et conclure que l'application est en panne. Et le déduire de la
 * plateforme serait faux dans les deux sens — un conteneur Linux sur un poste
 * macOS rend le même `process.platform` qu'un poste Linux nu.
 *
 * Le verdict est donc INJECTÉ : c'est ce qui rend les deux côtés éprouvables
 * ici, sans conteneur et sans toucher à l'environnement du test.
 */
describe("defautsDecor — constater l'endroit, pas le supposer", () => {
  it("en local : la boucle locale, et un dossier relatif au projet", () => {
    const d = defautsDecor({ dansConteneur: false });
    expect(d.base).toBe("https://127.0.0.1:5152");
    expect(d.out).toBe("tmp/browser");
  });

  it("en conteneur : le nom de l'hôte vu du dedans, et le volume monté", () => {
    const d = defautsDecor({ dansConteneur: true });
    expect(d.base).toBe("https://host.docker.internal:5152");
    expect(d.out).toBe("/output");
  });

  it("les deux côtés DIFFÈRENT — sinon le constat ne servirait à rien", () => {
    // Sens négatif du couple : une implémentation qui ignorerait le verdict
    // passerait les deux tests précédents si elle rendait la même chose ;
    // celui-ci l'interdit.
    expect(defautsDecor({ dansConteneur: true }).base).not.toBe(
      defautsDecor({ dansConteneur: false }).base,
    );
  });

  it("une valeur explicite l'emporte TOUJOURS sur le constat", () => {
    const d = defautsDecor({
      dansConteneur: true,
      base: "https://exemple.test",
      out: "/ailleurs",
    });
    expect(d.base).toBe("https://exemple.test");
    expect(d.out).toBe("/ailleurs");
  });

  it("une chaîne vide n'est pas un choix — elle ne doit pas écraser le défaut", () => {
    // Une variable d'environnement posée puis vidée vaut « non renseignée » :
    // la prendre au mot donnerait une origine vide et une erreur illisible.
    expect(defautsDecor({ dansConteneur: false, base: "", out: "" })).toEqual({
      base: "https://127.0.0.1:5152",
      out: "tmp/browser",
    });
  });
});

/**
 * Ce que ces tests prouvent : un rapport Lighthouse ne se résume pas naïvement.
 *
 * Deux confusions rendraient le résumé MENTEUR, et toutes deux sont faciles à
 * commettre : traiter un audit sans score comme un échec (il y en a plusieurs
 * par page — ils ne s'appliquent simplement pas), et classer les échecs par
 * score plutôt que par POIDS, ce qui remonte des broutilles sans influence
 * pendant qu'un audit décisif reste plus bas.
 */
describe("resumeLighthouse — un rapport d'un mégaoctet, rendu lisible", () => {
  const rapport = (audits, categories) => ({
    lighthouseVersion: "13.4.1",
    finalDisplayedUrl: "https://exemple.test/x",
    configSettings: { formFactor: "desktop", throttlingMethod: "simulate" },
    audits,
    categories,
  });

  it("rend les scores en pourcentage, et distingue « non noté » de zéro", () => {
    const r = resumeLighthouse(
      rapport(
        {},
        {
          perf: { id: "perf", score: 0.3, auditRefs: [] },
          agentic: { id: "agentic", score: null, auditRefs: [] },
        },
      ),
    );
    expect(r.scores).toEqual({ perf: 30, agentic: null });
    expect(r.nonNotees).toEqual(["agentic"]);
  });

  it("sens négatif : un audit SANS score n'est pas un échec", () => {
    // Vécu : les audits WebMCP et llms.txt sortent à `null` sur une page qui
    // ne les implémente pas. Les compter en échec ferait crier le rapport.
    const r = resumeLighthouse(
      rapport(
        { "llms-txt": { score: null, title: "llms.txt" } },
        {
          agentic: {
            id: "agentic",
            score: 1,
            auditRefs: [{ id: "llms-txt", weight: 0 }],
          },
        },
      ),
    );
    expect(r.auditsRates.total).toBe(0);
    expect(r.verdict).toBe("OK");
  });

  it("un audit au-dessus du seuil n'est pas retenu", () => {
    const r = resumeLighthouse(
      rapport(
        { bon: { score: 0.95, title: "Bon" } },
        { c: { id: "c", score: 0.95, auditRefs: [{ id: "bon", weight: 5 }] } },
      ),
    );
    expect(r.auditsRates.total).toBe(0);
  });

  it("classe par POIDS d'abord — un rouge sans influence ne passe pas devant", () => {
    const r = resumeLighthouse(
      rapport(
        {
          broutille: { score: 0, title: "Broutille" },
          decisif: { score: 0.5, title: "Décisif" },
        },
        {
          c: {
            id: "c",
            score: 0.4,
            auditRefs: [
              { id: "broutille", weight: 0 },
              { id: "decisif", weight: 10 },
            ],
          },
        },
      ),
    );
    expect(
      r.auditsRates.exemples.map((a: { audit: string }) => a.audit),
    ).toEqual(["decisif", "broutille"]);
  });

  it("rend le DÉCOR — un score de performance sans son appareil ne veut rien dire", () => {
    const r = resumeLighthouse(rapport({}, {}));
    expect(r.decor).toEqual({ appareil: "desktop", bridage: "simulate" });
  });

  it("un rapport vide ou absent ne fait pas planter le résumé", () => {
    expect(resumeLighthouse(undefined).verdict).toBe("OK");
    expect(resumeLighthouse({}).scores).toEqual({});
  });
});

/**
 * Ce que ces tests prouvent : on ne télécharge un navigateur qu'en dernier
 * recours, et un choix EXPLICITE ne se contourne jamais.
 *
 * Le premier point est une question de barrière à l'entrée : exiger cent
 * mégaoctets avant de pouvoir regarder un écran décourage l'usage. La plupart
 * des postes ont déjà un navigateur — et sous Windows, Edge est préinstallé.
 *
 * Le second est une question de vérité de la mesure : se rabattre en silence
 * sur un autre navigateur que celui demandé attribuerait des chiffres au
 * mauvais moteur.
 */
describe("ordreNavigateurs — ne rien télécharger sans nécessité", () => {
  it("essaie d'abord celui du pilote, puis ceux DÉJÀ posés sur la machine", () => {
    expect(ordreNavigateurs(undefined)).toEqual([
      "chromium",
      "chrome",
      "msedge",
    ]);
  });

  it("inclut Edge — préinstallé sur Windows, donc zéro téléchargement là-bas", () => {
    expect(ordreNavigateurs("")).toContain("msedge");
  });

  it("sens négatif : un navigateur EXPLICITE n'est jamais complété par un repli", () => {
    // Se rabattre ici rendrait une mesure attribuée au mauvais navigateur.
    expect(ordreNavigateurs("chrome")).toEqual(["chrome"]);
    expect(ordreNavigateurs("  msedge  ")).toEqual(["msedge"]);
  });
});
