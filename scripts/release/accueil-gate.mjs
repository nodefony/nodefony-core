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
 * ## Les six familles d'écart, et pourquoi chacune
 *
 * - `VERSION-PERIMEE` — l'accueil nomme une version plus ANCIENNE que celle du
 *   canal. C'est la dette de report, le cas constaté.
 * - `VERSION-FANTOME` — l'accueil nomme une version plus RÉCENTE que celle du
 *   canal : on annonce ce que personne ne peut installer. Pire que la première,
 *   parce que la commande copiée depuis la page échoue.
 * - `COMMANDE-SANS-CANAL` — une commande d'un bloc de code omet `@<canal>` alors
 *   que `latest` n'est pas encore la 10 : elle servirait la `7.0.2`, une version
 *   JavaScript sans rapport avec ce que la page décrit.
 * - `CANAL-DEPASSE` — une commande nomme un canal qui sert une version plus
 *   ANCIENNE que la plus avancée de la ligne 10. C'est le changement de CANAL,
 *   que `VERSION-PERIMEE` ne voit pas : le jour de la stable, `@beta` sert
 *   toujours la dernière bêta, donc une page restée sur `npm create
 *   nodefony@beta` est « à jour » de son canal — et fait installer une
 *   préversion à tous les visiteurs du jour de l'annonce. Constaté au passage
 *   alpha → beta, rattrapé à la main (8cc845550). Elle vise les COMMANDES, pas
 *   la prose : une ligne qui dit « l'ancien canal `alpha`, figé » informe, elle
 *   ne prescrit rien.
 * - `RIEN-PUBLIE` — la page affirme encore que rien n'est publié.
 * - `SURFACE-MUETTE` — une surface déclarée ne cite AUCUNE version. Sans cette
 *   famille, retirer la phrase rendrait le contrôle vert : le faux vert le plus
 *   facile à produire, et le seul qu'on ne verrait jamais.
 *
 * ## Ce qu'il BASCULE, et ce qu'il refuse
 *
 * Sous `--basculer`, il réécrit les versions périmées — c'est mécanique, donc
 * automatisable. Un gate qui se contenterait de refuser ne ferait que DÉPLACER
 * la dette d'un cran : la page resterait fausse entre deux publications.
 *
 * Avec `--en-cours <version>`, la page est jugée — et basculée — contre l'état
 * d'APRÈS la publication de cette version. C'est le mode de la release :
 * `release.mjs` bascule à l'ESTAMPILLE, avant l'empaquetage, parce que le
 * README d'un paquet part dans son tarball. Basculer après publier (l'ancien
 * ordre) a publié le README de la `10.0.0-beta.7` annonçant la beta.6.
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
 * node scripts/release/accueil-gate.mjs --en-cours 10.0.0-beta.8             # page du tarball à publier
 * node scripts/release/accueil-gate.mjs --en-cours 10.0.0-beta.8 --anticiper # telle que l'estampille la laissera
 * node scripts/release/accueil-gate.mjs --en-cours 10.0.0-beta.8 --basculer  # l'estampille
 * ```
 *
 * @usage node scripts/release/accueil-gate.mjs [--json] [--dist-tags <json>] [--en-cours <version>]
 * @usage node scripts/release/accueil-gate.mjs [--en-cours <version>] --basculer|--anticiper
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
  // Le README du dépôt et la page npm sont GÉNÉRÉS (`scripts/generate/readmes.mjs`) :
  // basculer la page sans sa source ferait échouer `readme:build --check` au
  // commit suivant. La même substitution passe donc dans les sections qui citent
  // la version, et dans la page npm assemblée des mêmes sections.
  { chemin: "src/nodefony/README.md", exigeVersion: false },
  { chemin: "scripts/generate/readme/00-intro.md", exigeVersion: false },
  { chemin: "scripts/generate/readme/08-demarrage.md", exigeVersion: false },
  { chemin: "AGENTS.md", exigeVersion: true },
  { chemin: "docker/hub-overview.md", exigeVersion: true, facultatif: true },
  // Ce que l'APPLICATION GÉNÉRÉE affiche à son utilisateur (#784) : l'écran
  // de connexion de toute application, et l'accueil de la démo. Du CODE, pas
  // du markdown — `code` y fait juger chaque commande, sans bloc clôturé. La
  // commande y est CALCULÉE (`createAppCommand` du cœur) : une commande
  // littérale qui y reparaît est le défaut lui-même.
  {
    chemin: "src/packages/@nodefony/framework/nodefony/src/loginPage.ts",
    exigeVersion: false,
    code: true,
  },
  {
    chemin: "src/nodefony/templates/demo/front/frontend/src/App.tsx.tpl",
    exigeVersion: false,
    code: true,
  },
];

/**
 * Les motifs d'une LIGNE majeure — construits pour la ligne jugée, jamais écrits
 * pour une version : la garde a été pensée pendant la 10, elle doit juger la 11
 * à l'identique (revue #796, « c'est générique ? »).
 *
 * - `version` : une préversion de la ligne, telle qu'elle s'écrit dans la prose ;
 * - `stable` : une version STABLE de la ligne (`10.0.0`), jamais le début d'une
 *   préversion. Elle ne compte comme annonce de publication qu'une fois `latest`
 *   sur la ligne : avant, ce n'est que le numéro du `package.json` que l'accueil
 *   affiche ;
 * - `nie` : les formules qui nient toute publication, au pluriel des tournures
 *   réellement employées (celles de l'accueil d'avant la première alpha).
 *
 * @param {number} ligne - la majeure jugée
 * @returns {{ version: RegExp, stable: RegExp, nie: RegExp }}
 */
function motifsDeLaLigne(ligne) {
  return {
    version: new RegExp(
      `\\b(${ligne}\\.\\d+\\.\\d+)-(alpha|beta|rc)\\.(\\d+)\\b`,
      "g",
    ),
    stable: new RegExp(`\\b${ligne}\\.\\d+\\.\\d+\\b(?![-.\\d])`, "g"),
    nie: new RegExp(
      `(pas encore publi|non publiée|aucun paquet\\s+.?${ligne}|rien n'est (?:encore )?(?:sur npm|publié))`,
      "i",
    ),
  };
}

/**
 * La majeure d'une version exacte, ou `null`.
 *
 * @param {string | null | undefined} v
 * @returns {number | null}
 */
function majeure(v) {
  const m = typeof v === "string" ? VERSION_EXACTE.exec(v) : null;
  return m ? Number(m[1]) : null;
}

/**
 * La ligne qu'un accueil doit annoncer : la majeure de la version que la passe
 * publie, sinon la plus haute majeure que le registre sert. Pendant les
 * préversions de la 11, `latest` sert encore la 10 et `alpha` la 11 : la ligne
 * est la 11, celle que la page doit annoncer.
 *
 * @param {Record<string, string>} distTags - étiquettes servies
 * @param {string | null} enCours - version publiée par la passe
 * @returns {number | null}
 */
function ligneCourante(distTags, enCours) {
  const deLaPasse = majeure(enCours);
  if (deLaPasse !== null) return deLaPasse;
  let haute = null;
  for (const v of Object.values(distTags)) {
    const m = majeure(v);
    if (m !== null && (haute === null || m > haute)) haute = m;
  }
  return haute;
}

/**
 * Une version EXACTE, rien autour : `10.0.0`, `10.0.0-beta.7`. Seule forme
 * que ce contrôle sait comparer, projeter — et ÉCRIRE dans un accueil.
 */
const VERSION_EXACTE = /^(\d+)\.(\d+)\.(\d+)(?:-([a-z]+)\.(\d+))?$/;

/** Un nom d'étiquette npm tel que le registre en sert (`latest`, `beta.0`). */
const ETIQUETTE = /^[A-Za-z][\w.-]*$/;

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
 * La création d'application par `npx` — mêmes groupes que {@link COMMANDE}.
 *
 * `create app` se lance HORS d'une application par définition : `npx` n'y
 * trouve aucun `nodefony` local et va chercher le `latest` du registre. C'est
 * la forme qu'affichaient l'écran de connexion et la démo générée (#784). Les
 * autres `npx nodefony …` se lancent DANS une application, où le binaire local
 * répond : ils ne sont pas visés.
 */
const NPX_CREATE_APP = /\bnpx\s+(nodefony)(@[a-z0-9.-]+)?\s+create\s+app\b/g;

/**
 * Compare deux versions de la ligne 10, préversion (`10.0.0-alpha.5`) ou
 * stable (`10.0.0`).
 *
 * Suffisant ici, et volontairement local : `10.0.0-alpha.5` contre
 * `10.0.0-alpha.12` — un tri lexical rendrait 12 < 5, d'où la comparaison
 * NUMÉRIQUE du cran ; et une stable vient après toutes les préversions de sa
 * base (SemVer §11), ce qu'aucun tri lexical ne rend non plus.
 *
 * @param a - version citée par l'accueil.
 * @param b - version servie par le canal.
 * @returns négatif si `a` précède `b`, 0 si égales, positif sinon.
 */
function comparer(a, b) {
  const decouper = (v) => {
    const m = VERSION_EXACTE.exec(v);
    return m
      ? [
          Number(m[1]),
          Number(m[2]),
          Number(m[3]),
          m[4] ?? null,
          m[5] === undefined ? null : Number(m[5]),
        ]
      : null;
  };
  const x = decouper(a);
  const y = decouper(b);
  if (!x || !y) return a === b ? 0 : a < b ? -1 : 1;
  for (const i of [0, 1, 2]) if (x[i] !== y[i]) return x[i] - y[i];
  if (x[3] === null || y[3] === null) {
    if (x[3] === y[3]) return 0;
    return x[3] === null ? 1 : -1; // la stable vient après ses préversions
  }
  if (x[3] !== y[3]) return x[3] < y[3] ? -1 : 1;
  return x[4] - y[4];
}

/**
 * Les canaux qu'une page d'accueil a le droit d'annoncer. `next` n'y est PAS :
 * c'est le canal de RÉPÉTITION de la stable (#27 — la 10.0.0 part sous `next`,
 * s'installe depuis le registre, puis seulement passe en `latest`). Le compter
 * ferait réclamer `npm create nodefony@next` à l'accueil pendant la répétition,
 * c'est-à-dire annoncer au public une version que personne n'a encore promue.
 */
const CANAUX_ANNONCABLES = new Set(["latest", "rc", "beta", "alpha"]);

/**
 * La version la plus avancée d'une ligne, parmi les canaux qu'une page
 * peut annoncer ({@link CANAUX_ANNONCABLES}).
 *
 * @param distTags - les étiquettes servies par npm.
 * @param ligne - la majeure jugée ({@link ligneCourante}).
 * @returns `{ canal, version }`, ou `null` quand aucun canal ne sert la ligne.
 */
function pointeDeLaLigne(distTags, ligne) {
  let pointe = null;
  for (const [canal, version] of Object.entries(distTags)) {
    if (!CANAUX_ANNONCABLES.has(canal)) continue;
    if (majeure(version) !== ligne) continue;
    if (pointe === null || comparer(version, pointe.version) > 0)
      pointe = { canal, version };
  }
  return pointe;
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
 * Les `dist-tags` tels que npm les servira une fois `enCours` publiée.
 *
 * Le README d'un paquet part dans SON tarball : il doit donc annoncer la
 * version qu'il accompagne, pas celle d'avant. Constaté au registre : le
 * README de `nodefony@10.0.0-beta.7` annonçait la beta.6, parce que la bascule
 * suivait la publication. Pour la 10.0.0, la page npm aurait dit « préversion
 * bêta » pour toujours. Juger l'accueil contre cet état PROJETÉ est ce qui
 * oblige la bascule à précéder l'empaquetage.
 *
 * Le canal d'une préversion est son étiquette (`beta`) ; celui d'une stable est
 * `latest` — même quand elle part d'abord sous `next` (#27) : c'est `latest`
 * que la page de la stable annonce, et la répétition ne s'annonce jamais.
 * Un canal n'est jamais RECULÉ : une version plus ancienne que ce qu'il sert
 * laisse les étiquettes intactes.
 *
 * @param distTags - les étiquettes servies aujourd'hui.
 * @param enCours - la version que la passe publie, ou `null`.
 * @returns de nouvelles étiquettes ; celles d'entrée ne sont pas modifiées.
 */
function projeter(distTags, enCours) {
  if (!enCours) return distTags;
  const m = VERSION_EXACTE.exec(enCours);
  if (!m) return distTags;
  const canal = m[4] ?? "latest";
  const servie = distTags[canal];
  if (typeof servie === "string" && comparer(enCours, servie) <= 0)
    return distTags;
  return { ...distTags, [canal]: enCours };
}

/**
 * Confronte les surfaces d'accueil aux étiquettes que le registre sert.
 *
 * Fonction PURE — c'est ce qui permet de l'éprouver sans réseau et sans dépôt,
 * sur les états réels qu'on a vus passer.
 *
 * @param options.surfaces - `[{ chemin, contenu, exigeVersion, code? }]` ; `code`
 *   juge chaque commande, hors de tout bloc clôturé (une source, un gabarit).
 * @param options.distTags - `{ alpha, beta, latest, … }` tels que npm les sert.
 * @param options.enCours - la version que la passe PUBLIE. L'accueil est alors
 *   jugé contre l'état d'APRÈS sa publication ({@link projeter}) : il doit
 *   l'annoncer, puisque son README part dans le tarball. Une reprise (canal
 *   servant déjà `enCours`) n'a besoin d'aucune tolérance : la page du commit
 *   tagué annonce déjà la version reprise.
 * @param options.ligne - la majeure jugée ; par défaut {@link ligneCourante}.
 * @returns la liste des écarts, vide quand l'accueil dit vrai.
 */
function confronterAccueil({
  surfaces,
  distTags: servis,
  enCours = null,
  ligne = ligneCourante(projeter(servis, enCours), enCours),
}) {
  const ecarts = [];
  const distTags = projeter(servis, enCours);
  const motifs = motifsDeLaLigne(ligne);
  const latestEstLaLigne = majeure(distTags.latest) === ligne;
  const pointe = pointeDeLaLigne(distTags, ligne);

  for (const surface of surfaces) {
    const { chemin, contenu, exigeVersion, commandesSeules = false } = surface;
    let versionsVues = 0;

    // ── Les versions citées ────────────────────────────────────────────────
    for (const m of commandesSeules ? [] : contenu.matchAll(motifs.version)) {
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

    // Au cran stable, la page annonce `10.0.0` et plus aucune préversion.
    if (!commandesSeules && latestEstLaLigne && versionsVues === 0) {
      versionsVues = (contenu.match(motifs.stable) ?? []).length;
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
    const nie = commandesSeules ? null : motifs.nie.exec(contenu);
    const quelqueChoseEstPublie = Object.keys(distTags).some(
      (t) => t !== "latest" || latestEstLaLigne,
    );
    if (nie && quelqueChoseEstPublie) {
      ecarts.push({
        genre: "RIEN-PUBLIE",
        chemin,
        ligne: ligneDe(contenu, nie.index),
        message: `« ${nie[0]} » — des paquets de la ligne ${ligne} sont publiés`,
      });
    }

    // ── Les commandes ─────────────────────────────────────────────────────
    const zones = zonesDeCode(contenu);
    const commandes = [
      ...contenu.matchAll(COMMANDE),
      ...contenu.matchAll(NPX_CREATE_APP),
    ];
    for (const m of commandes) {
      // Un canal NOMMÉ dépassé se refuse partout, prose comprise : une
      // commande citée en ligne (`npm create nodefony@beta <app>`) prescrit
      // autant qu'un bloc de code.
      const canalNomme = m[2]?.slice(1);
      const servieParLui = canalNomme ? distTags[canalNomme] : undefined;
      if (
        pointe !== null &&
        typeof servieParLui === "string" &&
        majeure(servieParLui) === ligne &&
        comparer(servieParLui, pointe.version) < 0
      ) {
        ecarts.push({
          genre: "CANAL-DEPASSE",
          chemin,
          ligne: ligneDe(contenu, m.index),
          message:
            `« ${m[0]} » fait installer « ${servieParLui} », alors que le canal ` +
            `« ${pointe.canal} » sert « ${pointe.version} » — la page prescrit un canal dépassé`,
          correction:
            pointe.canal === "latest"
              ? `écrire la commande sans canal (latest EST la ${ligne}), et requalifier la prose du cran`
              : `écrire ${m[0].replace(m[2], `@${pointe.canal}`)}`,
        });
      }
      // Dans du CODE, tout ce qui s'affiche est prescrit ; dans du markdown,
      // seul un bloc clôturé l'est ({@link zonesDeCode}).
      if (!surface.code && !dansUneZone(zones, m.index)) continue;
      // Le canal est nommé — sauf `@latest`, qui n'en nomme aucun : tant que
      // `latest` n'est pas la 10, il installe la 7 comme la forme nue.
      if (m[2] && m[2] !== "@latest") continue;
      if (latestEstLaLigne) continue; // `latest` EST la ligne : la forme nue est juste
      ecarts.push({
        genre: "COMMANDE-SANS-CANAL",
        chemin,
        ligne: ligneDe(contenu, m.index),
        message:
          `« ${m[0]} » ne nomme aucun canal, et « latest » sert encore ` +
          `« ${distTags.latest ?? "?"} » — cette commande n'installe pas la ${ligne}`,
        correction: m[0].startsWith("npx")
          ? "écrire `npm create nodefony@<canal> <app>` — hors d'une application, `npx` installe le `latest`"
          : `écrire ${m[0]}@<canal>`,
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
 * @param ligne - la majeure jugée ; par défaut {@link ligneCourante}.
 * @returns `{ contenu, remplacements }` — `remplacements` liste `de → vers`.
 */
function basculerVersions(
  contenu,
  distTags,
  ligne = ligneCourante(distTags, null),
) {
  const remplacements = [];
  const motif = motifsDeLaLigne(ligne).version;
  const sortie = contenu.replace(motif, (brut, base, canal, cran) => {
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
 * Ne garde que les étiquettes dont la valeur est une version exacte.
 *
 * Ce qui vient du registre finit ÉCRIT dans l'accueil sous `--basculer`, donc
 * dans le README d'un tarball publié : une réponse altérée (miroir, proxy,
 * registre injecté par `NF_ACCUEIL_REGISTRY`) y déposerait n'importe quel
 * texte. Une étiquette écartée n'ouvre aucun faux vert : le canal manque, et
 * le contrôle le refuse.
 *
 * @param tags - les `dist-tags` reçus, de forme inconnue.
 * @returns les seules paires `étiquette → version exacte`, ou `null` quand il
 *   n'en reste aucune — un « je n'ai pas pu regarder », pas un verdict.
 */
function garderVersions(tags) {
  if (!tags || typeof tags !== "object") return null;
  const gardees = {};
  for (const [canal, version] of Object.entries(tags)) {
    if (
      ETIQUETTE.test(canal) &&
      typeof version === "string" &&
      VERSION_EXACTE.test(version)
    )
      gardees[canal] = version;
  }
  return Object.keys(gardees).length > 0 ? gardees : null;
}

/**
 * Lit les `dist-tags` d'un paquet sur le registre.
 *
 * @param paquet - nom du paquet.
 * @returns les étiquettes à version exacte ({@link garderVersions}), ou `null`
 *   quand le registre n'a rien rendu d'exploitable — c'est un « je n'ai pas pu
 *   regarder », pas un verdict.
 */
async function lireDistTags(paquet = PAQUET) {
  const url = `${REGISTRY}/${paquet.replaceAll("/", "%2F")}`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return garderVersions(body?.["dist-tags"]);
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
      code: decl.code === true,
    });
  }
  const declarees = new Set(SURFACES.map((s) => s.chemin));
  for (const chemin of listerCorpus()) {
    if (declarees.has(chemin)) continue;
    surfaces.push({
      chemin,
      contenu: fs.readFileSync(path.join(ROOT, ...chemin.split("/")), "utf8"),
      exigeVersion: false,
      code: false,
      commandesSeules: true,
    });
  }
  return { surfaces, manquantes };
}

/**
 * Ce qui entre au corpus de PROSE : la documentation vivante, et ce que les
 * paquets emportent dans leur tarball (README, pages `docs/`, skills livrés).
 *
 * Ces pages PRESCRIVENT des commandes — un tutoriel, un guide de montée de
 * version, le skill `nodefony-upgrade` qu'une application reçoit — et la
 * stable les aurait publiées sur `@beta` : l'accueil seul était gardé. Elles
 * ne sont jugées que sur leurs COMMANDES (`commandesSeules`) : une procédure
 * qui cite `10.0.0-alpha.3` raconte, elle n'affirme pas l'état de publication.
 * L'historique en est exclu — il cite légitimement les canaux d'hier.
 */
const CORPUS = [
  /^SECURITY\.md$/,
  /^docs\/.+\.md$/,
  /^src\/nodefony\/docs\/.+\.md$/,
  /^src\/packages\/(?:@nodefony\/)?[^/]+\/README\.md$/,
  /^src\/packages\/@nodefony\/[^/]+\/(?:docs|skills)\/.+\.md$/,
];

/**
 * L'historique et la mémoire d'atelier : ils citent les canaux d'hier, à raison.
 * `docs/release/` est le plan d'exécution des publications : il ÉNONCE les règles
 * de canal, exemples compris, et le site ne le publie pas.
 */
const HORS_CORPUS = [
  /(?:^|\/)CHANGELOG\.md$/,
  /(?:^|\/)(?:MEMORY|CLAUDE)\.md$/,
  /^docs\/(?:archives|session-retros|adr|release)\//,
  /\/(?:node_modules|dist)\//,
];

/**
 * Un chemin appartient-il au corpus de prose ? Prédicat PUR, sur un chemin
 * relatif écrit en `/` — normalisé AVANT d'être filtré.
 *
 * @param chemin - chemin relatif à la racine du dépôt
 * @returns vrai si ses commandes sont jugées
 */
function estDansLeCorpus(chemin) {
  const p = chemin.split("\\").join("/");
  return CORPUS.some((r) => r.test(p)) && !HORS_CORPUS.some((r) => r.test(p));
}

/**
 * Énumère le corpus de prose du dépôt, en chemins relatifs écrits en `/`.
 *
 * @returns les chemins, triés
 */
function listerCorpus() {
  const trouves = [];
  const parcourir = (relatif) => {
    const abs = path.join(ROOT, ...relatif.split("/"));
    if (!fs.existsSync(abs)) return;
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      const enfant = `${relatif}/${e.name}`;
      if (e.isDirectory()) parcourir(enfant);
      else if (estDansLeCorpus(enfant)) trouves.push(enfant);
    }
  };
  for (const racine of ["docs", "src/nodefony/docs", "src/packages"])
    parcourir(racine);
  if (fs.existsSync(path.join(ROOT, "SECURITY.md")))
    trouves.push("SECURITY.md");
  return trouves.sort();
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
      distTags = garderVersions(JSON.parse(argv[iTags + 1] ?? ""));
    } catch {
      console.error("✗ --dist-tags : JSON illisible");
      return 2;
    }
    if (!distTags) {
      console.error("✗ --dist-tags : aucune étiquette à version exacte");
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

  const iEnCours = argv.indexOf("--en-cours");
  const enCours = iEnCours === -1 ? null : (argv[iEnCours + 1] ?? null);
  if (iEnCours !== -1 && !enCours) {
    console.error("✗ --en-cours : version manquante");
    return 2;
  }
  const cible = projeter(distTags, enCours);

  // ── Mode BASCULE — ce qui rend la dette impossible, et non seulement visible
  //
  // Le gate seul DÉPLACE la dette d'un cran : il refuse la publication suivante,
  // donc la page reste fausse entre les deux. Avec `--en-cours`, la bascule vise
  // l'état d'APRÈS la publication : c'est ainsi que `release.mjs` la fait à
  // l'estampille, AVANT l'empaquetage, pour que le README du tarball annonce la
  // version qu'il accompagne. `--anticiper` calcule la même bascule sans rien
  // écrire : c'est la répétition, qui juge la page telle que l'estampille la
  // laissera. Dans les deux cas, le contrôle qui suit le PROUVE.
  const basculer = argv.includes("--basculer");
  if (basculer || argv.includes("--anticiper")) {
    const faits = [];
    for (const s of surfaces) {
      // Le corpus de prose ne se bascule pas : ses versions racontent.
      if (s.commandesSeules) continue;
      const { contenu, remplacements } = basculerVersions(s.contenu, cible);
      if (remplacements.length === 0) continue;
      if (basculer)
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
      console.log(
        `${basculer ? "✎ accueil basculé" : "· bascule ANTICIPÉE, rien d'écrit"} ` +
          `(${faits.length} remplacement(s)) :`,
      );
      for (const f of faits) console.log(`   · ${f}`);
    }
    // On ne s'arrête pas là : ce qui vient d'être écrit se CONTRÔLE, et ce qui
    // relève de la prose (canal d'une commande, requalification d'un cran)
    // n'est pas basculable — il doit rester un refus.
  }

  const ecarts = confronterAccueil({ surfaces, distTags, enCours });

  if (asJson) {
    console.log(JSON.stringify({ distTags, ecarts }, null, 2));
    return ecarts.length > 0 ? 1 : 0;
  }

  const canaux =
    Object.entries(distTags)
      .map(([t, v]) => `${t}=${v}`)
      .join(" · ") +
    (cible === distTags ? "" : ` — jugé APRÈS publication de ${enCours}`);

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
  estDansLeCorpus,
  lireSurfaces,
  basculerVersions,
  comparer,
  garderVersions,
  projeter,
  pointeDeLaLigne,
  zonesDeCode,
  ligneDe,
  lireDistTags,
  COMMANDE,
  NPX_CREATE_APP,
  SURFACES,
};
