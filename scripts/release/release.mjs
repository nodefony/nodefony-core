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
 *   npm run release -- --version 10.0.0 --publish            # MANUEL
 *   npm run release -- --deprecate                           # les paquets historiques
 *   npm run release -- --deprecate --publish                 # …et les déprécier
 *   npm run release -- --dist-tags                           # `latest` restés en arrière
 *   npm run release -- --dist-tags --publish                 # …et les recaler
 *
 * `--otp <code>` accompagne `--deprecate --publish` et `--dist-tags --publish` :
 * les seuls gestes que le trusted publishing ne couvre pas. Sans lui, npm
 * réclame le code une fois par paquet.
 *
 * `--from` ne sert QU AUX trois premières : la publication saute le changelog,
 * qui a été écrit, relu et commité avant. Le passer là ne fait rien — et un
 * drapeau qui ne fait rien se recopie sans être compris, sur la seule commande
 * du lot qui ne se rattrape pas.
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
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  alignerReferencesInternes,
  analyserCommits,
  auditerMetadonnees,
  comparerVersions,
  detecterSuspects,
  fusionnerChangelog,
  messageDeDepreciation,
  ordreTopologique,
  paquetsNonEstampilles,
  pairsTropLarges,
  depreciationsAFaire,
  latestsRestesEnArriere,
  lireVueNpm,
  trierPourRecalage,
  phasesDeLaPasse,
  refusDePublicationHorsBranche,
  referencesFigees,
  rendreChangelog,
  validerVersion,
  versionDeLaPageMan,
  EXCLUS_DE_LA_DEPRECIATION,
  MAX_BUFFER_GIT,
  PAQUETS_HISTORIQUES,
} from "./release-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");

// Publiée (`files` de `src/nodefony/package.json`) et posée par npm à
// l'installation : ce n'est pas un artefact de développement.
const CHEMIN_MAN = "src/nodefony/man/nodefony.1";

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

// Le code à deux facteurs, pour les gestes que le trusted publishing ne couvre
// pas (`deprecate`, `dist-tag`). Sans lui, npm le réclame sur le terminal — une
// fois PAR PAQUET, soit trente saisies pour un lot. Un même code TOTP reste
// valable une trentaine de secondes : il passe donc sur tout le lot, à
// condition de ne pas traîner. Absent, le comportement interactif est conservé.
const OTP = arg("otp");
const avecOtp = (args) => (OTP ? [...args, `--otp=${OTP}`] : args);

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
// La branche qui PORTE les publications. Distincte de `--branch`, qui dit d'où
// l'on PRÉPARE : préparer depuis `dev` est normal, publier depuis `dev` ne l'est
// pas. Les confondre laissait `--branch dev` désarmer les deux d'un coup.
const BRANCHE_PUBLICATION = arg("publish-branch", "main");
const DEPOT_ATTENDU = arg("repo", "github.com/nodefony/nodefony-core");
const PUBLIER = drapeau("publish");
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

// Les modes ne se déduisent pas au fil du fichier : la règle est PURE et
// éprouvée (`phasesDeLaPasse`). Une condition de mode écrite inline avait déjà
// rendu `--publish` inerte, en sortant 0.
const PHASES = phasesDeLaPasse({
  ecrire: ECRIRE,
  publier: PUBLIER,
  pack: drapeau("pack"),
});

// `npm` est `npm.cmd` sous Windows, et `execFile` ne résout pas les `.cmd` : la
// règle vit dans le PRODUIT (`needsShell`, publié par le cœur), et ce script
// l'APPELLE plutôt que d'en recopier une variante qui dériverait.
let needsShell;
try {
  ({ needsShell } = await import("nodefony"));
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
    shell: needsShell("npm"),
    ...opts,
  });

/**
 * Les workspaces PUBLIABLES — `private` fait foi, jamais une liste écrite à la
 * main, dont l'oubli serait silencieux : le paquet manquant ne sort pas, et
 * personne ne le remarque avant qu'un utilisateur ne bute sur une dépendance
 * introuvable.
 *
 * Une seule implémentation, deux appelants — la passe de préparation et le mode
 * `--dist-tags`, qui court-circuite tout le reste du fichier et aurait sinon
 * recopié le geste.
 *
 * @returns un descripteur par paquet : `{ nom, location, chemin, pkg }`
 */
const listerPubliables = () => {
  const q = npm(["query", ".workspace", "--json"]);
  if (q.status !== 0) echouer(`npm query a échoué :\n${q.stderr}`);
  const liste = JSON.parse(q.stdout)
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
  if (liste.length === 0) echouer("aucun workspace publiable.");
  return liste;
};

// ═══════════════════════════════════════════════════════════════════════════
// --deprecate — les paquets de l'ère « Bundle », APRÈS la publication
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 C'est un geste SÉPARÉ, et il ne peut pas en être autrement. Le trusted
// publishing ne couvre que `publish` : le jeton qu'il délivre vit quelques
// minutes dans un exécuteur de la forge, auquel personne n'a accès. Aucune
// session npm authentifiée n'existe donc sur le poste après une release, et
// `npm deprecate` réclame la sienne, avec le code à deux facteurs.
//
// Le confondre avec la publication faisait croire que les dépréciations
// partaient avec le lot. Elles ne partaient pas, et rien ne le disait.
//
// Ce mode n'a besoin NI de version, NI de tarballs : il court-circuite donc
// tout le reste du fichier. Sans `--publish`, il ne touche pas au registre.
if (drapeau("deprecate")) {
  etape = "dépréciation";
  const depot = `https://${DEPOT_ATTENDU.replace(/^https?:\/\//, "")}`;
  dire(
    `\n${PUBLIER ? "🔴 DÉPRÉCIATION RÉELLE" : "── RÉPÉTITION — le registre n'est PAS touché"} — ` +
      `${PAQUETS_HISTORIQUES.length} paquets historiques\n`,
  );
  for (const e of EXCLUS_DE_LA_DEPRECIATION) {
    dire(`  ⊘ ${e.nom} — JAMAIS : ${e.motif}`);
  }
  dire("");

  // On CONSTATE avant d'agir. Une liste rejouée à l'aveugle ne peut jamais dire
  // « il n'y a plus rien à faire » — et c'est cette phrase qui rend le mode
  // utile six mois plus tard. Registre illisible : on retombe sur « tout
  // faire », car rejouer une dépréciation est sans effet de bord, quand en
  // sauter une laisse un vestige muet.
  const etatsDep = PAQUETS_HISTORIQUES.map((entree) => {
    const attendu = messageDeDepreciation(entree, depot);
    const r = npm(["view", entree.nom, "deprecated", "--json"]);
    let message = null;
    if (r.status === 0) {
      try {
        message = [JSON.parse(r.stdout || "null")].flat()[0] ?? null;
      } catch {
        message = null;
      }
    }
    return { nom: entree.nom, message, attendu };
  });
  const restantes = new Set(depreciationsAFaire(etatsDep).map((r) => r.nom));
  for (const r of depreciationsAFaire(etatsDep)) {
    alerter(`${r.nom} — ${r.motif}`);
  }
  if (restantes.size === 0) {
    dire(
      `\n✓ dépréciation — les ${PAQUETS_HISTORIQUES.length} paquets portent déjà leur message`,
    );
    process.exit(0);
  }
  dire(`\n  ${restantes.size} sur ${PAQUETS_HISTORIQUES.length} à traiter :\n`);

  const echecs = [];
  for (const entree of PAQUETS_HISTORIQUES) {
    if (!restantes.has(entree.nom)) continue;
    const message = messageDeDepreciation(entree, depot);
    if (!PUBLIER) {
      dire(`  npm deprecate ${entree.nom} "${message}"`);
      continue;
    }
    dire(`  → ${entree.nom}`);
    // `stdio: inherit` : npm demande le code à deux facteurs sur le terminal.
    const r = npm(avecOtp(["deprecate", entree.nom, message]), {
      stdio: "inherit",
    });
    // Un échec n'ARRÊTE PAS le lot, à l'inverse de la publication : une
    // dépréciation est indépendante des autres et RÉVERSIBLE (message vide).
    // S'arrêter au premier raté laisserait quinze paquets muets pour un seul
    // qui résiste — et l'on ne saurait pas lesquels ont abouti.
    if (r.status !== 0) echecs.push(entree.nom);
  }

  if (!PUBLIER) {
    dire("\n  Appliquer : --deprecate --publish (npm demandera le code 2FA)");
  } else if (echecs.length) {
    echouer(
      `dépréciation refusée sur ${echecs.length} paquet(s) : ${echecs.join(", ")}\n` +
        "  Les autres ont abouti. Une dépréciation est réversible (message vide) :\n" +
        "  reprendre ceux-là seuls, il n'y a rien à défaire.",
    );
  } else {
    dire(`\n✓ dépréciation — ${restantes.size} paquets`);
  }
  process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════
// --dist-tags — le `latest` resté en arrière, APRÈS la publication
// ═══════════════════════════════════════════════════════════════════════════
//
// 🔴 Pourquoi ce mode existe SÉPARÉMENT de la passe de publication, qui fait
// déjà ce constat : elle ne le fait qu'À CHAUD, pendant qu'un opérateur regarde
// défiler la sortie. Le geste, lui, ne peut PAS partir de la forge — le trusted
// publishing ne couvre que `publish` —, il attend donc le poste du mainteneur
// et son code à deux facteurs. Entre les deux, l'écart reste en ligne et plus
// rien ne le dit : `npm outdated` l'annonce alors comme quatorze paquets « en
// retard », symptôme dont la cause est invisible. Un constat qui ne se rejoue
// pas est un constat perdu.
//
// Comme `--deprecate`, ce mode n'a besoin NI de version, NI de tarballs : il
// court-circuite tout le reste du fichier. Sans `--publish`, il ne touche pas
// au registre.
if (drapeau("dist-tags")) {
  etape = "dist-tags";
  dire(
    `\n${PUBLIER ? "🔴 RECALAGE RÉEL" : "── RÉPÉTITION — le registre n'est PAS touché"}\n`,
  );

  const etats = [];
  const illisibles = [];
  for (const p of listerPubliables()) {
    // Un seul appel par paquet — les deux champs à la fois. La LECTURE de sa
    // sortie est un raisonnement à elle seule (npm enveloppe dans un tableau) :
    // elle vit dans le cœur, éprouvée, plutôt qu'ici où elle a déjà menti.
    const r = npm(["view", p.nom, "dist-tags", "versions", "--json"]);
    const vue = r.status === 0 ? lireVueNpm(r.stdout) : null;
    if (!vue) {
      illisibles.push(p.nom);
      continue;
    }
    etats.push({
      nom: p.nom,
      latest: vue.latest,
      publiee: p.pkg.version,
      versions: vue.versions,
    });
  }

  const { aRecaler, absentes } = trierPourRecalage(etats, (v) =>
    v.includes("-"),
  );
  const marqueDe = new Map([
    ...aRecaler.map((r) => [r.nom, "← À RECALER"]),
    ...absentes.map((r) => [r.nom, "⊘ version ABSENTE du registre"]),
  ]);
  for (const e of etats) {
    dire(
      `  ${e.nom.padEnd(26)} latest=${(e.latest ?? "—").padEnd(16)}` +
        `dépôt=${e.publiee.padEnd(16)}${marqueDe.get(e.nom) ?? "·"}`,
    );
  }
  for (const nom of illisibles) {
    alerter(`${nom} — registre illisible ou paquet jamais publié`);
  }
  dire(
    "\n  Un `latest` STABLE n'est jamais recalé : le déplacer vers une préversion\n" +
      "  servirait une alpha à tout `npm i` de la terre. C'est ce qui protège `nodefony`.",
  );

  if (!aRecaler.length) {
    dire("\n✓ dist-tags — rien à recaler");
    process.exit(0);
  }

  if (!PUBLIER) {
    dire(
      `\n  ${aRecaler.length} paquet(s) à recaler. Appliquer, depuis le poste\n` +
        "  (npm demandera le code 2FA) : --dist-tags --publish\n" +
        "  Ou, un par un :\n" +
        aRecaler
          .map((r) => `    npm dist-tag add ${r.nom}@${r.vers} latest`)
          .join("\n"),
    );
    process.exit(0);
  }

  const echecs = [];
  for (const r of aRecaler) {
    dire(`  → ${r.nom} : ${r.de} ⇒ ${r.vers}`);
    // `stdio: inherit` : npm demande le code à deux facteurs sur le terminal.
    const res = npm(
      avecOtp(["dist-tag", "add", `${r.nom}@${r.vers}`, "latest"]),
      { stdio: "inherit" },
    );
    // Un échec n'ARRÊTE PAS le lot, à l'inverse de la publication : un dist-tag
    // est indépendant des autres et se repose autant de fois qu'on veut.
    // S'arrêter au premier raté laisserait treize paquets périmés pour un seul
    // qui résiste — et l'on ne saurait pas lesquels ont abouti.
    if (res.status !== 0) echecs.push(r.nom);
  }
  if (echecs.length) {
    echouer(
      `recalage refusé sur ${echecs.length} paquet(s) : ${echecs.join(", ")}\n` +
        "  Les autres ont abouti. Un dist-tag se repose : reprendre ceux-là seuls,\n" +
        "  il n'y a rien à défaire.",
    );
  }
  dire(`\n✓ dist-tags — ${aRecaler.length} paquets recalés`);
  process.exit(0);
}
/**
 * Une commande git, ARGUMENT PAR ARGUMENT — jamais une ligne de shell.
 *
 * `execSync` passe par `/bin/sh` : la borne `--from`, saisie par l'appelant ou
 * dérivée d'une entrée de workflow, y devenait exécutable — `--from "x; …"`
 * lançait ce qui suit avec les droits du publieur, sur la machine qui publie.
 * `execFileSync` lance git DIRECTEMENT : il n'y a plus de shell à qui parler,
 * et chaque argument arrive tel quel (un motif comme `v[0-9]*` n'a donc plus
 * besoin de guillemets, et n'est plus développé par personne).
 *
 * @param {...string} args - arguments passés à git, un par un.
 */
const git = (...args) =>
  execFileSync("git", args, {
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

const sale = git("status", "--porcelain");
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
const branche = git("branch", "--show-current") || "(HEAD détaché)";
if (branche !== BRANCHE_ATTENDUE && ECRIRE) {
  echouer(
    `branche « ${branche} », attendue « ${BRANCHE_ATTENDUE} ».\n` +
      `  Délibéré ? \`--branch ${branche}\`.`,
  );
}

// À la PUBLICATION, la branche courante ne dit rien (HEAD détaché) : c'est
// l'APPARTENANCE du commit publié à la branche de publication qui se constate.
// Le verdict est calculé ici, la règle est ailleurs et pure.
if (PUBLIER) {
  const refExiste = (r) => {
    try {
      git("rev-parse", "--verify", "--quiet", r);
      return true;
    } catch {
      return false;
    }
  };
  const ref = [
    `refs/remotes/origin/${BRANCHE_PUBLICATION}`,
    `refs/heads/${BRANCHE_PUBLICATION}`,
  ].find(refExiste);
  let contenue = false;
  if (ref) {
    try {
      git("merge-base", "--is-ancestor", "HEAD", ref);
      contenue = true;
    } catch {
      contenue = false;
    }
  }
  // Un `main` LOCAL en retard sur le distant est le piège d'après : il naît du
  // geste même qui fait avancer la branche de publication (`push dev:main`
  // avance le DISTANT et laisse le local où il était), et il fait ensuite
  // mentir tout ce qui l'interroge. On le DIT — sans refuser : la garde
  // ci-dessous s'appuie sur la référence distante, qui, elle, est juste.
  if (
    refExiste(`refs/heads/${BRANCHE_PUBLICATION}`) &&
    refExiste(`refs/remotes/origin/${BRANCHE_PUBLICATION}`)
  ) {
    const local = git("rev-parse", `refs/heads/${BRANCHE_PUBLICATION}`).trim();
    const distant = git(
      "rev-parse",
      `refs/remotes/origin/${BRANCHE_PUBLICATION}`,
    ).trim();
    if (local !== distant) {
      alerter(
        `${BRANCHE_PUBLICATION} LOCAL (${local.slice(0, 8)}) diffère du distant (${distant.slice(0, 8)}).\n` +
          `  git fetch origin ${BRANCHE_PUBLICATION}:${BRANCHE_PUBLICATION}` +
          "  (avance en fast-forward, et REFUSE si les deux ont divergé —\n" +
          "   `git branch -f` écraserait sans regarder)",
      );
    }
  }

  const refus = refusDePublicationHorsBranche({
    branche: BRANCHE_PUBLICATION,
    brancheTrouvee: Boolean(ref),
    contenue,
  });
  if (refus) echouer(refus);
  dire(
    `✓ branche de publication — le commit appartient à ${BRANCHE_PUBLICATION}`,
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
const paquets = listerPubliables();
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
        return git("describe", "--tags", "--abbrev=0", "--match", "v[0-9]*");
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
    "log",
    `${dernierTag}..HEAD`,
    "--no-merges",
    `--format=%h${US}%B${RS}`,
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

// ── Un pair interne non borné sert le PASSÉ ─────────────────────────────────
// `*` accepte tout, donc npm prend `latest`. Mesuré sur l'alpha.1 : dans un
// dossier vide, `npm i @nodefony/http@10.0.0-alpha.1` installait
// `nodefony@7.0.2` et quatorze `*-bundle@7.0.2`. Invisible de tout le dépôt —
// une app générée épingle le cœur, ce qui contraint le pair, et l'épreuve
// d'installation vierge ne passe que par là. La préparation ALIGNE
// (étape « estampillage ») ; une passe qui n'écrit pas REFUSE, puisqu'elle
// publierait les manifestes tels qu'ils sont.
const tropLarges = pairsTropLarges(paquets);
if (tropLarges.length) {
  const liste = tropLarges.map((r) => `      ${r}`).join("\n");
  if (PHASES.publier && !PHASES.estampiller) {
    echouer(
      `${tropLarges.length} pair(s) interne(s) sans borne :\n` +
        liste +
        "\n\n  Publier ainsi met en ligne un paquet qui, installé seul, tire la version\n" +
        "  `latest` du cœur — une autre majeure, en silence, chez l'utilisateur.\n" +
        "  C'est la préparation qui borne, et son diff se relit avant le tag :\n" +
        `       npm run release -- --version ${VERSION} --from <ref> --write`,
    );
  }
  alerter(
    `${tropLarges.length} pair(s) interne(s) sans borne :\n` +
      liste +
      `\n    L'estampillage les passera à \`^${VERSION}\`.`,
  );
}

// La page de manuel est PUBLIÉE. Une passe qui n'écrit pas ne peut pas la
// régénérer : elle refuse, plutôt que de mettre en ligne un artefact qui
// annonce une autre version que le paquet qui le porte.
if (PHASES.publier && !PHASES.estampiller) {
  const posee = versionDeLaPageMan(
    readFileSync(path.join(ROOT, CHEMIN_MAN), "utf8"),
  );
  if (posee !== VERSION) {
    echouer(
      `la page de manuel annonce « ${posee ?? "illisible"} », le lot part en ${VERSION}.\n` +
        "  Elle est GÉNÉRÉE et publiée : c'est la préparation qui la régénère.\n" +
        `       npm run release -- --version ${VERSION} --from <ref> --write`,
    );
  }
  dire(`✓ page de manuel — annonce bien ${VERSION}`);
}

const figees = referencesFigees(paquets, VERSION);
if (figees.length) {
  const liste = figees.map((r) => `      ${r}`).join("\n");
  // Une référence interne épinglée sur une AUTRE version publie une dépendance
  // ABSENTE du registre : l'installation casse chez le premier utilisateur, et
  // la version est brûlée. L'épreuve d'installation vierge ne peut pas le voir
  // — elle substitue des tarballs locaux, elle ne résout jamais le registre.
  // Donc : la préparation ALIGNE (étape « estampillage »), et la publication
  // qui n'écrit pas REFUSE, puisqu'elle publierait le manifeste tel qu'il est.
  if (PUBLIER && !ECRIRE) {
    echouer(
      `${figees.length} référence(s) interne(s) figée(s) sur une AUTRE version :\n` +
        liste +
        "\n\n  Publier ainsi mettrait en ligne un paquet dont la dépendance n'existe\n" +
        "  pas sur le registre — `ETARGET` chez qui installe, et la version brûlée.\n" +
        "  C'est la préparation qui aligne, et son diff se relit avant le tag :\n" +
        `       npm run release -- --version ${VERSION} --from <ref> --write`,
    );
  }
  alerter(
    `${figees.length} référence(s) interne(s) figée(s) sur une AUTRE version :\n` +
      liste +
      `\n    Le lockstep les veut alignées` +
      (ECRIRE
        ? " — l'estampillage s'en charge."
        : ` : \`--write\` les passera à ${VERSION}.`),
  );
}

if (PHASES.repetition) {
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

// Ces deux étapes ÉCRIVENT. La publication n'y entre JAMAIS : ce qui part doit
// être exactement ce qui a été commité et relu, jamais un fichier réécrit par
// la passe qui publie.
if (PHASES.estampiller) {
  // ═══════════════════════════════════════════════════════════════════════════
  etape = "estampillage";
  // ═══════════════════════════════════════════════════════════════════════════
  // Le balayage porte sur TOUS les paquets, pas sur les seuls `aChanger` : un
  // paquet peut déjà porter la version et référencer un frère sur une autre.
  const nomsInternes = new Set(paquets.map((p) => p.nom));
  const alignees = [];
  for (const p of paquets) {
    const brut = readFileSync(p.chemin, "utf8");
    let contenu = brut;

    if (p.pkg.version !== VERSION) {
      // Réécriture ciblée du seul champ `version`, sans reformater le fichier : un
      // `JSON.stringify` global réordonnerait les clés et gonflerait le diff jusqu'à
      // le rendre irrelisible — or ce diff est exactement ce que l'auteur relit.
      contenu = contenu.replace(
        /^(\s*"version"\s*:\s*")[^"]+(")/m,
        `$1${VERSION}$2`,
      );
      if (contenu === brut) echouer(`${p.nom} : champ "version" introuvable`);
    }

    const lockstep = alignerReferencesInternes(contenu, nomsInternes, VERSION);
    if (lockstep.introuvables.length) {
      // Un remplacement muet publierait la référence d'origine : le manifeste et
      // son texte ont divergé, et seule une lecture humaine peut trancher.
      echouer(
        `${p.nom} : référence(s) interne(s) introuvable(s) dans le texte du manifeste :\n` +
          lockstep.introuvables.map((r) => `    • ${r}`).join("\n"),
      );
    }
    contenu = lockstep.contenu;
    for (const trace of lockstep.alignees) alignees.push(`${p.nom} → ${trace}`);

    if (contenu !== brut) writeFileSync(p.chemin, contenu);
  }
  dire(`✓ estampillage — ${aChanger.length} package.json à ${VERSION}`);

  // ── Les artefacts GÉNÉRÉS qui embarquent la version ───────────────────────
  // Un `package.json` n'est pas le seul endroit où la version est écrite. La
  // page de manuel est générée, COMMITÉE, et publiée : elle a annoncé
  // « nodefony 10.0.0 » dans le tarball d'une 10.0.0-alpha.1, parce que
  // l'estampillage ne régénérait qu'elle. Le générateur refuse si le `dist` est
  // plus vieux que les sources — et c'est un refus JUSTE : on ne publie pas
  // depuis un dist périmé.
  etape = "artefacts générés (page de manuel)";
  const sortieMan = execFileSync("node", ["scripts/generate-man.mjs"], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const posee = versionDeLaPageMan(
    readFileSync(path.join(ROOT, CHEMIN_MAN), "utf8"),
  );
  if (posee !== VERSION) {
    echouer(
      `la page de manuel annonce « ${posee ?? "?"} » après régénération, pas ${VERSION}.\n` +
        `  Sortie du générateur :\n${sortieMan.trim().replace(/^/gm, "    ")}`,
    );
  }
  dire(`✓ artefacts générés — page de manuel à ${VERSION}`);
  if (alignees.length) {
    dire(
      `✓ lockstep — ${alignees.length} référence(s) interne(s) alignée(s) :\n` +
        alignees.map((r) => `    ${r}`).join("\n"),
    );
  }
}

if (PHASES.changelog) {
  etape = "écriture du changelog";
  const cheminChangelog = path.join(ROOT, "CHANGELOG.md");
  // Lire DIRECTEMENT : `existsSync` puis `readFileSync` teste un état qui peut
  // changer entre les deux appels, et confond « absent » avec « illisible ». Un
  // CHANGELOG.md devenu illisible pour cause de droits doit lever, jamais passer
  // pour vide — sinon la release en écrirait un neuf par-dessus l'ancien.
  // Règle et implémentation de référence : `lireSiPresentSync` de
  // `@nodefony/security` (nodefony/src/token/secretFile.ts) — inatteignable
  // depuis un script du dépôt, qui ne compile pas les paquets.
  const ancienChangelog = (() => {
    try {
      return readFileSync(cheminChangelog, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") return "";
      throw e;
    }
  })();
  const fusion = fusionnerChangelog(ancienChangelog, section, VERSION);
  if (fusion.erreur) echouer(fusion.erreur);
  writeFileSync(cheminChangelog, fusion.contenu);
  dire("✓ changelog écrit — CHANGELOG.md (brouillon à relire)");
}

// ═══════════════════════════════════════════════════════════════════════════
// Un budget de bundle est une promesse faite à l'utilisateur, pas une métrique
// de confort : ce qui grossit ici, il le télécharge. Le contrôle vit AVANT le
// pack — après, le tarball existe et la tentation de « voir plus tard » gagne.
// Un dépassement est un blocker (ADR-0007 D10) ; il ne se relève pas d'un
// chiffre dans un fichier, il se relève par un ADR.
etape = "budgets bundle client (ADR-0007 D10)";
{
  const barrelClient = path.join(
    ROOT,
    "src/nodefony/dist/client/client/index.js",
  );
  if (!existsSync(barrelClient)) {
    if (PHASES.empaqueter) {
      echouer(
        "dist client absent — les budgets portent sur ce que npm publie.\n" +
          "  → npm run build",
      );
    }
    alerter("budgets bundle NON vérifiés — dist client absent (npm run build)");
  } else {
    try {
      execFileSync("node", ["scripts/size-check.mjs"], {
        cwd: ROOT,
        stdio: "inherit",
      });
    } catch {
      echouer(
        "un budget de bundle client est dépassé — voir le tableau ci-dessus.",
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
if (PHASES.empaqueter) {
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
      shell: needsShell("tar"),
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
if (PHASES.publier) {
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
    // `--loglevel=warn` : `npm publish` énumère sinon TOUT le contenu du tarball
    // en `notice` — 800 lignes pour le seul cœur. Multiplié par quinze, la
    // demande du code à deux facteurs se noie dans un mur que personne ne lit,
    // et l'opérateur ne voit plus ce qu'on attend de lui. Rien n'est perdu : ce
    // que contient chaque tarball vient d'être inspecté à l'étape « inspection
    // des tarballs », qui REFUSE de publier sur un contenu suspect. Le prompt
    // du code, lui, n'est pas un journal : il passe par le terminal.
    const r = npm(
      [
        "publish",
        tarballs[nom],
        "--access",
        "public",
        "--loglevel=warn",
        ...tagArgs,
      ],
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

  // ── `latest` resté en arrière ────────────────────────────────────────────
  // npm pose `latest` à la PREMIÈRE publication d'un paquet, quel que soit
  // `--tag` — et ne le déplace plus ensuite. Un paquet né en préversion garde
  // donc `latest` sur sa toute première alpha : `npm i <paquet>`, sans nommer
  // de canal, sert le défaut que cette publication vient de corriger. Constaté
  // sur les treize paquets scopés de la `10.0.0-alpha.2`.
  //
  // On le CONSTATE ici, à chaud, pendant que l'opérateur regarde — plus tard,
  // personne ne va lire des dist-tags.
  etape = "dist-tags";
  const etats = [];
  for (const nom of publies) {
    const r = npm(["view", nom, "dist-tags", "--json"]);
    if (r.status !== 0) continue;
    try {
      etats.push({
        nom,
        latest: JSON.parse(r.stdout ?? "{}").latest ?? null,
        publiee: VERSION,
      });
    } catch {
      /* un paquet illisible ne doit pas faire tomber le bilan */
    }
  }
  const aRecaler = latestsRestesEnArriere(etats, (v) => v.includes("-"));
  if (aRecaler.length) {
    alerter(
      `${aRecaler.length} paquet(s) servent encore une préversion PÉRIMÉE sous « latest » :\n` +
        aRecaler
          .map((r) => `    ${r.nom} : latest=${r.de} (publié ${r.vers})`)
          .join("\n") +
        "\n  `npm i <paquet>` sans canal sert donc l'ancienne. Recaler, depuis le poste\n" +
        "  (le trusted publishing ne couvre que `publish`) :\n" +
        aRecaler
          .map((r) => `    npm dist-tag add ${r.nom}@${r.vers} latest`)
          .join("\n"),
    );
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Ce qui reste à la main — dit explicitement, jamais supposé fait
// ═══════════════════════════════════════════════════════════════════════════
dire(
  "\n── RESTE À FAIRE, DANS CET ORDRE ──\n" +
    "  1. RELIRE le brouillon de CHANGELOG.md et le réécrire pour un lecteur\n" +
    `  2. relire le diff (${aChanger.length} package.json + CHANGELOG.md), puis :\n` +
    `       git commit -am "chore(release): ${VERSION}"\n` +
    "  3. pousser le COMMIT, puis SEULEMENT ENSUITE le tag :\n" +
    `       git push origin ${branche}\n` +
    "     Une poussée de branche réveille toute l'intégration continue, bancs de charge\n" +
    "     compris : la publication attendra un exécuteur derrière elle — mesuré, quinze\n" +
    "     minutes. C'est normal, et il n'y a RIEN à attendre pour autant : sur ce dépôt,\n" +
    "     la forge n'est jamais au repos. Ce qui compte est l'ORDRE, pas le calme.\n" +
    `  4. faire avancer ${BRANCHE_PUBLICATION} — un tag de publication s'y pose, et nulle\n` +
    "     part ailleurs : c'est cette branche que décrivent le site public et les liens\n" +
    "     des README publiés.\n" +
    `       git push origin ${branche}:${BRANCHE_PUBLICATION}\n` +
    `       git fetch origin ${BRANCHE_PUBLICATION}:${BRANCHE_PUBLICATION}\n` +
    `     La seconde ligne n'est pas du rangement : pousser \`${branche}:${BRANCHE_PUBLICATION}\` avance\n` +
    `     la branche DISTANTE et laisse la locale où elle était. Un \`${BRANCHE_PUBLICATION}\` local en\n` +
    "     retard fait ensuite mentir tout ce qui l'interroge.\n" +
    "  5. poser le tag — c'est LUI qui déclenche la publication par la forge :\n" +
    `       git tag v${VERSION} <commit de ${BRANCHE_PUBLICATION}> && git push origin v${VERSION}\n` +
    "  6. BASCULER l'accueil sur ce qui est désormais publié — TROIS endroits, et\n" +
    "     aucun automate ne les surveille :\n" +
    "       README.md  — le bloc « État », puis la section « Démarrage »\n" +
    "       AGENTS.md  — la ligne « Publication npm » de la table d'état\n" +
    "     C'est la première impression du jour de l'annonce, et elle ne se rattrape\n" +
    "     pas. Deux règles, tant que `latest` n'est pas la version stable : la\n" +
    "     commande annoncée NOMME son canal — une forme nue sert `nodefony@7.0.2`,\n" +
    "     une version JavaScript sans rapport avec ce que la page décrit — et le\n" +
    "     `git clone` ne se supprime jamais, il se requalifie « contribuer au\n" +
    "     framework », seule voie pour travailler sur le framework lui-même.\n" +
    (PUBLIER
      ? `  7. déclarer le publieur de confiance sur les ${ordre.length} paquets (npmjs.com) :\n` +
        "     même dépôt, même NOM DE FICHIER de workflow, extension comprise — tous les\n" +
        "     champs sont sensibles à la casse, et npm ne valide RIEN à l'enregistrement :\n" +
        "     une erreur ne se voit qu'à la publication suivante.\n" +
        "  8. Settings → Publishing access → exiger la 2FA et interdire les jetons.\n"
      : ""),
);
