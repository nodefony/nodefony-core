#!/usr/bin/env node
/**
 * skills-doc — fiche de documentation par skill, ET gate de conformité.
 *
 * Une fiche écrite à la main diverge du skill qu'elle décrit dès la première édition. Ici, les 26
 * fiches sont DÉRIVÉES du `SKILL.md` lui-même : version, ressources, scripts, déclencheurs et
 * conformité au standard Agent Skills (AAIF) sont lus, jamais recopiés.
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
import { join, relative } from "node:path";

const SKILLS_DIR = ".claude/skills";
const OUT_DIR = "docs/skills";
const CHECK_ONLY = process.argv.includes("--check");
const ALLOWED_FIELDS = new Set([
  "name",
  "description",
  "license",
  "metadata",
  "allowed-tools",
]);
const MAX_DESC = 1024;
const MAX_BODY_LINES = 500;
// Horodatage exigé par le gate de documentation. Passé par l'environnement pour rester rejouable.
const STAMP =
  process.env.SKILLS_DOC_DATE || new Date().toISOString().slice(0, 10);

/** Découpe le frontmatter YAML sans dépendance : suffisant pour les champs plats du standard. */
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
 * Radiographie d'un script : sa raison d'être, sa ligne d'usage, ses options et les variables
 * d'environnement qu'il lit. Tout est extrait du SOURCE — une option ajoutée au script apparaît
 * dans la fiche à la régénération suivante, sans que personne ait à y penser.
 */
const ENV_NOISE =
  /^(PATH|HOME|PWD|SHELL|USER|TERM|LANG|TMPDIR|NODE_OPTIONS|FORCE_COLOR|CI)$/;

function analyzeScript(path) {
  let src = "";
  try {
    src = readFileSync(path, "utf8");
  } catch {
    return {
      purpose: "",
      usage: "",
      flags: [],
      envs: [],
      docs: {},
      requires: [],
    };
  }
  const head = src.split("\n").slice(0, 40);

  // ── HOOK DE DOC ────────────────────────────────────────────────────────────────────────────
  // Un script peut se DÉCRIRE lui-même dans son entête, au lieu de laisser deviner. Ces tags
  // sont facultatifs : sans eux, l'heuristique plus bas fait de son mieux ; avec eux, la fiche
  // devient exacte. C'est le seul endroit où la doc d'un script doit vivre — pas dans un fichier
  // parallèle qui divergera.
  //
  // (exemples entre accents graves pour qu'ils ne soient pas moissonnés par leur propre lecteur)
  //   `@usage`    node scripts/x.mjs --out rapport.html
  //   `@option`   --out    chemin du rapport produit
  //   `@env`      NF_PORT  port du serveur à interroger
  //   `@requires` docker, serveur UP
  //   `@output`   un rapport HTML autonome
  const tag = (name) =>
    [
      ...src.matchAll(
        new RegExp(`^\\s*(?:#|//|\\*)\\s*@${name}\\s+(.+)$`, "gm"),
      ),
    ].map((m) => m[1].trim());
  const docs = {
    usage: tag("usage"),
    options: tag("option").map((l) => {
      const m = l.match(/^(--?[\w-]+)\s+(.*)$/);
      return m
        ? { flag: m[1], help: m[2] }
        : { flag: l.split(/\s+/)[0], help: l.split(/\s+/).slice(1).join(" ") };
    }),
    envs: tag("env").map((l) => {
      const m = l.match(/^([A-Z][A-Z0-9_]*)\s+(.*)$/);
      return m
        ? { name: m[1], help: m[2] }
        : { name: l.split(/\s+/)[0], help: "" };
    }),
    output: tag("output"),
  };
  const declaredRequires = tag("requires")
    .flatMap((l) => l.split(/\s*,\s*/))
    .filter(Boolean);

  // Prérequis déduits quand le script ne les déclare pas : ce qu'il faut avoir sous la main
  // pour que son résultat veuille dire quelque chose.
  const inferred = [];
  if (/\bdocker\b/i.test(src)) inferred.push("docker");
  if (/localhost:\d|127\.0\.0\.1|https?:\/\/localhost/.test(src))
    inferred.push("serveur UP");
  if (/redis|REDIS_/i.test(src)) inferred.push("redis");
  if (/\b(psql|postgres|mysql|mariadb|mongo)\b/i.test(src))
    inferred.push("base de données");
  const requires = [
    ...new Set(declaredRequires.length ? declaredRequires : inferred),
  ];

  // Raison d'être : la première ligne de commentaire substantielle de l'entête.
  let purpose = "";
  for (const line of head) {
    const c = line.match(/^\s*(?:#|\/\/|\*)\s*(.{8,})$/);
    // Un filet de séparation (tirets ASCII ou box-drawing) n'est pas une raison d'être.
    if (
      c &&
      !/^#!/.test(line.trim()) &&
      !/eslint|prettier|@ts-/.test(c[1]) &&
      !/^[-=─━_*·.\s]+$/u.test(c[1])
    ) {
      purpose = c[1].trim().replace(/\s*[-–—]\s*$/, "");
      break;
    }
  }

  // Ligne d'usage : un exemple d'invocation cité dans l'entête.
  const usageLine = head.find(
    (l) =>
      /(?:^|\s)(?:node|bash|sh|npx)\s+[\w./-]*(?:scripts\/)?[\w.-]+\.(?:mjs|js|sh)/.test(
        l,
      ) && /^\s*(?:#|\/\/|\*)/.test(l),
  );
  const usage = usageLine
    ? usageLine.replace(/^\s*(?:#|\/\/|\*)\s*/, "").trim()
    : "";

  // Options : les drapeaux réellement testés par le script.
  const flags = [
    ...new Set([...src.matchAll(/--[a-z][a-z0-9-]{1,24}/g)].map((m) => m[0])),
  ]
    .filter(
      (f) =>
        !/^--(?:experimental|max-old|expose|enable|no-warnings|loader|import)/.test(
          f,
        ),
    )
    .sort();

  // Variables d'ENTRÉE : ce qui vient de l'extérieur, jamais les variables de travail du script.
  // En shell, `VAR=…` en début de ligne signale une variable locale — sauf `VAR="${VAR:-défaut}"`,
  // qui est précisément la forme d'un paramètre configurable avec valeur par défaut.
  const assignedLocally = new Set(
    [...src.matchAll(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]{2,})=(.*)$/gm)]
      .filter((m) => !new RegExp(`\\$\\{?${m[1]}\\b`).test(m[2]))
      .map((m) => m[1]),
  );
  const envs = [
    ...new Set([
      ...[...src.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g)].map(
        (m) => m[1],
      ),
      ...[...src.matchAll(/process\.env\[["']([A-Z][A-Z0-9_]{2,})["']\]/g)].map(
        (m) => m[1],
      ),
      ...[...src.matchAll(/\$\{?([A-Z][A-Z0-9_]{2,})[:}\s]/g)].map((m) => m[1]),
    ]),
  ]
    .filter(
      (e) =>
        !ENV_NOISE.test(e) &&
        !assignedLocally.has(e) &&
        !/^(BASH_|FUNCNAME|RANDOM|SECONDS|PIPESTATUS)/.test(e),
    )
    .sort();

  return {
    purpose: docs.output.length && !purpose ? docs.output[0] : purpose,
    usage: docs.usage[0] || usage,
    usages: docs.usage.length ? docs.usage : usage ? [usage] : [],
    flags: docs.options.length ? docs.options.map((o) => o.flag) : flags,
    options: docs.options,
    envs: docs.envs.length ? docs.envs.map((e) => e.name) : envs,
    envDocs: docs.envs,
    output: docs.output[0] || "",
    requires,
    selfDocumented: Boolean(
      docs.usage.length || docs.options.length || docs.envs.length,
    ),
  };
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
 * Termes en `nodefony-…` qui ne désignent PAS un skill : noms de conteneurs, de processus, de
 * paquets ou de composants. Sans cette liste, le contrôle des renvois crierait sur eux.
 */
const NON_SKILL_TERMS = new Set([
  "nodefony-core", // le dépôt et le paquet npm du cœur
  "nodefony-ai-memory", // le dépôt privé de sauvegarde de la mémoire IA
  "nodefony-admin", // service back de Studio
  "nodefony-cards", // bloc de mise en page du portail doc
  "nodefony-dev-server", // titre de processus du superviseur de dev
]);

/**
 * Les skills nommés par un skill : uniquement les occurrences entourées d'accents graves, dans le
 * SKILL.md et ses `references/`. Les scripts en sont exclus — ils citent des conteneurs et des
 * titres de processus qui portent le même préfixe.
 */
function collectSkillRefs(dir) {
  const found = new Set();
  const scan = (p) => {
    for (const m of readFileSync(p, "utf8").match(/`nodefony-[a-z][a-z-]*`/g) ||
      []) {
      found.add(m.slice(1, -1));
    }
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
  return found;
}

/** Les déclencheurs cités dans la description — ce qui décide de l'invocation. */
function triggers(description) {
  const after = description.split(/D[ée]clencheurs?\s*(?:étroits[^:]*)?:/i)[1];
  if (!after) return [];
  return [...after.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

const skills = [];
for (const name of readdirSync(SKILLS_DIR).sort()) {
  const dir = join(SKILLS_DIR, name);
  const file = join(dir, "SKILL.md");
  if (!existsSync(file)) continue;
  const src = readFileSync(file, "utf8");
  const { fields, raw, body, description, version } = parseFrontmatter(src);

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
    .filter(
      (n) =>
        n !== name &&
        !existsSync(join(SKILLS_DIR, n)) &&
        !NON_SKILL_TERMS.has(n),
    )
    .sort();

  const checks = [
    {
      key: "name conforme et égal au dossier",
      ok: /^[a-z0-9-]{1,64}$/.test(fields.name || "") && fields.name === name,
    },
    {
      key: `description de 1 à ${MAX_DESC} caractères`,
      ok: description.length > 0 && description.length <= MAX_DESC,
      detail: `${description.length}`,
    },
    {
      key: "aucun champ hors standard",
      ok: unknown.length === 0,
      detail: unknown.join(", "),
    },
    { key: "dossier de ressources nommé `references/`", ok: !legacyRef },
    {
      key: "aucun renvoi vers un skill inexistant",
      ok: deadSkillRefs.length === 0,
      detail: deadSkillRefs.join(", "),
    },
    {
      key: `corps < ${MAX_BODY_LINES} lignes (recommandation)`,
      ok: bodyLines < MAX_BODY_LINES,
      detail: `${bodyLines}`,
      soft: true,
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
      (prose.match(/`[^`]+`/g) || [])
        .map((k) => k.replace(/`/g, "").trim())
        .filter((k) => k.length > 1 && k.length < 40 && !k.includes(" ")),
    ),
  ].slice(0, 20);
  const approxTokens = Math.round(src.length / 4);

  skills.push({
    name,
    dir,
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
    referencesTotal: countRecursive(refDir),
    scripts: listFiles(scrDir, [".mjs", ".js", ".sh", ".py", ".ts"]).map(
      (f) => ({ f, path: `scripts/${f}`, ...analyzeScript(join(scrDir, f)) }),
    ),
    rootScripts: listFiles(dir, [".sh"]).map((f) => ({
      f,
      path: f,
      ...analyzeScript(join(dir, f)),
    })),
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
  L.push("lang: fr");
  L.push("audience: humain");
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
    for (const r of s.references) L.push(`- \`references/${r}\``);
    if (s.referencesTotal > s.references.length)
      L.push(
        `- _(+ ${s.referencesTotal - s.references.length} fichiers dans des sous-dossiers : specs et normes bundlées hors ligne)_`,
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
  L.push("| Contrôle | État | Mesure |");
  L.push("| --- | :---: | --- |");
  for (const c of s.checks)
    L.push(`| ${c.key} | ${badge(c.ok)} | ${esc(c.detail || "")} |`);
  L.push("");
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
  "migration-audit": ["🗺️", "Inspecter et auditer"],
  "security-review": ["🛡️", "Inspecter et auditer"],
  inspect: ["🔬", "Inspecter et auditer"],
  "check-externals": ["🔗", "Publier et distribuer"],
  release: ["🚢", "Publier et distribuer"],
  rfc: ["📜", "Références et livrables"],
  "ts-docs": ["🔤", "Références et livrables"],
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
const familyOf = (name) => (CATALOG[short(name)] || [, "Autres"])[1];

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
    const bits = [];
    if (nScripts) bits.push(`${nScripts} script${nScripts > 1 ? "s" : ""}`);
    if (s.references.length)
      bits.push(
        `${s.references.length} référence${s.references.length > 1 ? "s" : ""}`,
      );
    bits.push(s.version ? `v${s.version}` : "non versionné");
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
  L.push("lang: fr");
  L.push("audience: humain");
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

// ---------------------------------------------------------------- exécution
if (!CHECK_ONLY) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const s of skills)
    writeFileSync(join(OUT_DIR, `${s.name}.md`), renderSkill(s));
  writeFileSync(join(OUT_DIR, "index.md"), renderIndex(skills));

  // Index MACHINE. Un registre de skills ou un moteur de recherche n'ouvre pas 27 markdown :
  // il lui faut un seul fichier structuré — résumé, mots-clés, déclencheurs, coût d'activation,
  // prérequis, graphe de voisinage, conformité. C'est la même donnée que les fiches, sérialisée.
  const registry = {
    schema: "nodefony.skills-registry/1",
    standard: "agent-skills (AAIF)",
    generatedBy: ".claude/skills/nodefony-skill/scripts/skills-doc.mjs",
    generatedAt: STAMP,
    count: skills.length,
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
  writeFileSync(
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
      if (next !== src) writeFileSync(ANALYSIS, next);
      console.log(`  cards injectées dans ${ANALYSIS}`);
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
process.exit(failed.length ? 1 : 0);
