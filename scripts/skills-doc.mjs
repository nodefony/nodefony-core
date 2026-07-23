#!/usr/bin/env node
/**
 * skills-doc — fiche de documentation par skill, ET gate de conformité.
 *
 * Une fiche écrite à la main diverge du skill qu'elle décrit dès la première édition. Ici, les 26
 * fiches sont DÉRIVÉES du `SKILL.md` lui-même : version, ressources, scripts, déclencheurs et
 * conformité au standard Agent Skills (AAIF) sont lus, jamais recopiés.
 *
 *   node scripts/skills-doc.mjs            # régénère docs/skills/ ; sort 1 si un skill n'est pas conforme
 *   node scripts/skills-doc.mjs --check    # ne réécrit rien, contrôle seulement (utilisable en CI)
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
    return { purpose: "", usage: "", flags: [], envs: [] };
  }
  const head = src.split("\n").slice(0, 40);

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

  return { purpose, usage, flags, envs };
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
  const sections = [...body.matchAll(/^##\s+(.+)$/gm)].map((m) =>
    m[1].replace(/\s*\{#.*\}$/, ""),
  );

  const refDir = join(dir, "references");
  const scrDir = join(dir, "scripts");
  const legacyRef = existsSync(join(dir, "reference"));

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
      key: `corps < ${MAX_BODY_LINES} lignes (recommandation)`,
      ok: bodyLines < MAX_BODY_LINES,
      detail: `${bodyLines}`,
      soft: true,
    },
  ];

  skills.push({
    name,
    dir,
    version,
    description,
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
  L.push("generated: scripts/skills-doc.mjs");
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
    "> Fiche **générée** par `scripts/skills-doc.mjs` à partir du `SKILL.md`. Ne pas l'éditer :",
  );
  L.push("> corriger le skill, puis régénérer.");
  L.push("");
  L.push("| | |");
  L.push("| --- | --- |");
  L.push(
    `| Version | ${s.version ? `\`${s.version}\`` : "— (non versionné)"} |`,
  );
  L.push(`| Corps | ${s.bodyLines} lignes |`);
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
  }

  L.push("## Conformité au standard Agent Skills");
  L.push("");
  L.push("| Contrôle | État | Mesure |");
  L.push("| --- | :---: | --- |");
  for (const c of s.checks)
    L.push(`| ${c.key} | ${badge(c.ok)} | ${esc(c.detail || "")} |`);
  L.push("");
  L.push(
    "Le détail du standard et la méthode de mesure : [Outillage agents](../outillage-agents.md).",
  );
  L.push("");
  return L.join("\n");
}

function renderIndex(list) {
  const L = [];
  L.push("---");
  L.push('title: "Fiches des skills — index généré"');
  L.push("lang: fr");
  L.push("audience: humain");
  L.push("generated: scripts/skills-doc.mjs");
  L.push('source: "docs/skills/index.md"');
  L.push("---");
  L.push("");
  L.push("# Fiches des skills");
  L.push("");
  L.push(
    `> Une fiche par skill du dépôt de développement, **générée** depuis son \`SKILL.md\` par`,
  );
  L.push(
    `> \`scripts/skills-doc.mjs\` : version, contenu, déclencheurs, ressources, scripts et conformité`,
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
    `**${list.length} skills** · **${conformes}/${list.length} conformes** au standard · régénérer : \`node scripts/skills-doc.mjs\``,
  );
  L.push("");
  L.push("| Skill | Version | Corps | Réf. | Scripts | Conforme |");
  L.push("| --- | --- | ---: | ---: | ---: | :---: |");
  for (const s of list)
    L.push(
      `| [\`${s.name}\`](${s.name}.md) | ${s.version || "—"} | ${s.bodyLines} | ${s.references.length} | ${s.scripts.length + s.rootScripts.length} | ${badge(s.hard)} |`,
    );
  L.push("");
  return L.join("\n");
}

// ---------------------------------------------------------------- exécution
if (!CHECK_ONLY) {
  mkdirSync(OUT_DIR, { recursive: true });
  for (const s of skills)
    writeFileSync(join(OUT_DIR, `${s.name}.md`), renderSkill(s));
  writeFileSync(join(OUT_DIR, "index.md"), renderIndex(skills));
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
