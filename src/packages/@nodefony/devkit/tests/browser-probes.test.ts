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
  kept: string[];
  unknown: string[];
}
interface IParseProbes {
  probes: { label: string; sel: string }[];
  rejected: string[];
}
interface IParseWidths {
  widths: number[];
  invalidWidths: string[];
}

const FAMILIES = probes["FAMILIES"] as Record<string, string>;
const parseFamilies = fonctionDe<
  (raw: string | undefined, fallback?: string[]) => IParseFamilies
>(probes, "parseFamilies");
const parseProbes = fonctionDe<(raw: string | undefined) => IParseProbes>(
  probes,
  "parseProbes",
);
const parseWidths = fonctionDe<(raw: string | undefined) => IParseWidths>(
  probes,
  "parseWidths",
);
const verdictGlobal = fonctionDe<(verdicts: string[]) => string>(
  probes,
  "verdictGlobal",
);
const median = fonctionDe<(values: number[]) => number | null>(
  probes,
  "median",
);
const browserOrder = fonctionDe<(explicit: string | undefined) => string[]>(
  probes,
  "browserOrder",
);
const authStateName = fonctionDe<(login: string | undefined) => string>(
  probes,
  "authStateName",
);
const environmentDefaults = fonctionDe<
  (stage: { inContainer: boolean; base?: string; out?: string }) => {
    base: string;
    out: string;
  }
>(probes, "environmentDefaults");
const parseColorScheme = fonctionDe<
  (raw: string | undefined) => {
    schema: string | null;
    invalid: string | null;
  }
>(probes, "parseColorScheme");
const parseStorage = fonctionDe<
  (raw: string | undefined) => {
    entries: { key: string; value: string }[];
    rejected: string[];
  }
>(probes, "parseStorage");
// Le rapport d'axe-core est une structure ouverte et versionnée par son
// éditeur : la modéliser en détail ici périmerait au premier changement de
// leur schéma. Le contrat qu'on éprouve est celui de NOTRE résumé.
const summarizeLighthouse = fonctionDe<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forme externe
  (lhr: any, threshold?: number) => any
>(probes, "summarizeLighthouse");
const summarizeAxe = fonctionDe<
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forme externe
  (report: any) => any
>(probes, "summarizeAxe");

describe("parseFamilies — l'allowlist", () => {
  it("retient les familles connues, dans l'ordre demandé", () => {
    expect(parseFamilies("a11y, perf")).toEqual({
      kept: ["a11y", "perf"],
      unknown: [],
    });
  });

  it("« toutes » déplie l'allowlist entière", () => {
    expect(parseFamilies("toutes").kept).toEqual(Object.keys(FAMILIES));
  });

  it("vide rend le défaut, sans invention", () => {
    expect(parseFamilies(undefined, ["rendu"]).kept).toEqual(["rendu"]);
    expect(parseFamilies("", []).kept).toEqual([]);
  });

  it("sens négatif : une famille inconnue est RENDUE, jamais avalée", () => {
    const r = parseFamilies("a11y,inexistante");
    expect(r.kept).toEqual(["a11y"]);
    expect(r.unknown).toEqual(["inexistante"]);
  });

  it("sens négatif : « toString » n'est PAS une famille (piège du prototype)", () => {
    expect(parseFamilies("toString").unknown).toEqual(["toString"]);
  });

  it("dédoublonne", () => {
    expect(parseFamilies("perf,perf").kept).toEqual(["perf"]);
  });
});

describe("parseProbes — libellé=sélecteur", () => {
  it("découpe les entrées bien formées", () => {
    expect(parseProbes("titre=h1, bouton=button[type=submit]")).toEqual({
      probes: [
        { label: "titre", sel: "h1" },
        { label: "bouton", sel: "button[type=submit]" },
      ],
      rejected: [],
    });
  });

  it("sens négatif : une entrée malformée est RENDUE, jamais avalée", () => {
    const r = parseProbes("sansEgal,=h1,ok=body");
    expect(r.probes).toEqual([{ label: "ok", sel: "body" }]);
    expect(r.rejected).toEqual(["sansEgal", "=h1"]);
  });

  it("vide rend vide", () => {
    expect(parseProbes(undefined)).toEqual({ probes: [], rejected: [] });
  });
});

describe("parseWidths — largeurs d'écran", () => {
  it("retient des entiers plausibles, dédoublonnés", () => {
    expect(parseWidths("360,768,360")).toEqual({
      widths: [360, 768],
      invalidWidths: [],
    });
  });

  it("sens négatif : zéro, négatif, texte et hors bornes sont RENDUS invalides", () => {
    const r = parseWidths("0,-5,abc,10000,240,4000");
    expect(r.widths).toEqual([240, 4000]);
    expect(r.invalidWidths).toEqual(["0", "-5", "abc", "10000"]);
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

describe("median — la statistique d'un RTT", () => {
  it("série vide rend null, jamais un zéro inventé", () => {
    expect(median([])).toBeNull();
  });

  it("impaire : l'élément central ; paire : la moyenne des deux centraux", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it("sens négatif : un aberrant ne déplace PAS la médiane (c'est son intérêt)", () => {
    expect(median([2, 3, 2, 3, 5000])).toBe(3);
  });

  it("ne mute pas la série d'entrée", () => {
    const serie = [3, 1, 2];
    median(serie);
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
    expect(r.invalid).toBe("sombre");
  });

  it("le vocabulaire d'une bibliothèque n'est pas celui de la norme", () => {
    // « auto » est courant dans les trousses d'interface, absent de la norme.
    expect(parseColorScheme("auto").invalid).toBe("auto");
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
    expect(r.entries).toEqual([
      { key: "theme", value: "light" },
      { key: "langue", value: "fr" },
    ]);
  });

  it("une valeur peut contenir « = » — seul le PREMIER sépare", () => {
    // Un jeton encodé ou un JSON en valeur : le découper au dernier « = »
    // tronquerait la valeur sans rien dire.
    expect(parseStorage("jeton=a=b=c").entries).toEqual([
      { key: "jeton", value: "a=b=c" },
    ]);
  });

  it("sens négatif : une entrée sans « = » est REJETÉE, pas devinée", () => {
    const r = parseStorage("theme,x=1");
    expect(r.rejected).toEqual(["theme"]);
    expect(r.entries).toEqual([{ key: "x", value: "1" }]);
  });

  it("une clé vide est rejetée — poser « =light » n'a aucun sens", () => {
    expect(parseStorage("=light").rejected).toEqual(["=light"]);
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
describe("summarizeAxe — restituer sans perdre ni inventer", () => {
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
      summarizeAxe({ violations: [], passes: [], incomplete: [] }).verdict,
    ).toBe("OK");
  });

  it("sens négatif : un seul manquement bascule en ALERTE", () => {
    expect(
      summarizeAxe({ violations: [violation("color-contrast", "serious", 1)] })
        .verdict,
    ).toBe("ALERTE");
  });

  it("« à vérifier » N'EST PAS un manquement — le moteur dit qu'il ne conclut pas", () => {
    const r = summarizeAxe({
      violations: [],
      incomplete: [violation("color-contrast", "", 3)],
    });
    expect(r.verdict).toBe("OK");
    expect(r.toReview).toHaveLength(1);
  });

  it("rend PLUSIEURS cibles par règle — huit défauts ne se corrigent pas d'un geste", () => {
    const r = summarizeAxe({
      violations: [violation("color-contrast", "serious", 8)],
    });
    expect(r.worst[0].examples).toHaveLength(5);
    expect(r.worst[0].targets).toBe(8);
    // Ce qui dépasse est ANNONCÉ : une troncature muette se lit « tout est là ».
    expect(r.worst[0].otherTargets).toBe(3);
  });

  it("trie par gravité — le critique se lit en premier", () => {
    const r = summarizeAxe({
      violations: [
        violation("mineur", "minor", 1),
        violation("critique", "critical", 1),
        violation("serieux", "serious", 1),
      ],
    });
    expect(r.worst.map((v: { rule: string }) => v.rule)).toEqual([
      "critique",
      "serieux",
      "mineur",
    ]);
    expect(r.failures.bySeverity.critical).toBe(1);
  });

  it("un rapport sans passes ni incomplete ne fait pas planter le compte", () => {
    const r = summarizeAxe({ violations: [violation("x", "moderate", 1)] });
    expect(r.rulesRun).toBe(1);
    expect(r.passed).toBe(0);
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
describe("environmentDefaults — constater l'endroit, pas le supposer", () => {
  it("en local : la boucle locale, et un dossier relatif au projet", () => {
    const d = environmentDefaults({ inContainer: false });
    expect(d.base).toBe("https://127.0.0.1:5152");
    expect(d.out).toBe("tmp/browser");
  });

  it("en conteneur : le nom de l'hôte vu du dedans, et le volume monté", () => {
    const d = environmentDefaults({ inContainer: true });
    expect(d.base).toBe("https://host.docker.internal:5152");
    expect(d.out).toBe("/output");
  });

  it("les deux côtés DIFFÈRENT — sinon le constat ne servirait à rien", () => {
    // Sens négatif du couple : une implémentation qui ignorerait le verdict
    // passerait les deux tests précédents si elle rendait la même chose ;
    // celui-ci l'interdit.
    expect(environmentDefaults({ inContainer: true }).base).not.toBe(
      environmentDefaults({ inContainer: false }).base,
    );
  });

  it("une valeur explicite l'emporte TOUJOURS sur le constat", () => {
    const d = environmentDefaults({
      inContainer: true,
      base: "https://exemple.test",
      out: "/ailleurs",
    });
    expect(d.base).toBe("https://exemple.test");
    expect(d.out).toBe("/ailleurs");
  });

  it("une chaîne vide n'est pas un choix — elle ne doit pas écraser le défaut", () => {
    // Une variable d'environnement posée puis vidée vaut « non renseignée » :
    // la prendre au mot donnerait une origine vide et une erreur illisible.
    expect(
      environmentDefaults({ inContainer: false, base: "", out: "" }),
    ).toEqual({
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
describe("summarizeLighthouse — un rapport d'un mégaoctet, rendu lisible", () => {
  const report = (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forme externe
    audits: Record<string, any>,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- forme externe
    categories: Record<string, any>,
  ) => ({
    lighthouseVersion: "13.4.1",
    finalDisplayedUrl: "https://exemple.test/x",
    configSettings: { formFactor: "desktop", throttlingMethod: "simulate" },
    audits,
    categories,
  });

  it("rend les scores en pourcentage, et distingue « non noté » de zéro", () => {
    const r = summarizeLighthouse(
      report(
        {},
        {
          perf: { id: "perf", score: 0.3, auditRefs: [] },
          agentic: { id: "agentic", score: null, auditRefs: [] },
        },
      ),
    );
    expect(r.scores).toEqual({ perf: 30, agentic: null });
    expect(r.unscored).toEqual(["agentic"]);
  });

  it("sens négatif : un audit SANS score n'est pas un échec", () => {
    // Vécu : les audits WebMCP et llms.txt sortent à `null` sur une page qui
    // ne les implémente pas. Les compter en échec ferait crier le rapport.
    const r = summarizeLighthouse(
      report(
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
    expect(r.failedAudits.total).toBe(0);
    expect(r.verdict).toBe("OK");
  });

  it("un audit au-dessus du seuil n'est pas retenu", () => {
    const r = summarizeLighthouse(
      report(
        { bon: { score: 0.95, title: "Bon" } },
        { c: { id: "c", score: 0.95, auditRefs: [{ id: "bon", weight: 5 }] } },
      ),
    );
    expect(r.failedAudits.total).toBe(0);
  });

  it("classe par POIDS d'abord — un rouge sans influence ne passe pas devant", () => {
    const r = summarizeLighthouse(
      report(
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
      r.failedAudits.examples.map((a: { audit: string }) => a.audit),
    ).toEqual(["decisif", "broutille"]);
  });

  it("rend le DÉCOR — un score de performance sans son appareil ne veut rien dire", () => {
    const r = summarizeLighthouse(report({}, {}));
    expect(r.stage).toEqual({ device: "desktop", throttling: "simulate" });
  });

  it("un rapport vide ou absent ne fait pas planter le résumé", () => {
    expect(summarizeLighthouse(undefined).verdict).toBe("OK");
    expect(summarizeLighthouse({}).scores).toEqual({});
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
describe("browserOrder — ne rien télécharger sans nécessité", () => {
  it("essaie d'abord celui du pilote, puis ceux DÉJÀ posés sur la machine", () => {
    expect(browserOrder(undefined)).toEqual(["chromium", "chrome", "msedge"]);
  });

  it("inclut Edge — préinstallé sur Windows, donc zéro téléchargement là-bas", () => {
    expect(browserOrder("")).toContain("msedge");
  });

  it("sens négatif : un navigateur EXPLICITE n'est jamais complété par un repli", () => {
    // Se rabattre ici rendrait une mesure attribuée au mauvais navigateur.
    expect(browserOrder("chrome")).toEqual(["chrome"]);
    expect(browserOrder("  msedge  ")).toEqual(["msedge"]);
  });
});

/**
 * Ce que ces tests prouvent : une session appartient à quelqu'un, et son
 * fichier le dit.
 *
 * Le défaut n'est pas hypothétique — il a été mesuré : un état sauvegardé sous
 * un nom unique était repris quel que soit le compte demandé, si bien qu'une
 * sonde lancée pour un utilisateur de moindre privilège rendait l'identité de
 * l'administrateur, sans un mot. Un canal refusé s'ouvrait alors, et l'on
 * concluait que la protection ne mordait pas.
 */
describe("authStateName — un état d'authentification a un propriétaire", () => {
  it("deux identifiants différents ne partagent JAMAIS un fichier", () => {
    expect(authStateName("admin")).not.toBe(authStateName("user"));
  });

  it("le même identifiant rend le même nom — sinon on se reconnecte sans cesse", () => {
    expect(authStateName("admin")).toBe(authStateName("admin"));
  });

  it("reste un nom de fichier utilisable, même sur un identifiant e-mail", () => {
    const nom = authStateName("prenom.nom@example.test");
    // Ni séparateur de chemin, ni caractère refusé par un système de fichiers :
    // un identifiant est une donnée d'entrée, il ne compose pas un chemin.
    expect(nom).not.toMatch(/[/\\:*?"<>|]/u);
    expect(nom.endsWith(".json")).toBe(true);
  });

  it("sens négatif : deux identifiants qui s'assainissent PAREIL restent distincts", () => {
    // `a@b` et `a-b` donnent le même fragment lisible ; sans empreinte, ils
    // partageraient un fichier — exactement le trou qu'on ferme.
    expect(authStateName("a@b")).not.toBe(authStateName("a-b"));
  });

  it("un identifiant absent ne produit pas un nom vide", () => {
    expect(authStateName(undefined).length).toBeGreaterThan("‌.json".length);
  });
});

/**
 * La séquence d'actions (`NF_BROWSER_ACTIONS`) et le signe `=`.
 *
 * Ce banc existe pour un défaut vécu : `=` sert à la fois de séparateur dans la
 * grammaire des actions et d'opérateur dans les sélecteurs CSS d'attribut. Une
 * coupure au premier `=` amputait `[data-active=true]` en `[data-active`, la
 * sonde s'arrêtait sur « cible introuvable », et l'on partait chercher un défaut
 * dans la page — alors qu'on n'avait jamais visé le bon élément.
 */
describe("parseActions — le « = » des sélecteurs CSS n'est pas un séparateur", () => {
  interface IAction {
    verb: string;
    target: string;
    value: string;
  }
  const parseActions = fonctionDe<(b?: string) => IAction[]>(
    probes,
    "parseActions",
  );

  it("garde entier un sélecteur d'attribut sur un verbe SANS valeur", () => {
    expect(parseActions("voir:[data-active=true]")).toEqual([
      { verb: "voir", target: "[data-active=true]", value: "" },
    ]);
  });

  it("coupe la valeur d'un `saisir`, sans casser le sélecteur qui la précède", () => {
    expect(parseActions("saisir:input[name=q]=bonjour")).toEqual([
      { verb: "saisir", target: "input[name=q]", value: "bonjour" },
    ]);
  });

  it("accepte une valeur à espaces — c'est du texte, pas un jeton", () => {
    expect(parseActions("saisir:#nav-q=session redis")).toEqual([
      { verb: "saisir", target: "#nav-q", value: "session redis" },
    ]);
  });

  it("prend `clic` par défaut quand aucun verbe n'est écrit", () => {
    expect(parseActions("Se connecter")).toEqual([
      { verb: "clic", target: "Se connecter", value: "" },
    ]);
  });

  it("lit une SÉQUENCE, dans l'ordre donné", () => {
    expect(parseActions("survol:[aria-expanded=false]|clic:#x")).toEqual([
      { verb: "survol", target: "[aria-expanded=false]", value: "" },
      { verb: "clic", target: "#x", value: "" },
    ]);
  });

  it("sens négatif : une entrée vide ne fabrique pas une action fantôme", () => {
    expect(parseActions("")).toEqual([]);
    expect(parseActions(undefined)).toEqual([]);
    expect(parseActions("clic:#a||clic:#b")).toHaveLength(2);
  });
});
