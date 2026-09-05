/**
 * Suite du gate de langue des identifiants — écrite pour le faire ÉCHOUER,
 * pas pour l'accompagner.
 *
 * Deux façons de mourir pour cet outil, et chacune a ses cas ici :
 *  - crier FAUX sur du français légitime (commentaires, chaînes, gabarits,
 *    texte JSX) ou sur un mot anglais qui ressemble à du français (`content`,
 *    `success`, `classes`) — un gate qui crie faux apprend à passer outre ;
 *  - se TAIRE sur un identifiant français déclaré (`rendreRapport`,
 *    `controlesSautes`) parce que l'extraction l'a raté, ou parce qu'une
 *    exception l'a absorbé sans le dire.
 *
 * Les cas marqués « PIÈGE » sont ceux où une implémentation plausible passe à
 * côté. Lancer : `node scripts/check-identifier-language.test.mjs`.
 */
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import {
  EXCLUDED_HOMOGRAPHS,
  FRENCH_DICTIONARY,
  DEFAULT_EXCEPTIONS,
  analyzeSource,
  applyExceptions,
  extractDeclaredIdentifiers,
  frenchWordOf,
  isProductionFile,
  judgeIdentifier,
  normalizeWord,
  scanRepo,
  splitIdentifier,
  stripProse,
  stripShellProse,
  extractShellIdentifiers,
} from "./check-identifier-language.mjs";

/** Les noms déclarés d'un source, dans l'ordre, sans les lignes. */
const declared = (src) =>
  extractDeclaredIdentifiers(stripProse(src)).map((d) => d.name);
/** Les identifiants FAUTIFS d'un source. */
const faulty = (src, file = "x.ts") =>
  analyzeSource(src, file).map((f) => f.identifier);

// ═══════════════════════════════════════════════════════════════════════════
describe("splitIdentifier — toutes les conventions", () => {
  // (pas d'`it.each` en node:test — une boucle fait le même travail)
  const cases = [
    ["renderReport", ["render", "Report"]],
    ["RenderReport", ["Render", "Report"]],
    ["render_report", ["render", "report"]],
    ["RENDER_REPORT", ["RENDER", "REPORT"]],
    // PIÈGE : un découpage naïf `[A-Z][a-z]*` rend `H`, `T`, `T`, `P`, `Server`.
    ["HTTPServer", ["HTTP", "Server"]],
    ["parseHTTPResponse", ["parse", "HTTP", "Response"]],
    ["getX", ["get", "X"]],
    ["utf8Decode", ["utf", "8", "Decode"]],
    ["ligne2", ["ligne", "2"]],
    ["_private", ["private"]],
    ["$scope", ["scope"]],
    ["#largeur", ["largeur"]],
    ["__proto__", ["proto"]],
    ["a", ["a"]],
  ];
  for (const [input, expected] of cases) {
    it(`${input} → ${JSON.stringify(expected)}`, () => {
      assert.deepEqual(splitIdentifier(input), expected);
    });
  }
});

describe("normalizeWord — accents et casse", () => {
  it("ramène `Contrôlé` et `controle` sur la même forme", () => {
    assert.equal(normalizeWord("Contrôlé"), "controle");
    assert.equal(normalizeWord("SAUTÉES"), "sautees");
    assert.equal(normalizeWord("déjà"), "deja");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("frenchWordOf — la décision mot à mot", () => {
  it("reconnaît les mots français, accentués ou non, au singulier et au pluriel", () => {
    for (const [w, base] of [
      ["rendre", "rendre"],
      ["controle", "controle"],
      ["contrôle", "controle"],
      ["controles", "controle"],
      ["largeur", "largeur"],
      ["filet", "filet"],
      ["accord", "accord"],
      ["sautes", "saute"],
      ["sautées", "sautee"],
      ["fichier", "fichier"],
      ["donnees", "donnee"],
      ["jeux", "jeu"],
      ["canaux", "canal"],
      ["TITRES", "titre"],
      ["Etat", "etat"],
      ["sorties", "sortie"],
      ["choisis", "choisi"],
    ])
      assert.equal(frenchWordOf(w), base, w);
  });

  it("laisse passer les mots anglais courants du code", () => {
    for (const w of [
      "render",
      "report",
      "skipped",
      "checks",
      "usable",
      "width",
      "content",
      "type",
      "parse",
      "argv",
      "format",
      "date",
      "route",
      "params",
      "page",
      "parent",
      "port",
      "signature",
      "instance",
      "application",
      "configuration",
      "service",
      "module",
      "option",
      "import",
      "export",
      "message",
      "information",
      "version",
      "simple",
      "double",
      "total",
      "long",
      "important",
      "possible",
      "distance",
      "direction",
      "question",
      "action",
      "section",
      "position",
      "condition",
      "cache",
      "charge",
      "pose",
      "retire",
      "lance",
      "execute",
      "compiler",
      "installer",
      "analyse",
      "decide",
      "premier",
      "debut",
      "fin",
      "centre",
      "pendant",
      "sans",
      "pour",
      "par",
      "non",
      "vue",
      "ensemble",
      "file",
      "pile",
      "flux",
      "suite",
      "tour",
      "part",
      "passe",
      "cadre",
      "lieu",
      "tranche",
      "comment",
      "dont",
      "est",
      "plus",
      "net",
      "sale",
      "grand",
      "court",
      "large",
      "fort",
      "active",
      "complete",
      "resume",
      "police",
      "patron",
      "verifier",
      "modifier",
      "porter",
      "planter",
      "change",
      "gain",
      "cable",
      "lent",
      "loin",
      "encore",
      "meme",
      "verdict",
      "phrase",
      "cause",
      "rang",
      "devise",
      "series",
      "classes",
      "branches",
      "indices",
      "taxes",
    ])
      assert.equal(frenchWordOf(w), null, w);
  });

  it("PIÈGE : `success` n'est pas `succes` + s, `gross` n'est pas `gros` + s", () => {
    assert.equal(frenchWordOf("success"), null);
    assert.equal(frenchWordOf("Success"), null);
    assert.equal(frenchWordOf("gross"), null);
    assert.equal(frenchWordOf("bass"), null);
    // …mais le mot français nu, lui, sort.
    assert.equal(frenchWordOf("succes"), "succes");
    assert.equal(frenchWordOf("gros"), "gros");
  });

  it("PIÈGE : `-ies` est un pluriel anglais — `copies`, `categories`, `replies`, `verifies`", () => {
    for (const w of [
      "copies",
      "categories",
      "strategies",
      "hierarchies",
      "replies",
      "verifies",
      "modifies",
      "justifies",
      "parties",
    ])
      assert.equal(frenchWordOf(w), null, w);
    // Les pluriels français en -ies qui existent vraiment restent attrapés.
    assert.equal(frenchWordOf("sorties"), "sortie");
    assert.equal(frenchWordOf("saisies"), "saisie");
  });

  it("ignore les mots de moins de trois lettres et les chiffres", () => {
    for (const w of ["de", "la", "le", "et", "ou", "a", "y", "42", "8", ""])
      assert.equal(frenchWordOf(w), null, w);
  });

  it("PIÈGE : le mot `de` dans `deSerialize` et `non` dans `nonNull` ne sortent pas", () => {
    assert.deepEqual(judgeIdentifier("deSerialize").words, []);
    assert.deepEqual(judgeIdentifier("nonNull").words, []);
    assert.deepEqual(judgeIdentifier("triState").words, []);
    assert.deepEqual(judgeIdentifier("codeVerifier").words, []);
  });
});

describe("le dictionnaire lui-même", () => {
  it("ne contient AUCUN des homographes exclus (un ajout distrait ferait crier le gate)", () => {
    const leaked = EXCLUDED_HOMOGRAPHS.filter((w) =>
      FRENCH_DICTIONARY.has(normalizeWord(w)),
    );
    assert.deepEqual(leaked, []);
  });

  it("ne contient que des formes sans accent, en minuscules, d'au moins trois lettres", () => {
    for (const w of FRENCH_DICTIONARY) {
      assert.equal(w, normalizeWord(w), w);
      assert.ok(w.length >= 3, w);
    }
  });

  it("contient les mots du module renommé en bloc (`kernel/checks/`)", () => {
    for (const w of [
      "rendre",
      "controle",
      "largeur",
      "filet",
      "accord",
      "saute",
      "utile",
    ])
      assert.ok(FRENCH_DICTIONARY.has(w), w);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("judgeIdentifier — les cas vrais des deux côtés", () => {
  it("fait sortir les identifiants français", () => {
    for (const [id, words] of [
      ["rendreRapport", ["rendre", "rapport"]],
      ["controlesSautes", ["controle", "saute"]],
      ["largeurUtile", ["largeur", "utile"]],
      ["filet", ["filet"]],
      ["accord", ["accord"]],
      ["IControleSaute", ["controle", "saute"]],
      ["FAMILLES", ["famille"]],
      ["nomDeFichier", ["nom", "fichier"]],
      ["porteDejaLaCle", ["porte", "deja", "cle"]],
    ]) {
      assert.deepEqual(
        judgeIdentifier(id).words.map((w) => w.french),
        words,
        id,
      );
    }
  });

  it("laisse passer les identifiants anglais", () => {
    for (const id of [
      "renderReport",
      "skippedChecks",
      "usableWidth",
      "contentType",
      "parseArgv",
      "formatDate",
      "routeParams",
      "onSuccess",
      "IJsonRpcSuccess",
      "successRedirect",
      "linterCategories",
      "gitBranches",
      "cssClasses",
      "portNumber",
      "pageSize",
      "parentNode",
      "signatureHeader",
      "serviceInstance",
      "importMeta",
      "exportName",
      "totalCount",
      "longRunning",
      "cacheKey",
      "chargeAmount",
      "installerPath",
      "compilerOptions",
      "resumeToken",
      "netSocket",
      "fileName",
      "flux",
      "suite",
      "HTTPServer",
      "MAX_RETRY_COUNT",
      "__proto__",
      "$scope",
      "_id",
    ])
      assert.deepEqual(judgeIdentifier(id).words, [], id);
  });

  it("propose une traduction quand chaque mot français en a une, en gardant la casse", () => {
    assert.equal(judgeIdentifier("rendreRapport").suggestion, "renderReport");
    // Mot à mot, l'ordre français reste : c'est une piste, pas un renommage.
    assert.equal(judgeIdentifier("largeurUtile").suggestion, "widthUsable");
    assert.equal(judgeIdentifier("LIMITE_MS").suggestion, "LIMIT_MS");
    assert.equal(judgeIdentifier("IControleSaute").suggestion, "ICheckSkipped");
    assert.equal(judgeIdentifier("familles").suggestion, "families");
    assert.equal(
      judgeIdentifier("controlesSautes").suggestion,
      "checksSkipped",
    );
  });

  it("ne propose RIEN quand un mot français n'a pas de traduction connue", () => {
    const { words, suggestion } = judgeIdentifier("identiteAgent");
    assert.ok(words.length > 0);
    assert.equal(suggestion, null);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("stripProse — commentaires, chaînes, gabarits, regex", () => {
  it("blanchit les commentaires de ligne et de bloc en gardant les lignes", () => {
    const src =
      "const a = 1; // rendre le rapport\n/* largeur\n utile */\nconst b = 2;\n";
    const out = stripProse(src);
    assert.equal(out.length, src.length);
    assert.equal(out.split("\n").length, src.split("\n").length);
    assert.ok(!out.includes("rendre"));
    assert.ok(!out.includes("largeur"));
    assert.ok(out.includes("const b = 2"));
  });

  it("blanchit les chaînes simples et doubles, échappements compris", () => {
    const out = stripProse(
      `const s = "il n'y a \\"rien\\" à rendre"; const t = 'largeur';`,
    );
    assert.ok(!out.includes("rendre"));
    assert.ok(!out.includes("largeur"));
    assert.ok(out.includes("const s ="));
    assert.ok(out.includes("const t ="));
  });

  it("PIÈGE : un gabarit garde le CODE de ses ${} et blanchit son texte", () => {
    const out = stripProse(
      "const m = `largeur ${(ligne) => ligne + 1} utile`;",
    );
    assert.ok(!out.includes("largeur"));
    assert.ok(!out.includes("utile"));
    assert.ok(out.includes("(ligne) => ligne + 1"));
  });

  it("PIÈGE : gabarits imbriqués — l'accolade d'un objet dans ${} ne ferme pas le gabarit", () => {
    const src =
      "const m = `a ${cond ? `b${x}` : `c`} d ${ { rendu: 1 }.rendu } e`;\nconst apres = 1;";
    const out = stripProse(src);
    assert.ok(out.includes("const apres = 1"));
    assert.ok(out.includes("{ rendu: 1 }.rendu"));
    assert.ok(!out.includes(" a "), "le texte du gabarit est blanchi");
  });

  it("blanchit une expression régulière mais pas une division", () => {
    const out = stripProse(
      "const re = /rendre|largeur/gi; const q = total / largeur;",
    );
    assert.ok(!out.includes("rendre"));
    assert.ok(out.includes("total / largeur"));
  });

  it("PIÈGE : une apostrophe dans du texte JSX n'ouvre pas une chaîne sans fin", () => {
    const src = "<p>l'écran d'accueil</p>\nconst largeur = 1;\n";
    const out = stripProse(src);
    assert.ok(out.includes("const largeur = 1"));
  });

  it("PIÈGE : `</div>` n'ouvre pas une expression régulière", () => {
    const src = "<div>x</div>\nconst largeur = 1;\n";
    assert.ok(stripProse(src).includes("const largeur = 1"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("extractDeclaredIdentifiers — ce qui est déclaré, et rien d'autre", () => {
  it("fonctions, classes, interfaces, types, enums et leurs membres", () => {
    const names = declared(`
export function rendreRapport(largeur: number, { couleur }: IOptionsRendu): string {}
export class Rapport extends Base implements IRapport {}
export interface IControleSaute { titre: string; raison?: string }
export type EtatSection = "ok" | "ko";
enum Famille { Rouge = 1, Vert, Bleu = "b" }
export async function* generer() {}
`);
    for (const n of [
      "rendreRapport",
      "largeur",
      "couleur",
      "Rapport",
      "IControleSaute",
      "titre",
      "raison",
      "EtatSection",
      "Famille",
      "Rouge",
      "Vert",
      "Bleu",
      "generer",
    ])
      assert.ok(names.includes(n), n);
    for (const n of [
      "Base",
      "IRapport",
      "string",
      "number",
      "extends",
      "implements",
      "ok",
    ])
      assert.ok(!names.includes(n), `${n} ne doit pas être déclaré`);
  });

  it("const / let / var, destructuration objet et tableau, imbriquée, avec défauts", () => {
    const names = declared(`
const largeur = 80;
let { titre, raison: motif, ...reste } = options;
var [premier, second = 2, [troisieme]] = liste;
const { a: { b: profondeur } } = x;
for (const ligne of lignes) {}
`);
    for (const n of [
      "largeur",
      "titre",
      "motif",
      "reste",
      "premier",
      "second",
      "troisieme",
      "profondeur",
      "ligne",
    ])
      assert.ok(names.includes(n), n);
    // PIÈGE : la CLÉ `raison` d'un `{ raison: motif }` n'est pas déclarée, l'alias l'est.
    assert.ok(!names.includes("raison"));
    assert.ok(!names.includes("options"));
    assert.ok(!names.includes("lignes"));
  });

  it("méthodes, accesseurs, signatures d'interface, constructeur à propriétés de paramètre", () => {
    const names = declared(`
class Rendu {
  private largeur = 80;
  readonly couleur: boolean;
  #sautes: number[] = [];
  constructor(private readonly filet: string, public accord: number) {}
  get titre(): string { return ""; }
  static async rendre(lignes: string[]): Promise<void> {}
  *iterer() {}
}
interface IRapport {
  rendre(largeur: number): string;
  replier(): void;
}
`);
    for (const n of [
      "largeur",
      "couleur",
      "#sautes",
      "filet",
      "accord",
      "titre",
      "rendre",
      "lignes",
      "iterer",
      "replier",
    ])
      assert.ok(names.includes(n), n);
    assert.ok(!names.includes("constructor"));
    assert.ok(!names.includes("Promise"));
  });

  it("PIÈGE : un APPEL en début de ligne n'est pas une déclaration", () => {
    const names = declared(`
  rendreRapport(largeur);
  afficher(x)
    .then(y);
  if (largeur) {}
  for (const i of x) {}
  while (ok) {}
  switch (etat) { case 1: break; default: break; }
  try { lire(); } catch (erreur) {}
  return rendre(a, b);
  new Rapport(1);
  await charger(f);
  it("largeur", () => {});
  describe("rendu", () => {
    foo(bar);
  });
`);
    for (const n of [
      "rendreRapport",
      "afficher",
      "lire",
      "rendre",
      "charger",
      "it",
      "describe",
      "foo",
      "Rapport",
      "if",
      "for",
      "while",
      "switch",
      "case",
      "default",
    ])
      assert.ok(!names.includes(n), `${n} est un appel, pas une déclaration`);
    // …mais la clause catch lie bien `erreur`.
    assert.ok(names.includes("erreur"));
  });

  it("flèches : paramètres entre parenthèses, param nu, async, type de retour", () => {
    const names = declared(`
const f = (largeur, hauteur = 1) => largeur;
const g = async ({ titre }) => titre;
const h = ligne => ligne;
const k = (x): number => x;
items.map((element) => element.id);
export default (racine) => racine;
`);
    for (const n of [
      "largeur",
      "hauteur",
      "titre",
      "ligne",
      "x",
      "element",
      "racine",
    ])
      assert.ok(names.includes(n), n);
    assert.ok(!names.includes("items"));
    assert.ok(!names.includes("map"));
  });

  it("propriétés d'objet et membres typés, clé collée au `:` comme prettier l'écrit", () => {
    const names = declared(`
const options = { largeur: 80, couleur: true, "clé-quotée": 1, [dyn]: 2 };
type T = { titre: string; sautes?: number };
`);
    for (const n of ["largeur", "couleur", "titre", "sautes"])
      assert.ok(names.includes(n), n);
    assert.ok(!names.includes("dyn"));
  });

  it("PIÈGE : un ternaire, un `case`, un `?.` ou un `::` ne déclarent rien", () => {
    const names = declared(`
const v = cond ? largeur : hauteur;
const w = cond
  ? largeur
  : hauteur;
switch (x) { case Etat.Ok: y(); }
const z = obj?.largeur;
`);
    assert.ok(!names.includes("hauteur"));
    assert.ok(!names.includes("Etat"));
    assert.ok(!names.includes("obj"));
    assert.ok(!names.includes("cond"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("analyzeSource — prose française tolérée, identifiants français refusés", () => {
  it("un fichier de production propre, entièrement commenté en français, ne sort RIEN", () => {
    const src = `
/**
 * Rendre le rapport tel qu'un HUMAIN le lit — largeur utile, filet, accord.
 * @param options - le décor du rendu
 */
export function renderReport(options: IRenderOptions): string {
  // la largeur est déjà bornée par l'appelant
  const lines = []; // une ligne par contrôle sauté
  const label = "Contrôles sautés : " + options.skipped.length;
  const re = /sauté|manquant/u;
  return \`\${label} — largeur \${options.width}\`;
}
export const MESSAGES = { missing: "fichier manquant", forbidden: "accès refusé" };
`;
    assert.deepEqual(faulty(src), []);
  });

  it("PIÈGE : du texte JSX en français, typographie française comprise, ne sort pas", () => {
    const src = `
export function Panel({ count }: IPanelProps) {
  return (
    <section>
      <h2>Contrôles sautés</h2>
      <p>
        Lignes : {count}
      </p>
      <p>Aucun résultat, l'écran est vide.</p>
    </section>
  );
}
`;
    assert.deepEqual(faulty(src, "Panel.tsx"), []);
  });

  it("fait sortir les identifiants français, une fois par nom, avec ligne, mots et suggestion", () => {
    const src = `
export function rendreRapport(largeur: number): string {
  const lignes: string[] = [];
  return lignes.join("\\n");
}
const filet = 1;
`;
    const findings = analyzeSource(src, "renderReport.ts");
    const byId = Object.fromEntries(findings.map((f) => [f.identifier, f]));
    assert.deepEqual(Object.keys(byId).sort(), [
      "filet",
      "largeur",
      "lignes",
      "rendreRapport",
    ]);
    assert.equal(byId.rendreRapport.line, 2);
    assert.equal(byId.rendreRapport.file, "renderReport.ts");
    assert.equal(byId.rendreRapport.suggestion, "renderReport");
    assert.equal(byId.lignes.occurrences, 1); // la déclaration, pas les usages
    assert.deepEqual(
      byId.filet.words.map((w) => w.french),
      ["filet"],
    );
  });

  it("compte les redéclarations d'un même nom sans les dédoubler dans le rapport", () => {
    const src =
      "function a(largeur: number) {}\nfunction b(largeur: number) {}\n";
    const findings = analyzeSource(src);
    assert.equal(findings.length, 1);
    assert.equal(findings[0].occurrences, 2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("SHELL — un autre langage, donc un autre automate", () => {
  it("stripShellProse blanchit les commentaires `#` en gardant les lignes", () => {
    const out = stripShellProse("A=1 # contrôle sauté\nB=2\n");
    assert.ok(!out.includes("contrôle"), "le commentaire doit être blanchi");
    assert.ok(out.includes("A=1"), "le code doit rester");
    assert.equal(out.split("\n").length, 3, "les lignes sont conservées");
  });

  it("PIÈGE : `#` collé à un mot n'ouvre PAS un commentaire (`${#tab[@]}`)", () => {
    const out = stripShellProse("N=${#tab[@]}\nlargeur=1\n");
    assert.ok(
      out.includes("largeur=1"),
      "la ligne suivante ne doit pas être avalée",
    );
  });

  it("PIÈGE : un `\\` final ne prolonge PAS une chaîne forte (règle JS ≠ règle shell)", () => {
    // En bash, `'…'` se ferme à la PREMIÈRE apostrophe suivante, même précédée
    // d'un antislash : `\\` n'y échappe rien. Un automate qui applique la règle
    // JavaScript croirait la chaîne encore ouverte et avalerait la suite.
    const out = stripShellProse("A='texte\\'\nlargeur=1\n");
    assert.ok(
      out.includes("largeur=1"),
      "la chaîne doit se fermer, la ligne suivante survivre",
    );
    assert.ok(!out.includes("texte"), "son contenu doit être blanchi");
  });

  it("blanchit un document en ligne entier, marqueur nu ou quoté", () => {
    for (const open of ["<<EOF", "<<-EOF", "<<'EOF'", '<<"EOF"']) {
      const out = stripShellProse(
        `cat ${open}\ndu texte français : largeur\nEOF\nrendre=1\n`,
      );
      assert.ok(!out.includes("texte français"), open);
      assert.ok(
        out.includes("rendre=1"),
        `${open} — le code après doit survivre`,
      );
    }
  });

  it("extrait fonctions, local/readonly/export, affectations nues et boucles", () => {
    const src = [
      "rendre_rapport() {",
      "  local titre=1",
      "  readonly LARGEUR=2",
      "  export CHEMIN=3",
      "}",
      "function tracer_courbe {",
      "  compteur=0",
      "}",
      "for fichier in *.txt; do :; done",
    ].join("\n");
    const names = extractShellIdentifiers(stripShellProse(src)).map(
      (d) => d.name,
    );
    for (const expected of [
      "rendre_rapport",
      "titre",
      "LARGEUR",
      "CHEMIN",
      "tracer_courbe",
      "compteur",
      "fichier",
    ])
      assert.ok(
        names.includes(expected),
        `${expected} manque : ${names.join(", ")}`,
      );
  });

  it("PIÈGE : une comparaison `==` n'est pas une affectation", () => {
    const names = extractShellIdentifiers(
      stripShellProse('if [ "$a" == 1 ]; then :; fi\n'),
    );
    assert.deepEqual(names, []);
  });

  it("ne rend jamais un mot réservé du shell", () => {
    const names = extractShellIdentifiers(
      stripShellProse(
        "for i in a; do echo x; done\nwhile true; do break; done\n",
      ),
    );
    for (const kw of ["for", "do", "done", "while", "echo", "break", "true"])
      assert.ok(!names.includes(kw), `${kw} ne doit pas sortir`);
  });

  it("analyzeSource route sur l'extension : `.sh` juge en shell", () => {
    const src =
      "#!/usr/bin/env bash\n# un commentaire français\nlargeur_utile=80\nrenderReport() { :; }\n";
    const found = new Set(
      analyzeSource(src, "probe.sh").map((f) => f.identifier),
    );
    assert.ok(found.has("largeur_utile"), "le français doit sortir");
    assert.ok(!found.has("renderReport"), "l'anglais ne doit pas sortir");
  });

  it("le périmètre retient les scripts shell et EXEMPTE leurs tests", () => {
    assert.ok(isProductionFile("bin/deploy.sh"));
    assert.ok(isProductionFile("scripts/run.bash"));
    assert.ok(!isProductionFile(".claude/hooks/guard-bash.test.sh"));
    assert.ok(!isProductionFile("scripts/a.spec.sh"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("isProductionFile — le périmètre", () => {
  it("retient le code de production, y compris le module nommé `test`", () => {
    for (const p of [
      "src/nodefony/src/kernel/checks/renderReport.ts",
      "src/packages/@nodefony/studio/frontend/src/routes/Migrations.tsx",
      "src/modules/test/nodefony/controller/BenchOrmController.ts",
      "src/nodefony/src/testing/index.ts",
      // JavaScript : même règle. Un `monterDecor` dans un `.mjs` d'outillage
      // est aussi introuvable au `grep` anglais qu'un `rendreRapport` en `.ts`.
      "src/x/script.mjs",
      "scripts/check-site-links.mjs",
      "src/x/legacy.js",
      "src/x/config.cjs",
      "src/x/widget.jsx",
    ])
      assert.ok(isProductionFile(p), p);
  });

  it("exclut tests, dist, node_modules, templates, coverage, .d.ts, vitest.*", () => {
    for (const p of [
      "src/nodefony/src/tests/Kernel.test.ts",
      "src/nodefony/src/kernel/Kernel.test.ts",
      "src/packages/@nodefony/http/nodefony/tests/memory.test.ts",
      "src/packages/@nodefony/devkit/tests/bench.selftest.ts",
      "src/x/Foo.spec.ts",
      "src/x/__tests__/a.ts",
      "src/x/fixtures/a.ts",
      "src/nodefony/dist/index.ts",
      "src/nodefony/node_modules/zod/index.ts",
      "src/nodefony/templates/app/base/index.ts",
      "src/packages/@nodefony/devkit/coverage/devkit/x.ts",
      "src/nodefony/dist/types/index.d.ts",
      "src/packages/@nodefony/http/vitest.config.ts",
      "src/packages/@nodefony/http/vitest.load.config.ts",
      "src/x/readme.md",
      // Tests, quelle que soit l'extension — la règle EXEMPTE leurs
      // identifiants locaux, qui ne partent ni sur npm ni dans un `.d.ts`.
      "scripts/gate.test.mjs",
      "scripts/gate.spec.mjs",
      "src/x/tests/helper.mjs",
      "src/x/tools.test.js",
    ])
      assert.ok(!isProductionFile(p), p);
  });

  it("PIÈGE : normalise les séparateurs Windows AVANT de filtrer", () => {
    assert.ok(!isProductionFile("src\\nodefony\\src\\tests\\Kernel.test.ts"));
    assert.ok(!isProductionFile("src\\nodefony\\dist\\index.ts"));
    assert.ok(isProductionFile("src\\nodefony\\src\\Kernel.ts"));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("applyExceptions — absorbées, COMPTÉES, et les muettes dénoncées", () => {
  const findings = [
    { file: "src/a/x.ts", identifier: "largeur" },
    { file: "src/a/x.ts", identifier: "titre" },
    { file: "src/b/y.ts", identifier: "largeur" },
    { file: "src/bb/z.ts", identifier: "filet" },
  ];

  it("par identifiant : partout", () => {
    const r = applyExceptions(findings, [{ identifier: "largeur" }]);
    assert.deepEqual(
      r.kept.map((f) => f.identifier),
      ["titre", "filet"],
    );
    assert.equal(r.applied[0].absorbed, 2);
    assert.deepEqual(r.unused, []);
  });

  it("par chemin : un dossier, avec ou sans `/` final — PIÈGE : `src/b` ≠ `src/bb`", () => {
    const r = applyExceptions(findings, [{ path: "src/b" }]);
    assert.deepEqual(
      r.kept.map((f) => `${f.file}#${f.identifier}`),
      ["src/a/x.ts#largeur", "src/a/x.ts#titre", "src/bb/z.ts#filet"],
    );
    assert.equal(r.applied[0].absorbed, 1);
    assert.equal(
      applyExceptions(findings, [{ path: "src/b/" }]).applied[0].absorbed,
      1,
    );
  });

  it("par chemin ET identifiant", () => {
    const r = applyExceptions(findings, [
      { path: "src/a/x.ts", identifier: "largeur" },
    ]);
    assert.equal(r.kept.length, 3);
    assert.equal(r.applied[0].absorbed, 1);
  });

  it("une exception qui n'absorbe RIEN est rendue dans `unused`", () => {
    const r = applyExceptions(findings, [
      { identifier: "disparu" },
      { path: "src/nulle-part/" },
    ]);
    assert.equal(r.kept.length, 4);
    assert.deepEqual(r.applied, []);
    assert.equal(r.unused.length, 2);
  });

  it("une entrée sans `path` ni `identifier` n'absorbe rien (jamais un joker)", () => {
    const r = applyExceptions(findings, [{ reason: "oups" }]);
    assert.equal(r.kept.length, 4);
    assert.equal(r.unused.length, 1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
describe("scanRepo — sur un dépôt fabriqué", () => {
  const roots = [];
  after(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });
  const repo = (files) => {
    const root = mkdtempSync(path.join(tmpdir(), "nf-lang-"));
    roots.push(root);
    for (const [rel, body] of Object.entries(files)) {
      const abs = path.join(root, ...rel.split("/"));
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, body);
    }
    return root;
  };

  it("balaie `src`, ignore les tests, rend les constats et le compte des exceptions", () => {
    const root = repo({
      "src/core/report.ts":
        "export function rendreRapport(largeur: number) {}\n",
      "src/core/clean.ts": "export function renderReport(width: number) {}\n",
      "src/core/report.test.ts": "const largeur = 1; const filet = 2;\n",
      "src/core/tests/helpers.ts": "export const controlesSautes = [];\n",
      "src/core/dist/report.ts": "export const accord = 1;\n",
      "src/core/templates/x.ts": "export const gabarit = 1;\n",
      "src/core/notes.md": "largeur filet accord\n",
    });
    const r = scanRepo({ root });
    assert.equal(r.scanned, 2);
    assert.deepEqual(
      r.findings.map((f) => `${f.file}:${f.line} ${f.identifier}`).sort(),
      ["src/core/report.ts:1 largeur", "src/core/report.ts:1 rendreRapport"],
    );
    // Les exceptions par défaut sont déclarées mais, sur ce dépôt, sans effet — et dites.
    assert.equal(r.exceptions.declared, DEFAULT_EXCEPTIONS.length);
    assert.equal(r.exceptions.applied, 0);
    assert.equal(r.exceptions.unused.length, DEFAULT_EXCEPTIONS.length);
  });

  it("applique une exception fournie et la COMPTE", () => {
    const root = repo({
      "src/core/report.ts":
        "export function rendreRapport(largeur: number) {}\n",
      "src/mirror/schema.ts":
        "export const libelle = 1; export const montant = 2;\n",
    });
    const r = scanRepo({
      root,
      exceptions: [{ path: "src/mirror/", reason: "miroir" }],
    });
    assert.deepEqual(r.findings.map((f) => f.identifier).sort(), [
      "largeur",
      "rendreRapport",
    ]);
    assert.equal(r.exceptions.applied, 1);
    assert.equal(r.exceptions.absorbed, 2);
    assert.equal(r.exceptions.detail[0].exception.reason, "miroir");
  });

  it("un chemin explicite restreint le balayage", () => {
    const root = repo({
      "src/a/x.ts": "export const largeur = 1;\n",
      "src/b/y.ts": "export const filet = 1;\n",
    });
    const r = scanRepo({ root, paths: ["src/b"] });
    assert.equal(r.scanned, 1);
    assert.deepEqual(
      r.findings.map((f) => f.identifier),
      ["filet"],
    );
  });
});
