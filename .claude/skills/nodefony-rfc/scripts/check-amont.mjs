#!/usr/bin/env node
/**
 * Dit si une spec VIVANTE figée sous `references/` a dérivé de son amont.
 *
 * Le problème qu'il ferme : une RFC ne change jamais, mais une spec vivante
 * (MCP, AGENTS.md, Fetch) bouge — et une copie figée se périme EN SILENCE. On
 * continue de la citer, on croit tenir la norme, et l'écart ne se voit nulle
 * part. Ancrer la copie à un SHA rend la dérive CONSTATABLE en une commande.
 *
 * Ce script ne met JAMAIS à jour : il NOMME les fichiers suivis qui ont changé.
 * Une spec se relit avant d'être remplacée — un remplacement automatique ferait
 * entrer du texte que personne n'a lu dans la référence qui fait foi.
 *
 * Décor : chaque dossier de `references/` porte un `AMONT.json`
 * (`repo`, `ref`, `sha`, `fichiers`). Un dossier sans `AMONT.json` est ignoré —
 * c'est le cas d'une spec figée à la main, et son absence est DITE.
 *
 * Codes de sortie : `0` tout à jour · `3` de la dérive à instruire ·
 * `78` impossible de savoir (réseau, quota). Le 3 n'est pas une erreur : une
 * spec qui avance est la normale, c'est de l'ignorer qui coûte.
 *
 * @module
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const REFERENCES = path.join(ICI, "..", "references");

/** Interroge l'API GitHub en JSON, ou rend `null` si elle n'a pas répondu. */
async function api(chemin) {
  const entetes = { Accept: "application/vnd.github+json" };
  // Un jeton n'est pas requis (dépôts publics) mais desserre le quota anonyme,
  // qui suffit rarement à une passe d'intégration continue.
  if (process.env.GITHUB_TOKEN) {
    entetes.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  try {
    const reponse = await fetch(`https://api.github.com/${chemin}`, {
      headers: entetes,
      signal: AbortSignal.timeout(20_000),
    });
    if (!reponse.ok) return null;
    return await reponse.json();
  } catch {
    return null;
  }
}

/** Les dossiers de `references/` qui déclarent un amont. */
function sourcesFigees() {
  if (!existsSync(REFERENCES)) return [];
  const sources = [];
  for (const entree of readdirSync(REFERENCES, { withFileTypes: true })) {
    if (!entree.isDirectory()) continue;
    const manifeste = path.join(REFERENCES, entree.name, "AMONT.json");
    if (!existsSync(manifeste)) {
      sources.push({ nom: entree.name, amont: null });
      continue;
    }
    sources.push({
      nom: entree.name,
      amont: JSON.parse(readFileSync(manifeste, "utf8")),
    });
  }
  return sources;
}

let derive = 0;
let inconnu = 0;
let sansAmont = 0;

for (const { nom, amont } of sourcesFigees()) {
  if (amont === null) {
    sansAmont += 1;
    console.log(`⚠️  ${nom} — aucun AMONT.json : la dérive est INVÉRIFIABLE`);
    continue;
  }

  const tete = await api(`repos/${amont.repo}/commits/${amont.ref}`);
  if (tete === null) {
    inconnu += 1;
    console.log(`🔌 ${nom} — ${amont.repo} injoignable : on ne SAIT pas`);
    continue;
  }

  if (tete.sha === amont.sha) {
    console.log(`✅ ${nom} — à jour (${amont.sha.slice(0, 8)})`);
    continue;
  }

  // La comparaison porte sur les fichiers SUIVIS : un amont qui avance de
  // quarante commits sans toucher à ce qu'on a figé ne demande aucun geste.
  const ecart = await api(
    `repos/${amont.repo}/compare/${amont.sha}...${tete.sha}`,
  );
  if (ecart === null) {
    inconnu += 1;
    console.log(`🔌 ${nom} — comparaison indisponible : on ne SAIT pas`);
    continue;
  }

  const suivis = new Set(amont.fichiers);
  const touches = (ecart.files ?? [])
    .map((f) => f.filename)
    .filter((f) => suivis.has(f));

  if (touches.length === 0) {
    console.log(
      `✅ ${nom} — ${ecart.ahead_by} commit(s) d'avance, aucun fichier suivi touché`,
    );
    continue;
  }

  derive += 1;
  console.log(
    `🔴 ${nom} — ${touches.length} fichier(s) suivi(s) ont changé depuis ${amont.sha.slice(0, 8)} :`,
  );
  for (const f of touches) console.log(`      ${f}`);
  console.log(`      relire : ${ecart.html_url}`);
  console.log(
    `      puis figer : mettre à jour les fichiers ET le sha dans references/${nom}/AMONT.json`,
  );
}

if (sansAmont > 0) {
  console.log(
    `\n${sansAmont} référence(s) sans AMONT.json — leur dérive ne sera jamais vue.`,
  );
}

if (inconnu > 0) {
  console.log("\n⚠️  Verdict PARTIEL : au moins une source n'a pas répondu.");
  process.exit(78);
}
process.exit(derive > 0 ? 3 : 0);
