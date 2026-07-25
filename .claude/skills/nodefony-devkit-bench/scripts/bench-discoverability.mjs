#!/usr/bin/env node
/**
 * Banc de DÉCOUVRABILITÉ du devkit — les 9 tâches (gate de la release 10.0.0).
 *
 * La question mesurée : un agent IA lâché dans une app FRAÎCHEMENT générée
 * (`nodefony create app`) découvre-t-il l'outillage du framework, ou DEVINE-t-il ?
 * Le critère unique du devkit — « l'agent n'invente jamais du code Nodefony » —
 * devient ici un harnais REJOUABLE, pas une impression de session :
 *
 *  - tâche 1 « CRUD produit »   : a-t-il lancé `create entity` ? le 409 et le
 *    PATCH sortent-ils du GÉNÉRÉ, ou l'agent a-t-il dû les inventer à la main ?
 *    (ÉCHOUE avant devkit S4 : non générés, l'agent code un `throw … 409`
 *    artisanal dans le service — preuve négative VOULUE, vérifiée au 1ᵉʳ run)
 *  - tâche 2 « protège une route » : zone firewall / `@IsGranted`, pas un
 *    contrôle d'accès artisanal dans le controller ?
 *  - tâche 3 « canal temps réel » : `create controller --kind realtime` /
 *    `RealtimeController`, pas un `new WebSocket` bas-niveau bricolé ?
 *    (fragile avant S3 : les vitrines n'illustrent pas encore la façade)
 *  - tâche 4 « commande CLI » : a-t-il lancé `create command`, ou recomposé une
 *    classe `Command` de mémoire ? (ÉCHOUAIT tant que le générateur n'existait
 *    pas : le gabarit n'était rendu qu'au moment de `create module --command`,
 *    donc ajouter une commande à un module déjà créé n'avait AUCUN chemin)
 *  - tâche 5 « démarre puis arrête » : emploie-t-il `npm run dev` /
 *    `nodefony status` / `nodefony stop` — que l'`AGENTS.md` généré lui donne —
 *    ou bricole-t-il `lsof`/`kill -9` ? Rien ne prouvait qu'un agent les
 *    utilise ; c'est la seule tâche dont le gate est un état du SYSTÈME (plus
 *    aucun port tenu à la fin), pas un état du dépôt.
 *  - tâche 6 « configuration par l'environnement » : pose-t-il la variable au
 *    bon endroit, avec le nom que l'application DÉCLARE ? Le juge est
 *    `nodefony env --json` lui-même : une variable inventée y apparaît
 *    « inconnue », et une valeur masquée par un rang supérieur n'est pas
 *    l'effective — deux fautes qu'aucune relecture de diff ne montre.
 *  - tâche 7 « choisir la bonne brique » : ouvre-t-il le catalogue publié avec
 *    le cœur, ou invente-t-il un nom de paquet plausible (`@nodefony/mongo`,
 *    `@nodefony/nosql`) qu'aucun `npm install` ne résoudra ? Le gate confronte
 *    tout `@nodefony/*` écrit au catalogue réel.
 *  - tâche 8 « appeler le générateur au lieu de l'imiter » : emploie-t-il
 *    `--describe-json` (le scaffold DÉCRIT ses questions et le contexte du
 *    projet) et `--dry-run` (simuler = la même exécution, sans le disque) ?
 *    C'est le pari central du devkit, et rien ne l'avait jamais mesuré.
 *  - tâche 9 « interroger plutôt que lire les sources » : `nodefony inspect`.
 *    Le gate confronte le nombre de routes ANNONCÉ au nombre réel — un agent qui
 *    a compté dans les sources se trompe, puisqu'une route dépend de
 *    décorateurs, d'un manifeste et d'un ordre de chargement.
 *
 * Chaque tâche est déroulée par un agent en mode headless dans l'app témoin,
 * puis JUGÉE sur pièces — le transcript (a-t-il APPELÉ l'outil ?) et le diff
 * git (qu'a-t-il ÉCRIT ?). Aucun juge LLM : que des sondes objectives.
 *
 * Usage :
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs                # décor + 9 tâches + rapport
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs --task 2       # une seule tâche
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs --setup-only   # juste l'app témoin (--link)
 *   node .claude/skills/nodefony-devkit-bench/scripts/bench-discoverability.mjs --analyze-only tmp/devkit-bench/<run>
 *                                                # re-juger un run existant
 *
 * Prérequis : le checkout est BUILDÉ (`npm run build` — l'app témoin se lie au
 * dist local via --link) et le CLI `claude` est disponible (surchargable :
 * DEVKIT_BENCH_AGENT="mon-cli" — il doit accepter un prompt en argument,
 * travailler dans le cwd et écrire son transcript sur stdout).
 *
 * ⚠️ L'agent tourne SANS garde-fou d'approbation, dans un décor JETABLE
 * (tmp/devkit-bench/<run>/app) — ne jamais pointer ce banc sur un vrai projet.
 *
 * Sortie : rapport console + tmp/devkit-bench/<run>/report.json (par tâche :
 * verdict, sondes, préuves). Exit 1 si une tâche échoue — AVANT S4 c'est
 * l'état ATTENDU : un banc qui n'a jamais mordu ne gate rien.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Racine du dépôt, trouvée en REMONTANT plutôt qu'en comptant les « .. ».
 *
 * Ces scripts vivent dans un skill, et un skill se déplace : un chemin relatif
 * figé casse au premier rangement, sur une erreur (« module introuvable ») qui
 * ne dit pas qu'elle parle d'un déplacement.
 */
function findRepoRoot(from) {
  let dir = from;
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(path.join(dir, "src/nodefony/bin/nodefony"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("racine du dépôt Nodefony introuvable depuis " + from);
}

const REPO = findRepoRoot(path.dirname(fileURLToPath(import.meta.url)));
const BIN = path.join(REPO, "src", "nodefony", "bin", "nodefony");
const AGENT = process.env.DEVKIT_BENCH_AGENT ?? "claude";
/**
 * Modèle de l'agent — VARIABLE DU DÉCOR : deux runs sur deux modèles ne se
 * comparent pas. Défaut = le modèle LÉGER de la famille (haiku), à dessein :
 * le banc mesure la DÉCOUVRABILITÉ de l'app, pas l'intelligence de l'agent.
 * Un modèle fort compense les trous du devkit en devinant juste — un modèle
 * léger ne réussit que si l'app le GUIDE (AGENTS.md, docs, générateurs). Le
 * test le plus défavorable est le seul qui prouve. DEVKIT_BENCH_MODEL pour
 * comparer (le rapport enregistre toujours le modèle RELEVÉ au transcript).
 */
const MODEL = process.env.DEVKIT_BENCH_MODEL ?? "haiku";
/** Args du mode headless du CLI claude — transcript JSONL complet sur stdout. */
const AGENT_ARGS = process.env.DEVKIT_BENCH_AGENT_ARGS
  ? process.env.DEVKIT_BENCH_AGENT_ARGS.split(" ")
  : [
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--dangerously-skip-permissions",
    ];

/**
 * Ports DÉDIÉS de l'app témoin, hérités par tout ce que l'agent lance depuis
 * elle (le serveur qu'il démarre en tâche 5 compris).
 *
 * Sans eux, un autre serveur Nodefony déjà en marche répond sur les ports par
 * défaut : la readiness de `--detach --wait` est déclarée, et l'agent — comme
 * le gate — interroge une application qui n'est pas la sienne. Distincts de
 * ceux du banc de vérité (5361/5362) pour que les deux puissent tourner
 * ensemble.
 */
const PORTS = { NF_PORT: "5371", NF_PORT_HTTPS: "5372" };

/** Env de tout ce qui s'exécute DANS l'app témoin — agent comme gates. */
const APP_ENV = { ...process.env, ...PORTS };

/**
 * Les 9 tâches — LIBELLÉS FIGÉS : reformuler une tâche change ce que le banc
 * mesure, et deux runs ne se comparent plus. Toute évolution = nouvelle tâche.
 */
const TASKS = [
  {
    id: 1,
    name: "CRUD produit",
    prompt:
      "Ajoute une ressource REST « produit » à cette application : entité Product " +
      "(sku texte unique obligatoire, status draft ou published, price nombre, défaut 0), " +
      "endpoints CRUD complets. Un POST avec un sku déjà pris doit répondre 409, et une " +
      "mise à jour partielle (price seul) doit être possible sans renvoyer tout l'objet. " +
      "Termine en prouvant que les tests de l'app passent.",
    probes: [
      {
        kind: "transcript",
        name: "a lancé create entity",
        pattern: /create\s+entity/u,
      },
      { kind: "transcript", name: "a lu AGENTS.md", pattern: /AGENTS\.md/u },
      {
        kind: "code",
        name: "entité générée (nodefony/entity/)",
        pattern: /nodefony\/entity\/.*\.ts$/mu,
        where: "files",
      },
      {
        kind: "code",
        name: "pas de CRUD artisanal (ResourceController attendu)",
        pattern: /extends\s+ResourceController/u,
        where: "content",
      },
      {
        // LA sonde de la preuve négative S4 : tant que le scaffold ne génère
        // ni le PATCH ni le mapping contrainte-unique→409, un agent ne peut
        // satisfaire l'énoncé qu'en les INVENTANT à la main (throw 409 dans le
        // service — vécu au premier run réel). Après S4, l'app n'a plus aucun
        // `throw … 409` : le framework mappe, le généré expose PATCH.
        kind: "code",
        name: "409 obtenu SANS mapping artisanal (généré/framework attendu)",
        pattern: /throw[^\n]*409|nodefonyError\([^)]*409/u,
        where: "added",
        invert: true,
      },
      { kind: "gate", name: "npm test vert dans l'app", cmd: ["npm", "test"] },
    ],
  },
  {
    id: 2,
    name: "protège une route",
    prompt:
      'Ajoute une route GET /api/reports qui rend un JSON { report: "ok" }, accessible ' +
      "UNIQUEMENT à un utilisateur authentifié porteur du rôle ROLE_ADMIN — un anonyme doit " +
      "recevoir un refus du framework, pas un contrôle artisanal écrit dans le controller. " +
      "Termine en prouvant que les tests de l'app passent.",
    probes: [
      {
        kind: "transcript",
        name: "a lu AGENTS.md ou la doc security",
        pattern: /AGENTS\.md|security\/docs/u,
      },
      {
        kind: "code",
        name: "garde du framework (@IsGranted ou zone firewall)",
        pattern: /@IsGranted|firewalls?\s*:/u,
        where: "content",
      },
      {
        kind: "code",
        name: "pas de contrôle artisanal (401/403 renvoyé à la main)",
        pattern: /renderJson\([^)]*40[13]|status(Code)?\s*=\s*40[13]/u,
        where: "added",
        invert: true,
      },
      { kind: "gate", name: "npm test vert dans l'app", cmd: ["npm", "test"] },
    ],
  },
  {
    id: 3,
    name: "canal temps réel",
    prompt:
      "Ajoute un canal temps réel « prices » : le serveur pousse un tick JSON par seconde " +
      "aux abonnés, et montre côté CLIENT comment s'y abonner (doc ou test). Utilise ce que " +
      "le framework offre de plus haut niveau des DEUX côtés. Termine en prouvant que les " +
      "tests de l'app passent.",
    probes: [
      {
        kind: "transcript",
        name: "a lancé create controller --kind realtime",
        pattern: /create\s+controller\s+.*realtime/u,
      },
      {
        kind: "code",
        name: "façade realtime (RealtimeController/@RealtimeChannel)",
        pattern: /RealtimeController|@RealtimeChannel/u,
        where: "content",
      },
      {
        kind: "code",
        name: "pas de WS bas-niveau bricolé côté serveur",
        pattern: /new\s+WebSocketServer|\bws\.on\(/u,
        where: "added",
        invert: true,
      },
      // Côté CLIENT (dilution mesurée au banc S2 : les 2 modèles passaient le
      // serveur, le trou est dans l'exemple client). Paire sonde positive
      // (la façade isomorphe est montrée) + sonde négative (pas de client WS
      // recomposé à la main) — une négative seule passe aussi par abandon.
      {
        kind: "code",
        name: "côté client : la façade isomorphe est montrée (RealtimeClient / nodefony/react)",
        pattern: /RealtimeClient|nodefony\/react/u,
        where: "content",
      },
      {
        kind: "code",
        name: "pas de client WS recomposé à la main (new WebSocket)",
        pattern: /new\s+WebSocket\(/u,
        where: "added",
        invert: true,
      },
      { kind: "gate", name: "npm test vert dans l'app", cmd: ["npm", "test"] },
    ],
  },
  {
    id: 4,
    name: "commande CLI",
    prompt:
      "Ajoute à cette application une commande CLI `app:ping` qui affiche un message " +
      "et accepte une option `--json` pour une sortie machine. Elle doit apparaître dans " +
      "`nodefony --help` et s'exécuter réellement. Termine en le prouvant.",
    probes: [
      {
        // LA sonde du trou : tant que `create command` n'existait pas, un agent
        // ne pouvait que recomposer la classe de mémoire — et il le faisait.
        kind: "transcript",
        name: "a lancé create command",
        pattern: /create\s+command/u,
      },
      { kind: "transcript", name: "a lu AGENTS.md", pattern: /AGENTS\.md/u },
      {
        kind: "code",
        name: "commande générée (nodefony/command/)",
        pattern: /nodefony\/command\/.*\.ts$/mu,
        where: "files",
      },
      {
        kind: "code",
        name: "façade du framework (extends Command)",
        pattern: /extends\s+Command\b/u,
        where: "content",
      },
      {
        // Un agent qui ignore la façade parse argv lui-même ou tire un parseur
        // tiers — les deux contournent le cycle de vie du Kernel (la commande ne
        // s'arrête plus à une phase de boot, et n'a plus accès au conteneur).
        kind: "code",
        name: "pas de parsing d'argv artisanal ni de parseur tiers",
        pattern: /process\.argv|from\s+["']commander["']|from\s+["']yargs["']/u,
        where: "added",
        invert: true,
      },
      {
        // Le gate d'ÉTAT : peu importe le chemin pris, la commande doit exister
        // pour de vrai. Le build est inclus — le CLI lit le `dist/`, pas les
        // sources (cause n°1 des « ma commande n'apparaît pas »).
        kind: "gate",
        name: "app:ping listée par `nodefony --help` (après build)",
        cmd: [
          "sh",
          "-c",
          `npm run build >/dev/null 2>&1 && node ${JSON.stringify(BIN)} --help | grep -q "app:ping"`,
        ],
      },
    ],
  },
  {
    id: 5,
    name: "démarre puis arrête le serveur",
    prompt:
      "Démarre le serveur de cette application en arrière-plan, vérifie qu'il répond, " +
      "puis arrête-le proprement sans laisser de processus derrière toi. " +
      "Termine en montrant la preuve des trois étapes.",
    probes: [
      {
        kind: "transcript",
        name: "a démarré par le framework (npm run dev / nodefony development)",
        pattern: /npm run dev\b|nodefony\s+(development|dev|production)\b/u,
      },
      {
        // Les deux commandes standalone que l'AGENTS.md généré lui donne — et
        // dont RIEN ne prouvait qu'un agent s'en sert.
        kind: "transcript",
        name: "a employé nodefony status ou nodefony stop",
        pattern: /nodefony\s+(status|stop)\b/u,
      },
      {
        kind: "transcript",
        name: "pas d'arrêt bricolé (kill -9 / pkill / lsof)",
        pattern: /kill\s+-9|pkill|lsof\s+-t/u,
        invert: true,
      },
      {
        // Gate d'ÉTAT DU SYSTÈME, pas du dépôt : le seul de tout le banc. Un
        // « je l'ai arrêté » dans le transcript ne prouve rien — un port encore
        // tenu, si. Node pur : `nc` n'est pas garanti partout.
        kind: "gate",
        name: "aucun port de l'app encore tenu",
        cmd: [
          "node",
          "-e",
          `const net=require("node:net");let open=0,left=2;` +
            `for (const p of [${PORTS.NF_PORT}, ${PORTS.NF_PORT_HTTPS}]) {` +
            `const s=net.connect(p,"127.0.0.1");` +
            `s.on("connect",()=>{open++;s.destroy();if(!--left)process.exit(open?1:0)});` +
            `s.on("error",()=>{if(!--left)process.exit(open?1:0)});}`,
        ],
      },
    ],
  },
  {
    id: 6,
    name: "configuration par l'environnement",
    prompt:
      "Configure cette application pour qu'elle écrive ses journaux dans un FICHIER plutôt " +
      "que sur la sortie standard, et pour qu'elle utilise la base PostgreSQL " +
      "postgres://app:pwd@db:5432/app. N'écris aucune de ces deux valeurs en dur dans le " +
      "code : passe par l'environnement, au bon endroit. Prouve ensuite que la " +
      "configuration est bien prise en compte.",
    probes: [
      {
        // Le chemin qu'on vient d'ouvrir : la cascade et le catalogue des
        // variables ne se DEVINENT pas, ils se demandent.
        kind: "transcript",
        name: "a interrogé l'environnement (nodefony env)",
        pattern: /nodefony\s+env\b|npx nodefony env/u,
      },
      // ⚠️ PAS de sonde sur le diff git pour cette tâche. Vécu au premier run :
      // l'agent avait fait JUSTE — `NF_LOG_DRIVER=file` dans `.env.local`, le bon
      // endroit — et deux sondes de code l'ont déclaré en échec, parce que
      // `.env.local` est GITIGNORÉ et n'apparaît dans aucun diff. Le juge lisait
      // le dépôt là où la bonne réponse vit hors du dépôt, par conception. Pour
      // une tâche de configuration, seul un juge d'ÉTAT dit la vérité.
      {
        kind: "code",
        name: "aucune valeur en dur dans le code TypeScript",
        pattern: /^\+.*postgres:\/\/[^\n]*$/mu,
        where: "addedTs",
        invert: true,
      },
      {
        // LE gate : la commande sert de JUGE. Elle dit ce que l'application
        // verra vraiment — pas ce que le fichier contient. Une variable
        // inventée apparaît en « inconnue », une valeur masquée par un rang
        // supérieur n'est pas l'effective : les deux font rougir ici, et aucune
        // ne se verrait en relisant le diff.
        kind: "gate",
        name: "`nodefony env --json` : valeurs EFFECTIVES, venues d'un .env, 0 variable inconnue",
        cmd: [
          "sh",
          "-c",
          `node ${JSON.stringify(BIN)} env --json > .nf-env.json; node -e ` +
            `"const r=require('./.nf-env.json');` +
            `const v=n=>r.vars.find(x=>x.name===n);` +
            `const log=v('NF_LOG_DRIVER'),db=v('NF_DATABASE_URL');` +
            `const bad=[];` +
            // Une variable inventée n'a aucun effet et ne le dit jamais : c'est
            // ici, et nulle part ailleurs, qu'elle se voit.
            `if(r.unknown.length)bad.push('variables inconnues: '+r.unknown.map(u=>u.name).join(','));` +
            `if(!log||log.value!=='file')bad.push('NF_LOG_DRIVER effectif='+(log&&log.value));` +
            `if(!db||!String(db.value).startsWith('postgres://'))bad.push('NF_DATABASE_URL effectif='+(db&&db.value));` +
            // « Au bon endroit » se prouve par la PROVENANCE, pas par le diff :
            // changer le défaut dans env.ts produirait la même valeur effective,
            // et ce n'est pas ce qu'on demandait.
            `for (const x of [log,db]) if(x && !/^\\\\.env/.test(String(x.origin))) ` +
            `bad.push(x.name+' ne vient pas d\\\\'un fichier .env (origine: '+x.origin+')');` +
            `if(bad.length){console.error(bad.join(' | '));process.exit(1)}"`,
        ],
      },
    ],
  },
  {
    id: 7,
    name: "choisir la bonne brique",
    prompt:
      "Cette application doit stocker des documents hétérogènes, sans schéma fixe : des " +
      "rapports d'audit externes dont la forme varie d'un émetteur à l'autre. Écris dans un " +
      "fichier NOTES.md quelle brique Nodefony s'en charge, comment on la déclare dans CETTE " +
      "application, et ce que cette brique ne fera PAS aussi bien que celle déjà en place — " +
      "la limite est connue et assumée par le framework, ne la devine pas. N'installe rien.",
    probes: [
      {
        // ⚠️ La sonde vise une chaîne du CONTENU du catalogue, jamais son NOM.
        // Vécu, et c'est le piège de toute sonde de transcript : `/catalogue\.md/`
        // passait au vert alors que l'agent ne l'avait JAMAIS ouvert — le nom du
        // fichier apparaissait parce que l'`AGENTS.md`, lui, le mentionne. Une
        // sonde qui cherche un nom de fichier mesure une mention ; seule une
        // chaîne du contenu prouve que le fichier a transité.
        // OBSERVATION, pas jugement : depuis que l'`AGENTS.md` porte lui-même la
        // limite des adaptateurs, deux voies équivalentes mènent à la réponse.
        // Exiger CELLE-CI recalerait un agent qui a lu l'index et répondu juste
        // — on mesurerait la conformité à un chemin, pas la découvrabilité. Ce
        // qui juge est la sonde suivante : a-t-il RAPPORTÉ la limite ?
        observe: true,
        kind: "transcript",
        name: "a ouvert le catalogue des modules (contenu vu, pas seulement cité)",
        pattern: /Ne le prends pas si|Prends-le quand/u,
      },
      {
        kind: "code",
        name: "a nommé la bonne brique (@nodefony/mongoose)",
        pattern: /@nodefony\/mongoose/u,
        where: "content",
      },
      {
        // LA question non devinable, et c'est tout l'intérêt : « mongoose pour du
        // document » est de la culture générale — le premier run l'a montré, un
        // modèle léger y répond juste sans rien ouvrir. La COUVERTURE ADAPTÉE
        // (l'adaptateur n'implémente pas tout le contrat, et c'est un choix) ne
        // s'invente pas : elle n'existe que dans le catalogue et la doc du module.
        kind: "code",
        // Le premier run recalibré a mis la DOC en cause, pas l'agent : il avait
        // bien ouvert le catalogue, mais n'en avait rapporté que des limites de
        // MongoDB (devinables). La cellule disait « couverture adaptée à la
        // nature du moteur » — vrai, allusif, et inexploitable. Elle nomme
        // désormais les stores manquants ; la sonde vise donc un FAIT vérifiable
        // (`nodefony.stores` du paquet), pas une tournure.
        // La sonde vise les noms des stores MANQUANTS, et EUX SEULS. Première
        // version : `\bstores?\b` — faux POSITIF immédiat, l'agent employait
        // « stores noSQL » sans rien avoir rapporté. Un faux positif est pire
        // qu'un faux négatif : il déclare fermé un trou ouvert. `audit` est
        // exclu aussi, le mot figure dans l'énoncé lui-même. Restent deux termes
        // qu'on n'écrit pas sans avoir lu la liste.
        name: "a rapporté la limite ASSUMÉE (les stores que l'adaptateur ne couvre pas)",
        pattern: /idempot|totp/iu,
        where: "content",
      },
      {
        // Un chemin du monorepo (`src/packages/@nodefony/…`) n'existe PAS dans une
        // application installée par npm : le citer produit une instruction
        // inapplicable. Vu au premier run — l'agent l'a écrit quatre fois, le mode
        // `--link` le lui ayant rendu visible.
        kind: "code",
        name: "aucun chemin du monorepo (inapplicable chez l'utilisateur npm)",
        pattern: /src\/packages\/@nodefony/u,
        where: "added",
        invert: true,
      },
      {
        // LE gate : tout `@nodefony/*` écrit doit EXISTER. Un agent qui devine
        // invente `@nodefony/mongo`, `@nodefony/nosql`, `@nodefony/document` —
        // des noms plausibles qu'aucun `npm install` ne résoudra jamais.
        kind: "gate",
        name: "aucun paquet @nodefony/* inventé (confronté au catalogue publié)",
        cmd: [
          "sh",
          "-c",
          `node -e "const fs=require('node:fs');` +
            `const cat=fs.readFileSync('node_modules/nodefony/docs/catalogue.md','utf8');` +
            `const known=new Set([...cat.matchAll(/@nodefony\\\\/[a-z0-9-]+/g)].map(m=>m[0]));` +
            `const notes=fs.existsSync('NOTES.md')?fs.readFileSync('NOTES.md','utf8'):'';` +
            `if(!notes){console.error('NOTES.md absent');process.exit(1)}` +
            `const cited=new Set([...notes.matchAll(/@nodefony\\\\/[a-z0-9-]+/g)].map(m=>m[0]));` +
            `const ghosts=[...cited].filter(p=>!known.has(p));` +
            `if(ghosts.length){console.error('paquets inventés: '+ghosts.join(','));process.exit(1)}"`,
        ],
      },
    ],
  },
  {
    id: 8,
    name: "appeler le générateur au lieu de l'imiter",
    prompt:
      "Avant de créer quoi que ce soit dans cette application, établis un plan : quelles " +
      "entités existent déjà, quels connecteurs de base de données sont déclarés, et quelles " +
      "options le générateur d'entité accepte. Écris ce plan dans DISCOVERY.md. Puis SIMULE " +
      "la création d'une entité Invoice (numéro texte unique, montant décimal) sans rien " +
      "écrire sur le disque, et colle le résultat de la simulation dans DISCOVERY.md.",
    probes: [
      {
        // La porte MACHINE du scaffold : il se DÉCRIT (questions, valeurs
        // permises, contexte réel du projet). C'est le pari central du devkit —
        // l'agent APPELLE l'outil au lieu d'imiter des fichiers — et rien ne
        // l'avait jamais mesuré.
        kind: "transcript",
        name: "a demandé au scaffold de se décrire (--describe-json)",
        pattern: /--describe-json/u,
      },
      {
        kind: "transcript",
        name: "a simulé au lieu d'écrire (--dry-run)",
        pattern: /--dry-run/u,
      },
      {
        kind: "code",
        name: "le plan est écrit (DISCOVERY.md)",
        pattern: /^DISCOVERY\.md$/mu,
        where: "files",
      },
      {
        // Gate d'ÉTAT, et il est double : la simulation n'a RIEN écrit (aucun
        // fichier d'entité), et le plan cite un connecteur RÉEL du projet — donc
        // lu, pas inventé.
        kind: "gate",
        name: "la simulation n'a rien écrit, et le plan cite le connecteur réel",
        cmd: [
          "sh",
          "-c",
          `node -e "const fs=require('node:fs');` +
            `const bad=[];` +
            `for (const d of ['nodefony/entity','modules']) {` +
            `if(fs.existsSync(d)&&JSON.stringify(fs.readdirSync(d,{recursive:true})).includes('Invoice'))` +
            `bad.push('une entité Invoice a été ÉCRITE malgré la simulation');}` +
            `const p=fs.existsSync('DISCOVERY.md')?fs.readFileSync('DISCOVERY.md','utf8'):'';` +
            `if(!p)bad.push('DISCOVERY.md absent');` +
            `else if(!/default|sqlite|connecteur/i.test(p))bad.push('le plan ne cite aucun connecteur réel');` +
            `if(bad.length){console.error(bad.join(' | '));process.exit(1)}"`,
        ],
      },
    ],
  },
  {
    id: 9,
    name: "interroger l'application plutôt que lire ses sources",
    prompt:
      "Réponds à trois questions sur CETTE application, et écris les réponses dans AUDIT.md : " +
      "combien de routes expose-t-elle au total, quels services le module de sécurité " +
      "enregistre-t-il, et quelle est la valeur effective de la durée de vie d'une session. " +
      "Les réponses doivent refléter l'état RÉEL de l'application, pas ce que ses sources " +
      "laissent supposer.",
    probes: [
      {
        // L'état réel d'une app (routes montées, services, config effective)
        // dépend de décorateurs, d'un manifeste et d'un ordre de chargement :
        // le déduire des sources est faux dès qu'un module en ajoute.
        kind: "transcript",
        name: "a interrogé l'application (nodefony inspect)",
        pattern: /nodefony\s+inspect|npx nodefony inspect/u,
      },
      {
        kind: "code",
        name: "le rapport est écrit (AUDIT.md)",
        pattern: /^AUDIT\.md$/mu,
        where: "files",
      },
      {
        // LE gate : le nombre de routes écrit doit être le VRAI. Un agent qui a
        // compté à la main dans les sources se trompe — c'est précisément ce que
        // la commande existe pour éviter, et le seul moyen de le prouver est de
        // confronter sa réponse au chiffre que l'outil donne.
        kind: "gate",
        name: "le nombre de routes annoncé est le nombre RÉEL",
        cmd: [
          "sh",
          "-c",
          `node ${JSON.stringify(BIN)} inspect routes --json > .nf-routes.json 2>/dev/null; node -e ` +
            `"const fs=require('node:fs');` +
            `const n=JSON.parse(fs.readFileSync('.nf-routes.json','utf8')).length;` +
            `const a=fs.existsSync('AUDIT.md')?fs.readFileSync('AUDIT.md','utf8'):'';` +
            `if(!a){console.error('AUDIT.md absent');process.exit(1)}` +
            `if(!new RegExp('\\\\\\\\b'+n+'\\\\\\\\b').test(a)){` +
            `console.error('routes réelles='+n+', absent du rapport');process.exit(1)}"`,
        ],
      },
    ],
  },
];

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });

const git = (dir, ...args) => sh("git", ["-C", dir, ...args]).trim();

/** Décor : app témoin liée au checkout, sous git (le diff = la pièce à conviction). */
function setup(runDir) {
  const app = path.join(runDir, "app");
  mkdirSync(runDir, { recursive: true });
  console.log("• app témoin (create app --link --preset complete)…");
  sh(BIN, [
    "create",
    "app",
    "bench-app",
    "--dir",
    app,
    "--preset",
    "complete",
    "--frontend",
    "none",
    "--link",
    "--yes",
  ]);
  console.log("• npm install (symlinks --link + transitives)…");
  sh("npm", ["install", "--no-audit", "--no-fund"], { cwd: app });
  git(app, "init", "-q");
  git(app, "add", "-A");
  git(
    app,
    "-c",
    "user.name=bench",
    "-c",
    "user.email=bench@local",
    "commit",
    "-qm",
    "état initial",
  );
  return app;
}

/** Déroule UNE tâche : agent headless dans l'app, transcript + diff capturés. */
function runTask(app, runDir, task) {
  console.log(`\n━━ tâche ${task.id} — ${task.name}`);
  const transcriptPath = path.join(runDir, `task-${task.id}.transcript.jsonl`);
  const res = spawnSync(
    AGENT,
    [...AGENT_ARGS, ...(MODEL ? ["--model", MODEL] : []), task.prompt],
    {
      cwd: app,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: 30 * 60 * 1000,
      // Les ports dédiés sont hérités par TOUT ce que l'agent lance — serveur
      // compris : c'est ce qui rend la tâche 5 mesurable sans dépendre de ce
      // qui tourne par ailleurs sur la machine.
      env: APP_ENV,
    },
  );
  writeFileSync(transcriptPath, res.stdout ?? "");
  if (res.status !== 0) {
    console.log(`  ⚠️ agent sorti en ${res.status} (transcript conservé)`);
  }
  // ─── L'agent a-t-il seulement PU travailler ? ────────────────────────────
  // Un agent qui n'a jamais démarré rend un transcript où toutes les sondes
  // sont rouges — et le rapport ressemble alors trait pour trait à une app
  // devenue indécouvrable. Vécu : quota de session épuisé au milieu d'un run
  // complet, huit tâches « échouées » qui n'étaient jamais parties, et un
  // 1/9 qui ne disait rien du devkit. On ARRÊTE, plutôt que de publier un
  // verdict qui n'en est pas un.
  const transcript = res.stdout ?? "";
  if (/"terminal_reason"\s*:\s*"api_error"/u.test(transcript)) {
    const reason =
      /"result"\s*:\s*"([^"]{0,160})"/u.exec(transcript)?.[1] ?? "erreur API";
    // Le NOMBRE d'échanges tranche entre les deux cas, qui ne valent pas pareil.
    const turns = (transcript.match(/"type"\s*:\s*"assistant"/gu) ?? []).length;
    console.log(
      turns < 3
        ? `\n🛑 l'agent n'a JAMAIS démarré (${turns} échange) — ${reason}\n` +
            `   Toutes ses sondes seraient rouges sans que l'application y soit pour rien.`
        : `\n🛑 l'agent a été COUPÉ après ${turns} échanges — ${reason}\n` +
            `   Son verdict est partiel : ce qu'il n'a pas eu le temps de faire n'est pas un échec.`,
    );
    console.log(
      `   Run INTERROMPU. Relancer l'accès rétabli ; le décor est conservé et\n` +
        `   \`--analyze-only <run>\` re-juge sans redérouler les agents.`,
    );
    process.exit(2);
  }
  git(app, "add", "-A");
  // Un agent qui n'a RIEN écrit est déjà un verdict — commit vide autorisé.
  git(
    app,
    "-c",
    "user.name=bench",
    "-c",
    "user.email=bench@local",
    "commit",
    "-qm",
    `tâche ${task.id}`,
    "--allow-empty",
  );
  runGates(app, runDir, task);
}

/**
 * Exécute les sondes `gate` d'une tâche IMMÉDIATEMENT après elle, et fige le
 * résultat sur disque.
 *
 * Une gate lance une commande dans l'arbre de travail : la jouer plus tard,
 * c'est mesurer l'état laissé par les tâches SUIVANTES. Vécu : la tâche 9
 * recommente une variable d'environnement pour faire booter sa propre
 * inspection, et c'est la tâche 6 — jouée bien avant — qui rougit. Se détacher
 * sur le commit de la tâche ne suffit pas : l'agent avait écrit dans un fichier
 * GITIGNORÉ (`.env.local`), qu'aucun `checkout` ne restaure. Le seul instant où
 * l'état est fidèle, suivi ou non, est la seconde qui suit la tâche.
 */
function runGates(app, runDir, task) {
  const gates = task.probes.filter((p) => p.kind === "gate");
  if (!gates.length) return;
  const results = gates.map((p) => {
    const r = spawnSync(p.cmd[0], p.cmd.slice(1), {
      cwd: app,
      encoding: "utf8",
      timeout: 300_000,
      env: APP_ENV,
    });
    const pass = r.status === 0;
    console.log(`  ${pass ? "✅" : "❌"} [gate] ${p.name} (exit ${r.status})`);
    return {
      name: p.name,
      pass,
      evidence: pass ? "exit 0" : `exit ${r.status}`,
    };
  });
  writeFileSync(
    path.join(runDir, `task-${task.id}.gates.json`),
    JSON.stringify(results, null, 2),
  );
}

/** Juge UNE tâche sur pièces : transcript + diff du commit de la tâche. */
function judgeTask(app, runDir, task) {
  const transcript = existsSync(
    path.join(runDir, `task-${task.id}.transcript.jsonl`),
  )
    ? readFileSync(
        path.join(runDir, `task-${task.id}.transcript.jsonl`),
        "utf8",
      )
    : "";
  // Le commit de la tâche se retrouve par son MESSAGE — robuste quel que soit
  // le sous-ensemble de tâches joué (--task N, run partiel). La BASE du diff
  // est le commit de HARNAIS précédent (« tâche N-1 » ou « état initial »),
  // pas `hash~1` : un agent peut committer LUI-MÊME en cours de tâche (vécu au
  // premier run réel), et son travail vivrait entre les deux commits de
  // harnais — un diff d'un seul cran le raterait entièrement.
  const log = git(app, "log", "--format=%H %s").split("\n");
  const harnessIdx = (suffix) => log.findIndex((l) => l.endsWith(suffix));
  const idx = harnessIdx(`tâche ${task.id}`);
  if (idx === -1) {
    console.log(
      `  ❌ aucun commit « tâche ${task.id} » — la tâche n'a pas été jouée`,
    );
    return {
      id: task.id,
      name: task.name,
      verdict: "FAIL",
      guessed: task.probes.length,
      probes: [],
    };
  }
  const hash = log[idx].split(" ")[0];
  const base = log
    .slice(idx + 1)
    .find((l) => /tâche \d+$|état initial$/u.test(l))
    ?.split(" ")[0];
  const files = git(app, "diff", "--name-only", `${base ?? `${hash}~1`}`, hash)
    .split("\n")
    .filter(Boolean);
  const content = files
    .filter(
      (f) => /\.(ts|tsx|json|md)$/u.test(f) && existsSync(path.join(app, f)),
    )
    .map((f) => readFileSync(path.join(app, f), "utf8"))
    .join("\n");
  // Lignes AJOUTÉES seulement — le haystack des sondes NÉGATIVES. Sur fichiers
  // entiers, une sonde inversée mord sur du PRÉ-EXISTANT légitime (vécu : agent
  // 6/6 côté fond, recalé parce qu'il avait touché l'e2e généré qui porte le
  // `new WebSocket` du test echo). On ne juge un interdit que sur ce que
  // l'agent a ÉCRIT.
  const added = git(app, "diff", "--unified=0", `${base ?? `${hash}~1`}`, hash)
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
  // Lignes ajoutées dans le CODE seul. Une valeur peut être légitime dans un
  // `.env` (c'est même là qu'on la veut) et fautive dans un `.ts` : sans cette
  // restriction, une sonde « pas de valeur en dur » rougirait sur la bonne
  // réponse.
  const addedTs = git(
    app,
    "diff",
    "--unified=0",
    `${base ?? `${hash}~1`}`,
    hash,
    "--",
    "*.ts",
    // Les TESTS sont exclus : une valeur littérale y est une FIXTURE, pas une
    // configuration en dur. Vécu — un agent qui avait tout fait juste (valeur
    // dans le `.env`, config qui lit l'environnement, `nodefony env --json`
    // vert) était recalé parce que son test d'accompagnement citait l'URL
    // qu'il venait de poser. La sonde visait la config ; elle mordait sur la
    // preuve.
    ":(exclude)tests/**",
    ":(exclude)**/*.test.ts",
    ":(exclude)**/*.spec.ts",
  )
    .split("\n")
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .join("\n");
  // Les gates ont été jouées à la fin de la tâche (`runGates`) : on relit leur
  // verdict figé, on ne les rejoue pas ici — l'arbre de travail a changé depuis.
  const gatesPath = path.join(runDir, `task-${task.id}.gates.json`);
  const frozenGates = existsSync(gatesPath)
    ? JSON.parse(readFileSync(gatesPath, "utf8"))
    : null;
  const probes = task.probes.map((p) => {
    let pass = false;
    let evidence = "";
    if (p.kind === "transcript") {
      // `invert` vaut ici aussi : certains INTERDITS ne laissent pas de trace
      // dans le dépôt (un `kill -9` n'écrit aucun fichier) — le transcript est
      // la seule pièce qui les montre.
      const hit = p.pattern.test(transcript);
      pass = p.invert ? !hit : hit;
      evidence = hit ? "vu dans le transcript" : "absent du transcript";
    } else if (p.kind === "code") {
      const haystack =
        p.where === "files"
          ? files.join("\n")
          : p.where === "added"
            ? added
            : p.where === "addedTs"
              ? addedTs
              : content;
      const hit = p.pattern.test(haystack);
      pass = p.invert ? !hit : hit;
      evidence = `${files.length} fichier(s) touchés`;
    } else if (p.kind === "gate") {
      const frozen = frozenGates?.find((g) => g.name === p.name);
      if (frozen) {
        pass = frozen.pass;
        evidence = `${frozen.evidence} (mesuré à la fin de la tâche)`;
      } else {
        // Run antérieur à la mesure figée : on rejoue, en DISANT que le verdict
        // porte sur l'état courant de l'app et non sur celui de la tâche.
        const r = spawnSync(p.cmd[0], p.cmd.slice(1), {
          cwd: app,
          encoding: "utf8",
          timeout: 300_000,
          env: APP_ENV,
        });
        pass = r.status === 0;
        evidence = `exit ${r.status} ⚠️ rejoué sur l'état COURANT de l'app (gate non figée à l'époque) — non opposable`;
      }
    }
    console.log(
      `  ${pass ? "✅" : p.observe ? "👁 " : "❌"} ${p.name} (${evidence})${p.observe ? " — observation" : ""}`,
    );
    return { name: p.name, kind: p.kind, pass, evidence, observe: !!p.observe };
  });
  // ─── Ce qui JUGE et ce qui OBSERVE ────────────────────────────────────────
  // Une sonde exige un ACTE quand aucune autre voie ne donne l'information de
  // façon fiable — lancer le générateur (le code écrit à la main diverge du
  // gabarit), interroger l'environnement (la précédence est un mécanisme, pas
  // un contenu qu'on lirait dans un fichier). Elle se contente d'OBSERVER
  // quand plusieurs voies équivalentes existent : exiger l'ouverture du
  // catalogue alors que l'AGENTS.md porte déjà la réponse mesurerait la
  // conformité à un chemin, pas la capacité. L'observation reste affichée et
  // consignée — elle dit COMMENT l'agent s'y est pris, sans faire échouer.
  const guessed = probes.filter((p) => !p.pass && !p.observe).length;
  const observed = probes.filter((p) => !p.pass && p.observe).length;
  const verdict = guessed === 0 ? "PASS" : "FAIL";
  console.log(
    `  → ${verdict} — ${guessed} sonde(s) rouge(s) sur ${probes.filter((p) => !p.observe).length}` +
      (observed ? ` (+ ${observed} observation non tenue)` : ""),
  );
  return { id: task.id, name: task.name, verdict, guessed, observed, probes };
}

function main() {
  const args = process.argv.slice(2);
  // `--task 4` ou `--task 4,6,7` — rejouer PLUSIEURS tâches ciblées dans UN
  // décor : monter une app témoin coûte une installation complète, la payer
  // trois fois pour trois tâches n'apporte rien (chaque tâche a son commit et
  // ses gates figées, elles ne se contaminent plus).
  const only = args.includes("--task")
    ? args[args.indexOf("--task") + 1]
        .split(",")
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n))
    : null;
  const analyzeOnly = args.includes("--analyze-only")
    ? path.resolve(args[args.indexOf("--analyze-only") + 1])
    : null;
  const runDir =
    analyzeOnly ??
    path.join(
      REPO,
      "tmp",
      "devkit-bench",
      new Date().toISOString().replaceAll(":", "-").slice(0, 19),
    );
  const app = path.join(runDir, "app");
  const tasks = TASKS.filter((t) => only === null || only.includes(t.id));

  if (!analyzeOnly) {
    if (!existsSync(path.join(REPO, "src", "nodefony", "dist"))) {
      console.error(
        "dist absent — `npm run build` d'abord (l'app témoin se lie au checkout)",
      );
      process.exit(64);
    }
    setup(runDir);
    if (args.includes("--setup-only")) {
      console.log(`\napp témoin prête : ${app}`);
      return;
    }
    for (const task of tasks) runTask(app, runDir, task);
  }

  const results = tasks.map((t) => judgeTask(app, runDir, t));
  // Modèle RELEVÉ dans les transcripts (pas seulement demandé) : c'est ce qui
  // a réellement tourné qui rend deux runs comparables.
  const models = new Set();
  for (const t of tasks) {
    const p = path.join(runDir, `task-${t.id}.transcript.jsonl`);
    if (existsSync(p)) {
      const m = readFileSync(p, "utf8").match(/"model":"([^"]+)"/u);
      if (m) models.add(m[1]);
    }
  }
  const report = {
    date: new Date().toISOString(),
    runDir,
    model: [...models].join("+") || MODEL || "inconnu",
    results,
  };
  writeFileSync(
    path.join(runDir, "report.json"),
    JSON.stringify(report, null, 2),
  );
  const failed = results.filter((r) => r.verdict === "FAIL");
  console.log(
    `\n━━ verdict : ${results.length - failed.length}/${results.length} tâches PASS`,
  );
  console.log(
    `rapport : ${path.relative(REPO, path.join(runDir, "report.json"))}`,
  );
  if (failed.length > 0) {
    console.log(
      "(avant devkit S4, l'échec de la tâche 1 est l'état ATTENDU — le 409/PATCH " +
        "non générés forcent l'agent à inventer ; la 3 peut passer côté serveur " +
        "si l'agent suit la façade realtime)",
    );
    process.exit(1);
  }
}

main();
