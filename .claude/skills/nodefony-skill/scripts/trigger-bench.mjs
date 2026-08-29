#!/usr/bin/env node
/**
 * trigger-bench — prouve qu'une phrase réelle élit le bon skill.
 *
 * Le risque d'une consolidation, c'est la régression silencieuse : on resserre une description,
 * et un skill cesse de se déclencher sans que rien ne le dise. Ce banc met un chiffre dessus.
 *
 * @usage    node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs
 * @usage    node .claude/skills/nodefony-skill/scripts/trigger-bench.mjs --verbose
 * @option   --verbose  affiche le top-3 par phrase + les recouvrements arbitrés et les cas fragiles
 * @option   --list     liste les cas du banc sans les exécuter
 * @output   phrases élisant le bon skill, cas négatifs respectés, couverture, recouvrements (arbitrés vs à trancher)
 *
 * QUATRE MESURES : (1) phrases réelles → le bon skill en tête ; (2) cas NÉGATIFS → une phrase qui ne
 * DOIT pas élire un skill (attrape la sur-portée) ; (3) couverture → tout skill a au moins une porte
 * testée ; (4) recouvrements de déclencheurs, séparés en ARBITRÉS (documentés, meilleure porte) et à
 * TRANCHER (le vrai bruit). Il MORD sur une phrase ratée ou un cas négatif violé.
 *
 * CE QU'IL PROUVE : la surface LEXICALE d'une description discrimine bien. CE QU'IL NE PROUVE PAS :
 * le jugement du modèle, qui comprend des formulations absentes du texte. Un cas vert n'est pas une
 * garantie d'invocation ; un cas ROUGE est un vrai défaut : aucun mot de la demande ne rejoint la
 * description.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const SKILLS_DIR = ".claude/skills";
const VERBOSE = process.argv.includes("--verbose");
const LIST_ONLY = process.argv.includes("--list");

/** Cas issus des retex, des mémoires et des demandes réellement formulées en session. */
const CASES = [
  // — cycle de session
  ["reprends", "nodefony-session"],
  ["on en était où ?", "nodefony-session"],
  ["fin de session", "nodefony-session"],
  ["consolide les retex", "nodefony-session"],
  // — serveur et diagnostic
  ["lance le serveur", "nodefony-start-server"],
  ["relance le serveur de dev", "nodefony-start-server"],
  [
    "pourquoi le test échoue, montre les logs du serveur",
    "nodefony-tail-error-logs",
  ],
  ["ce test passe seul mais échoue en suite", "nodefony-debug"],
  ["est-ce ma régression ? fais une baseline stash", "nodefony-debug"],
  ["ça crash au boot, stack trace incompréhensible", "nodefony-debug"],
  ["le seuil mémoire a sauté", "nodefony-check-memory-health"],
  ["j'ai touché au pipeline, je vais commiter", "nodefony-check-memory-health"],
  ["vérifie la fuite mémoire, heap delta", "nodefony-check-memory-health"],
  // — mesure
  ["est-ce que ça tient la charge ?", "nodefony-load-test"],
  ["combien de pods pour 10000 utilisateurs ?", "nodefony-load-test"],
  ["quel est l'impact perf de ce changement ?", "nodefony-load-test"],
  ["mesure le RPS et la latence p99", "nodefony-load-test"],
  ["est-ce que ça marche à plusieurs instances ?", "nodefony-multipod-bench"],
  [
    "teste le fan-out cross-pod sur le bus redis partagé",
    "nodefony-multipod-bench",
  ],
  // — développement
  ["je vais coder dans le kernel", "nodefony-framework-dev"],
  ["créer un service injectable", "nodefony-framework-dev"],
  ["ajoute un décorateur de route sur ce controller", "nodefony-framework-dev"],
  ["crée un module nodefony", "nodefony-create-module"],
  ["scaffold un module avec un front react", "nodefony-create-frontend-module"],
  ["fais une page studio avec un dashboard", "nodefony-studio-dev"],
  ["la debug bar de studio", "nodefony-studio-dev"],
  [
    "câble le RealtimeClient et les hooks realtime côté front",
    "nodefony-frontend-dev",
  ],
  [
    "vérifie que ma modif front passe, curl le transform vite",
    "nodefony-frontend-dev",
  ],
  // — sécurité, normes
  ["c'est safe ? fais une revue sécurité du diff", "nodefony-security-review"],
  ["attaquer cette brique, matrice d'attaque", "nodefony-security-review"],
  ["vérifie la conformité RFC des cookies et du CORS", "nodefony-rfc"],
  // — doc, inspection, livrables
  ["écrire une page de doc de référence", "nodefony-documentation"],
  ["la doc dit-elle encore vrai ?", "nodefony-documentation"],
  ["qui implémente cette interface ?", "nodefony-inspect"],
  ["quels paramètres prend cette méthode ?", "nodefony-inspect"],
  ["montre la config et les routes de ce module", "nodefony-inspect"],
  ["qu'est-ce que j'ai modifié ? diff rapide", "nodefony-inspect"],
  [
    "analyse d'impact avant refactor : qui utilise ce symbole ?",
    "nodefony-inspect",
  ],
  [
    "vérifie les external et les peerDeps du bundler",
    "nodefony-check-externals",
  ],
  ["on publie sur npm, prépare la release", "nodefony-release"],
  [
    "est-ce que le paquet publié marche vraiment ? smoke test des tarballs",
    "nodefony-release",
  ],
  ["où en est la migration ?", "nodefony-session"],
  ["fais un rapport HTML imprimable de ces mesures", "nodefony-html-report"],
  ["c'est quoi la phase 12, la couche IA agentic ?", "nodefony-roadmap"],
  // — bancs du scaffold : ce qu'il PRODUIT, et ce qu'un agent en TROUVE
  [
    "j'ai modifié le scaffold, est-ce que le code généré compile toujours ?",
    "nodefony-devkit-bench",
  ],
  [
    "rejouer le banc devkit avant de dire que la vague est finie",
    "nodefony-devkit-bench",
  ],
  ["est-ce que create entity marche encore ?", "nodefony-devkit-bench"],
  // — méta
  ["créer un skill", "nodefony-skill"],
  ["mon skill ne se déclenche jamais", "nodefony-skill"],
  ["fusionner deux skills en un", "nodefony-skill"],
  // — skills LIVRÉS PAR NPM (`@nodefony/devkit/skills/`), destinés à l'auteur
  //   d'une application, pas au développeur du framework. Ce sont des phrases
  //   d'utilisateur : « je veux stocker des articles », pas « scaffolder une
  //   entité ». C'est précisément cette formulation-là qui doit mordre, puisque
  //   c'est la seule que l'utilisateur emploiera.
  ["je veux stocker des articles dans mon app", "nodefony-add-crud"],
  ["ajoute une entité avec un CRUD", "nodefony-add-crud"],
  ["comment définir une relation entre deux entités", "nodefony-add-crud"],
  // La porte du skill de migration : ce sont les phrases par lesquelles on y
  // arrive VRAIMENT — un symptôme (« la colonne n'existe pas »), une intention
  // (« déployer un changement de schéma »), jamais le nom du skill.
  [
    "j'ai ajouté un champ à une entité et la colonne n'existe pas en base",
    "nodefony-migrate-schema",
  ],
  ["comment migrer le schéma de ma base", "nodefony-migrate-schema"],
  [
    "je dois déployer un changement de schéma en production",
    "nodefony-migrate-schema",
  ],
  ["crée un service métier partagé", "nodefony-add-service"],
  ["mon service est undefined dans le conteneur", "nodefony-add-service"],
  ["protège cette route", "nodefony-protect-route"],
  ["un partenaire doit pouvoir poster chez moi", "nodefony-protect-route"],
  ["réserver cette page aux administrateurs", "nodefony-protect-route"],
  ["ajoute un flux temps réel", "nodefony-add-realtime-channel"],
  ["mon canal websocket est public", "nodefony-add-realtime-channel"],
  // — observer un écran RÉEL (le décor navigateur, pas le dev front)
  ["regarde l'écran", "nodefony-browser"],
  ["lis la console du navigateur", "nodefony-browser"],
  ["mesure le contraste de cette couleur", "nodefony-browser"],
  ["est-ce que la page s'affiche ?", "nodefony-browser"],
  ["prends une capture d'écran de la page", "nodefony-browser"],
  // — tickets
  ["ouvre un ticket pour ça", "nodefony-ticket"],
  ["ce titre de ticket est incompréhensible", "nodefony-ticket"],
  ["mets un lexique dans les tickets", "nodefony-ticket"],
  ["corrige les titres des issues, on n'y comprend rien", "nodefony-ticket"],
  ["renomme cette issue en français", "nodefony-ticket"],
  ["ce ticket, on ne l'a pas déjà fait ?", "nodefony-ticket"],
  ["quel ticket prendre maintenant ?", "nodefony-ticket"],
];

/**
 * Cas NÉGATIFS — une phrase qui ne DOIT PAS élire un skill (rang 1). Ils attrapent la sur-portée :
 * une description trop large « vole » une demande qui appartient à un autre skill. C'est ce qui fait
 * MORDRE le banc quand on élargit une description sans y penser.
 */
const NEGATIVE_CASES = [
  ["crée un module @nodefony neuf", "nodefony-inspect"], // création ≠ inspection
  ["où est défini ce symbole ?", "nodefony-create-module"], // lookup ≠ scaffold
  ["lance un test de charge", "nodefony-check-memory-health"], // charge ≠ gate mémoire
  ["écris une page de doc de référence", "nodefony-studio-dev"], // doc ≠ écran générique
  ["démarre le serveur de dev", "nodefony-debug"], // démarrer ≠ diagnostiquer
  // Observer un écran ≠ coder le front. `nodefony-browser` porte des mots très
  // attractifs (« affichage », « page », « accessibilité ») : ces deux cas
  // gardent la frontière, faute de quoi il capterait les demandes de dev front.
  ["mon prébundle Vite est périmé", "nodefony-browser"],
  ["comment brancher le socket client ?", "nodefony-browser"],
];

/**
 * Recouvrements ARBITRÉS — un déclencheur déclaré par un skill mais légitimement capté par un autre,
 * parce que l'autre est une meilleure porte pour cette formulation. Les documenter les sort du bruit :
 * il ne reste en « à arbitrer » que les recouvrements NON tranchés — le vrai signal. `owner|captor`.
 */
const ACCEPTED_OVERLAPS = new Map([
  [
    "stack trace|nodefony-tail-error-logs",
    "lire une stack, c'est tailler les logs",
  ],
  [
    "fuite mémoire|nodefony-check-memory-health",
    "le gate mémoire porte le diagnostic",
  ],
  ["memory leak|nodefony-check-memory-health", "idem — gate mémoire"],
  [
    "phase 12|nodefony-session",
    "« phase 12 » seul = question de statut → session ; le contexte IA élit roadmap",
  ],
  [
    "realtime|nodefony-frontend-dev",
    "le realtime vécu est surtout côté client",
  ],
  [
    "WebSocket|nodefony-rfc",
    "sur le mot seul, la norme WS est une porte valide",
  ],
  [
    "structure d'un module|nodefony-create-module",
    "le scaffold EST la structure d'un module",
  ],
  ["module hooks|nodefony-create-module", "un module neuf porte ses hooks"],
  [
    "avant de publier sur npm|nodefony-release",
    "publier > vérifier les external",
  ],
]);

// ————————————————————————————————————————————————————————— scoring lexical
const STOP = new Set(
  "le la les un une des du de d a à au aux et ou en dans sur pour par ce ce cette ces mon ma mes ton ta tes son sa ses qui que quoi est sont ai as a fais fait faire vais veux peux il elle on nous vous ils elles y n' l' d' c' j' s' se si ne pas plus tres très bien avec sans quel quelle quels quelles comment pourquoi ça ca cela".split(
    /\s+/,
  ),
);

const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const words = (s) =>
  norm(s)
    .split(" ")
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Les dossiers où vivent des skills de ce dépôt.
 *
 * Les skills du REPO (`.claude/skills/`) servent à développer le framework ; ceux
 * des PAQUETS (`src/packages/@nodefony/<m>/skills/`) partent sur npm et servent à
 * développer AVEC. Les seconds sont exposés au même risque que les premiers — une
 * description resserrée, et le skill cesse de se déclencher sans que rien ne le
 * dise — sauf qu'ils sont chez des utilisateurs, où personne ne peut plus le
 * corriger. Ils sont donc mesurés ici, par le même banc : une capacité livrée à
 * un agent arrive AVEC sa mesure, et cette règle vaut aussi pour les skills.
 */
function skillDirs() {
  const dirs = [SKILLS_DIR];
  const packages = "src/packages/@nodefony";
  for (const pkg of existsSync(packages) ? readdirSync(packages).sort() : []) {
    const d = join(packages, pkg, "skills");
    if (existsSync(d)) dirs.push(d);
  }
  return dirs;
}

function loadSkills() {
  const out = [];
  const entries = skillDirs().flatMap((dir) =>
    readdirSync(dir)
      .sort()
      .map((name) => ({ dir, name })),
  );
  for (const { dir, name } of entries) {
    const f = join(dir, name, "SKILL.md");
    if (!existsSync(f)) continue;
    const raw = readFileSync(f, "utf8").split(/^---$/m)[1] || "";
    const lines = raw.split("\n");
    let desc = "";
    for (let i = 0; i < lines.length; i++) {
      const h = lines[i].match(/^description: *(>-?|\|-?)?(.*)$/);
      if (!h) continue;
      const parts = h[2].trim() ? [h[2].trim()] : [];
      for (let j = i + 1; j < lines.length; j++) {
        if (!/^\s/.test(lines[j]) && lines[j].trim() !== "") break;
        if (lines[j].trim()) parts.push(lines[j].trim());
      }
      desc = parts.join(" ");
      break;
    }
    const after = desc.split(/D[ée]clencheurs?\s*(?:étroits[^:]*)?:/i);
    const trig = [...(after[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    // La PORTÉE, et elle change le verdict : les skills du dépôt et ceux livrés
    // par un paquet ne se rencontrent JAMAIS. Un développeur du framework a les
    // premiers ; l'auteur d'une application n'a que les seconds, posés par
    // `ai:sync`. Les faire concourir ensemble fabriquerait des recouvrements qui
    // n'existent pour personne — « websocket » réclamé par `nodefony-rfc` face à
    // un skill que l'utilisateur d'app est le seul à posséder — et on
    // apprendrait à ignorer un avertissement, ce qui est pire que ne pas
    // l'émettre.
    out.push({
      name,
      desc,
      prose: after[0],
      triggers: trig,
      scope: dir === SKILLS_DIR ? "repo" : "package",
    });
  }
  return out;
}

/**
 * Score d'une phrase pour un skill. Un déclencheur cité mot pour mot dans la phrase pèse le plus
 * lourd ; sinon on compte le recouvrement des mots significatifs, d'abord avec les déclencheurs
 * (ils sont écrits POUR être reconnus), puis avec la prose de la description.
 */
function score(phrase, skill) {
  const p = norm(phrase);
  const pw = new Set(words(phrase));
  if (!pw.size) return 0;
  let s = 0;
  for (const t of skill.triggers) {
    const tn = norm(t);
    if (tn && (p.includes(tn) || tn.includes(p))) s += 12;
    const tw = words(t);
    if (tw.length) {
      const hit = tw.filter((w) => pw.has(w)).length;
      if (hit)
        s += 6 * (hit / tw.length) * (hit / Math.max(1, pw.size)) * tw.length;
    }
  }
  const prose = new Set(words(skill.prose));
  for (const w of pw) if (prose.has(w)) s += 1;
  // Le nom du skill lui-même est un signal fort quand l'utilisateur le cite.
  if (p.includes(skill.name.replace(/^nodefony-/, ""))) s += 8;
  return s;
}

// ————————————————————————————————————————————————————————— exécution
const skills = loadSkills();
if (LIST_ONLY) {
  for (const [phrase, expected] of CASES)
    console.log(`${expected.padEnd(34)} ← "${phrase}"`);
  console.log(`\n${CASES.length} cas · ${skills.length} skills`);
  process.exit(0);
}

/**
 * Classe les skills d'une PORTÉE pour une phrase.
 *
 * L'élection se fait entre skills qui coexistent réellement chez le même
 * utilisateur — cf `scope` dans `loadSkills`. Sans portée, un skill de paquet
 * serait jugé face à vingt-trois skills que son utilisateur n'aura jamais.
 *
 * @param {string} phrase - la demande, telle qu'elle serait formulée.
 * @param {"repo"|"package"} scope - le corpus dans lequel élire.
 * @returns {{name: string, sc: number}[]} les skills, du plus au moins probable.
 */
const rank = (phrase, scope = "repo") =>
  skills
    .filter((s) => s.scope === scope)
    .map((s) => ({ name: s.name, sc: score(phrase, s) }))
    .sort((a, b) => b.sc - a.sc);

/** La portée d'un skill par son nom — les cas ne la déclarent pas. */
const scopeOf = (name) => skills.find((s) => s.name === name)?.scope ?? "repo";

const FRAGILE_MARGIN = 0.15; // marge relative sous laquelle un cas vert tient à peu de chose

let pass = 0;
const failures = [];
const fragile = [];

for (const [phrase, expected] of CASES) {
  const ranked = rank(phrase, scopeOf(expected));
  const [first, second] = ranked;
  const ok = first.sc > 0 && first.name === expected;
  if (ok) {
    pass++;
    const margin = second && second.sc > 0 ? first.sc - second.sc : first.sc;
    if (margin < first.sc * FRAGILE_MARGIN)
      fragile.push({
        phrase,
        first: first.name,
        second: second?.name || "—",
        d: margin.toFixed(1),
      });
  } else {
    failures.push({
      phrase,
      expected,
      got: first.name,
      sc: first.sc.toFixed(1),
      rank: ranked.findIndex((r) => r.name === expected) + 1,
    });
  }
  if (VERBOSE)
    console.log(
      `${ok ? "✅" : "❌"} "${phrase}"\n     ${ranked
        .slice(0, 3)
        .map((r) => `${r.name}:${r.sc.toFixed(1)}`)
        .join("  ")}`,
    );
}

// ————————————————————————————————————————————————————————— cas négatifs (ne DOIT pas élire)
const negFail = [];
for (const [phrase, mustNot] of NEGATIVE_CASES) {
  const top = rank(phrase, scopeOf(mustNot))[0];
  if (top.sc > 0 && top.name === mustNot) negFail.push({ phrase, mustNot });
}

// ————————————————————————————————————————————————————————— couverture (porte non testée)
const tested = new Set(CASES.map(([, e]) => e));
const uncovered = skills.map((s) => s.name).filter((n) => !tested.has(n));

// ————————————————————————————————————————————————————————— déclencheurs déclarés (non-régression)
let tPass = 0;
const tArbitrated = []; // recouvrement documenté dans ACCEPTED_OVERLAPS
const tOpen = []; // recouvrement NON tranché — le vrai signal
for (const s of skills) {
  for (const t of s.triggers) {
    const got = rank(t, s.scope)[0];
    if (got.sc > 0 && got.name === s.name) {
      tPass++;
      continue;
    }
    const entry = { trigger: t, owner: s.name, got: got.name };
    const key = `${t}|${got.name}`;
    if (ACCEPTED_OVERLAPS.has(key))
      tArbitrated.push({ ...entry, why: ACCEPTED_OVERLAPS.get(key) });
    else tOpen.push(entry);
  }
}

const totalTriggers = tPass + tArbitrated.length + tOpen.length;
console.log("\n=== banc de déclenchement ===");
console.log(
  `Phrases réelles      : ${pass}/${CASES.length}` +
    (fragile.length
      ? `  (dont ${fragile.length} fragile·s, marge < ${FRAGILE_MARGIN * 100}%)`
      : ""),
);
console.log(
  `Cas négatifs         : ${NEGATIVE_CASES.length - negFail.length}/${NEGATIVE_CASES.length} respectés (ne DOIVENT pas élire)`,
);
console.log(
  `Couverture           : ${skills.length - uncovered.length}/${skills.length} skills ont ≥1 cas`,
);
console.log(
  `Déclencheurs déclarés: ${tPass}/${totalTriggers} → leur skill · ${tArbitrated.length} arbitrés · ${tOpen.length} à arbitrer`,
);

if (failures.length) {
  console.log("\n❌ phrases qui n'élisent pas le skill attendu :");
  for (const f of failures)
    console.log(
      `   "${f.phrase}"\n     attendu ${f.expected} — obtenu ${f.got} (${f.sc}) ; l'attendu est ${f.rank ? `au rang ${f.rank}` : "absent"}`,
    );
}
if (negFail.length) {
  console.log("\n❌ cas négatifs violés (une description est trop large) :");
  for (const n of negFail)
    console.log(
      `   "${n.phrase}" élit ${n.mustNot} — qui ne devrait PAS gagner ici`,
    );
}
if (uncovered.length) {
  console.log(
    `\n⚠️  ${uncovered.length} skill(s) sans cas positif (porte non testée) :`,
  );
  console.log("   " + uncovered.join(", "));
}
if (tOpen.length) {
  console.log(
    `\n⚠️  ${tOpen.length} recouvrement(s) NON tranché(s) — arbitrer, ou documenter dans ACCEPTED_OVERLAPS :`,
  );
  for (const t of tOpen.slice(0, 12))
    console.log(
      `   "${t.trigger}" — déclaré par ${t.owner}, capté par ${t.got}`,
    );
  if (tOpen.length > 12) console.log(`   … ${tOpen.length - 12} autres`);
}
if (VERBOSE) {
  if (tArbitrated.length) {
    console.log("\nℹ️  recouvrements arbitrés (documentés, meilleure porte) :");
    for (const t of tArbitrated)
      console.log(`   "${t.trigger}" ${t.owner} → ${t.got} — ${t.why}`);
  }
  if (fragile.length) {
    console.log("\nℹ️  cas verts fragiles (faible marge sur le 2ᵉ) :");
    for (const a of fragile)
      console.log(`   "${a.phrase}" — ${a.first} devant ${a.second} de ${a.d}`);
  }
}

// Le banc MORD sur : une phrase réelle qui rate son skill, OU un cas négatif violé (description
// trop large). Recouvrements ouverts, fragilité, couverture = signaux à arbitrer, pas des échecs durs.
process.exit(failures.length || negFail.length ? 1 : 0);
