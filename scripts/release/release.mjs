/**
 * release.mjs — PRÉPARE une release Nodefony, et refuse tout ce qui ne se rattrape pas.
 *
 * ── CE QUI REND UNE RELEASE DIFFÉRENTE DE TOUT AUTRE GESTE ──────────────────
 *
 * Elle est IRRÉVERSIBLE. Une version publiée sur npm ne se réécrit jamais :
 * `unpublish` n'est ouvert que 72 heures, et seulement si personne n'en dépend
 * — politique adoptée après l'affaire `left-pad` (2016), où un retrait a cassé
 * l'écosystème. Une version publiée par erreur est BRÛLÉE.
 *
 * Pire en lockstep : quinze paquets se publient en séquence et npm ne connaît
 * pas la transaction. Un échec au huitième laisse sept paquets en ligne qui
 * référencent sept absents — et ces sept versions sont brûlées, donc la reprise
 * se fait en 10.0.1 POUR TOUT LE LOT. D'où la règle de ce fichier : tout ce qui
 * peut être vérifié l'est AVANT le premier `publish`, jamais entre deux.
 *
 * ── LE TAG EST LA CAUSE, PAS LA CONSÉQUENCE ─────────────────────────────────
 *
 * Ce script estampille, écrit un brouillon de changelog et empaquette. Il ne
 * pose PAS le tag : c'est le tag `v10.*` poussé à la main qui déclenche le flux
 * de publication. Inverser les deux enlève à l'auteur le seul point où il relit
 * ce qui va sortir sous son nom.
 *
 *   npm run release -- --version 10.0.0 --from <ref>            # répétition
 *   npm run release -- --version 10.0.0 --from <ref> --write
 *   npm run release -- --version 10.0.0 --from <ref> --write --pack
 *   npm run release -- --version 10.0.0 --from <ref> --publish  # MANUEL
 *
 * Options : --branch <nom> · --repo <hôte/org/dépôt> · --npm-tag <tag>
 *           --offline (n'interroge pas le registre — une collision passerait)
 *
 * ── POURQUOI UN MODE MANUEL, ALORS QUE LA CIBLE EST L'OIDC ──────────────────
 *
 * Le publieur de confiance se déclare dans les réglages d'un paquet QUI EXISTE
 * DÉJÀ. Les treize `@nodefony/*` n'ont jamais été publiés : ils ne peuvent pas
 * naître par ce chemin. Ce mode sert cette première fois, depuis le poste du
 * mainteneur, avec le code à deux facteurs, sans qu'aucun jeton n'existe. Cette
 * absence n'est pas du confort : le vol de jeton de publication est le vecteur
 * d'`eslint-scope` (2018), d'`ua-parser-js` (2021) et du ver `Shai-Hulud`
 * (2025), qui moissonnait les jetons npm sur les exécuteurs d'intégration.
 *
 * ── CE QU'IL NE FAIT PAS, ET POURQUOI ───────────────────────────────────────
 *
 * Il ne DÉCIDE rien : tout le raisonnement — validation de version, lecture des
 * messages de commit, ordre de publication, audit des métadonnées, rendu du
 * changelog, détection de contenu suspect — vit dans `release-core.mjs`,
 * pur et éprouvé par `release-core.test.mjs`. Ce fichier n'est que l'accès
 * au monde : git, npm, le disque. Une release ne se répétant pas, ce qui décide
 * doit pouvoir s'éprouver sans elle.
 *
 * Il n'empaquette pas non plus : `pack-all.mjs` le fait, avec la bascule des
 * `exports.types` et le post-traitement des déclarations.
 */
import { execFileSync, execSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  analyserCommits,
  auditerMetadonnees,
  comparerVersions,
  detecterSuspects,
  fusionnerChangelog,
  ordreTopologique,
  paquetsNonEstampilles,
  referencesFigees,
  rendreChangelog,
  validerVersion,
  MAX_BUFFER_GIT,
} from "./release-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

// ── Étapes NOMMÉES : un échec doit dire lequel des maillons a lâché ─────────
let etape = "démarrage";
const dire = (m) => console.log(m);
const alerter = (m) => console.log(`  ⚠ ${m}`);
const echouer = (msg) => {
  console.error(`\n✗ ÉCHEC à l'étape « ${etape} » :\n  ${msg}\n`);
  process.exit(1);
};

const arg = (nom, def = null) => {
  const i = process.argv.indexOf(`--${nom}`);
  const v = process.argv[i + 1];
  return i >= 0 && v && !v.startsWith("--") ? v : def;
};
const drapeau = (nom) => process.argv.includes(`--${nom}`);

if (drapeau("help") || process.argv.length === 2) {
  dire(
    readFileSync(new URL(import.meta.url))
      .toString()
      .split("*/")[0]
      .replace(/^\/\*\*| \* ?/gm, ""),
  );
  process.exit(0);
}

const VERSION = arg("version");
const DEPUIS = arg("from");
const TAG_NPM = arg("npm-tag");
const BRANCHE_ATTENDUE = arg("branch", "main");
const DEPOT_ATTENDU = arg("repo", "github.com/nodefony/nodefony-core");
const PUBLIER = drapeau("publish");
const PACK = drapeau("pack") || PUBLIER;
// 🔴 PUBLIER N'IMPLIQUE PAS ÉCRIRE, et c'est la charnière de tout ce fichier.
//
// Préparer et publier sont deux gestes, à deux moments, sur deux machines.
// La préparation écrit (versions, changelog) et se relit ; la publication part
// d'un TAG et ne doit RIEN écrire — ce qui part doit être exactement ce qui a
// été commité et relu. Les coupler avait deux conséquences, toutes deux
// mauvaises : la forge aurait publié du code n'existant dans aucun commit, et
// elle serait tombée à l'écriture du changelog, qui refuse d'écraser une
// section déjà présente — un rouge sans aucun rapport avec la publication.
const ECRIRE = drapeau("write");
const HORS_LIGNE = drapeau("offline");

// `npm` est `npm.cmd` sous Windows, et `execFile` ne résout pas les `.cmd` : la
// règle vit dans le PRODUIT (`besoinDeShell`, publié par le cœur), et ce script
// l'APPELLE plutôt que d'en recopier une variante qui dériverait.
let besoinDeShell;
try {
  ({ besoinDeShell } = await import("nodefony"));
} catch {
  echouer(
    "impossible de charger `nodefony` — le cœur n'est pas bâti.\n" +
      "  Ce script en dépend pour lancer npm de façon portable. → npm run build",
  );
}

const npm = (args, opts = {}) =>
  spawnSync("npm", args, {
    cwd: ROOT,
    encoding: "utf8",
    shell: besoinDeShell("npm"),
    ...opts,
  });
const git = (cmd) =>
  execSync(`git ${cmd}`, {
    cwd: ROOT,
    encoding: "utf8",
    // Le journal complet dépasse le défaut de 1 Mio — cf `MAX_BUFFER_GIT`.
    maxBuffer: MAX_BUFFER_GIT,
  }).trim();

// ═══════════════════════════════════════════════════════════════════════════
etape = "gardes préalables";
// ═══════════════════════════════════════════════════════════════════════════
if (!VERSION) {
  echouer(
    "aucune version donnée. `--version 10.0.0`.\n" +
      "  Ce script n'invente pas la version : le lockstep en pose UNE, et c'est une décision.",
  );
}
const { ok, prerelease } = validerVersion(VERSION);
if (!ok) {
  echouer(
    `« ${VERSION} » n'est pas une version semver 2.0.0 valide.\n` +
      "  Rappels de la spec : pas de zéro en tête (01.2.3 ✗), pré-release après `-`,\n" +
      "  métadonnées de build après `+`, identifiants [0-9A-Za-z-] uniquement.",
  );
}

// Le tag `latest` est ce que reçoit quiconque tape `npm i <paquet>`. Publier une
// préversion sans tag explicite le DÉPLACE : tout l'écosystème installe alors
// une bêta, et le redéplacer ensuite ne rattrape pas les installations parties.
if (prerelease && !TAG_NPM) {
  echouer(
    `« ${VERSION} » est une PRÉVERSION (${prerelease}) et aucun tag npm n'est donné.\n` +
      "  Sans `--npm-tag`, npm la publierait sous `latest` : tout `npm i` la recevrait.\n" +
      "  → --npm-tag next   (ou beta, rc…)",
  );
}
if (!prerelease && TAG_NPM && TAG_NPM !== "latest") {
  alerter(
    `version stable sous le tag « ${TAG_NPM} » : elle ne sera PAS installée par défaut.`,
  );
}

const sale = git("status --porcelain");
if (sale && (ECRIRE || PUBLIER)) {
  echouer(
    `l'arbre de travail n'est pas propre (${sale.split("\n").length} fichier(s)).\n` +
      "  Publier depuis un arbre sale produit du code qui n'existe dans AUCUN commit :\n" +
      "  personne — pas même toi — ne pourra plus auditer ce qui a été mis en ligne.\n" +
      sale
        .split("\n")
        .slice(0, 5)
        .map((l) => `    ${l}`)
        .join("\n"),
  );
}

// `--show-current` rend une chaîne VIDE sur un HEAD détaché — ce qu'est un
// checkout de tag dans la forge. La garde ne vaut donc que pour la préparation :
// à la publication, c'est le TAG qui fait foi, pas la branche depuis laquelle on
// se trouve être.
const branche = git("branch --show-current") || "(HEAD détaché)";
if (branche !== BRANCHE_ATTENDUE && ECRIRE) {
  echouer(
    `branche « ${branche} », attendue « ${BRANCHE_ATTENDUE} ».\n` +
      `  Délibéré ? \`--branch ${branche}\`.`,
  );
}

// Trusted publishing : ces planchers ne sont pas du confort. En dessous, le CLI
// ne sait pas échanger l'assertion OIDC contre un jeton et rend `ENEEDAUTH` —
// un message qui n'évoque nulle part une version trop ancienne.
const versionNpm = npm(["--version"]).stdout?.trim() ?? "0.0.0";
if (comparerVersions(versionNpm, "11.5.1") < 0) {
  alerter(
    `npm ${versionNpm} — le trusted publishing exige ≥ 11.5.1 (ENEEDAUTH sinon).`,
  );
}
if (comparerVersions(process.versions.node, "22.14.0") < 0) {
  alerter(
    `node ${process.versions.node} — le trusted publishing exige ≥ 22.14.0.`,
  );
}

// 🔴 LA GARDE QUI A COÛTÉ TROIS SEMAINES DE ROUGE.
//
// `src/nodefony/.ai/symbols.json` est GÉNÉRÉ et ignoré par git : il existe sur
// la machine qui vient de commiter — le hook le régénère — et JAMAIS sur un
// checkout frais. Le paquet `nodefony` le déclare dans `files`, donc `pack-all`
// refuse d'empaqueter sans lui. Le banc de release est resté rouge trois passes
// hebdomadaires sur ce seul motif, sans que personne le lise.
if (!existsSync(path.join(ROOT, "src/nodefony/.ai/symbols.json"))) {
  echouer(
    "src/nodefony/.ai/symbols.json absent — le paquet `nodefony` le déclare dans `files`.\n" +
      "  Il est GÉNÉRÉ et ignoré par git, donc absent de tout checkout frais.\n" +
      "  → npm run generate-symbols",
  );
}
dire(
  `✓ gardes — ${VERSION}${prerelease ? ` (préversion → tag « ${TAG_NPM} »)` : ""}` +
    `, branche ${branche}, npm ${versionNpm}`,
);

// ═══════════════════════════════════════════════════════════════════════════
etape = "inventaire des paquets publiables";
// ═══════════════════════════════════════════════════════════════════════════
// `private` fait foi. Une liste écrite à la main se périme au premier paquet
// ajouté, et son oubli est SILENCIEUX : le paquet manquant ne sort pas, et
// personne ne le remarque avant qu'un utilisateur ne bute sur une dépendance
// introuvable.
const q = npm(["query", ".workspace", "--json"]);
if (q.status !== 0) echouer(`npm query a échoué :\n${q.stderr}`);
const paquets = JSON.parse(q.stdout)
  .filter((w) => !w.private)
  .map((w) => {
    const chemin = path.join(ROOT, w.location, "package.json");
    return {
      nom: w.name,
      location: w.location,
      chemin,
      pkg: JSON.parse(readFileSync(chemin, "utf8")),
    };
  });
if (paquets.length === 0) echouer("aucun workspace publiable.");
dire(`✓ inventaire — ${paquets.length} paquets publiables`);

// ═══════════════════════════════════════════════════════════════════════════
etape = "métadonnées de publication";
// ═══════════════════════════════════════════════════════════════════════════
const { bloquants, avertissements } = auditerMetadonnees(paquets, {
  depotAttendu: DEPOT_ATTENDU,
  existe: (d) => existsSync(path.join(ROOT, d)),
});
for (const a of avertissements) alerter(a);
if (bloquants.length) {
  echouer(
    `${bloquants.length} métadonnée(s) empêcheraient la publication :\n` +
      bloquants.map((b) => `    • ${b}`).join("\n") +
      "\n\n  Ces défauts ne se voient JAMAIS dans le dépôt : ils ne se manifestent qu'au\n" +
      "  `npm publish`, c'est-à-dire le jour J, au milieu d'un lot partiellement publié.\n" +
      "  npm ne valide rien à l'enregistrement du publieur de confiance — l'erreur\n" +
      "  n'apparaît qu'à la tentative de publication.",
  );
}
dire(
  `✓ métadonnées — repository, access et files conformes sur ${paquets.length} paquets`,
);

// ═══════════════════════════════════════════════════════════════════════════
etape = "ordre topologique";
// ═══════════════════════════════════════════════════════════════════════════
const { ordre, cycles } = ordreTopologique(paquets);
for (const c of cycles) alerter(`cycle de dépendances : ${c.join(" → ")}`);
dire(`✓ ordre de publication :\n    ${ordre.join(" → ")}`);

// ═══════════════════════════════════════════════════════════════════════════
etape = "vérification du registre";
// ═══════════════════════════════════════════════════════════════════════════
// La vérification sans session de rattrapage : une version déjà publiée ne peut
// pas être remplacée. Découvrir la collision au huitième paquet d'un lot de
// quinze, c'est brûler les sept précédents.
if (HORS_LIGNE) {
  alerter(
    "--offline : le registre n'est PAS interrogé. Une collision de version passerait.",
  );
} else {
  const deja = [];
  for (const p of paquets) {
    const v = npm(["view", `${p.nom}@${VERSION}`, "version", "--json"]);
    // Un paquet inconnu du registre rend E404 : c'est le cas NORMAL pour les
    // treize neufs. Seule une sortie 0 non vide signifie « version occupée ».
    if (v.status === 0 && v.stdout.trim()) deja.push(`${p.nom}@${VERSION}`);
  }
  if (deja.length) {
    echouer(
      `${deja.length} version(s) DÉJÀ publiée(s) sur le registre :\n` +
        deja.map((d) => `    • ${d}`).join("\n") +
        "\n\n  Une version publiée ne se réécrit pas. Passer à la version suivante.",
    );
  }
  dire(`✓ registre — ${VERSION} libre sur les ${paquets.length} paquets`);
}

// ═══════════════════════════════════════════════════════════════════════════
etape = "cohérence du lot avec la version demandée";
// ═══════════════════════════════════════════════════════════════════════════
// Ne vaut QUE pour une publication qui n'écrit pas — le cas de la forge, partie
// d'un tag. La préparation, elle, a précisément pour rôle d'aligner ce que cette
// garde exige.
if (PUBLIER && !ECRIRE) {
  const horsVersion = paquetsNonEstampilles(paquets, VERSION);
  if (horsVersion.length) {
    echouer(
      `${horsVersion.length} paquet(s) ne portent pas ${VERSION} :\n` +
        horsVersion.map((h) => `    • ${h}`).join("\n") +
        "\n\n  La publication ne CORRIGE pas : elle publierait alors du code qui n'existe\n" +
        "  dans aucun commit, sous un tag qui promet autre chose. C'est le commit de\n" +
        "  release qui estampille, et il se relit AVANT que le tag ne soit posé :\n" +
        `       npm run release -- --version ${VERSION} --from <ref> --write\n` +
        `       git commit -am "chore(release): ${VERSION}" && git tag v${VERSION}`,
    );
  }
  dire(`✓ cohérence — les ${paquets.length} paquets portent déjà ${VERSION}`);
}

// ═══════════════════════════════════════════════════════════════════════════
etape = "changelog";
// ═══════════════════════════════════════════════════════════════════════════
// Sauté en publication : le changelog a été écrit, relu et commité AVANT le tag.
// Le rejouer ici n'aurait rien à dire de juste — `git describe` rendrait le tag
// COURANT, donc zéro commit, et l'avertissement « majeure sans rupture »
// partirait à tort sur un intervalle vide.
let ruptures = [];
let section = "";
if (!(PUBLIER && !ECRIRE)) {
  const dernierTag =
    DEPUIS ??
    (() => {
      try {
        return git("describe --tags --abbrev=0 --match 'v[0-9]*'");
      } catch {
        return null;
      }
    })();

  if (!dernierTag) {
    echouer(
      "aucun tag `v*` dans ce dépôt, et aucune borne donnée.\n" +
        "  Sans borne, le changelog remonterait à la racine de l'historique : un mur que\n" +
        "  personne ne relit — donc une release que personne n'a relue.\n" +
        "  → `--from <ref>` (un commit, `HEAD~200`, le premier commit de la 10…).",
    );
  }

  // Le message ENTIER (`%B`), pas le sujet : Conventional Commits admet la
  // rupture signalée en PIED, qu'un parseur de sujets rate en silence.
  //
  // Et l'EMPREINTE avec lui : Common Changelog fait de la référence de commit
  // une obligation (« changes must reference relevant commits »). Une entrée
  // sans référence est invérifiable — celui qui remonte une régression ne peut
  // plus atteindre le code. Deux séparateurs non imprimables (US entre les
  // champs, RS entre les enregistrements) : ils ne peuvent pas apparaître dans
  // un message, là où n'importe quel caractère lisible finirait par le faire.
  const RS = "\x1e";
  const US = "\x1f";
  const commits = git(
    `log ${dernierTag}..HEAD --no-merges --format=%h${US}%B${RS}`,
  )
    .split(RS)
    .map((bloc) => {
      const [sha, ...reste] = bloc.split(US);
      return { sha: sha.trim(), message: reste.join(US).trim() };
    })
    .filter((c) => c.message);

  const analyse = analyserCommits(commits);
  ruptures = analyse.ruptures;
  // `ruptures` ne se passe plus au rendu : chaque entrée porte son propre
  // marqueur, ce qui permet de la remonter EN TÊTE DE SA CATÉGORIE comme la
  // spec l'exige — une liste séparée ne pouvait pas le faire.
  section = rendreChangelog({
    version: VERSION,
    date: new Date().toISOString().slice(0, 10),
    groupes: analyse.groupes,
  });

  dire(
    `✓ changelog — ${commits.length} commits depuis ${dernierTag}` +
      (ruptures.length
        ? `, dont ${ruptures.length} RUPTURE(S)`
        : ", aucune rupture signalée") +
      (analyse.ecartes
        ? ` · ${analyse.ecartes} sans effet utilisateur (docs, ci, chore… écartés)`
        : "") +
      (analyse.horsConvention
        ? ` · ${analyse.horsConvention} HORS CONVENTION (ignorés — messages à corriger)`
        : ""),
  );
  if (!ruptures.length && /^\d+\.0\.0$/.test(VERSION)) {
    alerter(
      "version MAJEURE sans une seule rupture signalée — vérifier que les commits\n" +
        "    portaient `!` ou un pied `BREAKING CHANGE:`. Une rupture non annoncée casse\n" +
        "    la production de l'utilisateur sans un mot.",
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RÉPÉTITION — le mode par DÉFAUT
// ═══════════════════════════════════════════════════════════════════════════
const aChanger = paquets.filter((p) => p.pkg.version !== VERSION);
const figees = referencesFigees(paquets, VERSION);
if (figees.length) {
  alerter(
    `${figees.length} référence(s) interne(s) figée(s) sur une AUTRE version :\n` +
      figees.map((r) => `      ${r}`).join("\n") +
      "\n    Le lockstep les veut alignées. Ce script ne les touche pas de lui-même :\n" +
      "    la convention du dépôt est `*`, et la changer est une décision.",
  );
}

if (!ECRIRE) {
  dire(
    "\n── RÉPÉTITION — aucun fichier touché ──\n" +
      `  ${aChanger.length} paquet(s) passeraient à ${VERSION}` +
      (aChanger.length
        ? " :\n" +
          aChanger
            .map((p) => `    ${p.nom} ${p.pkg.version} → ${VERSION}`)
            .join("\n")
        : " (tous y sont déjà)") +
      "\n\n  CHANGELOG.md recevrait :\n" +
      section
        .split("\n")
        .slice(0, 18)
        .map((l) => `    ${l}`)
        .join("\n") +
      (section.split("\n").length > 18 ? "\n    …" : "") +
      "\n\n  Appliquer : --write · empaqueter : --pack · publier : --publish",
  );
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
etape = "estampillage";
// ═══════════════════════════════════════════════════════════════════════════
for (const p of aChanger) {
  const brut = readFileSync(p.chemin, "utf8");
  // Réécriture ciblée du seul champ `version`, sans reformater le fichier : un
  // `JSON.stringify` global réordonnerait les clés et gonflerait le diff jusqu'à
  // le rendre irrelisible — or ce diff est exactement ce que l'auteur relit.
  const remplace = brut.replace(
    /^(\s*"version"\s*:\s*")[^"]+(")/m,
    `$1${VERSION}$2`,
  );
  if (remplace === brut) echouer(`${p.nom} : champ "version" introuvable`);
  writeFileSync(p.chemin, remplace);
}
dire(`✓ estampillage — ${aChanger.length} package.json à ${VERSION}`);

etape = "écriture du changelog";
const cheminChangelog = path.join(ROOT, "CHANGELOG.md");
const fusion = fusionnerChangelog(
  existsSync(cheminChangelog) ? readFileSync(cheminChangelog, "utf8") : "",
  section,
  VERSION,
);
if (fusion.erreur) echouer(fusion.erreur);
writeFileSync(cheminChangelog, fusion.contenu);
dire("✓ changelog écrit — CHANGELOG.md (brouillon à relire)");

// ═══════════════════════════════════════════════════════════════════════════
if (PACK) {
  etape = "pack — tarballs";
  try {
    execFileSync("node", ["scripts/release/pack-all.mjs"], {
      cwd: ROOT,
      stdio: "inherit",
    });
  } catch {
    echouer(
      "pack-all.mjs a échoué — voir sa sortie ci-dessus.\n" +
        "  Causes fréquentes : `dist/` absent (npm run build) ou graphe symbolique manquant.",
    );
  }

  // ── Ce que le tarball CONTIENT réellement ────────────────────────────────
  // `files` est une allowlist, donc la fuite est improbable — mais « improbable »
  // n'est pas « vérifié », et un secret publié est compromis à la seconde où il
  // est en ligne, bien avant la fenêtre de retrait de 72 heures.
  etape = "inspection des tarballs";
  const manifeste = path.join(ROOT, "release/tarballs/manifest.json");
  if (!existsSync(manifeste)) echouer("manifest.json absent après le pack.");
  const tarballs = JSON.parse(readFileSync(manifeste, "utf8"));
  const cwdTar = path.join(ROOT, "release/tarballs");

  const alertesContenu = [];
  let inspectes = 0;
  for (const [nom, tgz] of Object.entries(tarballs)) {
    const t = spawnSync("tar", ["-tzf", tgz], {
      cwd: cwdTar,
      encoding: "utf8",
      shell: besoinDeShell("tar"),
    });
    if (t.status !== 0) {
      // Une inspection qui n'a pas eu lieu ne doit JAMAIS se lire comme une
      // inspection concluante.
      alerter(
        `${nom} : contenu illisible — inspection SAUTÉE, donc non concluante.`,
      );
      continue;
    }
    inspectes++;
    const fichiers = t.stdout.split("\n").filter(Boolean);
    if (fichiers.length === 0) alertesContenu.push(`${nom} : tarball VIDE`);
    for (const f of detecterSuspects(fichiers))
      alertesContenu.push(`${nom} : ${f}`);
  }
  if (alertesContenu.length) {
    echouer(
      "contenu de tarball suspect — un secret publié est public pour toujours :\n" +
        alertesContenu.map((a) => `    • ${a}`).join("\n"),
    );
  }
  dire(
    `✓ pack — ${Object.keys(tarballs).length} tarballs, ${inspectes} inspectés, rien de suspect`,
  );
}

// ═══════════════════════════════════════════════════════════════════════════
if (PUBLIER) {
  const tarballs = JSON.parse(
    readFileSync(path.join(ROOT, "release/tarballs/manifest.json"), "utf8"),
  );
  const cwd = path.join(ROOT, "release/tarballs");
  const tagArgs = TAG_NPM ? ["--tag", TAG_NPM] : [];

  // La répétition porte sur les QUATORZE avant qu'un seul ne parte. C'est la
  // seule parade au lot partiel : npm ne connaît pas la transaction.
  etape = "répétition de publication (--dry-run sur le lot entier)";
  for (const nom of ordre) {
    if (!tarballs[nom])
      echouer(`${nom} : aucun tarball dans le manifeste — pack incomplet.`);
    const d = npm(
      ["publish", tarballs[nom], "--access", "public", "--dry-run", ...tagArgs],
      { cwd },
    );
    if (d.status !== 0) {
      echouer(
        `${nom} : la RÉPÉTITION échoue — rien n'a été publié, et c'est le but.\n` +
          (d.stderr || d.stdout || "")
            .split("\n")
            .slice(0, 12)
            .map((l) => `    ${l}`)
            .join("\n"),
      );
    }
  }
  dire(`✓ répétition — les ${ordre.length} paquets passent le --dry-run`);

  etape = "publication";
  dire(
    `\n🔴 PUBLICATION RÉELLE de ${ordre.length} paquets en ${VERSION}` +
      (TAG_NPM ? ` sous le tag « ${TAG_NPM} »` : " sous « latest »") +
      ".\n   npm demandera le code à deux facteurs. Une version publiée ne se retire\n" +
      "   plus passé 72 heures — et elle est brûlée à jamais.\n",
  );

  const publies = [];
  for (const nom of ordre) {
    dire(`  → npm publish ${tarballs[nom]}`);
    const r = npm(
      ["publish", tarballs[nom], "--access", "public", ...tagArgs],
      {
        cwd,
        stdio: "inherit",
      },
    );
    if (r.status !== 0) {
      // On s'ARRÊTE net : continuer publierait des paquets qui référencent des
      // frères absents. Et l'on DIT l'état exact — la reprise en dépend.
      echouer(
        `${nom} : publication refusée.\n` +
          `  DÉJÀ EN LIGNE et BRÛLÉS en ${VERSION} : ${publies.join(", ") || "aucun"}\n` +
          `  Reste : ${ordre.slice(ordre.indexOf(nom)).join(", ")}\n` +
          "  Traiter la cause, puis reprendre à ce paquet. Si la cause exige de modifier\n" +
          "  les paquets déjà publiés, il faut passer à la version suivante POUR TOUT LE\n" +
          "  LOT — le lockstep ne tolère pas un lot dépareillé.",
      );
    }
    publies.push(nom);
  }
  dire(`✓ publication — ${publies.length} paquets en ${VERSION}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Ce qui reste à la main — dit explicitement, jamais supposé fait
// ═══════════════════════════════════════════════════════════════════════════
dire(
  "\n── RESTE À FAIRE, DANS CET ORDRE ──\n" +
    "  1. RELIRE le brouillon de CHANGELOG.md et le réécrire pour un lecteur\n" +
    `  2. relire le diff (${aChanger.length} package.json + CHANGELOG.md), puis :\n` +
    `       git commit -am "chore(release): ${VERSION}"\n` +
    "  3. poser le tag — c'est LUI qui déclenche la publication par la forge :\n" +
    `       git tag v${VERSION} && git push origin ${branche} --tags\n` +
    (PUBLIER
      ? `  4. déclarer le publieur de confiance sur les ${ordre.length} paquets (npmjs.com) :\n` +
        "     même dépôt, même NOM DE FICHIER de workflow, extension comprise — tous les\n" +
        "     champs sont sensibles à la casse, et npm ne valide RIEN à l'enregistrement :\n" +
        "     une erreur ne se voit qu'à la publication suivante.\n" +
        "  5. Settings → Publishing access → exiger la 2FA et interdire les jetons.\n"
      : ""),
);
