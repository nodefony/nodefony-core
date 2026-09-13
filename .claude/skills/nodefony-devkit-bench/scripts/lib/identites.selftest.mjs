#!/usr/bin/env node
/**
 * Auto-contrôle des IDENTITÉS des juges — d'où vient le mot de passe admin, et
 * la politique du produit l'accepte-t-elle encore ?
 *
 * Ce contrôle existe parce que le défaut qu'il attrape a vidé HUIT juges sans
 * qu'aucun run ne le dise. Le mot de passe du compte administrateur vivait ici
 * en dur (« admin ») pendant que le gabarit du framework le changeait pour
 * `nodefony-dev-42` — la politique par défaut refusant désormais l'ancien, plus
 * aucune session ne s'ouvrait, et chaque juge de sécurité rendait « identité
 * indisponible » sur TOUTES ses tâches. Chaque moitié du jumeau restait
 * parfaitement cohérente avec elle-même ; c'est l'écart entre les deux que
 * personne ne regardait.
 *
 * Deux familles de règles, et la seconde est la plus importante :
 *
 * 1. **la RÉSOLUTION** — la variable d'abord, le semis de l'application
 *    ensuite, et **aucun repli en dur** : ne pas savoir est une information.
 * 2. **la POLITIQUE** — les valeurs que les bancs POSENT eux-mêmes sont
 *    soumises au même juge que celles d'un utilisateur. Un durcissement de la
 *    politique doit tomber ICI, pas chez qui lance le banc trois semaines plus
 *    tard sur un décor qui ne sème plus rien.
 *
 *   node lib/identites.selftest.mjs
 *   node lib/identites.selftest.mjs --prove   # remet le défaut : ce contrôle doit tomber
 *
 * Sorties : 0 toutes les règles tiennent · 1 au moins une est muette · 2 la
 * politique du produit n'est pas lisible (checkout non bâti — rien n'est prouvé).
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./identites.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const {
  motDePasseAdmin,
  MOT_DE_PASSE_POSE,
  MOT_DE_PASSE_SONDE,
  ouvrirSession,
} = await import(MODULE);

/** Racine du dépôt, trouvée en REMONTANT — ce contrôle vit dans un skill. */
function racineDepot(depuis) {
  let dir = depuis;
  for (let up = 0; up < 10; up += 1) {
    if (existsSync(path.join(dir, "src/nodefony/bin/nodefony"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const REPO = racineDepot(path.dirname(fileURLToPath(import.meta.url)));

const defauts = [];
// Le total se COMPTE, il ne s'écrit pas.
let regles = 0;

/**
 * @param {boolean} ok - la règle tient-elle ?
 * @param {string} regle - ce qui est éprouvé.
 * @param {string} preuve - ce qu'on a lu.
 */
function verifier(ok, regle, preuve) {
  regles += 1;
  if (!ok) defauts.push(`${regle} — ${preuve}`);
  console.log(`  ${ok ? "✅" : "❌"} ${regle}`);
}

// ── Un décor FABRIQUÉ : une application témoin de pacotille ─────────────────
// Le semis y est écrit à la main, avec une valeur qui n'est celle d'aucun
// gabarit : si la lecture allait chercher ailleurs (le gabarit du dépôt, un
// défaut en dur), elle ne rendrait pas CETTE valeur.
const TEMOIN = mkdtempSync(path.join(os.tmpdir(), "identites-selftest-"));
const MDP_DU_SEMIS = "semis-de-pacotille-77";
mkdirSync(path.join(TEMOIN, "nodefony", "security"), { recursive: true });
writeFileSync(
  path.join(TEMOIN, "nodefony", "security", "provisionUsers.ts"),
  `export const DEV_ADMIN_PASSWORD = "${MDP_DU_SEMIS}";\n`,
);
const VIDE = mkdtempSync(path.join(os.tmpdir(), "identites-selftest-vide-"));

const envOriginal = process.env;
process.env = { ...envOriginal };
delete process.env.NF_ADMIN_PASSWORD;

// ── 1. La résolution ────────────────────────────────────────────────────────
{
  const r = motDePasseAdmin(TEMOIN);
  verifier(
    r.password === MDP_DU_SEMIS,
    "le mot de passe est LU dans le semis de l'application témoin",
    JSON.stringify(r),
  );
  verifier(
    r.source === path.join("nodefony", "security", "provisionUsers.ts"),
    "la PROVENANCE est rendue — un décor s'énonce, il ne se devine pas",
    JSON.stringify(r),
  );
}
{
  const r = motDePasseAdmin(VIDE);
  verifier(
    r.password === undefined && typeof r.echec === "string",
    "sans semis lisible, on REFUSE de savoir — aucun repli en dur",
    JSON.stringify(r),
  );
  verifier(
    typeof r.echec === "string" && r.echec.includes("NF_ADMIN_PASSWORD"),
    "le motif nomme le geste qui débloque (poser la variable)",
    String(r.echec),
  );
}
{
  process.env.NF_ADMIN_PASSWORD = "pose-par-l-exploitant";
  const r = motDePasseAdmin(TEMOIN);
  verifier(
    r.password === "pose-par-l-exploitant" && r.source === "NF_ADMIN_PASSWORD",
    "la variable POSÉE gagne sur le semis — même priorité que le gabarit",
    JSON.stringify(r),
  );
  delete process.env.NF_ADMIN_PASSWORD;
}

// ── 2. Ne pas FRAPPER avec un mot de passe qu'on ne connaît pas ─────────────
// Sans cette règle, l'échec ressemble à « ce compte n'existe pas » et envoie
// chercher un défaut de semis — alors que c'est le banc qui ne sait pas quoi
// présenter. Le port employé ici n'existe pas : si la session était RÉELLEMENT
// tentée, le refus parlerait de connexion, jamais de mot de passe.
{
  const r = await ouvrirSession({
    username: "admin",
    password: "",
    echec: "motif fabriqué par le contrôle",
  });
  verifier(
    typeof r.echec === "string" &&
      r.echec.includes("motif fabriqué par le contrôle") &&
      r.injoignable === undefined,
    "une identité dont le mot de passe est INCONNU ne frappe pas le réseau",
    JSON.stringify(r),
  );
}

// ── 3. La politique du PRODUIT accepte-t-elle ce que les bancs posent ? ─────
// C'est la règle qui manquait : le garde-fou du produit couvre les fixtures du
// produit (gabarit, dépôt) ; les valeurs des BANCS n'étaient confrontées à
// rien, et l'une d'elles était déjà invalide sans que personne le sache.
const DIST =
  REPO === null
    ? null
    : path.join(REPO, "src/packages/@nodefony/user/dist/index.js");
if (DIST === null || !existsSync(DIST)) {
  console.log(
    `\n⚠️ politique du produit illisible (${DIST ?? "dépôt introuvable"}) — ` +
      "checkout non bâti : les valeurs des bancs ne sont PAS éprouvées. " +
      "`npm run build` puis relancer.",
  );
  process.env = envOriginal;
  process.exit(2);
}
{
  // 🔴 La CIBLE se dit. Ce contrôle vit dans un skill, et la racine se trouve en
  // remontant jusqu'à un artefact de BUILD (`src/nodefony/bin/nodefony`) : dans
  // un worktree, qui n'en a pas, la remontée continue jusqu'au checkout
  // principal. La politique éprouvée n'est alors pas celle qu'on croit — un
  // verdict juste sur la mauvaise cible reste un verdict faux.
  console.log(`  ℹ politique lue dans ${DIST}`);
  const { PasswordPolicy } = await import(DIST);
  const politique = new PasswordPolicy();
  const aEprouver = [
    [
      "MOT_DE_PASSE_POSE (ce qu'un banc pose pour faire semer)",
      MOT_DE_PASSE_POSE,
    ],
    ["MOT_DE_PASSE_SONDE (ce qu'un auto-contrôle pose)", MOT_DE_PASSE_SONDE],
    [
      "le défaut du SEMIS de l'application témoin",
      motDePasseAdmin(TEMOIN).password,
    ],
  ];
  for (const [quoi, valeur] of aEprouver) {
    const violation = await politique.violation(valeur, {
      identifier: "admin",
    });
    verifier(
      violation === null,
      `la politique du produit ACCEPTE ${quoi}`,
      `refusé : ${violation}`,
    );
  }
  // Le contrôle ne vaut que s'il sait dire NON : une politique qui accepterait
  // tout rendrait les trois règles ci-dessus vertes sans rien garder.
  verifier(
    (await politique.violation("admin", { identifier: "admin" })) !== null,
    "…et elle REFUSE encore « admin » (sinon ce contrôle ne garde rien)",
    "la politique n'a rien refusé",
  );
}

process.env = envOriginal;

for (const d of defauts) console.log(`     ${d}`);
console.log(
  defauts.length === 0
    ? `\n━━ ${regles}/${regles} : l'identité admin est LUE là où elle est posée, ` +
        "et ce que les bancs posent reste accepté par le produit"
    : `\n━━ ${defauts.length} règle(s) en défaut`,
);

// ── Preuve négative : on REMET le défaut, ce contrôle doit tomber ───────────
if (process.argv.includes("--prove")) {
  console.log("\n🔬 débranchement — ces règles doivent tomber");
  const source = readFileSync(
    fileURLToPath(new URL("./identites.mjs", import.meta.url)),
    "utf8",
  );
  const mutations = [
    {
      regle: "le repli en dur revient (l'ancien « admin »)",
      de: "  const pose = process.env.NF_ADMIN_PASSWORD;",
      vers:
        '  return { password: "admin", source: "en dur" };\n' +
        "  const pose = process.env.NF_ADMIN_PASSWORD;",
    },
    {
      regle: "le semis n'est plus LU (valeur du gabarit figée dans le banc)",
      de: "  const fichier = path.join(racine, SEMIS);",
      vers:
        '  return { password: "nodefony-dev-42", source: "recopie" };\n' +
        "  const fichier = path.join(racine, SEMIS);",
    },
    {
      regle: "la variable posée ne gagne plus sur le semis",
      de: '  if (typeof pose === "string" && pose.length > 0) {',
      vers: "  if (false) {",
    },
    {
      regle: "on FRAPPE avec un mot de passe inconnu",
      de: "  if (identite.echec !== undefined) {",
      vers: "  if (false) {",
    },
    {
      regle:
        "la valeur posée par les bancs redevient celle que la politique refuse",
      de: `export const MOT_DE_PASSE_POSE = "${MOT_DE_PASSE_POSE}";`,
      vers: 'export const MOT_DE_PASSE_POSE = "banc-verite-admin";',
    },
  ];
  let muets = 0;
  for (const [i, m] of mutations.entries()) {
    if (!source.includes(m.de)) {
      console.log(
        `  ⚠️ ${m.regle} — ancre introuvable, DÉBRANCHEMENT NON FAIT`,
      );
      muets += 1;
      continue;
    }
    // 🔴 Le module muté vit À CÔTÉ de ses voisins, pas dans `tmp` : il importe
    // `./http-probe.mjs` en relatif, et une copie isolée tomberait sur un
    // module introuvable. Le contrôle sortirait rouge SANS avoir éprouvé la
    // règle mutée — un débranchement qui « mord » pour la mauvaise raison est
    // une preuve fausse, et la plus difficile à voir.
    const copie = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      `identites-prove-${i}.tmp.mjs`,
    );
    writeFileSync(copie, source.replace(m.de, m.vers));
    let r;
    try {
      r = spawnSync(
        process.execPath,
        [fileURLToPath(import.meta.url), "--module", copie],
        { encoding: "utf8" },
      );
    } finally {
      rmSync(copie, { force: true });
    }
    // `1` et pas « non nul » : `2` dit que la politique n'a pas pu être lue,
    // c'est-à-dire qu'on n'a rien éprouvé du tout.
    const mord = r.status === 1;
    if (!mord) muets += 1;
    console.log(
      `  ${mord ? "✅" : "❌"} ${m.regle} → ce contrôle sort ${r.status}` +
        (mord ? "" : "  (IL NE MORD PAS)"),
    );
  }
  console.log(
    muets === 0
      ? `━━ les ${mutations.length} règles sont VUES rouges quand on les débranche`
      : `━━ ${muets} règle(s) NON PROUVÉE(S)`,
  );
  process.exit(defauts.length || muets ? 1 : 0);
}

process.exit(defauts.length ? 1 : 0);
