/**
 * Lance TOUS les contrôles internes du banc, et rend un verdict unique.
 *
 * 🔴 Pourquoi ce script existe. Les `*.selftest.mjs` du banc étaient déjà
 * écrits, déjà justes, et **aucun n'était lancé par quoi que ce soit** — ni
 * script npm, ni forge, ni étape d'un banc. Le SKILL.md les énumérait un par
 * un, ce qui revient à demander autant de commandes à la main avant chaque
 * conclusion : personne ne le fait. Aucun compte n'est écrit ici : un chiffre
 * en dur périme au premier contrôle ajouté, et se met alors à mentir.
 *
 * Ce que ça a coûté, en une fois : `imputation.selftest.mjs` avait un contrôle
 * d'exhaustivité complet — « toute cause émise par un juge est-elle classée ? »
 * — capable de nommer les quinze causes que trois juges neufs émettaient sans
 * qu'aucune ne soit classable. Il aurait crié dès le premier de ces juges. Il
 * n'a pas été lancé pendant un mois, et le banc a écarté des runs payés en
 * disant « trou d'instrument » de ce que son propre juge nommait précisément.
 *
 * Un contrôle qui existe et que personne n'exécute ne garde rien. C'est la
 * seule raison d'être de ce fichier : rendre le lot ATTEIGNABLE d'une commande.
 *
 * ```bash
 * node .claude/skills/nodefony-devkit-bench/scripts/selftests.mjs
 * node .claude/skills/nodefony-devkit-bench/scripts/selftests.mjs --prove   # + la mutation de chaque contrôle
 * ```
 *
 * Sortie : `0` tout vert · `1` au moins un contrôle rouge · `2` un contrôle a
 * rendu 2 (abstention bruyante — par exemple une cause non classée).
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { garderDrapeaux } from "./lib/argv.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));

/**
 * Ce qui ne peut PAS être lancé sans décor, et le motif — nommé plutôt que
 * filtré en silence : un contrôle sauté sans un mot se lit comme un contrôle
 * vert, et c'est exactement le piège que ce script existe pour fermer.
 */
const HORS_LOT = new Map([
  [
    "reinit-decor.selftest.mjs",
    "exige le chemin d'un run déjà consommé (`<runDir>`)",
  ],
  [
    "jeton-mcp.selftest.mjs",
    "exige une application démarrée et une porte MCP ouverte",
  ],
]);

/**
 * Le lot ATTENDU, nommé fichier par fichier.
 *
 * Le balayage reste l'autorité — un juge neuf est lancé sans qu'on l'inscrive
 * ici, et c'est la qualité qu'on ne veut pas perdre. Cette liste est un TÉMOIN,
 * et elle ferme le trou symétrique : un contrôle SUPPRIMÉ ne disparaît plus en
 * silence, il fait rougir ce script. Elle rend aussi ces fichiers visibles de
 * `scripts-audit.mjs`, qui ne sait pas lire un appel par `readdirSync` et les
 * déclarait morts par paquets de vingt.
 */
const LOT_ATTENDU = new Set([
  "bench-discoverability.selftest.mjs",
  "bench-schema.selftest.mjs",
  "jeton-mcp.selftest.mjs",
  "reinit-decor.selftest.mjs",
  "lib/agents-formats.selftest.mjs",
  "lib/argv.selftest.mjs",
  "lib/env-decor.selftest.mjs",
  "lib/exec-portable.selftest.mjs",
  "lib/gate-csp-nonce.selftest.mjs",
  "lib/gate-csrf-partenaire.selftest.mjs",
  "lib/gate-entity-delete.selftest.mjs",
  "lib/gate-liste-bornee.selftest.mjs",
  "lib/gate-login-throttle.selftest.mjs",
  "lib/gate-m2m-stateless.selftest.mjs",
  "lib/gate-media-range.selftest.mjs",
  "lib/gate-migration.selftest.mjs",
  "lib/gate-module-local.selftest.mjs",
  "lib/gate-prefix-firewall.selftest.mjs",
  "lib/gate-realtime-channel.selftest.mjs",
  "lib/gate-role-hierarchy.selftest.mjs",
  "lib/gate-route-param.selftest.mjs",
  "lib/gate-routes-count.selftest.mjs",
  "lib/gate-secure-route.selftest.mjs",
  "lib/gate-session-csrf.selftest.mjs",
  "lib/gate-upload.selftest.mjs",
  "lib/gate-user-field.selftest.mjs",
  "lib/gate-zone-firewall.selftest.mjs",
  "lib/imputation.selftest.mjs",
  "lib/juges-collecte.selftest.mjs",
  "lib/passes.selftest.mjs",
  "lib/reference.selftest.mjs",
]);

/** Les contrôles, des deux dossiers, dans un ordre stable. */
function lot() {
  const trouves = [];
  for (const dossier of [ICI, path.join(ICI, "lib")]) {
    const prefixe = dossier === ICI ? "" : "lib/";
    for (const nom of readdirSync(dossier).sort()) {
      if (!nom.endsWith(".selftest.mjs")) continue;
      trouves.push({
        nom,
        cle: `${prefixe}${nom}`,
        chemin: path.join(dossier, nom),
      });
    }
  }
  return trouves;
}

/**
 * Ce contrôle sait-il se MUTER ?
 *
 * `--prove` ampute une sonde et exige qu'un cas tombe. Un contrôle qui ne lit
 * pas le drapeau ne mute rien — le lui passer ne fait rien, et surtout : son
 * vert ne dit RIEN de sa couverture. Le récapitulatif l'annonçait pourtant
 * « mutations vérifiées » pour le lot ENTIER, alors que dix contrôles sur trente
 * seulement lisent le drapeau. Un instrument qui s'attribue une garantie qu'il
 * n'a pas est pire que pas d'instrument.
 *
 * @param {string} chemin - le fichier du contrôle.
 * @returns {boolean} vrai s'il traite `--prove`.
 */
function saitSeMuter(chemin) {
  try {
    return readFileSync(chemin, "utf8").includes("--prove");
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  garderDrapeaux({
    args,
    connus: ["--prove", "--sans"],
    aValeur: ["--sans"],
    usage: [
      "Auto-contrôle des juges du banc devkit — le lot entier, d'une commande.",
      "",
      "  node selftests.mjs              lance tout le lot",
      "  node selftests.mjs --prove      + ampute les contrôles qui savent se muter",
      "  node selftests.mjs --sans <a,b> écarte des contrôles, en le DISANT",
      "",
      "Sorties : 0 tout vert · 1 un contrôle rouge ou DISPARU · 2 une abstention",
      "          64 usage",
    ].join("\n"),
    avertissement: "Rien n'a été lancé.",
  });
  const prove = args.includes("--prove");
  // Une absence voulue s'ÉNONCE — elle ne s'oublie pas. `bench-schema` exige
  // PostgreSQL et s'abstient sans lui : la forge qui n'a pas de base doit
  // pouvoir l'écarter NOMMÉMENT, jamais en laissant une abstention passer pour
  // un vert.
  const iSans = args.indexOf("--sans");
  const ecartes = new Set(
    iSans === -1 ? [] : (args[iSans + 1] ?? "").split(",").filter(Boolean),
  );
  const muets = [];
  const rouges = [];
  const abstentions = [];
  const sautes = [];
  let verts = 0;

  const trouves = lot();
  // Un contrôle DISPARU est un rouge : c'est le seul écart des deux qui fasse
  // perdre une garantie. Un contrôle neuf non déclaré ne se signale que.
  const vus = new Set(trouves.map((t) => t.cle));
  const disparus = [...LOT_ATTENDU].filter((c) => !vus.has(c));
  const nonDeclares = [...vus].filter((c) => !LOT_ATTENDU.has(c));
  for (const c of nonDeclares) {
    console.log(`  ➕ ${c} — lancé, mais absent de LOT_ATTENDU (à y inscrire)`);
  }

  for (const { nom, chemin } of trouves) {
    if (HORS_LOT.has(nom)) {
      sautes.push(nom);
      console.log(`  ⏭️  ${nom} — ${HORS_LOT.get(nom)}`);
      continue;
    }
    if (ecartes.has(nom)) {
      sautes.push(nom);
      console.log(
        `  ⏭️  ${nom} — ÉCARTÉ par --sans, à la demande de l'appelant`,
      );
      continue;
    }
    const mutable = saitSeMuter(chemin);
    if (prove && !mutable) muets.push(nom);
    const r = spawnSync(
      process.execPath,
      [chemin, ...(prove && mutable ? ["--prove"] : [])],
      {
        encoding: "utf8",
      },
    );
    const code = r.status;
    if (code === 0) {
      verts += 1;
      console.log(`  ✅ ${nom}`);
      continue;
    }
    const sortie = `${r.stdout ?? ""}${r.stderr ?? ""}`.trimEnd();
    if (code === 2) {
      abstentions.push(nom);
      console.log(`  ⚠️  ${nom} (exit 2)`);
    } else {
      rouges.push(nom);
      console.log(`  ✗ ${nom} (exit ${code})`);
    }
    for (const ligne of sortie.split("\n").slice(-12)) {
      if (ligne.trim()) console.log(`       ${ligne}`);
    }
  }

  for (const c of disparus) {
    console.log(`  ✗ ${c} — DÉCLARÉ mais introuvable : un contrôle a disparu`);
  }

  console.log(
    `\n━━ ${verts} vert(s) · ${abstentions.length} abstention(s) · ` +
      `${rouges.length + disparus.length} rouge(s) · ${sautes.length} hors lot` +
      (prove
        ? ` — ${trouves.length - sautes.length - muets.length} muté(s), ${muets.length} non muté(s)`
        : " (sans --prove : les contrôles ne sont pas mutés)"),
  );
  if (muets.length > 0) {
    console.log(
      `   ↳ ne lisent pas \`--prove\` — leur vert ne dit rien de leur couverture :\n` +
        `     ${muets.join(", ")}`,
    );
  }

  if (rouges.length > 0 || disparus.length > 0) return 1;
  if (abstentions.length > 0) return 2;
  return 0;
}

process.exit(main());
