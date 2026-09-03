#!/usr/bin/env node
/**
 * scripts-audit — chaque script du dépôt est-il au bon endroit, et quelqu'un l'appelle-t-il ?
 *
 * Un script mal placé ne casse rien : il devient introuvable. Celui qui vit à la racine alors que
 * son résultat dépend d'un protocole se lance sans ce protocole — et rend un chiffre faux. Celui
 * qui vit dans un skill sans que le skill le cite est mort sans que personne le sache.
 *
 * @usage    node .claude/skills/nodefony-skill/scripts/scripts-audit.mjs
 * @usage    node .claude/skills/nodefony-skill/scripts/scripts-audit.mjs --strict
 * @option   --strict  sort en échec dès qu'un script est orphelin ou qu'un renvoi est mort
 * @output   un classement de chaque script : bien placé, à déplacer, orphelin, ou renvoi mort
 *
 * LE CRITÈRE, posé et vérifié en session :
 *   → un script rejoint un SKILL quand son résultat dépend d'un PROTOCOLE (décor à monter, ordre
 *     à respecter, interprétation à faire). Le script produit un chiffre ; le skill en fait une mesure.
 *   → un script reste à la RACINE quand il est déterministe et câblé au package.json : on le lance,
 *     il rend toujours la même chose, il n'y a rien à interpréter.
 */
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, sep } from "node:path";

const STRICT = process.argv.includes("--strict");
const ACQUITTES_PATH = join(
  ".claude",
  "skills",
  "nodefony-skill",
  "scripts",
  "scripts-audit.attendus.json",
);
const SKILLS_DIR = ".claude/skills";
const ROOT_SCRIPTS = "scripts";
const EXT = [".mjs", ".js", ".sh", ".ts", ".py"];

const isScript = (f) => EXT.some((e) => f.endsWith(e));

/** Tous les scripts du dépôt, hors dépendances et build. */
function collect(dir, out = [], depth = 0) {
  if (!existsSync(dir) || depth > 4) return out;
  for (const e of readdirSync(dir)) {
    if (["node_modules", "dist", ".git", "coverage"].includes(e)) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) collect(p, out, depth + 1);
    else if (isScript(e)) out.push(p);
  }
  return out;
}

// Qui référence quoi : le package.json (scripts npm) et les SKILL.md.
const pkg = existsSync("package.json")
  ? readFileSync("package.json", "utf8")
  : "";
const skillTexts = new Map();
for (const name of readdirSync(SKILLS_DIR)) {
  const f = join(SKILLS_DIR, name, "SKILL.md");
  if (!existsSync(f)) continue;
  let text = readFileSync(f, "utf8");
  const refDir = join(SKILLS_DIR, name, "references");
  if (existsSync(refDir))
    for (const r of readdirSync(refDir))
      if (r.endsWith(".md")) text += readFileSync(join(refDir, r), "utf8");
  skillTexts.set(name, text);
}
const allSkillText = [...skillTexts.values()].join("\n");
const docsText = collectDocs("docs");
function collectDocs(dir, acc = "") {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) acc = collectDocs(p, acc);
    else if (e.endsWith(".md")) acc += readFileSync(p, "utf8");
  }
  return acc;
}

/**
 * Signaux qu'un script dépend d'un protocole — donc qu'il a sa place dans un skill.
 *
 * DEUX familles, et la distinction est toute la règle. Un signal EXÉCUTÉ prouve
 * que le script monte un décor ou frappe une cible ; un signal de VOCABULAIRE ne
 * prouve que le sujet dont il parle. Un rendeur de rapport parle de médianes, de
 * p99 et de runs sans en produire un seul — il lit un JSON déjà mesuré et écrit
 * du HTML.
 *
 * La règle « on exige un APPEL » était déjà écrite pour docker et pour le
 * serveur en écoute ; les deux signaux de mesure l'avaient ratée, et deux
 * rendeurs de la racine s'en trouvaient classés « à déplacer ». Le gate sortait
 * alors 1 à chaque passe : rouge en permanence, donc ne gardant plus rien.
 */
function protocolSignals(path) {
  let src = "";
  try {
    src = readFileSync(path, "utf8");
  } catch {
    return { tous: [], executes: [] };
  }
  const executes = [];
  const vocabulaire = [];
  // Mentionner « docker » ou « localhost » ne suffit pas : un générateur de fichier d'exemple en
  // parle sans jamais s'en servir. On exige un APPEL — lancer le conteneur, frapper le port.
  if (/(?:docker\s+(?:run|exec|compose|ps)|docker-compose)/i.test(src))
    executes.push("monte un décor docker");
  if (
    /(?:fetch|request|curl|WebSocket|autocannon|got)\s*\(?["'`]?[^\n]{0,40}(?:localhost|127\.0\.0\.1)/i.test(
      src,
    )
  )
    executes.push("frappe un serveur en écoute");
  if (/\b(bench|autocannon|wrk|rps|latenc|percentil|p9\d)\b/i.test(src))
    vocabulaire.push("parle de performance");
  if (/\b(median|médiane|warmup|chauff|iterations?|runs?)\b/i.test(src))
    vocabulaire.push("parle de runs répétés");
  if (
    /process\.env\.[A-Z]/.test(src) &&
    (src.match(/process\.env\.[A-Z]/g) || []).length > 3
  )
    vocabulaire.push("piloté par plusieurs variables d'environnement");
  return { tous: executes.concat(vocabulaire), executes };
}

const RACINES_VERSIONNEES = /^(?:\.claude|scripts)\//;
const EST_SCRIPT = /\.(?:mjs|js|sh|py|ts)$/;
const LANCEUR = /(?:execPath|execFile|spawnSync|spawn|execSync|\bsh\(|bash )/;

/** Le source sans ses commentaires : un exemple n'invoque rien. */
const sansCommentaires = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|\s)\/\/[^\n]*/g, "$1")
    .replace(/(^|\s)#[^\n]*/g, "$1");

/** Chemins de scripts réellement LANCÉS par un source, sous leurs deux formes. */
function cheminsInvoques(source) {
  const src = sansCommentaires(source);
  const refs = new Set();
  // La fenêtre INCLUT le match : `"bash .claude/…/start.sh"` porte son lanceur
  // À L'INTÉRIEUR du littéral. Une fenêtre qui s'arrête avant lui ne voit rien —
  // constaté en mutant ce site exact, que le gate laissait alors passer.
  const lance = (index, texte = "") =>
    LANCEUR.test(src.slice(Math.max(0, index - 120), index) + texte);
  // Forme 1 — le chemin écrit d'un seul tenant.
  // Le chemin n'est pas toujours collé au guillemet : `"bash .claude/…/start.sh"`
  // le fait précéder d'une commande. On borne par des frontières, pas par des
  // délimiteurs de chaîne — l'exigence d'invocation tient lieu de filtre.
  for (const m of src.matchAll(
    /(?<![\w./@-])((?:\.claude|scripts)\/[\w./@-]+\.(?:mjs|js|sh|py|ts))(?![\w.])/g,
  ))
    if (lance(m.index, m[0])) refs.add(m[1]);
  // Forme 2 — les segments d'un `join(...)`. On ne traite que les appels sans
  // parenthèse imbriquée : au pire on en rate un, jamais on n'en invente un.
  for (const m of src.matchAll(/(?:path\.)?join\(([^()]*)\)/g)) {
    if (!lance(m.index)) continue;
    const segments = [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map(
      (x) => x[1],
    );
    if (segments.length < 2) continue;
    const chemin = segments.join("/");
    if (RACINES_VERSIONNEES.test(chemin) && EST_SCRIPT.test(chemin))
      refs.add(chemin);
  }
  return [...refs];
}

const rows = [];
const rootScripts = collect(ROOT_SCRIPTS);
const sourcesByPath = new Map(
  rootScripts
    .concat(
      ...[...skillTexts.keys()].flatMap((n) => collect(join(SKILLS_DIR, n))),
    )
    .map((p) => {
      try {
        return [p, readFileSync(p, "utf8")];
      } catch {
        return [p, ""];
      }
    }),
);

/**
 * Un script IMPORTÉ par un autre script est appelé — même si aucun texte ne le
 * mentionne. Sans cette règle, un fichier de configuration importé par son
 * outil passe pour un orphelin, et les juges d'un banc — chacun appelé par le
 * banc ET par son auto-contrôle — sont déclarés morts par paquets de huit.
 *
 * L'appelant doit être un AUTRE fichier : un script qui se nomme lui-même dans
 * son propre en-tête ne prouve rien. Une seule implémentation pour les deux
 * zones (racine et skills) : la même règle écrite deux fois divergerait, et
 * c'est exactement ce qui s'était produit — les scripts de skill n'en
 * bénéficiaient pas.
 */
const importeAilleurs = (p) => {
  const base = p.split("/").pop();
  for (const [autre, src] of sourcesByPath) {
    if (autre === p) continue;
    if (src.includes(`/${base}`) || src.includes(`"${base}`)) return true;
  }
  return false;
};

/**
 * Les AUTOMATES du dépôt — ce qui LANCE un script sans qu'un humain ait à le taper.
 *
 * Être nommé dans une page n'est PAS être exécuté. Ce contrôle a annoncé « 0
 * orphelin » cinq semaines durant pendant qu'une vingtaine d'auto-contrôles,
 * énumérés un par un dans leur page de skill, n'étaient lancés par rien — dont
 * celui qui savait nommer quinze causes qu'aucun juge ne classait. Un inventaire
 * qui compte une phrase comme un appel ne mesure pas l'exécution : il mesure la
 * documentation.
 *
 * Trois automates, et rien d'autre : un script npm, un étage de forge, un autre
 * script qui l'invoque ou l'importe — un module importé s'exécute.
 */
const cle = (p) => p.split(sep).join("/");

/** Les VALEURS des scripts npm, jamais le fichier entier : une dépendance qui
 * porte le nom d'un script n'en fait pas un automate. */
const scriptsNpm = (() => {
  try {
    return Object.values(JSON.parse(pkg).scripts ?? {}).join("\n");
  } catch {
    return pkg;
  }
})();

const forgeText = (() => {
  const dir = join(".github", "workflows");
  if (!existsSync(dir)) return "";
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
})();

/**
 * Les sources, commentaires retirés. Ce qui sépare un APPEL d'une MENTION n'est
 * pas la forme du chemin — un script est aussi bien lancé par `spawn`, importé,
 * ou nommé dans une table que son lanceur parcourt (`readdirSync` + liste
 * attendue) — mais la NATURE du fichier qui le nomme : un nom écrit dans un
 * source exécutable y est pour servir ; un nom écrit dans une page est de la
 * prose. Exiger une invocation adjacente accusait 39 juges parfaitement vivants,
 * dont le chemin est assemblé dans une constante et lancé dix lignes plus loin.
 */
const sourcesNettoyees = new Map(
  [...sourcesByPath].map(([chemin, src]) => [chemin, sansCommentaires(src)]),
);

/**
 * Quel automate lance ce script ? `null` quand personne ne le fait — le script
 * peut alors être parfaitement documenté, il n'en est pas exécuté pour autant.
 *
 * @param {string} p - chemin du script, tel que collecté.
 * @returns {string|null} le nom de l'automate, ou `null` si aucun.
 */
function automateQuiLance(p) {
  const k = cle(p);
  const base = k.split("/").pop();
  if (scriptsNpm.includes(k) || scriptsNpm.includes(base))
    return "un script npm";
  if (forgeText.includes(k) || forgeText.includes(base))
    return "un étage de forge";
  // Le nom précédé d'un séparateur ou d'un délimiteur de chaîne : sans cette
  // frontière, `index.mjs` se croit appelé par tout le dépôt.
  for (const [autre, src] of sourcesNettoyees) {
    if (cle(autre) === k) continue;
    if (
      src.includes(`/${base}`) ||
      src.includes(`"${base}`) ||
      src.includes(`'${base}`) ||
      src.includes(`\`${base}`)
    )
      return `un autre script (${cle(autre).split("/").pop()})`;
  }
  return null;
}

for (const p of rootScripts) {
  const base = p.split("/").pop();
  const inPkg = pkg.includes(p) || pkg.includes(base);
  // Le nom du fichier apparaît tel quel dans un `import "./x.ts"` — inutile de construire une
  // expression : la première tentative l'a fait, et son échappement produisait un `\\` littéral.
  const inSkill = allSkillText.includes(p) || allSkillText.includes(base);
  const inDocs = docsText.includes(p);
  const signals = protocolSignals(p);
  const lancePar = automateQuiLance(p);
  let verdict, why;
  if (inPkg) {
    verdict = "✅ bien placé";
    why = "câblé dans package.json — outil déterministe du dépôt";
  } else if (signals.executes.length >= 1 && signals.tous.length >= 2) {
    // Au moins un APPEL, et au moins deux signaux au total : un unique
    // `fetch("localhost")` dans un générateur de fichier d'exemple ne suffit
    // pas à faire d'un script un banc.
    verdict = "➡️  à déplacer vers un skill";
    why = signals.tous.join(", ");
  } else if (lancePar) {
    verdict = "✅ bien placé";
    why = `lancé par ${lancePar}`;
  } else if (inSkill || inDocs) {
    // Une page le nomme, aucun automate ne l'exécute. Ce n'est pas forcément une
    // faute — mais ce n'est pas le même état, et rendre le même verdict que pour
    // un script lancé revient à mesurer la documentation.
    verdict = "📄 documenté, jamais lancé";
    why = inSkill
      ? "cité par un skill, exécuté par personne"
      : "cité dans la documentation, exécuté par personne";
  } else {
    verdict = "⚠️  orphelin";
    why = "cité nulle part : ni package.json, ni skill, ni doc";
  }
  rows.push({ zone: "racine", path: p, verdict, why });
}

/**
 * Un renvoi vers un script existe-t-il quelque part ? Une seule implémentation,
 * partagée par les deux contrôles (le texte des skills, et les sources qui
 * LANCENT un script) : la même règle écrite deux fois divergerait, et le second
 * contrôle a précisément commencé par redécouvrir ces cas un par un.
 *
 * Un renvoi peut viser la racine du dépôt, le skill porteur, ou un skill voisin ;
 * et il peut être capturé avec un préfixe (`$SKILL_DIR/scripts/run.sh`) dont
 * seule la queue est vérifiable.
 *
 * @param {string} ref - le chemin tel qu'écrit.
 * @param {string} dossierPorteur - dossier du fichier qui porte le renvoi.
 * @returns {boolean} vrai dès qu'un candidat existe.
 */
function renvoiResolu(ref, dossierPorteur) {
  const court = ref.replace(/^.*?(?=(?:scripts|lib)\/)/u, "");
  return [
    ref,
    join(dossierPorteur, court),
    court,
    ...[...skillTexts.keys()].map((other) => join(SKILLS_DIR, other, court)),
  ].some((c) => existsSync(c));
}

// Scripts vivant DANS un skill : le skill les cite-t-il ?
const deadRefs = [];
for (const [name, text] of skillTexts) {
  const dir = join(SKILLS_DIR, name);
  for (const p of collect(dir)) {
    const rel = p.slice(dir.length + 1);
    const base = p.split("/").pop();
    const nomme = text.includes(rel) || text.includes(base);
    const lancePar = automateQuiLance(p);
    rows.push({
      zone: name,
      path: p,
      verdict: lancePar
        ? "✅ bien placé"
        : nomme
          ? "📄 documenté, jamais lancé"
          : "⚠️  non cité par son skill",
      why: lancePar
        ? `lancé par ${lancePar}`
        : nomme
          ? "cité par le skill qui le porte, exécuté par personne"
          : "présent, jamais mentionné, jamais lancé — mort, ou à documenter",
    });
  }
  // Renvois vers des scripts qui n'existent pas. Trois pièges déjà payés :
  //   — `\.js` capture le `.js` de `test-map.json` : exiger une frontière de mot ;
  //   — un renvoi peut viser la RACINE ou un AUTRE skill : chercher ailleurs avant de crier au mort.
  //   — `es5.d.ts` est une DÉCLARATION de types, jamais un script : l'écarter.
  //   — un chemin peut porter un SOUS-DOSSIER (`scripts/lib/isolation.mjs`) : sans
  //     le segment intermédiaire, le motif repartait à `lib/…` et déclarait mort un
  //     fichier bien présent. Un gate qui crie au loup finit par ne plus être lu.
  //   — un skill peut renvoyer vers un script qui vit AILLEURS dans le dépôt (un
  //     paquet qui le publie) : capturer le chemin AVEC son préfixe de dossiers,
  //     sinon on ne teste que `scripts/x.mjs` et l'on déclare mort un fichier
  //     parfaitement présent sous `src/packages/…`.
  for (const m of text.matchAll(
    /(?:[\w.@-]+\/)*(?:scripts|lib)(?:\/[\w.-]+)*\/[\w.-]+\.(?:mjs|js|sh|py|ts)(?![\w.])/g,
  )) {
    const ref = m[0];
    if (ref.endsWith(".d.ts")) continue;
    // Le renvoi peut avoir été capturé avec son préfixe : on teste aussi la
    // partie qui commence à `scripts/` ou `lib/`, seule forme valable pour un
    // renvoi INTERNE au skill.
    if (!renvoiResolu(ref, dir)) deadRefs.push({ skill: name, ref });
  }
}

/**
 * Renvois morts dans les SOURCES — pas seulement dans les `SKILL.md`.
 *
 * Le contrôle ci-dessus lit le TEXTE des skills ; un script qui LANCE un autre
 * script par un chemin en dur y échappait entièrement. Vécu : la chaîne de
 * release a quitté l'outillage d'agent pour `scripts/release/`, et un banc a
 * gardé l'ancien chemin — découvert par la forge, sur les QUATRE systèmes à la
 * fois, après vingt secondes de décor et un `Cannot find module`. Un chemin de
 * fichier ne se refactorise pas : il se vérifie.
 *
 * Deux formes, parce que le défaut vécu portait la seconde :
 *   — le chemin écrit d'un seul tenant, `"scripts/release/pack-all.mjs"` ;
 *   — les segments d'un `join(repo, ".claude", "skills", …, "x.mjs")`, qu'aucune
 *     expression cherchant un chemin ne peut voir.
 *
 * Le critère est l'INVOCATION, pas la ressemblance : le chemin doit être remis à
 * un lanceur (`execPath`, `spawn`, `execFile`, `sh(`, `bash `). La première
 * version se contentait de « ça ressemble à un chemin de script » et sortait
 * sept accusations, toutes fausses — un glob de configuration, un chemin
 * d'application témoin, une donnée de test, des exemples en commentaire. Un
 * gate qui crie au loup n'est plus lu ; les commentaires sont donc retirés
 * avant lecture, et seule une invocation compte.
 */

for (const [source, src] of sourcesByPath) {
  const porteur = source.slice(0, source.lastIndexOf("/"));
  for (const ref of cheminsInvoques(src)) {
    if (ref.includes("*") || ref.includes("${")) continue;
    if (!renvoiResolu(ref, porteur)) deadRefs.push({ skill: source, ref });
  }
}

// ————————————————————————————————————————————————————————— rapport
const byVerdict = (v) => rows.filter((r) => r.verdict.includes(v));
console.log(`\n=== placement des scripts (${rows.length} fichiers) ===\n`);

const move = byVerdict("à déplacer");
const orphan = rows.filter(
  (r) => r.verdict.includes("orphelin") || r.verdict.includes("non cité"),
);

const jamaisLances = byVerdict("jamais lancé");
console.log(`✅ bien placés          : ${byVerdict("bien placé").length}`);
console.log(`📄 jamais lancés        : ${jamaisLances.length}`);
console.log(`➡️  à déplacer          : ${move.length}`);
console.log(`⚠️  orphelins/non cités : ${orphan.length}`);
console.log(`❌ renvois morts        : ${deadRefs.length}`);

if (move.length) {
  console.log(
    "\n➡️  Dépendent d'un protocole — leur place est dans un skill :",
  );
  for (const r of move) console.log(`   ${r.path}\n     ${r.why}`);
}
if (orphan.length) {
  console.log("\n⚠️  Personne ne les appelle (à documenter, ou à retirer) :");
  for (const r of orphan) console.log(`   ${r.path}  [${r.zone}]`);
}
if (jamaisLances.length) {
  console.log(
    "\n📄 Nommés par une page, exécutés par aucun automate (ni npm, ni forge, ni script) :",
  );
  for (const r of jamaisLances) console.log(`   ${r.path}  [${r.zone}]`);
}
if (deadRefs.length) {
  console.log("\n❌ Renvois vers un script absent :");
  for (const d of deadRefs) console.log(`   ${d.skill} → ${d.ref}`);
}
console.log("");

/**
 * « Documenté, jamais lancé » n'est pas une faute — un banc de charge se tape à
 * la main, et c'est très bien. Ce qui serait une faute, c'est qu'un script NEUF
 * y entre sans que personne le remarque, ou qu'un acquittement survive au
 * câblage qu'il attendait. La liste versionnée fige donc l'état connu, et la
 * garde ne mord que sur l'ÉCART — un gate qui rouge en permanence ne garde rien.
 */
const acquittes = (() => {
  try {
    const brut = JSON.parse(readFileSync(ACQUITTES_PATH, "utf8"));
    return new Set(brut["documentes-jamais-lances"] ?? []);
  } catch {
    return null;
  }
})();

const nonAcquittes = acquittes
  ? jamaisLances.filter((r) => !acquittes.has(cle(r.path)))
  : [];
const acquittementsPerimes = acquittes
  ? [...acquittes].filter((a) => !jamaisLances.some((r) => cle(r.path) === a))
  : [];

if (acquittes === null) {
  console.log(
    `⚠️  liste d'acquittement illisible ou absente (${ACQUITTES_PATH}) — l'écart n'est pas gardé.`,
  );
} else {
  if (nonAcquittes.length) {
    console.log(
      "\n🔴 Jamais lancés et NON acquittés — les câbler, ou les inscrire dans la liste :",
    );
    for (const r of nonAcquittes) console.log(`   ${r.path}`);
  }
  if (acquittementsPerimes.length) {
    console.log(
      "\n🔴 Acquittements PÉRIMÉS — ces scripts sont désormais lancés (ou absents) ; retirer la ligne :",
    );
    for (const a of acquittementsPerimes) console.log(`   ${a}`);
  }
}
console.log("");

// `--strict` échoue sur les TROIS anomalies. La première version ignorait « à déplacer », et un
// contrôle négatif l'a montré : une sonde classée à déplacer laissait le gate vert.
process.exit(
  STRICT &&
    (orphan.length ||
      deadRefs.length ||
      move.length ||
      acquittes === null ||
      nonAcquittes.length ||
      acquittementsPerimes.length)
    ? 1
    : 0,
);
