#!/usr/bin/env node
/**
 * skills-doc — fiche de documentation par skill, ET gate de conformité.
 *
 * Une fiche écrite à la main diverge du skill qu'elle décrit dès la première édition. Ici, les 26
 * fiches sont DÉRIVÉES du `SKILL.md` lui-même : version, ressources, scripts, déclencheurs et
 * conformité au standard Agent Skills sont lus, jamais recopiés.
 *
 * @usage    node .claude/skills/nodefony-skill/scripts/skills-doc.mjs
 * @usage    node .claude/skills/nodefony-skill/scripts/skills-doc.mjs --check
 * @option   --check  contrôle seulement, n'écrit rien (utilisable en intégration continue)
 * @env      SKILLS_DOC_DATE  horodatage des pages générées ; par défaut la date du jour
 * @output   une fiche par skill dans docs/skills/, l'index, les cards de la page d'analyse et registry.json
 *
 * Le standard : name ≤ 64 en [a-z0-9-] identique au dossier · description 1..1024 · aucun champ hors
 * name/description/license/metadata/allowed-tools · ressources en scripts|references|assets.
 * Référence : docs/outillage-agents.md
 */
import {
  readFileSync,
  writeFileSync,
  readdirSync,
  existsSync,
  mkdirSync,
  statSync,
} from "node:fs";
import { join } from "node:path";
import YAML from "yaml";
import {
  analyzeScript,
  cle,
  collectScripts,
  createLaunchFinder,
  readSources,
} from "../lib/script-doc.mjs";

const SKILLS_DIR = ".claude/skills";

/**
 * Les skills LIVRÉS aux applications, par le paquet npm `@nodefony/devkit`.
 *
 * Ils sont de vrais skills — ils partent chez l'utilisateur, dans
 * `.agents/skills/` de son application — mais ils ne vivent pas dans
 * `.claude/skills`, qui ne porte que ceux du dépôt. Sans ce second emplacement,
 * le contrôle « aucun renvoi vers un skill inexistant » déclare MORT tout renvoi
 * vers eux : un skill du dépôt ne pouvait pas nommer ce que le produit livre,
 * et l'exception se serait posée à la main, une par une, en se périmant.
 */
const SKILLS_LIVRES_DIR = "src/packages/@nodefony/devkit/skills";

/**
 * Un nom désigne-t-il un skill RÉEL — du dépôt, ou livré par npm ?
 *
 * @param {string} nom - le nom cité entre accents graves.
 * @returns {boolean}
 */
const estUnSkill = (nom) =>
  existsSync(join(SKILLS_DIR, nom)) || existsSync(join(SKILLS_LIVRES_DIR, nom));
const OUT_DIR = "docs/skills";
const CHECK_ONLY = process.argv.includes("--check");
// Champs de frontmatter autorisés par le standard Agent Skills. Source :
// https://agentskills.io/specification.md § "SKILL.md format". `compatibility` a été ajouté par le
// standard (≤500 car.) — sans lui ici, un skill conforme serait faussement signalé « hors standard ».
const ALLOWED_FIELDS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);
const MAX_DESC = 1024; // spec : description 1-1024 caractères
const MAX_COMPAT = 500; // spec : compatibility 1-500 caractères
const MAX_BODY_LINES = 500; // best-practices (SHOULD, pas MUST) : corps court
// name (spec) : 1-64 car., minuscules alphanumériques + tirets, ni au bord ni consécutifs.
const NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// Le standard référencé par les fiches. Agent Skills n'a pas de numéro de révision publié — on
// nomme la source plutôt qu'une version fictive.
//
// Gouvernance vérifiée à la source primaire (agentskills.io, § « Open development ») : « The Agent
// Skills format was originally developed by Anthropic, released as an open standard ». Aucune
// fondation ne le porte — ne pas confondre avec AGENTS.md et MCP, eux confiés à l'AAIF.
const STANDARD = {
  name: "Agent Skills",
  org: "Anthropic (standard ouvert)",
  url: "https://agentskills.io/specification.md",
};
// Horodatage exigé par le gate de documentation. Passé par l'environnement pour rester rejouable.
const STAMP =
  process.env.SKILLS_DOC_DATE || new Date().toISOString().slice(0, 10);

/**
 * Découpe le frontmatter à la main : tolérant par construction, c'est ce qui permet d'EXTRAIRE les
 * champs même d'un en-tête bancal pour le décrire dans la fiche. Il ne dit donc RIEN de la validité
 * — le verdict revient à `yamlError`, qui passe le même texte à un vrai parseur.
 */
function parseFrontmatter(src) {
  const m = src.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { fields: {}, raw: "", body: src };
  const raw = m[1];
  const fields = {};
  // Champs de premier niveau uniquement (une clé indentée appartient au champ précédent).
  for (const line of raw.split("\n")) {
    const km = line.match(/^([a-zA-Z-]+):(.*)$/);
    if (km) fields[km[1]] = km[2].trim();
  }
  // description : scalaire replié (>) ou inline. Parcours ligne à ligne — une regex avec `$` en
  // mode multiligne s'arrêterait au premier saut de ligne et ne rendrait que la première ligne.
  const lines = raw.split("\n");
  let description = "";
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(/^description: *(>-?|\|-?)?(.*)$/);
    if (!head) continue;
    const parts = head[2].trim() ? [head[2].trim()] : [];
    for (let j = i + 1; j < lines.length; j++) {
      if (!/^\s/.test(lines[j]) && lines[j].trim() !== "") break; // ligne non indentée = champ suivant
      if (lines[j].trim()) parts.push(lines[j].trim());
    }
    description = parts.join(" ");
    break;
  }
  const version = (raw.match(/^\s+version: *(.+)$/m) || [])[1]?.trim() || null;
  return { fields, raw, body: m[2], description, version };
}

/**
 * Rend le message d'erreur d'un en-tête que YAML refuse, ou `null` s'il est valide.
 *
 * Le découpage maison ci-dessus accepte tout, et le parseur de l'agent est lui aussi tolérant : une
 * faute d'en-tête ne se manifeste donc JAMAIS en session — elle apparaît chez qui lit le fichier
 * avec un vrai parseur, GitHub en tête, qui refuse alors de rendre la page. Le cas vécu est une
 * description en scalaire plain contenant « : » (deux-points suivi d'une espace), que YAML lit comme
 * l'ouverture d'un second mapping ; la parade est le bloc plié `description: >`, où il est légal.
 *
 * @param raw - le texte de l'en-tête, entre les deux `---`
 * @returns le message du parseur, ou `null` si l'en-tête est du YAML valide
 */
function yamlError(raw) {
  try {
    YAML.parse(raw);
    return null;
  } catch (e) {
    return String(e.message).split("\n")[0];
  }
}

function listFiles(dir, exts) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) continue;
    if (!exts || exts.some((x) => e.endsWith(x))) out.push(e);
  }
  return out.sort();
}

function countRecursive(dir) {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    n += statSync(p).isDirectory() ? countRecursive(p) : 1;
  }
  return n;
}

/**
 * Objet d'un fichier `references/` : son premier titre `# …` et le nombre de lignes. Ce qui distingue
 * une fiche « parfaite » d'une liste de noms de fichiers — le lecteur voit CE QUE chaque référence
 * couvre sans l'ouvrir. Le titre est nettoyé de son markdown ; à défaut, on retombe sur le nom.
 */
function referenceMeta(dir, fileName) {
  const raw = readFileSync(join(dir, fileName), "utf8");
  const lines = raw.split("\n");
  let title = "";
  for (const l of lines) {
    const m = l.match(/^#\s+(.+?)\s*$/);
    if (m) {
      title = m[1].replace(/[`*_]/g, "").trim();
      break;
    }
  }
  return { f: fileName, title, lines: lines.length };
}

/**
 * Termes en `nodefony-…` qui ne désignent PAS un skill : noms de conteneurs, de processus, de
 * paquets ou de composants. Sans cette liste, le contrôle des renvois crierait sur eux.
 */
const NON_SKILL_TERMS = new Set([
  "nodefony-core", // le dépôt et le paquet npm du cœur
  "nodefony-ai-memory", // le dépôt privé de sauvegarde de la mémoire IA
  "nodefony-admin", // service back de Studio
  "nodefony-cards", // bloc de mise en page du portail doc
  "nodefony-dev-server", // titre de processus du superviseur de dev
  "nodefony-orm", // camp du banc comparatif (bench-pairs.sh), pas un skill
]);

/**
 * Ce qu'un skill NOMME entre accents graves, dans son SKILL.md et ses `references/` — le parcours
 * unique des deux contrôles de renvoi (skills cités, ressources citées).
 *
 * Les scripts en sont exclus : ils citent des conteneurs et des titres de processus qui portent le
 * même préfixe que les skills.
 *
 * @param dir - dossier du skill.
 * @param re - motif GLOBAL dont la capture 1 est la valeur retenue.
 * @returns les valeurs distinctes citées.
 */
function eachSkillDocLine(dir, fn) {
  const scan = (p) => {
    for (const line of readFileSync(p, "utf8").split("\n")) fn(line);
  };
  const skillFile = join(dir, "SKILL.md");
  if (existsSync(skillFile)) scan(skillFile);
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".md")) scan(p);
    }
  };
  walk(join(dir, "references"));
}

/**
 * Les valeurs citées entre accents graves, tous fichiers de doc du skill confondus.
 *
 * @param dir - dossier du skill.
 * @param re - motif GLOBAL dont la capture 1 est la valeur retenue.
 */
function scanSkillDocs(dir, re) {
  const found = new Set();
  eachSkillDocLine(dir, (line) => {
    for (const m of line.matchAll(re)) found.add(m[1]);
  });
  return found;
}

/** Les skills nommés par un skill. */
function collectSkillRefs(dir) {
  return scanSkillDocs(dir, /`(nodefony-[a-z][a-z-]*)`/g);
}

/**
 * Les renvois `references/…` d'un skill qui ne mènent NULLE PART.
 *
 * Ce contrôle manquait, et son absence ne se voyait pas : un renvoi vers un `references/*.md`
 * supprimé — ou jamais écrit — laissait la passe VERTE, alors qu'un agent qui le suit ne trouve
 * rien. Constaté en retirant un fichier fraîchement ajouté : la passe restait verte.
 *
 * Un renvoi peut être **croisé** : « `nodefony-frontend-dev` §4 → `references/build-hmr.md` » cite
 * la ressource d'un AUTRE skill, et c'est légitime. La résolution se fait donc contre le skill
 * courant **ou** contre tout skill nommé sur la même ligne — sans quoi le contrôle crierait sur des
 * renvois parfaitement valides (c'est arrivé au premier jet, sur ce renvoi précis).
 *
 * `existsSync` répond aussi bien pour un dossier (`references/rfc/`) que pour un fichier.
 *
 * @param dir - dossier du skill.
 * @returns les chemins cités qu'aucun skill ne porte, triés.
 */
function deadResourceRefsOf(dir) {
  const dead = new Set();
  eachSkillDocLine(dir, (line) => {
    const paths = [...line.matchAll(/`(references\/[a-zA-Z0-9._/-]+)`/g)].map(
      (m) => m[1],
    );
    if (paths.length === 0) return;
    const owners = [dir];
    for (const m of line.matchAll(/`(nodefony-[a-z][a-z-]*)`/g)) {
      const other = join(SKILLS_DIR, m[1]);
      if (existsSync(other)) owners.push(other);
    }
    for (const p of paths) {
      if (!owners.some((o) => existsSync(join(o, p)))) dead.add(p);
    }
  });
  return [...dead].sort();
}

/** Les déclencheurs cités dans la description — ce qui décide de l'invocation. */
function triggers(description) {
  const after = description.split(/D[ée]clencheurs?\s*(?:étroits[^:]*)?:/i)[1];
  if (!after) return [];
  return [...after.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Les skills à contrôler : ceux du dépôt, ET ceux que npm livre aux applications.
 *
 * 🔴 Les livrés étaient hors du gate, et c'est le plus grave des deux oublis
 * possibles : un skill du dépôt n'est lu que par un agent qui travaille ICI,
 * quand un skill livré part chez des utilisateurs qu'on ne connaît pas et qu'on
 * ne peut plus corriger sans publier. Ils sont marqués `livre` — leur fiche
 * publique et le registre les distinguent, et un contrôle peut n'être exigé que
 * d’eux.
 *
 * @returns les dossiers à contrôler, dépôt d'abord, chacun avec son origine.
 */
function skillsAControler() {
  const out = [];
  for (const [racine, livre] of [
    [SKILLS_DIR, false],
    [SKILLS_LIVRES_DIR, true],
  ]) {
    if (!existsSync(racine)) continue;
    for (const name of readdirSync(racine).sort())
      out.push({ name, dir: join(racine, name), livre });
  }
  return out;
}

const skills = [];
for (const { name, dir, livre } of skillsAControler()) {
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  const { fields, raw, body, description, version } = parseFrontmatter(src);

  const yamlErr = yamlError(raw);
  const topLevelFields = [...raw.matchAll(/^([a-zA-Z-]+):/gm)].map((m) => m[1]);
  const unknown = topLevelFields.filter((f) => !ALLOWED_FIELDS.has(f));
  const bodyLines = body.split("\n").length;
  // Les titres d'un GABARIT vivent dans un bloc de code : ce ne sont pas des sections du skill.
  const bodyOutsideCode = body.replace(/^```[\s\S]*?^```/gm, "");
  const sections = [...bodyOutsideCode.matchAll(/^##\s+(.+)$/gm)].map((m) =>
    m[1].replace(/\s*\{#.*\}$/, ""),
  );

  const refDir = join(dir, "references");
  const scrDir = join(dir, "scripts");
  const legacyRef = existsSync(join(dir, "reference"));

  // Graphe : quels autres skills ce skill nomme (orientation, délégation, « passer la main »).
  // Un skill fusionné ou retiré laisse derrière lui des renvois qui envoient dans le vide : ils sont
  // comptés à part et font échouer le contrôle, au lieu d'être silencieusement filtrés.
  const cited = collectSkillRefs(dir);
  const related = [...cited]
    .filter((n) => n !== name && existsSync(join(SKILLS_DIR, n)))
    .sort();
  const deadSkillRefs = [...cited]
    .filter((n) => n !== name && !estUnSkill(n) && !NON_SKILL_TERMS.has(n))
    .sort();

  // Même règle appliquée aux RESSOURCES : un renvoi « le détail est dans
  // references/x.md » vers un fichier absent envoie l'agent dans le vide, sans
  // que rien ne le signale.
  const deadResourceRefs = deadResourceRefsOf(dir);

  // 🔴 Les numéros d'issue — un POINTEUR MORT dès que le ticket se ferme ou
  // se renomme, et un skill n'a aucune raison d'en porter : l'avancement vit
  // dans les tickets, l'histoire dans `git log`, la règle ici. C'est la règle
  // anti-journal du CLAUDE.md, qui vaut explicitement pour les skills.
  // On ne regarde que la PROSE : un bloc de code peut légitimement montrer
  // `gh issue close 95` ou un `--grep '#N'`, et une ancre markdown (`](#3-…`)
  // ne désigne aucun ticket.
  // ⚠️ Borné à DEUX chiffres et plus, délibérément : les skills numérotent
  // leurs pièges et leurs étapes (« PIÈGE Vite glob #1 », « #2 »), et un gate
  // qui crie faux s'apprend à être ignoré — on préfère laisser passer un
  // hypothétique `#9` que rougir sur quatre skills irréprochables.
  const proseSansCode = body
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`[^`\n]*`/g, "");
  const ticketRefs = [
    ...new Set(
      [...proseSansCode.matchAll(/(?<![\w([])#(\d{2,4})\b/g)].map(
        (m) => `#${m[1]}`,
      ),
    ),
  ];

  const compat = fields.compatibility || "";
  // `nature` : normatif = MUST du standard · recommandé = SHOULD (best-practices) · projet =
  // contrôle propre à Nodefony. `ref` = la règle citée, pour qu'un lecteur voie d'où sort le contrôle.
  const checks = [
    {
      key: "name conforme et égal au dossier",
      ok:
        (fields.name || "").length <= 64 &&
        NAME_RE.test(fields.name || "") &&
        fields.name === name,
      nature: "normatif",
      ref: "spec § name : 1-64 car., minuscules alphanumériques + `-`, ni au bord ni consécutifs, = nom du dossier",
    },
    {
      key: "en-tête analysable par un vrai parseur YAML",
      ok: yamlErr === null,
      detail: yamlErr ?? "",
      nature: "normatif",
      ref: "spec § frontmatter : « YAML frontmatter » — un en-tête que YAML refuse n'est pas rendu par GitHub, alors que le parseur de l'agent, tolérant, l'accepte sans un mot",
    },
    {
      key: `description de 1 à ${MAX_DESC} caractères`,
      ok: description.length > 0 && description.length <= MAX_DESC,
      detail: `${description.length}`,
      nature: "normatif",
      ref: "spec § description : 1-1024 car., non vide (quoi + quand)",
    },
    {
      key: "aucun champ hors standard",
      ok: unknown.length === 0,
      detail: unknown.join(", "),
      nature: "normatif",
      ref: "spec § frontmatter : seuls `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` (version → `metadata.version`)",
    },
    {
      key: `compatibility ≤ ${MAX_COMPAT} caractères (si présent)`,
      ok: compat.length <= MAX_COMPAT,
      detail: compat ? `${compat.length}` : "absent",
      nature: "normatif",
      ref: "spec § compatibility : 1-500 car. si fourni",
    },
    {
      key: "dossier de ressources nommé `references/`",
      ok: !legacyRef,
      nature: "normatif",
      ref: "spec § resources : le dossier de détail se nomme `references/` (pluriel)",
    },
    // ⚠️ Ce que ce gate ne contrôle PAS, et où c'est contrôlé : `ai:sync` ne
    // pose pas le skill chez l'utilisateur, il pose un POINTEUR dont la
    // description est réduite à sa PREMIÈRE PHRASE. La règle appartient donc au
    // produit (`readSkillHeader`), et son contrôle vit là où la vraie fonction
    // est importée — `src/nodefony/src/tests/aiSync.test.ts`. La recopier ici
    // en ferait une seconde implémentation, qui divergerait en silence.
    {
      key: "aucun renvoi vers un skill inexistant",
      ok: deadSkillRefs.length === 0,
      detail: deadSkillRefs.join(", "),
      nature: "projet",
      ref: "Nodefony : un renvoi vers un skill fusionné/retiré envoie dans le vide",
    },
    {
      key: "aucun renvoi vers une ressource inexistante",
      ok: deadResourceRefs.length === 0,
      detail: deadResourceRefs.join(", "),
      nature: "projet",
      ref: "Nodefony : un renvoi `references/x.md` vers un fichier absent envoie l'agent dans le vide",
    },
    {
      key: "aucun numéro de ticket dans la prose",
      ok: ticketRefs.length === 0,
      detail: ticketRefs.join(", "),
      nature: "projet",
      ref: "Nodefony : un numéro d'issue est un pointeur MORT dans un skill — la règle s'y écrit intemporelle (anti-journal)",
    },
    {
      key: `corps < ${MAX_BODY_LINES} lignes`,
      ok: bodyLines < MAX_BODY_LINES,
      detail: `${bodyLines}`,
      soft: true,
      nature: "recommandé",
      ref: "best-practices : corps court (index) + détail en `references/` (divulgation progressive)",
    },
  ];

  // Ce qu'un registre ou un moteur de recherche doit pouvoir lire sans ouvrir le skill :
  // un résumé d'une ligne, des mots-clés, le coût d'activation, et les skills voisins.
  const summary = description
    .split(/(?<=[.!?])\s/)[0]
    .replace(/\*\*/g, "")
    .trim();
  const prose = description.split(/D[ée]clencheurs?\s*(?:étroits[^:]*)?:/i)[0];
  const keywords = [
    ...new Set(
      (prose.match(/`[^`]+`/g) ?? [])
        .map((k) => k.replace(/`/g, "").trim())
        .filter((k) => k.length > 1 && k.length < 40 && !k.includes(" ")),
    ),
  ].slice(0, 20);
  const approxTokens = Math.round(src.length / 4);

  skills.push({
    name,
    dir,
    livre,
    version,
    description,
    summary,
    keywords,
    related,
    approxTokens,
    bodyLines,
    sections,
    triggers: triggers(description),
    references: listFiles(refDir, [".md"]),
    referenceMetas: listFiles(refDir, [".md"]).map((f) =>
      referenceMeta(refDir, f),
    ),
    referencesTotal: countRecursive(refDir),
    // Les trois `map` ci-dessous itèrent des NOMS DE FICHIERS (des chaînes) : ce
    // qui est étalé n'est pas l'élément parcouru, c'est l'objet neuf que rend
    // `analyzeScript`. Rien n'est donc copié en double, et le remplacement que
    // suggère la règle (`Object.assign`) n'aurait ici aucune source à muter.
    // oxlint-disable-next-line no-map-spread
    scripts: listFiles(scrDir, [".mjs", ".js", ".sh", ".py", ".ts"]).map(
      (f) => ({ f, path: `scripts/${f}`, ...analyzeScript(join(scrDir, f)) }),
    ),
    // oxlint-disable-next-line no-map-spread
    rootScripts: listFiles(dir, [".sh"]).map((f) => ({
      f,
      path: f,
      ...analyzeScript(join(dir, f)),
    })),
    // oxlint-disable-next-line no-map-spread
    libs: listFiles(join(dir, "lib"), [".mjs", ".js"]).map((f) => ({
      f,
      path: `lib/${f}`,
      ...analyzeScript(join(dir, "lib", f)),
    })),
    checks,
    hard: checks.filter((c) => !c.soft).every((c) => c.ok),
  });
}

// ---------------------------------------------------------------- rendu d'une fiche
const badge = (ok) => (ok ? "✅" : "❌");
const esc = (s) => String(s).replace(/\|/g, "\\|");

function renderSkill(s) {
  const L = [];
  const firstSentence = s.description.split(/(?<=[.!?])\s/)[0];
  L.push("---");
  L.push(`title: "${s.name} — fiche de skill"`);
  // Le `title` porte « — fiche de skill » pour qui lit la page ; le MENU, lui, est une
  // colonne étroite, et `doc-lint` refuse au-delà de 32 caractères. Le nom du skill est
  // déjà le libellé que le lecteur cherche : il fait le navTitle sans rien perdre.
  L.push(`navTitle: ${s.name}`);
  L.push("lang: fr");
  L.push("audience: [developer]");
  L.push("topic: skills");
  L.push("status: stable");
  L.push("updated: " + STAMP);
  L.push("generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs");
  L.push(`source: "${s.dir}/SKILL.md"`);
  L.push("---");
  L.push("");
  L.push(`# \`${s.name}\``);
  L.push("");
  L.push(`> ${firstSentence}`);
  L.push("");
  L.push(
    "📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **" +
      s.name +
      "**",
  );
  L.push("");
  // Badge de conformité — visible EN HAUT, d'un coup d'œil : respecte-t-on le standard, et de combien.
  const norm = s.checks.filter((c) => c.nature === "normatif");
  const proj = s.checks.filter((c) => c.nature === "projet");
  const reco = s.checks.filter((c) => c.nature === "recommandé");
  const okN = norm.filter((c) => c.ok).length;
  const okP = proj.filter((c) => c.ok).length;
  const okR = reco.filter((c) => c.ok).length;
  const dot = s.hard ? "🟢" : "🔴";
  L.push(s.hard ? "> [!TIP]" : "> [!CAUTION]");
  L.push(
    `> ${dot} **${s.hard ? "Conforme" : "NON conforme"}** au standard [${STANDARD.name}](${STANDARD.url}) — _${STANDARD.org}_.`,
  );
  L.push(
    `> ℹ️ **${okN}/${norm.length}** contrôles normatifs (MUST) · 🛡️ **${okP}/${proj.length}** projet · 💡 **${okR}/${reco.length}** recommandé (SHOULD)` +
      `${s.version ? ` · 🏷️ \`v${s.version}\`` : ""}.`,
  );
  L.push("");
  L.push("> [!NOTE]");
  L.push(
    "> Fiche **générée** par `.claude/skills/nodefony-skill/scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :",
  );
  L.push("> corriger le skill, puis régénérer.");
  L.push("");
  L.push("| | |");
  L.push("| --- | --- |");
  L.push(
    `| Version | ${s.version ? `\`${s.version}\`` : "— (non versionné)"} |`,
  );
  L.push(`| Famille | ${familyOf(s.name)} |`);
  L.push(`| Corps | ${s.bodyLines} lignes |`);
  L.push(
    `| Coût d'activation | ~${s.approxTokens.toLocaleString("fr-FR")} tokens (le corps est chargé à l'invocation) |`,
  );
  L.push(`| Description | ${s.description.length} / ${MAX_DESC} caractères |`);
  L.push(`| Déclencheurs | ${s.triggers.length} |`);
  L.push(
    `| Ressources \`references/\` | ${s.references.length} page(s)${s.referencesTotal > s.references.length ? `, ${s.referencesTotal} fichiers au total` : ""} |`,
  );
  L.push(
    `| Scripts | ${s.scripts.length + s.rootScripts.length + s.libs.length} |`,
  );
  L.push(
    `| Conformité | ${badge(s.hard)} ${s.hard ? "conforme au standard" : "NON conforme"} |`,
  );
  L.push("");

  L.push("## Ce qu'il fait");
  L.push("");
  L.push(
    s.description.split(/D[ée]clencheurs?\s*(?:étroits[^:]*)?:/i)[0].trim(),
  );
  L.push("");

  const allSc = [...s.rootScripts, ...s.scripts, ...s.libs];
  const requires = [...new Set(allSc.flatMap((x) => x.requires))];
  if (requires.length) {
    L.push("## Prérequis");
    L.push("");
    L.push(
      `Ce que le décor doit fournir pour que ses scripts disent quelque chose : ${requires.map((r) => `**${r}**`).join(" · ")}.`,
    );
    L.push("");
  }

  if (s.related.length) {
    L.push("## Skills voisins");
    L.push("");
    L.push(
      "Ce skill en nomme d'autres — pour déléguer, ou pour dire ce qu'il ne fait pas :",
    );
    L.push("");
    L.push(s.related.map((r) => `[\`${short(r)}\`](${r}.md)`).join(" · "));
    L.push("");
  }

  if (s.triggers.length) {
    L.push("## Quand il se déclenche");
    L.push("");
    L.push(
      "Formulations qui doivent conduire à l'**invoquer** (et non à lire ses fichiers) :",
    );
    L.push("");
    L.push(s.triggers.map((t) => `\`${t}\``).join(" · "));
    L.push("");
  }

  if (s.sections.length) {
    L.push("## Ce que contient le corps");
    L.push("");
    for (const sec of s.sections) L.push(`- ${sec}`);
    L.push("");
  }

  if (s.references.length) {
    L.push("## Références (chargées à la demande)");
    L.push("");
    L.push(
      "Détail déporté hors du corps — chargé seulement quand la tâche l'exige (divulgation progressive).",
    );
    L.push("");
    L.push("| Fichier | Ce qu'il couvre | Lignes |");
    L.push("| --- | --- | --: |");
    for (const r of s.referenceMetas)
      L.push(`| \`references/${r.f}\` | ${esc(r.title || "—")} | ${r.lines} |`);
    L.push("");
    if (s.referencesTotal > s.references.length)
      L.push(
        `_(+ ${s.referencesTotal - s.references.length} fichiers dans des sous-dossiers : specs et normes bundlées hors ligne.)_`,
      );
    L.push("");
  }

  const allScripts = [...s.rootScripts, ...s.scripts, ...s.libs];
  if (allScripts.length) {
    L.push("## Scripts embarqués");
    L.push("");
    L.push(
      "Rôle, invocation, options et variables d'environnement — **extraits du source** de chaque",
    );
    L.push("script, donc toujours à jour après régénération.");
    L.push("");
    L.push("| Script | Rôle | Options | Variables d'environnement |");
    L.push("| --- | --- | --- | --- |");
    for (const sc of allScripts) {
      const flags = sc.flags.length
        ? sc.flags.map((f) => `\`${f}\``).join(" ")
        : "—";
      const envs = sc.envs.length
        ? sc.envs.map((e) => `\`${e}\``).join(" ")
        : "—";
      L.push(
        `| \`${sc.path}\` | ${esc(sc.purpose || "—")} | ${esc(flags)} | ${esc(envs)} |`,
      );
    }
    L.push("");
    const withUsage = allScripts.filter((sc) => sc.usage);
    if (withUsage.length) {
      L.push("**Invocation telle que documentée dans chaque script :**");
      L.push("");
      L.push("```bash");
      for (const sc of withUsage) L.push(sc.usage);
      L.push("```");
      L.push("");
    }
    const envAll = [...new Set(allScripts.flatMap((sc) => sc.envs))].sort();
    if (envAll.length) {
      L.push(
        `**Toutes les variables lues par ce skill** : ${envAll.map((e) => `\`${e}\``).join(" · ")}`,
      );
      L.push("");
    }

    // Détail des scripts qui se documentent eux-mêmes (tags @option / @env / @output) : ceux-là
    // ont une aide écrite par leur auteur, pas déduite.
    const documented = allScripts.filter((sc) => sc.selfDocumented);
    if (documented.length) {
      L.push("### Détail des scripts auto-documentés");
      L.push("");
      for (const sc of documented) {
        L.push(`#### \`${sc.path}\``);
        L.push("");
        if (sc.output) L.push(`Produit : ${sc.output}`);
        if (sc.usages.length) {
          L.push("");
          L.push("```bash");
          for (const u of sc.usages) L.push(u);
          L.push("```");
        }
        if (sc.options.length) {
          L.push("");
          L.push("| Option | Rôle |");
          L.push("| --- | --- |");
          for (const o of sc.options)
            L.push(`| \`${o.flag}\` | ${esc(o.help)} |`);
        }
        if (sc.envDocs.length) {
          L.push("");
          L.push("| Variable | Rôle |");
          L.push("| --- | --- |");
          for (const e of sc.envDocs)
            L.push(`| \`${e.name}\` | ${esc(e.help)} |`);
        }
        L.push("");
      }
    }
  }

  L.push("## Conformité au standard Agent Skills");
  L.push("");
  L.push("> [!NOTE]");
  L.push(`> **Standard [Agent Skills](${STANDARD.url})** — ${STANDARD.org}.`);
  L.push(
    "> **Nature** — ℹ️ _normatif_ : règle **MUST** du standard, un client conforme la refuse ;",
  );
  L.push(
    "> _recommandé_ : **SHOULD** des best-practices ; _projet_ : contrôle propre à Nodefony. La colonne",
  );
  L.push("> _Règle_ cite la source exacte de chaque contrôle.");
  L.push("");
  L.push("| Contrôle | Nature | État | Mesure | Règle (source) |");
  L.push("| --- | :---: | :---: | --- | --- |");
  const natLabel = {
    normatif: "ℹ️ normatif",
    recommandé: "recommandé",
    projet: "projet",
  };
  for (const c of s.checks)
    L.push(
      `| ${c.key} | ${natLabel[c.nature] || "—"} | ${badge(c.ok)} | ${esc(c.detail || "")} | ${esc(c.ref || "—")} |`,
    );
  L.push("");
  L.push(
    "_Le validateur officiel `skills-ref validate` couvre les règles normatives ; ce gate y ajoute les contrôles projet et un rappel des recommandations._",
  );
  L.push("");
  L.push("## 🔗 Pour aller plus loin");
  L.push("");
  L.push(
    "- ⬆️ **Retour au hub** : [Fiches des skills](index.md) · [Outillage agents](../outillage-agents.md)",
  );
  L.push(
    `- **Le skill lui-même** : \`${s.dir}/SKILL.md\` — c'est lui qu'on édite, pas cette fiche.`,
  );
  L.push("");
  return L.join("\n");
}

/**
 * Icône et famille par skill — l'œil doit trier avant de lire. Un skill absent de cette table
 * retombe sur « Autres » : la fiche sort quand même, mais le classement demande une décision.
 */
const CATALOG = {
  session: ["🧭", "Cycle de session"],
  skill: ["🧩", "Cycle de session"],
  "framework-dev": ["⚙️", "Développer le framework"],
  "frontend-dev": ["🎨", "Développer le framework"],
  "studio-dev": ["🖥️", "Développer le framework"],
  documentation: ["📘", "Développer le framework"],
  "create-module": ["📦", "Développer le framework"],
  "create-frontend-module": ["🖼️", "Développer le framework"],
  "start-server": ["🚀", "Exécuter, diagnostiquer, mesurer"],
  debug: ["🩺", "Exécuter, diagnostiquer, mesurer"],
  "tail-error-logs": ["📄", "Exécuter, diagnostiquer, mesurer"],
  "check-memory-health": ["🧠", "Exécuter, diagnostiquer, mesurer"],
  "load-test": ["📈", "Exécuter, diagnostiquer, mesurer"],
  "multipod-bench": ["🛰️", "Exécuter, diagnostiquer, mesurer"],
  "migrate-schema": ["🗄️", "Développer le back"],
  "security-review": ["🛡️", "Inspecter et auditer"],
  inspect: ["🔬", "Inspecter et auditer"],
  "check-externals": ["🔗", "Publier et distribuer"],
  release: ["🚢", "Publier et distribuer"],
  rfc: ["📜", "Références et livrables"],
  roadmap: ["🗓️", "Références et livrables"],
  "html-report": ["📊", "Références et livrables"],
};
const FAMILY_ORDER = [
  "Cycle de session",
  "Développer le framework",
  "Exécuter, diagnostiquer, mesurer",
  "Inspecter et auditer",
  "Publier et distribuer",
  "Références et livrables",
  "Autres",
];
const short = (name) => name.replace(/^nodefony-/, "");
const iconFor = (name) => (CATALOG[short(name)] || ["🔧"])[0];
const familyOf = (name) => (CATALOG[short(name)] || [undefined, "Autres"])[1];

/**
 * Cards des skills — bloc `nodefony-cards` rendu par Studio. Généré, donc toujours aligné sur les
 * descriptions réelles : une card ment le jour où on la recopie à la main.
 */
function renderCards(list, prefix = "") {
  const cards = list.map((s) => {
    const sentences = s.description.split(/(?<=[.!?])\s/);
    const first = sentences[0].replace(/"/g, "'").replace(/\*\*/g, "").trim();
    const second = (sentences[1] || "")
      .replace(/"/g, "'")
      .replace(/\*\*/g, "")
      .trim();
    let desc = first.length < 160 && second ? `${first} ${second}` : first;
    if (desc.length > 300)
      desc = desc.slice(0, 297).replace(/\s+\S*$/, "") + "…";
    const nScripts = s.scripts.length + s.rootScripts.length + s.libs.length;
    // Pied de card : d'abord le VERDICT de conformité (icône + version) — le signal « pro » lisible
    // d'un coup d'œil — puis les ressources. Cohérent d'une card à l'autre.
    const bits = [
      `${s.hard ? "🟢" : "🔴"} conforme${s.version ? ` v${s.version}` : ""}`,
    ];
    if (nScripts) bits.push(`⚙️ ${nScripts} script${nScripts > 1 ? "s" : ""}`);
    if (s.references.length) bits.push(`📎 ${s.references.length} réf`);
    return `  { "icon": "${iconFor(s.name)}", "title": "${short(s.name)}", "href": "${prefix}${s.name}.md",\n    "desc": "${desc}",\n    "meta": "${bits.join(" · ")}" }`;
  });
  return "```nodefony-cards\n[\n" + cards.join(",\n") + "\n]\n```";
}

/** Les cards regroupées par famille, chaque famille sous son propre titre. */
function renderCardsByFamily(list, prefix = "") {
  const L = [];
  for (const fam of FAMILY_ORDER) {
    const group = list.filter((s) => familyOf(s.name) === fam);
    if (!group.length) continue;
    L.push(`### ${fam}`);
    L.push("");
    L.push(renderCards(group, prefix));
    L.push("");
  }
  return L.join("\n");
}

function renderIndex(list) {
  const L = [];
  L.push("---");
  L.push('title: "Fiches des skills — index généré"');
  L.push("navTitle: Fiches des skills");
  L.push("lang: fr");
  L.push("audience: [developer]");
  L.push("topic: skills");
  L.push("tests: none");
  L.push("status: stable");
  L.push("updated: " + STAMP);
  L.push("generated: .claude/skills/nodefony-skill/scripts/skills-doc.mjs");
  L.push('source: "docs/skills/index.md"');
  L.push("---");
  L.push("");
  L.push("# Fiches des skills");
  L.push("");
  L.push(
    `> Une fiche par skill du dépôt de développement, **générée** depuis son \`SKILL.md\` par`,
  );
  L.push(
    `> \`.claude/skills/nodefony-skill/scripts/skills-doc.mjs\` : version, contenu, déclencheurs, ressources, scripts et conformité`,
  );
  L.push(
    `> au standard Agent Skills. L'analyse d'ensemble — usage réel, doublons, fusions — vit dans`,
  );
  L.push(`> [Outillage agents](../outillage-agents.md).`);
  L.push("");
  L.push(
    "📍 [Documentation](../index.md) › [Outillage agents](../outillage-agents.md) › **Fiches des skills**",
  );
  L.push("");
  const conformes = list.filter((s) => s.hard).length;
  L.push(
    `**${list.length} skills** · **${conformes}/${list.length} conformes** au standard · régénérer : \`node .claude/skills/nodefony-skill/scripts/skills-doc.mjs\``,
  );
  L.push("");
  L.push("## 🧭 Par où commencer");
  L.push("");
  L.push(
    "- **Comprendre l'ensemble** (usage réel, doublons, fusions, conformité) →",
  );
  L.push("  [Outillage agents](../outillage-agents.md).");
  L.push(
    "- **Écrire ou réparer un skill** → la fiche [`nodefony-skill`](nodefony-skill.md), qui porte",
  );
  L.push("  les conventions du dépôt et la barrière de conformité.");
  L.push(
    "- **Chercher un outil pour une tâche précise** → les cards par famille ci-dessous ; chacune",
  );
  L.push("  mène à la fiche du skill, avec ses déclencheurs et ses scripts.");
  L.push("");
  L.push("## Par famille");
  L.push("");
  L.push(renderCardsByFamily(list));
  L.push("## Tableau récapitulatif");
  L.push("");
  L.push("| Skill | Version | Corps | Réf. | Scripts | Conforme |");
  L.push("| --- | --- | ---: | ---: | ---: | :---: |");
  for (const s of list)
    L.push(
      `| [\`${s.name}\`](${s.name}.md) | ${s.version || "—"} | ${s.bodyLines} | ${s.references.length} | ${s.scripts.length + s.rootScripts.length + s.libs.length} | ${badge(s.hard)} |`,
    );
  L.push("");
  L.push("## 🔗 Pour aller plus loin");
  L.push("");
  L.push(
    "- ⬆️ **Retour au hub** : [Outillage agents](../outillage-agents.md) · [Toute la documentation](../index.md)",
  );
  L.push(
    "- **Écrire un skill** : [`nodefony-skill`](nodefony-skill.md) — conventions, gabarit, barrière de conformité.",
  );
  L.push(
    "- **Le standard** : `name`, `description` ≤ 1024, champs autorisés, ressources en `references/`.",
  );
  L.push("  Validateur officiel : `skills-ref validate ./<skill>`.");
  L.push("");
  return L.join("\n");
}

/**
 * Une fiche générée ne se réécrit QUE si son contenu change.
 *
 * Le timbre du jour était posé sur les 24 fiches à chaque passe : un seul skill
 * modifié produisait 27 fichiers au diff, et la vraie ligne se noyait dans le
 * bruit. La date décrit l'artefact, elle ne doit pas le faire vivre.
 *
 * Le même comparateur sert au mode `--check` : une fiche qui diffère du rendu
 * est PÉRIMÉE. Sans lui, rien ne le voyait — le registre a vécu un jour entier
 * avec le corps d'un skill à 455 lignes quand il en portait 619, et le gate
 * était vert.
 */
const perimees = [];
const sansTimbre = (t) =>
  t
    .replace(/^updated: .*$/m, "updated: —")
    .replace(/"generatedAt": ".*"/, '"generatedAt": "—"');

/**
 * Écrit si le contenu diffère ; en `--check`, se contente de le SIGNALER.
 *
 * @param {string} chemin - fichier généré.
 * @param {string} contenu - rendu attendu.
 */
function ecrireGenere(chemin, contenu) {
  const actuel = existsSync(chemin) ? readFileSync(chemin, "utf8") : "";
  if (sansTimbre(actuel) === sansTimbre(contenu)) return;
  if (CHECK_ONLY) perimees.push(chemin);
  else writeFileSync(chemin, actuel ? contenu : contenu);
}

/**
 * Les skills qui reçoivent une FICHE — un seul par nom.
 *
 * Deux skills portent le même nom des deux côtés (`nodefony-browser`,
 * `nodefony-migrate-schema`) : un JUMEAU du dépôt, plus complet, et sa version
 * livrée. Les deux sont CONTRÔLÉS — c'est tout l'objet de l'élargissement —
 * mais une seule fiche peut porter un nom de fichier, et sans arbitrage
 * explicite c'est le dernier rendu qui gagnerait, silencieusement, selon
 * l'ordre de lecture du disque. Le dépôt gagne : sa fiche est celle qu'un
 * lecteur du dépôt cherche.
 */
const skillsAvecFiche = skills.filter(
  (s) => !s.livre || !skills.some((o) => o.name === s.name && !o.livre),
);

// ---------------------------------------------------------- index de scripts/
/**
 * Les dossiers de `scripts/`, rangés par NATURE — jamais par appelant : un même
 * script est lancé par npm ET un hook ET la forge, l'appelant ne classe rien.
 * L'ordre est celui de l'index ; un dossier absent de cette table y apparaît
 * en fin, sous son seul nom, et le contrôle le signale.
 */
const SCRIPT_NATURES = [
  ["lib", "Helpers transverses, importés par les scripts des autres dossiers."],
  [
    "gates",
    "Gardes de commit et de forge : chacune refuse un état précis du dépôt.",
  ],
  ["scaffold", "Contrôles et mise en forme des gabarits d'application."],
  ["deps", "Inventaire et garde des dépendances, gabarits compris."],
  ["test", "Orchestration des suites de test et de la couverture."],
  [
    "generate",
    "Génération d'artefacts : graphe symbolique, page de manuel, catalogue d'environnement, logo.",
  ],
  ["site", "Rendu du site de documentation publié et de ses pages annexes."],
  [
    "repo",
    "Hygiène de l'arbre de travail : verrous, rangement de tmp/, commit sans verrou orphelin.",
  ],
  ["ci", "Ce que la forge lance ou éprouve sur elle-même."],
  ["release", "Chaîne de publication du produit."],
];
const SCRIPTS_DIR = "scripts";
const SCRIPTS_README = join(SCRIPTS_DIR, "README.md");
const estTest = (p) => /\.test\.[cm]?[jt]sx?$/u.test(p);

/**
 * Tous les scripts de `scripts/`, documentés depuis leur SOURCE : raison d'être,
 * `@usage`, options, variables, et qui les lance — npm, hook, forge, autre
 * script — par la même règle que `scripts-audit.mjs`.
 *
 * @returns {object[]} une entrée par script, triée par nature puis par chemin.
 */
function repoScripts() {
  const skillDirs = readdirSync(SKILLS_DIR).filter((n) =>
    existsSync(join(SKILLS_DIR, n, "SKILL.md")),
  );
  const racine = collectScripts(SCRIPTS_DIR);
  const sources = readSources(
    racine.concat(...skillDirs.map((n) => collectScripts(join(SKILLS_DIR, n)))),
  );
  const pkg = existsSync("package.json")
    ? readFileSync("package.json", "utf8")
    : "";
  const { appelants } = createLaunchFinder(sources, pkg);
  const rang = (nature) => {
    const i = SCRIPT_NATURES.findIndex(([n]) => n === nature);
    return i === -1 ? SCRIPT_NATURES.length : i;
  };
  return racine
    .map((p) => {
      const chemin = cle(p);
      const rel = chemin.slice(SCRIPTS_DIR.length + 1);
      const nature = rel.includes("/") ? rel.split("/")[0] : "";
      const a = analyzeScript(p);
      const appels = appelants(p);
      const uniques = (xs) => [...new Set(xs)];
      return {
        path: chemin,
        rel,
        nature,
        test: estTest(chemin),
        purpose: a.purpose,
        usage: a.usages,
        declaredUsage: a.declaredUsage,
        options: a.options,
        env: a.envDocs.length
          ? a.envDocs
          : a.envs.map((e) => ({ name: e, help: "" })),
        output: a.output,
        calledBy: uniques(
          appels.filter((x) => !estTest(x.name)).map((x) => x.name),
        ),
        testedBy: uniques(
          appels.filter((x) => estTest(x.name)).map((x) => x.name),
        ),
      };
    })
    .sort(
      (x, y) =>
        rang(x.nature) - rang(y.nature) ||
        (x.rel < y.rel ? -1 : x.rel > y.rel ? 1 : 0),
    );
}

/**
 * `scripts/README.md` — l'index GÉNÉRÉ de l'outillage du dépôt.
 *
 * @param {object[]} list - sortie de `repoScripts()`.
 * @returns {string} le markdown complet.
 */
function renderScriptsIndex(list) {
  const code = (s) => `\`${s}\``;
  // Un chemin d'appelant hors de scripts/ reste tel quel ; dans scripts/, relatif.
  const appelant = (n) =>
    code(n.startsWith(`${SCRIPTS_DIR}/`) ? n.slice(SCRIPTS_DIR.length + 1) : n);
  const out = [
    "<!-- GÉNÉRÉ par .claude/skills/nodefony-skill/scripts/skills-doc.mjs — ne pas éditer : `npm run skills:doc`. -->",
    "",
    "# `scripts/` — l'outillage du dépôt",
    "",
    "Chaque script du dépôt, rangé par **nature** : ce qu'il fait, comment le lancer, et **qui le lance**",
    "(commande npm, hook git, étape de forge, autre script). Tout est extrait du source — l'en-tête",
    "du script (`@usage`, `@option`, `@env`, `@requires`, `@output`) est la seule place où sa",
    "documentation s'écrit. `npm run skills:check` refuse un script sans `@usage` et un index périmé.",
    "",
    "Un script dont l'appelant manque n'est lancé par aucun automate : il se tape à la main.",
    "",
  ];
  const natures = [...new Set(list.map((s) => s.nature))];
  for (const nature of natures) {
    const desc = SCRIPT_NATURES.find(([n]) => n === nature)?.[1];
    out.push(`## ${code(nature ? `${nature}/` : "(racine)")}`, "");
    if (desc) out.push(desc, "");
    for (const s of list.filter((x) => x.nature === nature)) {
      const nom = nature ? s.rel.slice(nature.length + 1) : s.rel;
      out.push(`### [${code(nom)}](${s.rel})`, "");
      if (s.purpose) out.push(s.purpose, "");
      for (const u of s.usage) out.push(`- **Usage** : ${code(u)}`);
      for (const o of s.options)
        out.push(`- **Option** ${code(o.flag)}${o.help ? ` — ${o.help}` : ""}`);
      for (const e of s.env)
        out.push(
          `- **Variable** ${code(e.name)}${e.help ? ` — ${e.help}` : ""}`,
        );
      if (s.output) out.push(`- **Produit** : ${s.output}`);
      out.push(
        `- **${s.test ? "Lancé" : "Appelé"} par** : ${
          s.calledBy.length
            ? s.calledBy.map(appelant).join(" · ")
            : "aucun automate"
        }`,
      );
      if (!s.test && s.testedBy.length)
        out.push(`- **Testé par** : ${s.testedBy.map(appelant).join(" · ")}`);
      out.push("");
    }
  }
  return out.join("\n").replace(/\n+$/, "\n");
}

/**
 * Les écarts que l'index ne sait pas réparer seul : un script sans `@usage`
 * (hors tests), un fichier posé à la racine de `scripts/`, un dossier hors de
 * la table des natures.
 *
 * @param {object[]} list - sortie de `repoScripts()`.
 * @returns {string[]} un message par écart.
 */
function scriptsIndexGaps(list) {
  const gaps = [];
  for (const s of list) {
    if (!s.nature)
      gaps.push(
        `${s.path} : posé à la racine de scripts/ — le ranger par nature`,
      );
    else if (!SCRIPT_NATURES.some(([n]) => n === s.nature))
      gaps.push(`${s.path} : dossier « ${s.nature} » absent de SCRIPT_NATURES`);
    if (!s.test && !s.declaredUsage)
      gaps.push(`${s.path} : aucun \`@usage\` en tête de fichier`);
  }
  return gaps;
}

// ---------------------------------------------------------------- exécution
const scriptsDuDepot = repoScripts();
const scriptGaps = scriptsIndexGaps(scriptsDuDepot);
{
  if (!CHECK_ONLY) mkdirSync(OUT_DIR, { recursive: true });
  for (const s of skillsAvecFiche)
    ecrireGenere(join(OUT_DIR, `${s.name}.md`), renderSkill(s));
  ecrireGenere(join(OUT_DIR, "index.md"), renderIndex(skillsAvecFiche));
  ecrireGenere(SCRIPTS_README, renderScriptsIndex(scriptsDuDepot));

  // Index MACHINE. Un registre de skills ou un moteur de recherche n'ouvre pas 27 markdown :
  // il lui faut un seul fichier structuré — résumé, mots-clés, déclencheurs, coût d'activation,
  // prérequis, graphe de voisinage, conformité. C'est la même donnée que les fiches, sérialisée.
  const registry = {
    schema: "nodefony.skills-registry/1",
    standard: "agent-skills",
    generatedBy: ".claude/skills/nodefony-skill/scripts/skills-doc.mjs",
    generatedAt: STAMP,
    count: skills.length,
    repoScripts: scriptsDuDepot.map(
      ({ rel: _rel, nature: _n, declaredUsage: _d, ...s }) => s,
    ),
    conformant: skills.filter((s) => s.hard).length,
    skills: skills.map((s) => ({
      name: s.name,
      summary: s.summary,
      family: familyOf(s.name),
      version: s.version,
      keywords: s.keywords,
      triggers: s.triggers,
      description: s.description,
      cost: { bodyLines: s.bodyLines, approxTokens: s.approxTokens },
      requires: [
        ...new Set(
          [...s.rootScripts, ...s.scripts, ...s.libs].flatMap(
            (x) => x.requires,
          ),
        ),
      ],
      resources: {
        references: s.references,
        referenceFilesTotal: s.referencesTotal,
        scripts: [...s.rootScripts, ...s.scripts, ...s.libs].map((x) => ({
          path: x.path,
          purpose: x.purpose,
          usage: x.usages,
          options: x.options.length
            ? x.options
            : x.flags.map((f) => ({ flag: f, help: "" })),
          env: x.envDocs.length
            ? x.envDocs
            : x.envs.map((e) => ({ name: e, help: "" })),
          output: x.output,
          selfDocumented: x.selfDocumented,
        })),
      },
      related: s.related,
      conformance: {
        ok: s.hard,
        checks: s.checks.map((c) => ({
          key: c.key,
          ok: c.ok,
          detail: c.detail || null,
          advisory: Boolean(c.soft),
        })),
      },
      links: { source: `${s.dir}/SKILL.md`, doc: `docs/skills/${s.name}.md` },
    })),
  };
  ecrireGenere(
    join(OUT_DIR, "registry.json"),
    JSON.stringify(registry, null, 2) + "\n",
  );

  // La page d'analyse porte les mêmes cards, remplies ICI entre deux marqueurs : une card
  // recopiée à la main ment dès la première édition d'une description.
  const ANALYSIS = "docs/outillage-agents.md";
  const START = "<!-- skills-cards:start -->";
  const END = "<!-- skills-cards:end -->";
  if (existsSync(ANALYSIS)) {
    const src = readFileSync(ANALYSIS, "utf8");
    const i = src.indexOf(START);
    const j = src.indexOf(END);
    if (i !== -1 && j > i) {
      const next =
        src.slice(0, i) +
        `${START}\n\n${renderCardsByFamily(skills, "skills/")}${END}` +
        src.slice(j + END.length);
      if (next !== src) {
        if (CHECK_ONLY) perimees.push(ANALYSIS);
        else writeFileSync(ANALYSIS, next);
      }
      if (!CHECK_ONLY) console.log(`  cards injectées dans ${ANALYSIS}`);
    }
  }
}

const failed = skills.filter((s) => !s.hard);
const soft = skills.filter((s) => s.checks.some((c) => c.soft && !c.ok));
console.log(
  `skills-doc — ${skills.length} skills · ${skills.length - failed.length} conformes`,
);
if (!CHECK_ONLY) console.log(`  fiches écrites dans ${OUT_DIR}/ (+ index.md)`);
for (const s of failed)
  console.log(
    `  ❌ ${s.name} : ${s.checks
      .filter((c) => !c.ok && !c.soft)
      .map((c) => c.key + (c.detail ? ` (${c.detail})` : ""))
      .join(", ")}`,
  );
for (const s of soft)
  console.log(
    `  ⚠️  ${s.name} : corps de ${s.bodyLines} lignes (recommandation : < ${MAX_BODY_LINES})`,
  );
if (perimees.length) {
  console.log(
    `  ❌ ${perimees.length} fiche(s) générée(s) PÉRIMÉE(s) — lancer \`npm run skills:doc\` :`,
  );
  for (const f of perimees) console.log(`     ${f}`);
}
if (scriptGaps.length) {
  console.log(`  ❌ ${scriptGaps.length} écart(s) dans scripts/ :`);
  for (const g of scriptGaps) console.log(`     ${g}`);
}
process.exit(failed.length || perimees.length || scriptGaps.length ? 1 : 0);
