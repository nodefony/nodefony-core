#!/usr/bin/env node
/**
 * **Refuse de publier quand l'accueil du dépôt n'annonce pas ce que npm sert.**
 *
 * L'accueil affirme un état de publication — une version, un canal, une
 * commande à copier. Cet état change à CHAQUE publication, et rien ne le
 * rebascule : c'est la première impression du jour de l'annonce, celle qui ne se
 * rattrape pas.
 *
 * ## Pourquoi ce contrôle existe
 *
 * L'étape de bascule était écrite — `release.mjs`, « RESTE À FAIRE », étape 6,
 * nommant les trois endroits. Elle a été AFFICHÉE à la publication de la
 * `10.0.0-alpha.5`, puis oubliée : le `README.md` et l'`AGENTS.md` annonçaient
 * encore la `10.0.0-alpha.4` pendant que le registre servait l'alpha.5, et les
 * quinze `package.json` du dépôt portaient déjà l'alpha.5. L'accueil était la
 * SEULE surface en retard, et aucune n'échouait.
 *
 * Un « RESTE À FAIRE » imprimé en fin de publication ne mord pas. Ce fichier
 * remplace le rappel par un refus : au moment de publier le cran suivant, la
 * dette du cran précédent bloque.
 *
 * ## Les cinq familles d'écart, et pourquoi chacune
 *
 * - `VERSION-PERIMEE` — l'accueil nomme une version plus ANCIENNE que celle du
 *   canal. C'est la dette de report, le cas constaté.
 * - `VERSION-FANTOME` — l'accueil nomme une version plus RÉCENTE que celle du
 *   canal : on annonce ce que personne ne peut installer. Pire que la première,
 *   parce que la commande copiée depuis la page échoue.
 * - `COMMANDE-SANS-CANAL` — une commande d'un bloc de code omet `@<canal>` alors
 *   que `latest` n'est pas encore la 10 : elle servirait la `7.0.2`, une version
 *   JavaScript sans rapport avec ce que la page décrit.
 * - `RIEN-PUBLIE` — la page affirme encore que rien n'est publié.
 * - `SURFACE-MUETTE` — une surface déclarée ne cite AUCUNE version. Sans cette
 *   famille, retirer la phrase rendrait le contrôle vert : le faux vert le plus
 *   facile à produire, et le seul qu'on ne verrait jamais.
 *
 * ## Ce qu'il BASCULE, et ce qu'il refuse
 *
 * Sous `--basculer`, il réécrit les versions périmées — c'est mécanique, donc
 * automatisable, et la release l'appelle juste après avoir publié. Un gate qui
 * se contenterait de refuser ne ferait que DÉPLACER la dette d'un cran : la page
 * resterait fausse entre deux publications.
 *
 * Tout le reste demeure un refus, parce que c'est de la PROSE : nommer le canal
 * dans une commande, requalifier le `git clone` au cran stable, dire ce qu'une
 * préversion ne promet pas. Une bascule qui écrirait ces phrases produirait du
 * texte que personne n'a relu.
 *
 * ## Codes de sortie
 *
 * - `0` — l'accueil dit vrai.
 * - `1` — au moins un écart. La publication doit s'arrêter.
 * - `2` — **on n'a PAS PU regarder** (registre muet, surface absente). Ne pas
 *   savoir regarder n'est pas un verdict favorable : avant un geste
 *   irréversible, l'appelant refuse sur `!= 0`. Une forge qui ne fait que
 *   surveiller peut, elle, distinguer les deux — un registre injoignable n'est
 *   pas une faute du dépôt.
 *
 * @example
 * ```bash
 * node scripts/release/accueil-gate.mjs                     # confronte au registre public
 * node scripts/release/accueil-gate.mjs --json              # sortie machine
 * node scripts/release/accueil-gate.mjs --dist-tags '{"alpha":"10.0.0-alpha.6"}'
 * node scripts/release/accueil-gate.mjs --basculer          # réécrit les versions, puis contrôle
 * ```
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Points d'injection — ils n'existent que pour rendre ce contrôle ÉPROUVABLE.
 * Sans eux, le script déduirait sa racine de son emplacement et parlerait au
 * registre public en dur : on ne pourrait ni le lâcher sur un accueil fabriqué,
 * ni le voir échouer sur un cas construit. Hors test, les valeurs sont celles
 * qu'elles ont toujours eues.
 */
const ROOT =
  process.env.NF_ACCUEIL_ROOT ??
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTRY = (
  process.env.NF_ACCUEIL_REGISTRY ?? "https://registry.npmjs.org"
).replace(/\/$/, "");

/** Le paquet dont les `dist-tags` font foi : celui que la page dit d'installer. */
const PAQUET = process.env.NF_ACCUEIL_PAQUET ?? "nodefony";

/**
 * Les surfaces d'accueil, et ce qu'on attend de chacune.
 *
 * La liste est COURTE et explicite, jamais un glob : une découverte
 * automatique embarquerait le `CHANGELOG.md` — qui doit légitimement citer
 * toutes les versions passées — et le corpus de documentation, dont les
 * exemples de procédure ne sont pas des affirmations d'état. Un contrôle qui
 * crie sur ce qui va bien finit désarmé.
 *
 * `exigeVersion` distingue une surface qui AFFIRME l'état de publication d'une
 * surface qui se contente de le mentionner.
 */
const SURFACES = [
  { chemin: "README.md", exigeVersion: true },
  { chemin: "AGENTS.md", exigeVersion: true },
  { chemin: "docker/hub-overview.md", exigeVersion: true, facultatif: true },
];

/** Une version de préversion de la ligne 10, telle qu'elle s'écrit dans la prose. */
const VERSION = /\b(10\.\d+\.\d+)-(alpha|beta|rc)\.(\d+)\b/g;

/**
 * Formules qui nient toute publication. Écrites au pluriel des tournures
 * réellement employées, pas d'une supposition : ce sont celles que l'accueil
 * portait avant la première alpha.
 */
const NIE_LA_PUBLICATION =
  /(pas encore publi|non publiée|aucun paquet\s+.?10|rien n'est (?:encore )?(?:sur npm|publié))/i;

/**
 * Une commande qui installe le framework. Le groupe `tag` capte `@alpha` quand
 * il est là — c'est son absence qui est l'écart.
 *
 * `npm install` seul, sans nom de paquet, ne concerne pas ce contrôle : c'est
 * l'installation des dépendances d'un dépôt déjà cloné.
 */
const COMMANDE =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:create|install|add|i)\s+(?:create-)?(nodefony|@nodefony\/[a-z0-9-]+)(@[a-z0-9.-]+)?/g;

/**
 * Compare deux versions de la ligne 10 portant un canal.
 *
 * Suffisant ici, et volontairement local : les deux opérandes viennent du même
 * motif {@link VERSION}, donc `10.0.0-alpha.5` contre `10.0.0-alpha.12` — un
 * tri lexical rendrait 12 < 5, d'où la comparaison NUMÉRIQUE du cran.
 *
 * @param a - version citée par l'accueil.
 * @param b - version servie par le canal.
 * @returns négatif si `a` précède `b`, 0 si égales, positif sinon.
 */
function comparer(a, b) {
  const decouper = (v) => {
    const m = /^(\d+)\.(\d+)\.(\d+)-([a-z]+)\.(\d+)$/.exec(v);
    return m
      ? [Number(m[1]), Number(m[2]), Number(m[3]), m[4], Number(m[5])]
      : null;
  };
  const x = decouper(a);
  const y = decouper(b);
  if (!x || !y) return a === b ? 0 : a < b ? -1 : 1;
  for (const i of [0, 1, 2]) if (x[i] !== y[i]) return x[i] - y[i];
  if (x[3] !== y[3]) return x[3] < y[3] ? -1 : 1;
  return x[4] - y[4];
}

/** Le numéro de ligne d'un décalage dans un texte — pour que l'écart soit ancré. */
function ligneDe(contenu, index) {
  let n = 1;
  for (let i = 0; i < index && i < contenu.length; i++) {
    if (contenu[i] === "\n") n++;
  }
  return n;
}

/**
 * Les intervalles occupés par des blocs de code clôturés.
 *
 * Utile parce que la règle du canal ne vaut QUE dans un bloc de code : la prose
 * de l'accueil cite délibérément `npm install nodefony` sans canal, pour dire
 * qu'il sert encore la `7.0.2`. Y voir un écart serait un faux positif sur la
 * phrase même qui prévient du piège.
 *
 * @param contenu - le markdown entier.
 * @returns les paires `[début, fin]` des zones de code.
 */
function zonesDeCode(contenu) {
  const zones = [];
  const fence = /^([ \t]*)(`{3,}|~{3,})[^\n]*\n/gm;
  let m;
  while ((m = fence.exec(contenu)) !== null) {
    const debut = m.index + m[0].length;
    const cloture = new RegExp(`^[ \\t]*${m[2][0]}{3,}[ \\t]*$`, "m");
    const reste = contenu.slice(debut);
    const fin = cloture.exec(reste);
    const finAbs = fin ? debut + fin.index : contenu.length;
    zones.push([debut, finAbs]);
    // 🔴 REPRENDRE APRÈS la ligne de clôture, pas SUR elle. Repartir de `finAbs`
    // fait relire ``` comme une nouvelle OUVERTURE : les zones se décalent d'un
    // bloc et la prose qui SÉPARE deux blocs passe pour du code. Constaté sur le
    // README — `npm install nodefony`, cité en prose pour dire qu'il sert encore
    // la 7, était signalé comme une commande prescrite sans canal.
    fence.lastIndex = fin ? finAbs + fin[0].length : contenu.length;
  }
  return zones;
}

const dansUneZone = (zones, index) =>
  zones.some(([d, f]) => index >= d && index < f);

/**
 * Confronte les surfaces d'accueil aux étiquettes que le registre sert.
 *
 * Fonction PURE — c'est ce qui permet de l'éprouver sans réseau et sans dépôt,
 * sur les états réels qu'on a vus passer.
 *
 * @param options.surfaces - `[{ chemin, contenu, exigeVersion }]`.
 * @param options.distTags - `{ alpha, beta, latest, … }` tels que npm les sert.
 * @returns la liste des écarts, vide quand l'accueil dit vrai.
 */
function confronterAccueil({ surfaces, distTags }) {
  const ecarts = [];
  const latestEstLa10 = (distTags.latest ?? "").startsWith("10.");

  for (const surface of surfaces) {
    const { chemin, contenu, exigeVersion } = surface;
    let versionsVues = 0;

    // ── Les versions citées ────────────────────────────────────────────────
    for (const m of contenu.matchAll(VERSION)) {
      versionsVues++;
      const citee = `${m[1]}-${m[2]}.${m[3]}`;
      const canal = m[2];
      const servie = distTags[canal];
      if (!servie) {
        ecarts.push({
          genre: "VERSION-FANTOME",
          chemin,
          ligne: ligneDe(contenu, m.index),
          message:
            `l'accueil annonce « ${citee} » mais le canal « ${canal} » n'existe pas ` +
            `sur le registre — cette commande ne peut aboutir chez personne`,
        });
        continue;
      }
      const ordre = comparer(citee, servie);
      if (ordre < 0) {
        ecarts.push({
          genre: "VERSION-PERIMEE",
          chemin,
          ligne: ligneDe(contenu, m.index),
          message: `l'accueil annonce « ${citee} », le canal « ${canal} » sert « ${servie} »`,
          correction: `remplacer ${citee} par ${servie}`,
        });
      } else if (ordre > 0) {
        ecarts.push({
          genre: "VERSION-FANTOME",
          chemin,
          ligne: ligneDe(contenu, m.index),
          message:
            `l'accueil annonce « ${citee} », que le canal « ${canal} » NE SERT PAS ` +
            `(il sert « ${servie} ») — la commande de la page échouerait`,
          correction: `publier ${citee}, ou ramener la page à ${servie}`,
        });
      }
    }

    if (exigeVersion && versionsVues === 0) {
      ecarts.push({
        genre: "SURFACE-MUETTE",
        chemin,
        ligne: 1,
        message:
          `cette surface doit annoncer l'état de publication et ne cite AUCUNE version. ` +
          `Sans cette exigence, retirer la phrase rendrait ce contrôle vert`,
      });
    }

    // ── L'affirmation « rien n'est publié » ────────────────────────────────
    const nie = NIE_LA_PUBLICATION.exec(contenu);
    const quelqueChoseEstPublie = Object.keys(distTags).some(
      (t) => t !== "latest" || latestEstLa10,
    );
    if (nie && quelqueChoseEstPublie) {
      ecarts.push({
        genre: "RIEN-PUBLIE",
        chemin,
        ligne: ligneDe(contenu, nie.index),
        message: `« ${nie[0]} » — des paquets de la ligne 10 sont publiés`,
      });
    }

    // ── Les commandes des blocs de code ───────────────────────────────────
    const zones = zonesDeCode(contenu);
    for (const m of contenu.matchAll(COMMANDE)) {
      if (!dansUneZone(zones, m.index)) continue;
      if (m[2]) continue; // le canal est nommé
      if (latestEstLa10) continue; // `latest` EST la 10 : la forme nue est juste
      ecarts.push({
        genre: "COMMANDE-SANS-CANAL",
        chemin,
        ligne: ligneDe(contenu, m.index),
        message:
          `« ${m[0]} » ne nomme aucun canal, et « latest » sert encore ` +
          `« ${distTags.latest ?? "?"} » — cette commande n'installe pas la 10`,
        correction: `écrire ${m[0]}@<canal>`,
      });
    }
  }
  return ecarts;
}

/**
 * Réécrit les versions PÉRIMÉES d'une surface sur ce que le canal sert.
 *
 * Fonction pure, et le périmètre est volontairement minuscule : elle ne touche
 * QUE le numéro de version, jamais une phrase. Ce qui reste à la main est ce qui
 * relève du jugement — requalifier le `git clone` au cran stable, dire ce qu'une
 * préversion ne promet pas, nommer un canal dans une commande. Une bascule
 * automatique qui écrirait de la prose produirait du texte que personne n'a relu.
 *
 * Elle est IDEMPOTENTE : relancée sur une surface déjà basculée, elle ne trouve
 * plus rien à faire. C'est ce qui permet de l'appeler sans condition après une
 * publication.
 *
 * ⚠️ Elle ne corrige PAS une `VERSION-FANTOME` — une page qui annonce une
 * version plus récente que le registre décrit peut-être un cran qu'on est en
 * train de publier, et l'écraser effacerait une intention. Ce cas reste un refus.
 *
 * @param contenu - le markdown de la surface.
 * @param distTags - les étiquettes servies par npm.
 * @returns `{ contenu, remplacements }` — `remplacements` liste `de → vers`.
 */
function basculerVersions(contenu, distTags) {
  const remplacements = [];
  const sortie = contenu.replace(VERSION, (brut, base, canal, cran) => {
    const servie = distTags[canal];
    if (!servie) return brut;
    const citee = `${base}-${canal}.${cran}`;
    if (comparer(citee, servie) >= 0) return brut; // à jour, ou en avance
    remplacements.push({ de: citee, vers: servie });
    return servie;
  });
  return { contenu: sortie, remplacements };
}

/**
 * Lit les `dist-tags` d'un paquet sur le registre.
 *
 * @param paquet - nom du paquet.
 * @returns les étiquettes, ou `null` quand le registre n'a rien rendu
 *   d'exploitable — c'est un « je n'ai pas pu regarder », pas un verdict.
 */
async function lireDistTags(paquet = PAQUET) {
  const url = `${REGISTRY}/${paquet.replaceAll("/", "%2F")}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const tags = body?.["dist-tags"];
    return tags && typeof tags === "object" ? tags : null;
  } catch {
    return null;
  }
}

/**
 * Charge les surfaces déclarées depuis le disque.
 *
 * @returns `{ surfaces, manquantes }` — une surface déclarée non facultative et
 *   introuvable est un « je n'ai pas pu regarder », jamais un silence.
 */
function lireSurfaces() {
  const surfaces = [];
  const manquantes = [];
  for (const decl of SURFACES) {
    const abs = path.join(ROOT, ...decl.chemin.split("/"));
    if (!fs.existsSync(abs)) {
      if (!decl.facultatif) manquantes.push(decl.chemin);
      continue;
    }
    surfaces.push({
      chemin: decl.chemin,
      contenu: fs.readFileSync(abs, "utf8"),
      exigeVersion: decl.exigeVersion,
    });
  }
  return { surfaces, manquantes };
}

/**
 * Point d'entrée.
 *
 * @param argv - arguments, sans `node` ni le chemin du script.
 * @returns le code de sortie.
 */
async function principal(argv) {
  const asJson = argv.includes("--json");
  const iTags = argv.indexOf("--dist-tags");

  const { surfaces, manquantes } = lireSurfaces();
  if (manquantes.length > 0) {
    console.error(
      `✗ CONTRÔLE AVEUGLE — surface d'accueil introuvable : ${manquantes.join(", ")}`,
    );
    return 2;
  }

  let distTags;
  if (iTags !== -1) {
    try {
      distTags = JSON.parse(argv[iTags + 1] ?? "");
    } catch {
      console.error("✗ --dist-tags : JSON illisible");
      return 2;
    }
  } else {
    distTags = await lireDistTags();
    if (!distTags) {
      console.error(
        `✗ CONTRÔLE AVEUGLE — le registre ${REGISTRY} n'a rendu aucun dist-tag pour ` +
          `« ${PAQUET} ». Ne pas savoir regarder n'est pas un verdict favorable.`,
      );
      return 2;
    }
  }

  // ── Mode BASCULE — ce qui rend la dette impossible, et non seulement visible
  //
  // Le gate seul DÉPLACE la dette d'un cran : il refuse la publication suivante,
  // donc la page reste fausse entre les deux. Appelé après une publication, ce
  // mode la met à jour sur l'instant, et le contrôle qui suit le PROUVE.
  if (argv.includes("--basculer")) {
    const faits = [];
    for (const s of surfaces) {
      const { contenu, remplacements } = basculerVersions(s.contenu, distTags);
      if (remplacements.length === 0) continue;
      fs.writeFileSync(
        path.join(ROOT, ...s.chemin.split("/")),
        contenu,
        "utf8",
      );
      s.contenu = contenu;
      for (const r of remplacements)
        faits.push(`${s.chemin} : ${r.de} → ${r.vers}`);
    }
    if (faits.length === 0) {
      console.log("· accueil déjà à jour — rien à basculer");
    } else {
      console.log(`✎ accueil basculé (${faits.length} remplacement(s)) :`);
      for (const f of faits) console.log(`   · ${f}`);
    }
    // On ne s'arrête pas là : ce qui vient d'être écrit se CONTRÔLE, et ce qui
    // relève de la prose (canal d'une commande, requalification d'un cran)
    // n'est pas basculable — il doit rester un refus.
  }

  const ecarts = confronterAccueil({ surfaces, distTags });

  if (asJson) {
    console.log(JSON.stringify({ distTags, ecarts }, null, 2));
    return ecarts.length > 0 ? 1 : 0;
  }

  const canaux = Object.entries(distTags)
    .map(([t, v]) => `${t}=${v}`)
    .join(" · ");

  if (ecarts.length === 0) {
    console.log(`✓ l'accueil annonce ce que npm sert — ${canaux}`);
    return 0;
  }

  console.error(
    `✗ l'accueil du dépôt ne dit pas ce que npm sert (${canaux}) :\n`,
  );
  for (const e of ecarts) {
    console.error(`   ${e.genre}  ${e.chemin}:${e.ligne}`);
    console.error(`      ${e.message}`);
    if (e.correction) console.error(`      → ${e.correction}`);
  }
  console.error(
    `\n${ecarts.length} écart(s). La bascule d'accueil est l'étape 6 du « RESTE À FAIRE » ` +
      `de la publication ; son pourquoi et ses deux règles de formulation vivent au §7.3quater ` +
      `de docs/release/nodefony-10.md.`,
  );
  return 1;
}

// Axiome de portabilité : on compare des URL, jamais des chemins — sous Windows
// `D:\…` se lirait comme un protocole, et la comparaison serait faussée sans erreur.
const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (lanceDirectement) {
  try {
    process.exitCode = await principal(process.argv.slice(2));
  } catch (erreur) {
    console.error(`\n✗ CONTRÔLE AVEUGLE — ${erreur.message}\n`);
    process.exitCode = 2;
  }
}

export {
  confronterAccueil,
  basculerVersions,
  comparer,
  zonesDeCode,
  lireDistTags,
  SURFACES,
};
