#!/usr/bin/env node
/**
 * Rapport HTML d'un (ou plusieurs) résultats de banc — pour un HUMAIN qui décide.
 *
 * Pourquoi un rapport et pas la sortie console : une sortie console se lit une
 * fois puis se perd, et deux runs ne s'y comparent pas. Le rapport embarque ses
 * DONNÉES SOURCES (`doc({ data })`) et son DÉCOR (machine, Node, paramètres) :
 * il reste rejouable, comparable, et ré-ingérable par un outil.
 *
 * ⚠️ Il ne se lit pas comme un satisfecit. Chaque banc porte son **contrôle de
 * validité** (volume écrit, requêtes réellement servies) : une mesure invalide
 * est affichée COMME telle, jamais silencieusement moyennée avec les autres.
 *
 * Usage (depuis la RACINE du repo) :
 *   JSON_OUT=tmp/sink.json node .claude/skills/nodefony-load-test/scripts/log-sink-contention.mjs
 *   node .claude/skills/nodefony-load-test/scripts/bench-report.mjs tmp/sink.json
 *   node .../bench-report.mjs tmp/a.json tmp/b.json      # plusieurs bancs, un rapport
 *
 * ENV : OUT (défaut `tmp/bench-report.html`)
 *
 * Le rapport va dans `tmp/` — c'est une PHOTO, pas de la documentation. Le
 * publier dans `docs/` est une décision de l'auteur du framework : voir la
 * section « Publier » du SKILL.md (jamais sans accord explicite).
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  doc,
  section,
  table,
  barChart,
  cards,
  note,
  warn,
  fmt,
} from "../../nodefony-html-report/lib/report.mjs";

const files = process.argv.slice(2);
if (!files.length) {
  console.error(
    "usage: node bench-report.mjs <resultat.json> [autre.json ...]\n" +
      "  produire un JSON : JSON_OUT=tmp/sink.json node .../log-sink-contention.mjs",
  );
  process.exit(1);
}

const OUT = resolve(process.env.OUT ?? "tmp/bench-report.html");
const runs = files.map((f) => JSON.parse(readFileSync(f, "utf8")));

/** Bandeau de décor : sans lui, un chiffre n'est comparable à rien. */
const decor = (r) =>
  cards([
    { k: "Machine", v: `${r.env.cpus} cœurs`, sub: r.env.cpuModel },
    { k: "Mémoire", v: r.env.totalMemGB, unit: "Go", sub: r.env.platform },
    { k: "Node", v: r.env.node, sub: "runtime de la mesure" },
    {
      k: "Protocole",
      v: `${r.params.workers} × ${fmt.int(r.params.lines)}`,
      sub: `médiane de ${r.params.runs} runs (+${r.params.warmup} warmup jeté)`,
    },
  ]);

/** Une section par banc : validité d'abord, chiffres ensuite. */
const sectionFor = (r) => {
  const invalid = r.variants.filter((v) => !v.integrityOk);
  const valid = r.variants.filter((v) => v.integrityOk);
  const best = Math.min(...valid.map((v) => v.medianMs));

  const validity = invalid.length
    ? warn(
        `<strong>${invalid.length} variante(s) invalides</strong> — elles n'ont pas produit le ` +
          `travail attendu (${invalid.map((v) => v.name).join(", ")}). Leurs durées ne mesurent ` +
          `rien et sont exclues des comparaisons : une variante qui ne fait rien est infiniment rapide.`,
      )
    : note(
        `<strong>Contrôle de validité passé</strong> sur les ${r.variants.length} variantes : ` +
          `le volume produit correspond à l'attendu. Sans ce contrôle, un débit ne prouve rien.`,
      );

  const rows = r.variants.map((v) => [
    v.name,
    v.integrityOk ? `${fmt.int(v.medianMs)} ms` : "—",
    v.integrityOk ? `${v.mLinesPerSec}` : "—",
    `${v.variancePct} %`,
    v.drops,
    v.integrityOk
      ? v.medianMs === best
        ? "★ le plus rapide"
        : `×${(v.medianMs / best).toFixed(1)} plus lent`
      : "✖ invalide",
  ]);

  // Échelle LOG : ces bancs s'étalent sur deux ordres de grandeur (une dizaine de
  // ms contre plusieurs secondes). En échelle linéaire, tout ce qui est rapide
  // s'écrase sur zéro et on ne voit plus que le pire cas.
  const chart = barChart(
    valid
      .slice()
      .sort((a, b) => b.medianMs - a.medianMs)
      .map((v) => ({ label: v.name, value: v.medianMs })),
    {
      title: `${r.title} — durée médiane (ms, plus bas = meilleur, échelle log)`,
      unit: "ms",
      logScale: true,
    },
  );

  return section(
    r.title,
    [
      decor(r),
      validity,
      chart,
      table(
        ["variante", "médiane", "M lignes/s", "variance", "drops", "lecture"],
        rows,
        { sortable: true, id: `t-${r.bench}` },
      ),
      note(
        `<strong>Lire la variance.</strong> Un écart inférieur à la variance n'est pas un ` +
          `écart. Les variantes les plus rapides tombent sous la dizaine de millisecondes : ` +
          `à ce niveau, deux mesures voisines sont indiscernables, et les présenter comme un ` +
          `classement serait promouvoir du bruit en conclusion.`,
      ),
    ].join("\n"),
  );
};

const html = doc({
  title:
    runs.length === 1
      ? runs[0].title
      : `Bancs Nodefony — ${runs.length} mesures`,
  subtitle:
    "Mesures reproductibles, avec leur décor et leur contrôle de validité. " +
    "Les données sources sont embarquées en pied de page — ce rapport se rejoue.",
  sections: runs.map(sectionFor),
  footer:
    "Rejouer : <code>JSON_OUT=tmp/&lt;banc&gt;.json node .claude/skills/nodefony-load-test/scripts/&lt;banc&gt;.mjs</code>, " +
    "puis <code>node .claude/skills/nodefony-load-test/scripts/bench-report.mjs tmp/&lt;banc&gt;.json</code>.",
  data: runs,
});

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html);
console.log(`\n  Rapport écrit : ${OUT}`);
console.log(`  Ouvrir        : open ${OUT}\n`);
console.log(
  `  Ce rapport est une PHOTO (tmp/, non commitée). Pour le verser à la doc du\n` +
    `  framework, il faut un accord explicite — voir « Publier » dans le SKILL.md.\n`,
);
