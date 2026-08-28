#!/usr/bin/env node
/**
 * Génère les migrations du framework pour les TROIS dialectes, sous un même nom.
 *
 * Pourquoi un script et pas trois appels à `drizzle-kit` : les trois journaux
 * doivent porter la MÊME liste de tags, dans le même ordre. Un dialecte régénéré
 * seul désaligne l'historique — et comme un tag publié sur npm est immuable à vie
 * (le renuméroter casse la détection chez tout consommateur qui l'a déjà
 * appliqué), le désalignement ne se rattrape pas. Le contrôle d'alignement tourne
 * donc AVANT (refus de partir d'un état incohérent) et APRÈS (refus d'en laisser
 * un derrière soi).
 *
 * Usage : `npm run generate:migrations -- --name <nom_en_snake_case>`
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SqlDialect } from "../nodefony/interfaces/IDrizzleConfig";
import type { IAuditRule } from "./drizzleKit";
import {
  DIALECTS,
  MODULE_ROOT,
  assertJournalsAligned,
  auditMigrationSql,
  readTags,
  runGenerate,
  stampFormatMarker,
} from "./drizzleKit";

/**
 * Lit `--name` sur la ligne de commande.
 *
 * @param argv - arguments passés au script.
 * @returns le nom validé.
 * @throws Error si le nom manque ou n'est pas un identifiant portable.
 */
function parseName(argv: string[]): string {
  const inline = argv.find((a) => a.startsWith("--name="));
  const flagAt = argv.indexOf("--name");
  const name = inline
    ? inline.slice("--name=".length)
    : flagAt === -1
      ? undefined
      : argv[flagAt + 1];
  if (!name || name.startsWith("--")) {
    throw new Error(
      "Nom manquant : `npm run generate:migrations -- --name <nom>`. " +
        "Le nom entre dans le tag, qui est immuable une fois publié.",
    );
  }
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(
      `Nom invalide "${name}" : minuscules, chiffres et « _ » seulement — ` +
        `il devient un nom de fichier sur trois systèmes.`,
    );
  }
  return name;
}

/** Point d'entrée. */
function main(argv: string[]): void {
  const name = parseName(argv);
  const before = assertJournalsAligned("avant génération");

  for (const dialect of DIALECTS) {
    const output = runGenerate({
      configRel: path.join("drizzle-kit", `${dialect}.config.ts`),
      name,
      label: dialect,
    });
    process.stdout.write(output);
    // Preuve sur l'ARTEFACT, pas sur un message : le journal du dialecte doit
    // avoir gagné le tag demandé. Sans ce contrôle, une génération qui n'écrit
    // rien passerait pour un succès et les journaux divergeraient au dialecte
    // suivant, sans que rien ne le dise ici.
    const tags = readTags(dialect);
    if (!tags.some((tag) => tag.endsWith(`_${name}`))) {
      throw new Error(
        `Le journal de ${dialect} ne porte aucun tag « …_${name} » après ` +
          `génération : [${tags.join(", ")}]. Rien n'a été écrit.`,
      );
    }
  }

  const after = assertJournalsAligned("après génération");
  let stamped = 0;
  for (const dialect of DIALECTS) {
    stamped += stampFormatMarker(path.join(MODULE_ROOT, "migrations", dialect));
  }

  // Ce que la génération vient d'écrire est RELU : un générateur de diff ne
  // distingue pas une intention d'une différence, et ce qui détruit des données
  // ne doit jamais partir sans que quelqu'un l'ait vu et voulu.
  const added = after.slice(before.length);
  const findings: Array<{
    level: "destructive" | "blocking";
    dialect: SqlDialect;
    tag: string;
    rule: IAuditRule;
  }> = [];
  for (const dialect of DIALECTS) {
    for (const tag of added) {
      const file = path.join(MODULE_ROOT, "migrations", dialect, `${tag}.sql`);
      if (!fs.existsSync(file)) {
        continue;
      }
      const audit = auditMigrationSql(fs.readFileSync(file, "utf8"), dialect);
      for (const rule of audit.destructive) {
        findings.push({ level: "destructive", dialect, tag, rule });
      }
      for (const rule of audit.blocking) {
        findings.push({ level: "blocking", dialect, tag, rule });
      }
    }
  }
  const render = (level: "destructive" | "blocking"): string =>
    findings
      .filter((f) => f.level === level)
      .map(
        (f) =>
          `  \u2022 ${f.dialect}/${f.tag}.sql \u2014 ${f.rule.id} : ${f.rule.what}\n` +
          `    \u2192 ${f.rule.todo}`,
      )
      .join("\n");

  const blocking = render("blocking");
  if (blocking) {
    process.stdout.write(
      `\n\u26a0\ufe0f  Op\u00e9rations VERROUILLANTES en production (rien n'est d\u00e9truit,\n` +
        `   mais l'application peut cesser de r\u00e9pondre pendant l'application) :\n${blocking}\n`,
    );
  }
  const destructive = render("destructive");
  if (destructive && !argv.includes("--allow-destructive")) {
    // Les fichiers sont conservés : les effacer priverait de la seule chose à
    // relire pour décider. C'est la mise au journal qui est refusée.
    throw new Error(
      `Cette g\u00e9n\u00e9ration D\u00c9TRUIT des donn\u00e9es :\n${destructive}\n\n` +
        `Les fichiers ont \u00e9t\u00e9 \u00e9crits \u2014 les RELIRE avant toute d\u00e9cision :\n` +
        added.map((tag) => `  migrations/<dialecte>/${tag}.sql`).join("\n") +
        `\n\nS'il s'agit d'un renommage mal interpr\u00e9t\u00e9 : annuler ces fichiers\n` +
        `avec votre outil de gestion de versions, puis regénérer dans un\n` +
        `terminal interactif et r\u00e9pondre \u00ab renamed \u00bb.\n` +
        `Si la perte est VOULUE et la base sauvegard\u00e9e, relancer avec :\n` +
        `  npm run generate:migrations -- --name ${name} --allow-destructive`,
    );
  }
  process.stdout.write(
    `\n✅ ${DIALECTS.length} dialectes alignés — ${after.length} migration(s) ` +
      `au journal (${after.length - before.length} ajoutée(s)), ${stamped} ` +
      `fichier(s) marqués « format=1 ».\n`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`\n❌ ${(error && error.message) || error}\n`);
    process.exitCode = 1;
  }
}
