// Page HTML de l'audit = l'ADR-0015 mis en page (aucun contenu propre : l'ADR fait foi).
// node docs/design/login/audit.mjs  →  docs/design/login/audit.html
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import {
  doc,
  section,
} from "../../../.claude/skills/nodefony-html-report/lib/report.mjs";

const here = import.meta.dirname;
const adrPath = path.join(
  here,
  "../../adr/0015-page-de-connexion-servie-par-le-framework.md",
);
const source = readFileSync(adrPath, "utf8").replace(/^---[\s\S]*?---\n/, "");
const md = new MarkdownIt({ html: false, linkify: true });
const body = md
  .render(source.replace(/^# .*\n/m, "").replace(/^📍.*\n/m, ""))
  .replace('href="../design/login/README.md"', 'href="README.md"');

writeFileSync(
  path.join(here, "audit.html"),
  doc({
    title: "ADR-0015 — Page de connexion",
    subtitle:
      "Servie par le framework, un balisage, un moteur partagé — décisions de la revue d'architecture (#547).",
    sections: [
      section(
        "Décisions",
        `${body}<p><a href="index.html">← Retour à la galerie</a></p>`,
      ),
    ],
    footer:
      "Généré par <code>node docs/design/login/audit.mjs</code> depuis <code>docs/adr/0015-page-de-connexion-servie-par-le-framework.md</code>.",
  }),
);
console.log("ok");
