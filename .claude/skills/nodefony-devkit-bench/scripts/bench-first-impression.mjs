#!/usr/bin/env node
/**
 * Banc de PREMIÈRE IMPRESSION — ce qu'un agent conclut du dépôt, sans y entrer.
 *
 * POURQUOI CE BANC EXISTE. Un développeur interroge aujourd'hui un agent avant
 * d'ouvrir un README. Essai réel : un agent grand public a conseillé d'écarter
 * Nodefony au motif qu'on « hériterait du monorepo, de la migration, du Studio,
 * de l'outillage IA ». Une application minimale installe QUATRE paquets. Rien de
 * ce qu'il reprochait n'entre dans une application — il avait jugé le dépôt de
 * développement en croyant juger le produit. Sans instrument, on corrige ce
 * canal à l'aveugle.
 *
 * CE QU'IL MESURE, ET CE QU'IL NE MESURE PAS. Il ne note pas le SENS du verdict :
 * un refus fondé sur un fait vrai — préversion, une seule personne, pas de
 * rétroportage — est un succès. Ce qu'il traque est le motif FAUX. Noter le sens
 * pousserait à taire les réserves du projet, c'est-à-dire à bien scorer en
 * mentant. Le juge et ses motifs vivent dans `lib/premiere-impression.mjs`,
 * éprouvés sans agent par son auto-contrôle — à lancer AVANT de payer un run.
 *
 * LE DÉCOR : la VUE DU WEB, et rien d'autre. L'agent reçoit un dossier isolé
 * contenant la page d'accueil (`README.md`), la carte d'entrée (`AGENTS.md`), le
 * plan du site (`llms.txt`) et les pages que le site PUBLIE — jamais un disque où
 * `src/` est ouvert. C'est exactement ce qu'un `fetch` atteint. Lui donner le
 * dépôt mesurerait autre chose : sa capacité à lire du code.
 *
 * Usage :
 *   node bench-first-impression.mjs                 # un run, décor sain
 *   node bench-first-impression.mjs --prove         # sain PUIS dégradé : le banc mord-il ?
 *   node bench-first-impression.mjs --decor-only    # monte le décor et s'arrête (0 agent, 0 coût)
 *   node bench-first-impression.mjs --answer <f>    # juge une réponse déjà obtenue
 */
import { spawnSync } from "node:child_process";
import {
  cpSync,
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
import { garderDrapeaux } from "./lib/argv.mjs";
import { envDecor } from "./lib/env-decor.mjs";
import {
  juger,
  mordSurLeDecor,
  decorDAvant,
} from "./lib/premiere-impression.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(ICI, "..", "..", "..", "..");

const USAGE = `Banc de première impression — ce qu'un agent conclut du dépôt sans y entrer.

  node bench-first-impression.mjs [options]

  --prove           joue le décor SAIN puis un décor DÉGRADÉ, et exige que le
                    verdict se dégrade. Un banc qui rend le même résultat quoi
                    qu'on lui donne à lire ne mesure rien. DEUX runs d'agent.
  --decor-only      monte le décor, affiche son chemin, n'appelle aucun agent.
  --answer <f>      juge une réponse déjà obtenue (aucun agent lancé).
  --keep            garde le décor après le run.

  Décor :
  NF_DEVKIT_BENCH_AGENT   binaire de l'agent (défaut : claude)
  NF_DEVKIT_BENCH_MODEL   modèle (défaut : haiku — le banc mesure l'ACCUEIL,
                          pas l'intelligence de l'agent : un modèle fort devine
                          ce que l'accueil ne dit pas)

  Codes de sortie : 0 aucun motif faux · 1 au moins un motif faux, ou le banc ne
  mord pas · 2 décor impossible · 64 drapeau inconnu.`;

garderDrapeaux({
  args: process.argv.slice(2),
  connus: ["--prove", "--decor-only", "--answer", "--keep"],
  aValeur: ["--answer"],
  usage: USAGE,
});

const args = process.argv.slice(2);
const flag = (nom) => args.includes(nom);
const valeur = (nom) => {
  const i = args.indexOf(nom);
  return i === -1 ? undefined : args[i + 1];
};

const AGENT = process.env.NF_DEVKIT_BENCH_AGENT ?? "claude";
const MODEL = process.env.NF_DEVKIT_BENCH_MODEL ?? "haiku";

/**
 * Les quatre questions, telles qu'elles sont posées à l'agent.
 *
 * Fermées, et chacune exige sa CITATION : sans elle on ne distingue pas un agent
 * qui a lu d'un agent qui devine — et les deux rendent une réponse plausible.
 */
const QUESTIONS = `Tu cherches un socle pour un projet neuf qui démarre dans quatre mois. Tu n'as
jamais entendu parler de ce framework. Tu ne disposes QUE des fichiers de ce
dossier : c'est exactement ce qu'un lecteur du web atteint (page d'accueil, carte
d'entrée, plan du site, pages publiées). N'accède à RIEN d'autre, et ne lance
aucune commande.

Réponds à ces quatre questions, chacune avec sa citation exacte (fichier + phrase) :

1. Que fait ce framework, et pour qui ? (2 phrases)
2. Combien de dépendances une application minimale installe-t-elle, et lesquelles ?
3. Le corpus te dit-il OÙ LIRE ce qui reste à faire avant la version stable, et ce
   qui peut casser d'une version à l'autre ? Cite l'endroit, ou dis que ce n'est pas là.
4. Recommanderais-tu d'ÉVALUER ce framework pour ce projet — OUI ou NON, et le motif
   principal en une phrase.

Termine par ce bloc, et lui seul en JSON :
{"q1":"…","q2":"…","q3":"…","q4":"OUI|NON — motif"}`;

/**
 * Monte la vue du web dans un dossier isolé.
 *
 * Le plan et les pages viennent de l'artefact RENDU (`dist-site`), jamais des
 * sources : c'est ce que le site publie qui est lu, et le tri du périmètre vit
 * dans le générateur. Sans artefact, le banc REFUSE plutôt que de composer une
 * vue approximative — un décor deviné produirait un verdict sur un site qui
 * n'existe pas.
 *
 * @param {{degrade?: boolean}} opts - `degrade` retire le plan et remet l'état en tête.
 * @returns {string} le chemin du décor.
 */
function monterDecor({ degrade = false } = {}) {
  const site = path.join(REPO, "dist-site");
  const plan = path.join(site, "llms.txt");
  if (!existsSync(plan)) {
    console.error(
      `décor impossible : ${plan} absent.\n` +
        "  npm run build && node scripts/readme-html.mjs dist-site/index.html\n" +
        "  node scripts/build-docs-site.mjs --out dist-site --mount /docs\n" +
        "  npm run site:plan",
    );
    process.exit(2);
  }
  const dir = mkdtempSync(
    path.join(os.tmpdir(), "nodefony-premiere-impression-"),
  );
  cpSync(path.join(REPO, "README.md"), path.join(dir, "README.md"));
  const accueil = readFileSync(path.join(REPO, "AGENTS.md"), "utf8");
  writeFileSync(
    path.join(dir, "AGENTS.md"),
    degrade ? decorDAvant(accueil) : accueil,
  );
  if (!degrade) cpSync(plan, path.join(dir, "llms.txt"));

  // Les pages publiées, à leur chemin d'URL : l'agent les atteint comme un
  // lecteur du web, en suivant le plan. Seul le markdown — le HTML n'est que la
  // même matière, habillée, et le faire lire coûterait des jetons pour rien.
  const docs = path.join(site, "docs");
  if (existsSync(docs)) {
    mkdirSync(path.join(dir, "docs"), { recursive: true });
    cpSync(docs, path.join(dir, "docs"), {
      recursive: true,
      filter: (src) =>
        !src.endsWith(".html") && !src.endsWith("search-index.json"),
    });
  }
  return dir;
}

/**
 * Lance l'agent dans le décor et rend ce qu'il a écrit.
 *
 * @param {string} decor - le dossier de la vue du web.
 * @returns {string} la sortie brute de l'agent.
 */
function interroger(decor) {
  const res = spawnSync(
    AGENT,
    ["-p", "--model", MODEL, "--dangerously-skip-permissions", QUESTIONS],
    {
      cwd: decor,
      encoding: "utf8",
      env: envDecor(process.env),
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  if (res.error) {
    console.error(
      `l'agent « ${AGENT} » n'a pas pu être lancé : ${res.error.message}`,
    );
    process.exit(2);
  }
  return `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
}

/**
 * Imprime un verdict.
 *
 * @param {string} titre - le nom du décor joué.
 * @param {object} v - ce que le juge a rendu.
 */
function rendre(titre, v) {
  console.log(`\n━━ ${titre}`);
  console.log(`   faits trouvés : ${v.exactitude.points}/${v.exactitude.sur}`);
  for (const manque of v.exactitude.manques)
    console.log(`     · non trouvé : ${manque}`);
  console.log(
    `   verdict de l'agent : ${v.verdict.toUpperCase()}  (informatif, pas un critère)`,
  );
  if (v.vrais.length)
    console.log(`   motifs VRAIS invoqués : ${v.vrais.join(", ")}`);
  if (v.faux.length)
    for (const f of v.faux)
      console.log(`   ❌ MOTIF FAUX — ${f.cause} : ${f.dit}`);
  else console.log("   ✅ aucun motif faux");
}

// ── Juger une réponse déjà obtenue : aucun agent, aucun coût ─────────────────
const fichier = valeur("--answer");
if (fichier) {
  const v = juger(readFileSync(path.resolve(fichier), "utf8"));
  rendre(`réponse relue — ${fichier}`, v);
  process.exit(v.juste ? 0 : 1);
}

const decor = monterDecor();
if (flag("--decor-only")) {
  console.log(`décor monté (aucun agent lancé) : ${decor}`);
  process.exit(0);
}

console.log(`agent ${AGENT} · modèle ${MODEL} · décor ${decor}`);
const sain = juger(interroger(decor));
rendre("décor SAIN — l'accueil tel qu'il est publié", sain);

let code = sain.juste ? 0 : 1;

if (flag("--prove")) {
  const abime = monterDecor({ degrade: true });
  console.log(
    `\ncontre-épreuve : état remis en tête, plan du site retiré · ${abime}`,
  );
  const degrade = juger(interroger(abime));
  rendre("décor DÉGRADÉ — la contre-épreuve", degrade);
  const m = mordSurLeDecor(sain, degrade);
  console.log(
    `\n━━ le banc ${m.mord ? "MORD" : "NE MORD PAS"} : ${m.pourquoi}`,
  );
  if (!m.mord) code = 1;
  if (!flag("--keep")) rmSync(abime, { recursive: true, force: true });
}

if (!flag("--keep")) rmSync(decor, { recursive: true, force: true });
else console.log(`\ndécor conservé : ${decor}`);
process.exit(code);
