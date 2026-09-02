#!/usr/bin/env node
/**
 * Auto-contrôle des sondes du banc de découvrabilité — le juge, AVANT le verdict.
 *
 * Ce fichier existe parce que les sondes de ce banc ont recalé des agents qui
 * avaient fait JUSTE, quatre fois, sur le même mode de défaillance : une sonde
 * qui lisait les tests alors qu'elle visait la configuration ; une autre qui
 * lisait les tests alors qu'elle visait le code de production ; une regex qui
 * ne franchissait pas la parenthèse d'un appel imbriqué ; un interdit posé sans
 * la condition qui le rend un interdit. À chaque fois le défaut n'a été vu
 * qu'après avoir lancé de vrais agents et relu les diffs à la main — une heure
 * d'analyse pour une faute qu'un échantillon de trois lignes aurait montrée.
 *
 * Le principe : chaque sonde reçoit deux échantillons FIGÉS — un qu'elle doit
 * accepter, un qu'elle doit refuser. Aucun agent n'est lancé, aucun décor n'est
 * monté ; le contrôle coûte quelques secondes et zéro jeton.
 *
 * Il appelle `evaluateProbe` du banc, jamais une copie de la règle : un
 * auto-contrôle qui réimplémente ce qu'il vérifie ne vérifie que lui-même.
 *
 *   node bench-discoverability.selftest.mjs
 *   node bench-discoverability.selftest.mjs --prove   # ampute chaque sonde
 *
 * Sorties — la distinction compte, et elle est volontaire :
 *   0  toutes les sondes couvertes se comportent comme annoncé, couverture complète
 *   1  une sonde couverte MENT (elle accepte ce qu'elle doit refuser, ou l'inverse)
 *   2  couverture INCOMPLÈTE — les sondes sans échantillon sont NOMMÉES. Un vert
 *      incomplet lu comme un vert complet est le piège maison n° 1 ; une sonde
 *      qu'on ajoute sans son échantillon doit se voir, pas se fondre dans le vert.
 */
import {
  TASKS,
  SONDES_QUALITE,
  refuserLesAncresDeDiff,
  elaguerAffichage,
  evaluateProbe,
  expliquerEchec,
  motifDEcartement,
  transcriptExploitable,
} from "./bench-discoverability.mjs";

/**
 * Ce qu'une commande AFFICHE ne compte pas pour un geste — les deux sens.
 *
 * La garde a un coût si elle se trompe, et il est asymétrique : élaguer TROP
 * fait rater un vrai appel de générateur (rouge visible, corrigé au run
 * suivant), élaguer TROP PEU laisse un agent valider une sonde en RACONTANT ce
 * qu'il n'a pas fait (vert que personne ne conteste). Les deux moitiés sont
 * donc éprouvées ici : six formes d'affichage doivent disparaître, cinq
 * invocations réelles doivent survivre — dont celles qui SUIVENT un affichage
 * dans la même commande, le cas où un élagage trop gourmand emporterait le
 * geste avec le décor.
 *
 * @returns {string[]} les libellés des cas qui n'ont pas rendu ce qu'ils doivent.
 */
function verifierElagageAffichage() {
  const rates = [];
  const cas = [
    // Ce que l'agent ÉCRIT — doit disparaître.
    [
      "heredoc décoratif (le cas vécu, tâche 28)",
      "cat << 'EOF'\n  Ou créer un module Nodefony distinct :\n    npx nodefony create module audit\nEOF",
      false,
    ],
    [
      "heredoc sans quotes",
      "cat <<EOF\nlance npx nodefony create module blog\nEOF",
      false,
    ],
    [
      "heredoc indenté (<<-)",
      "cat <<-FIN\n\tnpx nodefony create module blog\n\tFIN",
      false,
    ],
    ["echo littéral", 'echo "npx nodefony create module blog"', false],
    ["echo avec drapeau", 'echo -e "npx nodefony create module blog"', false],
    ["printf littéral", "printf 'npx nodefony create module blog'", false],
    // Ce que l'agent FAIT — doit survivre.
    ["invocation nue", "npx nodefony create module audit", true],
    ["invocation chaînée", "cd /app && npx nodefony create module audit", true],
    [
      "invocation APRÈS un heredoc refermé",
      "cat << 'EOF'\nbla\nEOF\nnpx nodefony create module audit",
      true,
    ],
    [
      "invocation dans un sh -c",
      'sh -c "npx nodefony create module audit"',
      true,
    ],
    [
      "invocation précédée d'un echo décoratif",
      'echo "on y va" && npx nodefony create module audit',
      true,
    ],
  ];
  for (const [label, cmd, doitSurvivre] of cas) {
    if (/create\s+module\b/u.test(elaguerAffichage(cmd)) !== doitSurvivre) {
      rates.push(label);
    }
  }
  return rates;
}

/**
 * Un gate rouge doit s'expliquer du premier coup.
 *
 * @returns {string[]} les libellés des cas qui n'ont pas rendu ce qu'ils doivent.
 */
function verifierExplicationGate() {
  const rates = [];
  const cas = [
    [
      "le message d'un gate écrit en ligne",
      ["aucun service porte par l app dans le conteneur\n", ""],
      "aucun service porte par l app dans le conteneur",
    ],
    [
      "canal d'erreur muet — on se rabat sur la sortie standard",
      ["", "\n\nDISCOVERY.md absent\n"],
      "DISCOVERY.md absent",
    ],
    [
      // La dernière ligne d'un outil bavard est « un journal complet est
      // disponible dans… » : c'est la PREMIÈRE qui porte l'erreur.
      "outil bavard — la première ligne, pas la dernière",
      [
        "FAIL tests/invoice.test.ts\nnpm ERR! code 1\nnpm ERR! journal complet\n",
        "",
      ],
      "FAIL tests/invoice.test.ts",
    ],
    ["un gate parfaitement muet", ["", "   \n\n"], ""],
    [
      // 🔴 Vécu : trois rouges d'un run entier expliqués par « npm notice run
      // bench-app@0.1.0 check » — le bruit de l'EXÉCUTEUR, jamais le manquement.
      // Le gate passe par `npm run <script>`, qui annonce toujours deux lignes
      // avant que la commande réelle ne parle. La règle « première ligne » reste
      // juste ; c'est « première ligne DE L'OUTIL » qu'elle voulait dire.
      "npm annonce le script avant que l'outil parle",
      [
        "",
        "npm notice run bench-app@0.1.0 check\nnpm notice run nodefony check\n" +
          "\u2717 le port 5151 est déjà tenu par un autre processus\n" +
          "\n2 manquement(s) sur 1 paquet(s) et 6 classe(s).\n",
      ],
      "\u2717 le port 5151 est déjà tenu par un autre processus",
    ],
    [
      // Même bruit, forme ancienne de npm (`> app@1.0.0 check`).
      "npm ancienne forme — le chevron d'annonce",
      [
        "",
        "> bench-app@0.1.0 typecheck\n> tsgo --noEmit\nsrc/a.ts(3,5): error TS2345: nope\n",
      ],
      "src/a.ts(3,5): error TS2345: nope",
    ],
    [
      // Le bruit SEUL ne doit pas rendre une chaîne vide qui ferait croire à un
      // gate muet : à défaut d'outil qui parle, on rend ce qu'on a.
      "rien que du bruit — on rend quand même quelque chose",
      ["", "npm notice run app@0.1.0 check\n"],
      "npm notice run app@0.1.0 check",
    ],
  ];
  for (const [label, [err, out], attendu] of cas) {
    if (expliquerEchec(err, out) !== attendu) rates.push(label);
  }
  // Une trace entière rendrait le rapport JSON illisible sans rien apprendre.
  const long = expliquerEchec("x".repeat(500), "");
  if (long.length > 200 || !long.endsWith("…")) {
    rates.push("une ligne démesurée est bornée");
  }
  return rates;
}

/**
 * La garde qui empêche un transcript MUET de rendre un verdict.
 *
 * Elle vaut pour n'importe quel agent : les cas ci-dessous n'emploient donc
 * AUCUNE clé propre au format Claude Code — c'est ce format-là qui change quand
 * on change d'agent, et une garde qui s'y accroche s'éteint au moment précis où
 * elle sert.
 *
 * @returns {string[]} les libellés des cas qui n'ont pas rendu ce qu'ils doivent.
 */
function verifierGardeTranscript() {
  const cas = [
    ["fichier absent (chaîne vide)", "", false],
    ["blancs seuls", "\n\n   \n", false],
    ["texte brut d'un CLI qu'on ne sait pas lire", "run terminé\nok\n", false],
    ["JSON tronqué en plein écrit", '{"type":"tool_use","inp', false],
    ["un scalaire n'est pas un événement", "42\ntrue\n", false],
    ["format Claude Code", '{"type":"result","num_turns":12}', true],
    [
      "format inconnu mais JSONL — le banc n'a rien à présumer des clés",
      '{"event":"tool_call","tool":"shell"}',
      true,
    ],
    [
      "une seule ligne lisible parmi des tronquées suffit",
      '{"broken\n{"type":"assistant"}\n',
      true,
    ],
  ];
  const rates = [];
  for (const [label, texte, attendu] of cas) {
    if (transcriptExploitable(texte) !== attendu) rates.push(label);
  }

  // L'autre vacuité, et celle qui a produit un FAIL de référence : un run où
  // l'agent n'a touché AUCUN fichier. Ses interdits ne mordent sur rien — huit
  // sondes vertes par pure absence de matière (T10, 16 tours, 40 s).
  const vivant = '{"type":"result","num_turns":16}';
  const ecartements = [
    [
      "run à zéro fichier — abandon, pas mesure",
      { transcript: vivant, files: [] },
      true,
    ],
    [
      "liste de fichiers absente vaut zéro fichier",
      { transcript: vivant, files: undefined },
      true,
    ],
    [
      "transcript muet écarte même si des fichiers ont bougé",
      { transcript: "", files: ["nodefony/entity/Product.ts"] },
      true,
    ],
    [
      "un run ordinaire n'est pas écarté",
      { transcript: vivant, files: ["nodefony/entity/Product.ts"] },
      false,
    ],
  ];
  for (const [label, pieces, attenduEcarte] of ecartements) {
    if (Boolean(motifDEcartement(pieces)) !== attenduEcarte) rates.push(label);
  }

  // La troisième vacuité, et celle que `--analyze-only` a compté FAIL sur un
  // run réel (T30) : l'agent COUPÉ par l'API (quota de session épuisé). Le mode
  // run s'arrête net quand ça arrive ; le re-jugement, lui, lisait les sondes
  // rouges d'un travail jamais fini et rendait un verdict — règle 4 du
  // dépistage jamais appliquée par ce chemin. Le champ vient d'un vrai
  // transcript : `terminal_reason` existe AUSSI sur les runs sains (valeur
  // `completed`), c'est la VALEUR qui tranche, pas la présence.
  const coupe =
    '{"type":"result","subtype":"success","is_error":true,"terminal_reason":"api_error",' +
    '"num_turns":4,"result":"You\'ve hit your session limit · resets 11:50am"}';
  const acheve =
    '{"type":"result","terminal_reason":"completed","num_turns":12}';
  // L'agent qui CITE le marqueur dans une commande ne s'écarte pas lui-même :
  // le juge parse l'événement, il ne greppe pas le texte (même piège que le
  // compte MCP — mesurer ce que l'agent DIT au lieu de ce qui s'est PASSÉ).
  const citation =
    '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash",' +
    '"input":{"command":"grep \\"terminal_reason\\":\\"api_error\\" run.jsonl"}}]}}\n' +
    acheve;
  const casQuota = [
    [
      "agent coupé par l'API en plein travail — écarté malgré des fichiers touchés",
      { transcript: coupe, files: ["nodefony/entity/Product.ts"] },
      true,
    ],
    [
      "terminal_reason:completed n'écarte rien",
      { transcript: acheve, files: ["nodefony/entity/Product.ts"] },
      false,
    ],
    [
      "citer api_error dans une commande n'écarte pas le run",
      { transcript: citation, files: ["nodefony/entity/Product.ts"] },
      false,
    ],
  ];
  for (const [label, pieces, attenduEcarte] of casQuota) {
    if (Boolean(motifDEcartement(pieces)) !== attenduEcarte) rates.push(label);
  }
  // Coupé AVANT d'avoir rien écrit : les deux causes s'appliquent, le motif
  // doit nommer la RACINE (la coupure), pas l'abandon — un opérateur qui lit
  // « abandon » cherche un défaut d'agent là où il n'y a qu'un quota.
  const motifRacine = motifDEcartement({ transcript: coupe, files: [] });
  if (!/api|coup/iu.test(motifRacine ?? "")) {
    rates.push(
      "coupé sans fichier — le motif doit nommer la coupure, pas l'abandon",
    );
  }
  // 🔴 La tâche dont la bonne réponse est INVISIBLE au diff (`.env.local`,
  // gitignoré). Sans l'exception déclarée, la garde écarte le run d'un agent
  // PARFAIT — vécu sur deux passes, « NON JUGEABLE » pendant que le juge d'état
  // rendait exit 0. Les deux sens sont éprouvés : le drapeau ouvre, son absence
  // ferme, et il ne dispense pas des autres causes d'écartement.
  if (
    motifDEcartement({ transcript: acheve, files: [], peutNeRienEcrire: true })
  )
    rates.push(
      "peutNeRienEcrire n'ouvre pas — un travail invisible au diff reste écarté",
    );
  if (!motifDEcartement({ transcript: acheve, files: [] }))
    rates.push("sans le drapeau, zéro fichier touché DOIT rester un abandon");
  if (
    !motifDEcartement({ transcript: coupe, files: [], peutNeRienEcrire: true })
  )
    rates.push(
      "le drapeau ne doit pas couvrir une COUPURE d'API — ce n'est pas la même question",
    );
  return rates;
}

/**
 * Matières par défaut — un échantillon ne renseigne QUE ce qu'il exerce.
 *
 * `added` est le diff des lignes ajoutées : ses lignes commencent par `+`,
 * et plusieurs sondes s'appuient sur cette forme. Les échantillons la
 * respectent, sans quoi ils éprouveraient une matière qui n'existe pas.
 */
const EMPTY = {
  files: [],
  added: "",
  // Lignes de CODE ajoutées, prose exclue — la matière des interdits dont le
  // marqueur peut être CITÉ dans un document.
  addedCode: "",
  addedTs: "",
  content: "",
  // Le contenu indexé PAR fichier — la matière des sondes qui visent la réponse
  // écrite (`file: "…"`). Un échantillon qui ne le pose pas décrit le cas
  // NOMINAL : son `content` est ce que porte le fichier visé (cf `matter`).
  contentByFile: null,
  transcript: "",
  // L'autre moitié du diff. `deletedFiles` est une LISTE (comme `files`), pas
  // un texte : une sonde qui la vise lit des chemins, pas des lignes de code.
  deleted: "",
  deletedFiles: [],
};

/**
 * Deux échantillons par sonde, indexés `"<id> :: <nom exact>"`.
 *
 * `pass` doit rendre `pass: true`, `fail` doit rendre `pass: false` — y compris
 * pour les sondes inversées, où `pass` est donc l'échantillon VERTUEUX (celui
 * qui ne porte pas l'interdit) et `fail` celui qui porte le contournement.
 *
 * `extra` sert aux cas qu'une paire ne capture pas : aujourd'hui le waiver
 * `unless`, où le motif interdit est présent ET la voie correcte aussi.
 */
const SAMPLES = {
  // ── T1 ────────────────────────────────────────────────────────────────────
  "1 :: a lancé create entity": {
    pass: { transcript: `{"command":"npx nodefony create entity Product"}` },
    fail: {
      transcript: `{"text":"j'écris l'entité à la main dans nodefony/entity"}`,
    },
    extra: [
      {
        // Le mode de défaillance que `commandeQuiContient` ferme : l'`AGENTS.md`
        // généré NOMME la commande, et le transcript porte le contenu de ce que
        // l'agent lit. Une sonde qui cherche le nom nu se satisfait donc d'une
        // LECTURE — elle mesure la documentation, pas le geste.
        label: "AGENTS.md lu, générateur jamais lancé",
        matter: {
          transcript: `{"type":"tool_result","content":"## Entités\\n\\n\`npx nodefony create entity <Nom>\`"}`,
        },
        expect: false,
      },
    ],
  },
  "1 :: a lu AGENTS.md": {
    pass: { transcript: `{"file_path":"/app/AGENTS.md"}` },
    fail: { transcript: `{"file_path":"/app/README.md"}` },
  },
  "1 :: entité générée (nodefony/entity/)": {
    pass: { files: ["nodefony/entity/Product.ts"] },
    fail: { files: ["nodefony/services/Product.ts"] },
  },
  "1 :: pas de CRUD artisanal (ResourceController attendu)": {
    pass: {
      content: `export class ProductController extends ResourceController {}`,
    },
    fail: { content: `export class ProductController extends Controller {}` },
  },
  "1 :: 409 obtenu SANS mapping artisanal (généré/framework attendu)": {
    pass: { added: `  // le 409 vient du contrat de ressource` },
    fail: { added: `  throw new nodefonyError("duplicate", 409);` },
  },

  // ── T2 ────────────────────────────────────────────────────────────────────
  "2 :: a lu AGENTS.md ou la doc security": {
    pass: {
      transcript: `{"file_path":"node_modules/@nodefony/security/docs/firewall.md"}`,
    },
    fail: { transcript: `{"file_path":"/app/package.json"}` },
  },
  "2 :: garde du framework (@IsGranted ou zone firewall)": {
    pass: { content: `  @IsGranted("ROLE_ADMIN")\n  async index() {}` },
    fail: {
      content: `  async index() { if (!user) return this.renderJson({}, 401); }`,
    },
  },
  "2 :: pas de contrôle d'accès artisanal (rôles lus ou refus rendu à la main)":
    {
      pass: {
        addedTs:
          `  @IsGranted("ROLE_ADMIN")\n` +
          `  async reports() { return this.renderJson({ report: "ok" }); }`,
      },
      fail: { addedTs: `    return this.renderJson({ error: "nope" }, 403);` },
      extra: [
        {
          // Les trois formes que la première version laissait passer — donc
          // l'essentiel du contrôle artisanal réellement écrit par un agent.
          label: "erreur du framework levée à la main dans le controller",
          matter: {
            addedTs: `    throw new nodefonyError("Access denied", 403);`,
          },
          expect: false,
        },
        {
          label: "rôles lus à la main",
          matter: {
            addedTs: `    if (!user.roles.includes("ROLE_ADMIN")) return this.renderJson({}, 403);`,
          },
          expect: false,
        },
        {
          label: "status posé à la main",
          matter: { addedTs: `    this.response.statusCode = 401;` },
          expect: false,
        },
        {
          // `addedTs` exclut les tests : une assertion qui CITE 403 est la preuve
          // que l'agent a vérifié son travail, pas une garde artisanale. Recaler
          // là-dessus serait punir la rigueur — le mode de défaillance n° 1 de ce
          // banc, déjà commis cinq fois.
          label: "un test qui assert un 403 n'est pas une garde",
          matter: { added: `    expect(res.status).toBe(403);` },
          expect: true,
        },
      ],
    },

  // ── T3 ────────────────────────────────────────────────────────────────────
  "3 :: a lancé create controller --kind realtime": {
    pass: {
      transcript: `{"command":"npx nodefony create controller Chat --kind realtime"}`,
    },
    fail: { transcript: `{"command":"npx nodefony create controller Chat"}` },
    extra: [
      {
        label: "AGENTS.md lu, générateur jamais lancé",
        matter: {
          transcript: `{"type":"tool_result","content":"Temps réel : \`npx nodefony create controller <Nom> --kind realtime\`"}`,
        },
        expect: false,
      },
    ],
  },
  "3 :: façade realtime (RealtimeController/@RealtimeChannel)": {
    pass: {
      content: `export class ChatController extends RealtimeController {}`,
    },
    fail: { content: `export class ChatController extends Controller {}` },
  },
  "3 :: pas de WS bas-niveau bricolé côté serveur": {
    pass: { added: `  @RealtimeChannel("chat")` },
    fail: { added: `  const wss = new WebSocketServer({ port: 8080 });` },
  },
  "3 :: côté client : la façade isomorphe est montrée (RealtimeClient / nodefony/react)":
    {
      pass: { content: `import { useRealtime } from "nodefony/react";` },
      fail: { content: `const socket = new WebSocket("ws://localhost:5151");` },
    },
  "3 :: pas de client WS recomposé à la main (new WebSocket)": {
    pass: { added: `  const { messages } = useRealtime("chat");` },
    fail: { added: `  const socket = new WebSocket("ws://localhost:5151");` },
  },

  // ── T4 ────────────────────────────────────────────────────────────────────
  "4 :: a lancé create command": {
    pass: {
      transcript: `{"command":"npx nodefony create command import:users"}`,
    },
    fail: { transcript: `{"command":"npx nodefony create controller Users"}` },
    extra: [
      {
        label: "AGENTS.md lu, générateur jamais lancé",
        matter: {
          transcript: `{"type":"tool_result","content":"Commandes : \`npx nodefony create command <nom:action>\`"}`,
        },
        expect: false,
      },
    ],
  },
  "4 :: a lu AGENTS.md": {
    pass: { transcript: `{"file_path":"/app/AGENTS.md"}` },
    fail: { transcript: `{"file_path":"/app/tsconfig.json"}` },
  },
  "4 :: commande générée (nodefony/command/)": {
    pass: { files: ["nodefony/command/ImportUsers.ts"] },
    fail: { files: ["scripts/import-users.ts"] },
  },
  "4 :: façade du framework (extends Command)": {
    pass: { content: `export class ImportUsers extends Command {}` },
    fail: { content: `export async function main() {}` },
  },
  "4 :: pas de parsing d'argv artisanal ni de parseur tiers": {
    pass: { added: `    this.addOption("--dry-run", "simule");` },
    fail: { added: `import { program } from "commander";` },
    extra: [
      {
        // 🔴 LE cas qui a coûté trois passes complètes — 0/3 sur une tâche dont
        // TOUS les gates d'état étaient verts. Le gabarit de `create command`
        // cite `process.argv` dans un COMMENTAIRE (une recette d'enchaînement
        // par `spawnSync`). L'agent qui lançait le générateur et ne touchait à
        // RIEN d'autre — zéro Write, zéro Edit, exactement le geste mesuré — se
        // voyait reprocher du code écrit par NOUS. La garde anti-commentaire
        // existait ; elle tombait sur le `+` du diff, que `\s*` ne consomme pas.
        label: "un commentaire du gabarit citant process.argv",
        matter: {
          added: `    //   spawnSync(process.execPath, [process.argv[1]!, "autre:commande"], {`,
        },
        expect: true,
      },
      {
        // La contrepartie : le vrai geste reste puni, commentaire ou pas.
        label: "un parsing d'argv RÉEL",
        matter: { added: `    const args = process.argv.slice(2);` },
        expect: false,
      },
    ],
  },

  // ── T5 ────────────────────────────────────────────────────────────────────
  "5 :: a démarré par le framework (npm run dev / npm start / nodefony development)":
    {
      pass: { transcript: `{"command":"npm run dev"}` },
      fail: { transcript: `{"command":"node dist/index.js"}` },
      extra: [
        {
          // LE cas du terrain : trois runs sur trois ont démarré par ce script,
          // que le gabarit déclare `nodefony production`. La sonde le refusait,
          // et la tâche sortait FAIL 0/3 alors que tous ses gates étaient verts.
          label: "démarrage par le script npm du gabarit",
          matter: {
            transcript: `{"command":"npm start > /tmp/server.log 2>&1 &"}`,
          },
          expect: true,
        },
        {
          // Un script npm qui ne lance PAS le serveur ne doit rien satisfaire :
          // sans quoi l'élargissement rendrait la sonde vraie sur toute la vie
          // de l'application.
          label: "un autre script npm ne démarre pas",
          matter: { transcript: `{"command":"npm run build"}` },
          expect: false,
        },
        {
          // LE cas qui manquait, et qui rendait la tâche satisfiable par ABANDON.
          // Le transcript porte le contenu des fichiers lus ; l'`AGENTS.md`
          // généré écrit `npm run dev` noir sur blanc. Un agent qui l'ouvre et
          // raconte ce qu'il ferait doit être REFUSÉ : lire n'est pas démarrer.
          label: "AGENTS.md lu, rien lancé",
          matter: {
            transcript: `{"type":"tool_result","content":"## Démarrer\\n\\n\`\`\`bash\\nnpm run dev\\n\`\`\`"}`,
          },
          expect: false,
        },
        {
          // Symétrique : la commande passée à un shell imbriqué reste une
          // invocation, et les guillemets échappés ne doivent pas l'y cacher.
          label: "démarrage via un shell imbriqué",
          matter: {
            transcript: `{"command":"sh -c \\"npx nodefony development --detach\\""}`,
          },
          expect: true,
        },
      ],
    },
  "5 :: a employé nodefony status ou stop (directement ou par npm)": {
    pass: { transcript: `{"command":"npx nodefony stop"}` },
    fail: { transcript: `{"command":"npx nodefony development"}` },
    extra: [
      {
        label: "AGENTS.md lu, aucune commande passée",
        matter: {
          transcript: `{"type":"tool_result","content":"Arrêt propre : \`npx nodefony stop\`"}`,
        },
        expect: false,
      },
      {
        // Le geste du terrain : `npm stop` est `nodefony stop`, par la porte
        // que le gabarit ouvre. `npm run stop` aussi — npm accepte les deux.
        label: "arrêt par le script npm du gabarit",
        matter: { transcript: `{"command":"npm stop 2>&1"}` },
        expect: true,
      },
      {
        // La borne : démarrer n'est pas arrêter, même par npm. Sans ce cas,
        // l'élargissement pourrait rendre la sonde vraie sur `npm start`.
        label: "le script de démarrage ne vaut pas un arrêt",
        matter: { transcript: `{"command":"npm start"}` },
        expect: false,
      },
    ],
  },
  "5 :: pas d'arrêt bricolé (kill / pkill)": {
    pass: { transcript: `{"command":"npx nodefony stop"}` },
    fail: { transcript: `{"command":"kill -9 $(lsof -ti:5151)"}` },
    extra: [
      {
        // Le trou de l'ancien `[^"]*`, qui s'arrêtait au premier guillemet
        // échappé : le bricolage se cachait derrière un `sh -c "…"`.
        label: "arrêt bricolé caché dans un shell imbriqué",
        matter: {
          transcript: `{"command":"sh -c \\"kill -9 $(lsof -ti:5151)\\""}`,
        },
        expect: false,
      },
      {
        // LE cas du terrain : deux agents sur trois avaient arrêté par
        // `npm stop`, puis constaté par `lsof` que les ports étaient rendus —
        // ce que l'énoncé leur demande de PROUVER. Un constat n'arrête rien.
        label: "lsof en lecture, pour constater l'arrêt",
        matter: {
          transcript: `{"command":"lsof -i :5371 -i :5372 2>/dev/null || echo libre"}`,
        },
        expect: true,
      },
      {
        // La contrepartie de ce relâchement : le meurtre reste attrapé, y
        // compris SANS `-9` — `kill $(lsof -ti:…)` bricolait tout autant et
        // passait sous l'ancien motif.
        label: "kill sans signal, par le port",
        matter: { transcript: `{"command":"kill $(lsof -ti:5371)"}` },
        expect: false,
      },
      {
        label: "pkill par nom de process",
        matter: { transcript: `{"command":"pkill -f nodefony"}` },
        expect: false,
      },
      {
        // 🔴 LE cas du terrain, et la quatrième fois que cette sonde confond un
        // TEXTE avec un GESTE. L'agent fait le sans-faute demandé — `npm run
        // stop`, qui rend « ✓ arrêté proprement » — puis écrit une ceinture
        // conditionnelle qui ne s'exécute QUE si un process survit. Il n'en
        // survit aucun : la branche est morte, personne n'a été tué, et la
        // sonde comptait pourtant le `kill -9` qu'elle contient. Le banc
        // punissait la prudence, et sur une sonde inversée un faux rouge ne se
        // remarque pas — il ressemble à un agent fautif.
        label: "ceinture kill dans une branche que l'arrêt réussi rend morte",
        matter: {
          transcript:
            `{"command":"npm run stop && if ps -p $(cat /tmp/server.pid) > /dev/null 2>&1; then kill -9 $(cat /tmp/server.pid); fi"}` +
            `{"type":"tool_result","content":"[stop] arrêt de 2 process dev…\\n  ✓ arrêté proprement\\n  ports : 5371 libéré  5372 libéré"}`,
        },
        expect: true,
      },
      {
        // La contrepartie, qui doit rester ROUGE : `nodefony stop` n'imprime
        // « arrêté proprement » que si AUCUN process ne survit
        // (`devStop.ts:439`). Quand il en reste, il le dit autrement — et le
        // `kill` qui suit est alors le vrai moyen d'arrêt, pas une ceinture.
        label: "kill après un arrêt qui a laissé des survivants",
        matter: {
          transcript:
            `{"command":"npx nodefony stop"}` +
            `{"type":"tool_result","content":"  ⚠ 2 process survivent (pid 411, 412) — relance nodefony stop"}` +
            `{"command":"kill -9 411 412"}`,
        },
        expect: false,
      },
      {
        // Et la leçon d'origine, qui doit tenir : le CLAUDE.md de l'app
        // INTERDIT ces commandes, donc les nomme. Un texte lu n'est pas un
        // geste posé.
        label: "la règle qui interdit kill -9, lue dans le CLAUDE.md",
        matter: {
          transcript: `{"type":"tool_result","content":"Ne jamais employer kill -9 ni pkill : utilise nodefony stop."}`,
        },
        expect: true,
      },
    ],
  },

  // ── T6 ────────────────────────────────────────────────────────────────────
  "6 :: a interrogé l'environnement (nodefony env)": {
    pass: { transcript: `{"command":"npx nodefony env --json"}` },
    fail: { transcript: `{"command":"cat .env.local"}` },
    extra: [
      {
        label: "AGENTS.md lu, environnement jamais interrogé",
        matter: {
          transcript: `{"type":"tool_result","content":"Le catalogue des variables : \`npx nodefony env\`"}`,
        },
        expect: false,
      },
    ],
  },
  "6 :: aucune valeur en dur dans le code TypeScript": {
    // La bonne réponse vit dans `.env.local`, gitignoré : le code, lui, ne doit
    // porter que la LECTURE de la variable.
    pass: { addedTs: `  url: env.NF_DATABASE_URL,` },
    fail: { addedTs: `  url: "postgres://user:secret@localhost:5432/app",` },
  },

  // ── T7 ────────────────────────────────────────────────────────────────────
  "7 :: a ouvert le catalogue des modules (contenu vu, pas seulement cité)": {
    pass: {
      transcript: `{"text":"Prends-le quand tes documents sont hétérogènes"}`,
    },
    fail: { transcript: `{"text":"j'ai regardé le catalogue des modules"}` },
  },
  "7 :: a nommé la bonne brique (@nodefony/mongoose)": {
    pass: { content: `npm install @nodefony/mongoose` },
    fail: { content: `npm install mongoose` },
  },
  "7 :: a rapporté la limite ASSUMÉE (les stores que l'adaptateur ne couvre pas)":
    {
      pass: {
        content: `Limite : le store d'idempotence n'est pas couvert par cet adaptateur.`,
      },
      fail: { content: `Cet adaptateur couvre tous les besoins.` },
    },
  "7 :: aucun chemin du monorepo (inapplicable chez l'utilisateur npm)": {
    pass: { added: `import { defineEntity } from "@nodefony/orm-core";` },
    fail: {
      added: `import x from "../../src/packages/@nodefony/mongoose/index";`,
    },
  },

  // ── T8 ────────────────────────────────────────────────────────────────────
  "8 :: a demandé au scaffold de se décrire (--describe-json)": {
    pass: {
      transcript: `{"command":"npx nodefony create entity --describe-json"}`,
    },
    fail: { transcript: `{"command":"npx nodefony create entity --help"}` },
    extra: [
      {
        label: "porte machine LUE dans la doc, jamais appelée",
        matter: {
          transcript: `{"type":"tool_result","content":"Chaque générateur se décrit : \`--describe-json\` rend ses questions."}`,
        },
        expect: false,
      },
    ],
  },
  "8 :: a simulé au lieu d'écrire (--dry-run)": {
    pass: {
      transcript: `{"command":"npx nodefony create entity Order --dry-run"}`,
    },
    fail: { transcript: `{"command":"npx nodefony create entity Order"}` },
    extra: [
      {
        label: "simulation LUE dans la doc, jamais lancée",
        matter: {
          transcript: `{"type":"tool_result","content":"Ajoute \`--dry-run\` pour simuler sans rien écrire."}`,
        },
        expect: false,
      },
    ],
  },
  "8 :: le plan est écrit (DISCOVERY.md)": {
    pass: { files: ["DISCOVERY.md"] },
    fail: { files: ["docs/DISCOVERY.md"] },
  },

  // ── T9 ────────────────────────────────────────────────────────────────────
  "9 :: a interrogé l'application en marche (inspect / card)": {
    pass: { transcript: `{"command":"npx nodefony inspect routes --json"}` },
    fail: { transcript: `{"pattern":"@route","path":"nodefony/controllers"}` },
    extra: [
      {
        // La carte de visite est l'autre porte du même geste — et c'est ELLE
        // qui nomme `inspect`. Un agent qui commence par là fait ce qu'on lui
        // apprend : la sonde de moyen ne doit pas le recaler, le gate juge déjà
        // le résultat.
        label: "accepte l'autre porte du même geste (card)",
        matter: { transcript: `{"command":"npx nodefony card -j"}` },
        expect: true,
      },
      {
        // `devkit:card` reste l'ALIAS du verbe d'origine, et il est encore écrit
        // dans les AGENTS.md déjà générés : le refuser recalerait un agent qui a
        // lu un document conforme à ce qui lui a été livré.
        label: "accepte l'alias conservé (devkit:card)",
        matter: { transcript: `{"command":"npx nodefony devkit:card -j"}` },
        expect: true,
      },
      {
        // Mais elle reste une sonde de GESTE : lire les sources n'en est pas un,
        // même en prononçant le mot.
        label: "refuse le mot sans la commande",
        matter: { transcript: `{"content":"je vais inspect les controllers"}` },
        expect: false,
      },
      {
        // Le cas que le précédent ne couvrait PAS : le document lu porte la
        // commande ENTIÈRE, `nodefony inspect` compris. C'est la forme réelle —
        // l'`AGENTS.md` généré l'écrit — et un motif nu l'accepte.
        label: "AGENTS.md lu, application jamais interrogée",
        matter: {
          transcript: `{"type":"tool_result","content":"Pour voir les routes montées : \`npx nodefony inspect routes\`"}`,
        },
        expect: false,
      },
    ],
  },
  "9 :: le rapport est écrit (AUDIT.md)": {
    pass: { files: ["AUDIT.md"] },
    fail: { files: ["audit.md"] },
  },

  // ── T10 ───────────────────────────────────────────────────────────────────
  // ── T30 ───────────────────────────────────────────────────────────────────
  "30 :: a interrogé le graphe symbolique (nodefony symbols)": {
    pass: {
      transcript: `{"command":"npx nodefony symbols AbstractCrudService --json"}`,
    },
    // Prononcer le mot n'est pas l'invoquer : l'AGENTS.md généré NOMME cette
    // commande, donc tout agent qui le lit la porte dans son transcript.
    fail: {
      transcript: `{"content":"je vais regarder les symbols du framework"}`,
    },
  },
  "30 :: la note est écrite (NOTE-SYMBOLE.md)": {
    pass: { files: ["NOTE-SYMBOLE.md"] },
    fail: { files: ["docs/NOTE-SYMBOLE.md"] },
  },
  "30 :: l'héritière est NOMMÉE et juste (UserService)": {
    pass: { content: `\`UserService\` étend \`AbstractCrudService\`.` },
    // Le nom PLAUSIBLE mais inventé — ce que produit une déduction depuis le
    // nom de la classe mère. C'est ce que la tâche cherche à distinguer.
    fail: { content: `\`CrudEntityService\` étend \`AbstractCrudService\`.` },
  },
  "30 :: le paquet de l'héritière est NOMMÉ et juste (@nodefony/user)": {
    pass: { content: `\`UserService\` vit dans \`@nodefony/user\`.` },
    // Le paquet plausible et faux : gérer des utilisateurs évoque la sécurité,
    // et un agent qui déduit sans vérifier écrit celui-ci.
    fail: { content: `\`UserService\` vit dans \`@nodefony/security\`.` },
    extra: [
      {
        // LE faux positif que `file` existe pour refuser : le paquet est bien
        // dans la matière, mais dans le `package.json` du décor — pas dans la
        // note. `contentByFile` posé À LA MAIN (note absente) est ce qui
        // distingue les deux, et sans lui ce cas passerait au vert.
        label: "refuse le paquet lu dans le manifeste, sans note écrite",
        matter: {
          content: `{\n  "dependencies": {\n    "@nodefony/user": "^10.0.0"\n  }\n}`,
          contentByFile: {
            "package.json": `{\n  "dependencies": {\n    "@nodefony/user": "^10.0.0"\n  }\n}`,
          },
        },
        expect: false,
      },
    ],
  },

  // ── T31 ───────────────────────────────────────────────────────────────────
  "31 :: a demandé à l'app de se présenter (card)": {
    pass: { transcript: `{"command":"npx nodefony card --json"}` },
    extra: [
      {
        // L'alias d'origine, encore écrit dans les AGENTS.md déjà générés.
        label: "accepte l'alias conservé (devkit:card)",
        matter: { transcript: `{"command":"npx nodefony devkit:card"}` },
        expect: true,
      },
    ],
    fail: { transcript: `{"command":"cat nodefony.config.ts"}` },
  },
  "31 :: a interrogé l'app en marche (inspect)": {
    pass: { transcript: `{"command":"npx nodefony inspect modules --json"}` },
    fail: { transcript: `{"command":"ls node_modules/@nodefony"}` },
  },
  "31 :: la présentation est écrite (PRESENTATION.md)": {
    pass: { files: ["PRESENTATION.md"] },
    fail: { files: ["presentation.md"] },
  },
  "31 :: des modules RÉELLEMENT chargés sont nommés (security + realtime)": {
    pass: {
      content: `Modules actifs : @nodefony/security, @nodefony/realtime, @nodefony/http.`,
    },
    // Un seul des deux ne suffit pas : `security` se cite de mémoire (tous les
    // gabarits en parlent), `realtime` beaucoup moins. C'est le COUPLE qui
    // atteste qu'on a lu la liste réelle plutôt que récité l'attendu.
    fail: { content: `Modules actifs : @nodefony/security, @nodefony/http.` },
  },

  // ── T32 ───────────────────────────────────────────────────────────────────
  "32 :: a lancé le vérificateur du framework (check)": {
    pass: { transcript: `{"command":"npm run check"}` },
    extra: [
      {
        label: "accepte la forme directe (npx nodefony check)",
        matter: { transcript: `{"command":"npx nodefony check"}` },
        expect: true,
      },
      {
        // Le motif doit traverser les guillemets ÉCHAPPÉS, sinon un appel
        // enveloppé dans un shell lui échappe — c'est-à-dire le cas où l'agent
        // enchaîne plusieurs commandes.
        label: "traverse un shell imbriqué",
        matter: {
          transcript: `{"command":"sh -c \\"cd . && npm run check\\""}`,
        },
        expect: true,
      },
    ],
    fail: { transcript: `{"command":"npm test"}` },
  },
  "32 :: le diagnostic est écrit (DIAGNOSTIC.md)": {
    pass: { files: ["DIAGNOSTIC.md"] },
    fail: { files: ["docs/DIAGNOSTIC.md"] },
  },
  "32 :: la brique fautive est nommée (@nodefony/mongoose)": {
    pass: {
      content: `La cause est \`@nodefony/mongoose\`, déclaré mais absent.`,
    },
    fail: { content: `Un module du manifeste ne se charge pas.` },
    extra: [
      {
        // Le faux positif propre à CETTE tâche : son `prepare` injecte le nom
        // dans le manifeste, donc réparer ce fichier sans rien conclure faisait
        // verdir la sonde quand elle lisait le transcript ou le contenu joint.
        label: "refuse le nom réparé dans le manifeste, sans diagnostic écrit",
        matter: {
          content: `use("@nodefony/mongoose", {}),`,
          contentByFile: {
            "nodefony.config.ts": `use("@nodefony/mongoose", {}),`,
          },
        },
        expect: false,
      },
    ],
  },
  "32 :: le vérificateur n'a pas été désarmé": {
    // La sonde est inversée : l'échantillon `pass` est un diff SAIN.
    pass: { added: `    use("@nodefony/http", {}),` },
    fail: { added: `  check: { enabled: false },` },
    extra: [
      {
        label: "refuse aussi le contournement par la ligne de commande",
        matter: { added: `    "check": "nodefony check --no-check"` },
        expect: false,
      },
    ],
  },

  // ── T33 ───────────────────────────────────────────────────────────────────
  "33 :: a lu ce que le framework dit des migrations": {
    pass: {
      transcript: `{"file":"node_modules/@nodefony/drizzle/docs/migrations.md"}`,
    },
    extra: [
      {
        label: "accepte le skill livré par le devkit",
        matter: {
          transcript: `{"command":"cat .agents/skills/nodefony-migrate-schema/SKILL.md"}`,
        },
        expect: true,
      },
    ],
    fail: { transcript: `{"command":"cat package.json"}` },
  },
  "33 :: a employé le générateur de migrations": {
    pass: {
      transcript: `{"command":"npx nodefony orm:generate --name ajout_slug"}`,
    },
    fail: { transcript: `{"command":"npx nodefony orm:migrate"}` },
  },
  "33 :: a appliqué par la commande du framework": {
    pass: { transcript: `{"command":"npx nodefony orm:migrate"}` },
    extra: [
      {
        // Le statut PORTE le mot `orm:migrate` — c'est voulu : lire l'état fait
        // partie du geste, et la sonde est de toute façon une observation.
        label: "accepte la lecture d'état, qui porte le même préfixe",
        matter: {
          transcript: `{"command":"npx nodefony orm:migrate:status --json"}`,
        },
        expect: true,
      },
    ],
    fail: { transcript: `{"command":"npm run build"}` },
  },
  "33 :: n'a jamais proposé de refaire la base à neuf": {
    // Sonde INVERSÉE : l'échantillon `pass` est un travail sain.
    pass: { transcript: `{"command":"npx nodefony orm:migrate --dry-run"}` },
    fail: { transcript: `{"command":"npx nodefony orm:reset --yes"}` },
    extra: [
      {
        label: "refuse le DROP TABLE écrit à la main",
        matter: {
          transcript: `{"command":"sqlite3 app.db 'DROP TABLE Article'"}`,
        },
        expect: false,
      },
      {
        // 🔴 Le waiver de la sonde VOISINE ne déteint pas sur celle-ci : avoir
        // fabriqué une copie ne rend pas `orm:reset` acceptable. C'est
        // exactement pourquoi les deux interdits sont séparés — un waiver posé
        // sur l'ancienne sonde unique aurait gracié celui-ci par ricochet.
        label: "la copie d'essai n'excuse PAS un orm:reset",
        matter: {
          transcript:
            `{"command":"cp var/databases/app.db var/databases/essai.db"}\n` +
            `{"command":"npx nodefony orm:reset --yes"}`,
        },
        expect: false,
      },
    ],
  },
  "33 :: n'a effacé aucune base, hors la copie qu'il a faite": {
    // Sonde INVERSÉE : le `pass` est un travail qui n'efface aucun fichier.
    pass: { transcript: `{"command":"npx nodefony orm:migrate"}` },
    fail: { transcript: `{"command":"rm var/databases/app.db"}` },
    extra: [
      {
        // LE cas qui a fait naître cette sonde : le produit dit de copier la
        // base, de l'éprouver, et l'agent range sa copie derrière lui. Le
        // condamner revenait à punir celui qui suit le conseil.
        label: "accepte le rangement d'une copie que l'agent a faite",
        matter: {
          transcript:
            `{"command":"cp var/databases/e2e.db var/databases/copie.db && NF_MIGRATE_DATABASE_URL=sqlite:var/databases/copie.db npx nodefony orm:migrate"}\n` +
            `{"command":"rm var/databases/copie.db && npm run check"}`,
        },
        expect: true,
      },
      {
        label: "refuse l'effacement par unlink",
        matter: {
          transcript: `{"command":"node -e \\"require('fs').unlinkSync('var/databases/app.db')\\""}`,
        },
        expect: false,
      },
    ],
  },
  "33 :: la migration d'origine n'a pas été supprimée": {
    // Sonde INVERSÉE sur les fichiers SUPPRIMÉS : le `pass` est un travail qui
    // n'en retire aucun.
    pass: { deletedFiles: [] },
    fail: { deletedFiles: ["migrations/0000_schema_initial.sql"] },
  },

  // ── T34 — ajouter un champ à l'utilisateur d'une application en service ───
  "34 :: a lu ce que le framework dit de l'utilisateur ou des migrations": {
    pass: {
      transcript: `{"file":"nodefony/entity/User.ts"}`,
    },
    extra: [
      {
        label: "accepte la doc du module d'identité",
        matter: {
          transcript: `{"command":"cat node_modules/@nodefony/user/docs/index.md"}`,
        },
        expect: true,
      },
      {
        label: "accepte le skill de migration livré par le devkit",
        matter: {
          transcript: `{"command":"cat .agents/skills/nodefony-migrate-schema/SKILL.md"}`,
        },
        expect: true,
      },
    ],
    fail: { transcript: `{"command":"cat package.json"}` },
  },
  "34 :: a lancé create entity User": {
    pass: {
      transcript: `{"command":"npx nodefony create entity User department:string? --yes"}`,
    },
    extra: [
      {
        // Le générateur RÉÉCRIT l'entière entité : relancer la commande avec
        // tous les champs est le geste que le fichier lui-même prescrit.
        label: "accepte la forme avec un défaut SQL",
        matter: {
          transcript: `{"command":"npx --no-install nodefony create entity User department:string=general --yes"}`,
        },
        expect: true,
      },
      {
        // Le contournement mesuré : écrire l'entité soi-même. Le mot `User`
        // apparaît, la commande non.
        label: "refuse l'écriture directe du fichier d'entité",
        matter: {
          transcript: `{"command":"cat > nodefony/entity/User.ts <<EOF"}`,
        },
        expect: false,
      },
      {
        // Créer une entité VOISINE n'est pas créer l'utilisateur : la sonde
        // vise le nom exact, sinon un `create entity UserProfile` la rendrait
        // verte sans qu'on ait touché aux comptes.
        label: "ne se laisse pas prendre par une entité voisine",
        matter: {
          transcript: `{"command":"npx nodefony create entity UserProfile bio:text --yes"}`,
        },
        expect: false,
      },
    ],
    fail: { transcript: `{"command":"npx nodefony orm:generate"}` },
  },
  "34 :: a employé le générateur de migrations": {
    pass: {
      transcript: `{"command":"npx nodefony orm:generate --name ajout_department"}`,
    },
    fail: { transcript: `{"command":"npm run build"}` },
  },
  "34 :: a appliqué par la commande du framework": {
    pass: { transcript: `{"command":"npx nodefony orm:migrate"}` },
    extra: [
      {
        label: "accepte la lecture d'état, qui porte le même préfixe",
        matter: {
          transcript: `{"command":"npx nodefony orm:migrate:status --json"}`,
        },
        expect: true,
      },
    ],
    fail: { transcript: `{"command":"npm run build"}` },
  },
  "34 :: n'a exécuté aucune commande qui refait la base à neuf": {
    // Sonde INVERSÉE : l'échantillon `pass` est un travail sain.
    pass: { transcript: `{"command":"npx nodefony orm:migrate --dry-run"}` },
    fail: { transcript: `{"command":"npx nodefony orm:reset --yes"}` },
    extra: [
      {
        label: "refuse le DROP TABLE exécuté à la main sur les comptes",
        matter: {
          transcript: `{"command":"sqlite3 var/databases/nodefony-drizzle.db 'DROP TABLE User'"}`,
        },
        expect: false,
      },
      {
        // 🔴 LE faux positif mesuré au premier run large : `orm:generate` écrit
        // lui-même ce SQL (patron d'expansion-contraction de SQLite), et
        // l'agent LIT le fichier qu'il vient de faire produire. Le condamner,
        // c'est le punir d'avoir lu la sortie du produit.
        label:
          "n'impute pas le DROP TABLE d'une migration GÉNÉRÉE, lue par l'agent",
        matter: {
          transcript: `{"file":"migrations/sqlite/0001_ajout.sql","content":"DROP TABLE \`User\`;--> statement-breakpoint"}`,
        },
        expect: true,
      },
      {
        // Même famille : l'aide d'une commande CITE `orm:reset`.
        label: "n'impute pas orm:reset lu dans une aide de commande",
        matter: {
          transcript: `{"text":"orm:reset [-c <connecteur>] [-y] — refusée partout ailleurs qu'en développement"}`,
        },
        expect: true,
      },
    ],
  },
  "34 :: a évoqué un effacement de base — observation": {
    // Observation : le `pass` est la SITUATION observée, pas un travail sain.
    pass: { transcript: `{"text":"on pourrait faire npx nodefony orm:reset"}` },
    fail: { transcript: `{"command":"npx nodefony orm:migrate"}` },
  },
  "34 :: n'a effacé aucune base, hors la copie qu'il a faite": {
    pass: { transcript: `{"command":"npx nodefony orm:migrate"}` },
    fail: { transcript: `{"command":"rm var/databases/nodefony-drizzle.db"}` },
    extra: [
      {
        label: "accepte le rangement d'une copie que l'agent a faite",
        matter: {
          transcript:
            `{"command":"cp var/databases/nodefony-drizzle.db var/databases/copie.db && NF_MIGRATE_DATABASE_URL=sqlite:var/databases/copie.db npx nodefony orm:migrate"}\n` +
            `{"command":"rm var/databases/copie.db"}`,
        },
        expect: true,
      },
    ],
  },
  "34 :: champ porté par une entité SÉPARÉE plutôt que par l'utilisateur — observation":
    {
      // Observation : le `pass` est ici la SITUATION observée, pas un travail sain.
      pass: { files: ["nodefony/entity/Department.ts"] },
      fail: { files: ["nodefony/entity/User.ts"] },
      extra: [
        {
          label: "un fichier hors du dossier d'entités ne compte pas",
          matter: { files: ["nodefony/service/DepartmentService.ts"] },
          expect: false,
        },
      ],
    },
  "34 :: department rangé dans metadata plutôt qu'en colonne — observation": {
    pass: {
      added: `      metadata: { department: "commerce" },`,
    },
    fail: {
      added: `  department: text("department"),`,
    },
  },
  "34 :: nom de la table des comptes non renommé": {
    // Sonde INVERSÉE : le `pass` est une table laissée telle que le framework
    // l'écrit — c'est `createUserTable` qui la produit, aucun `sqliteTable` nu.
    pass: {
      added: `export const userTable = createUserTable(DIALECTE);`,
    },
    fail: {
      added:
        `export const userTable = sqliteTable("app_users", {\n` +
        `  identifier: text("identifier").notNull(),\n` +
        `  socialProviders: text("socialProviders", { mode: "json" }),\n` +
        `});`,
    },
    extra: [
      {
        // Le nom JUSTE, écrit à la main, reste acceptable : ce qu'on interdit
        // est le RENOMMAGE, pas la réécriture.
        label: "accepte une table écrite à la main sous le bon nom",
        matter: {
          added:
            `export const userTable = sqliteTable("User", {\n` +
            `  identifier: text("identifier").notNull(),\n` +
            `});`,
        },
        expect: true,
      },
    ],
  },
  // ── T35 — recevoir un fichier ─────────────────────────────────────────────
  "35 :: a cherché ce que le framework offre pour les envois de fichiers": {
    pass: {
      transcript: `{"command":"cat node_modules/@nodefony/http/docs/upload.md"}`,
    },
    extra: [
      {
        label: "accepte la vitrine des décorateurs, qui montre le patron",
        matter: {
          transcript: `{"command":"npx nodefony create controller vitrine --kind example"}\n{"file":"nodefony/controllers/VitrineController.ts"}`,
        },
        expect: false,
      },
      {
        label: "accepte la recherche du décorateur lui-même",
        matter: {
          transcript: `{"command":"grep -r UploadedFile node_modules"}`,
        },
        expect: true,
      },
    ],
    fail: { transcript: `{"command":"npm run build"}` },
  },
  "35 :: façade du framework employée (@UploadedFile) — observation": {
    // Observation : le `pass` est la SITUATION observée, pas un travail sain.
    pass: {
      content: `  @Post("/depot")\n  depot(@UploadedFile() file: IUploadedFile) {}`,
    },
    fail: {
      content: `  @Post("/depot")\n  depot(@Body({ stream: true }) body: NodeJS.ReadableStream) {}`,
    },
    extra: [
      {
        label: "reconnaît aussi la forme plurielle",
        matter: {
          content: `depot(@UploadedFiles() files: IUploadedFile[]) {}`,
        },
        expect: true,
      },
    ],
  },
  "35 :: aucun parseur multipart tiers ajouté": {
    // Sonde INVERSÉE : le `pass` est un travail qui emploie la façade.
    pass: {
      added: `import { UploadedFile } from "@nodefony/framework";`,
    },
    fail: { added: `import multer from "multer";` },
    extra: [
      {
        label: "refuse busboy importé directement",
        matter: { added: `import busboy from "busboy";` },
        expect: false,
      },
      {
        label: "refuse la forme require()",
        matter: { added: `const formidable = require("formidable");` },
        expect: false,
      },
      {
        // Le type `IUploadedFile` vient de `@nodefony/http` et porte le mot
        // « upload » : la sonde ne doit pas le confondre avec un parseur.
        label: "n'attrape pas le type du framework",
        matter: {
          added: `import type { IUploadedFile } from "@nodefony/http";`,
        },
        expect: true,
      },
    ],
  },
  "35 :: aucune dépendance de parsing multipart déclarée": {
    pass: { added: `    "@nodefony/http": "^10.0.0",` },
    fail: { added: `    "multer": "^1.4.5",` },
  },
  "35 :: limites d'upload non desserrées": {
    pass: {
      added: `    use("@nodefony/http", { upload: { maxFileSize: 5 * 1024 * 1024 } }),`,
    },
    fail: {
      added: `    use("@nodefony/http", { upload: { maxFileSize: 0 } }),`,
    },
    extra: [
      {
        label: "refuse la borne infinie",
        matter: { added: `      maxFileSize: Infinity,` },
        expect: false,
      },
    ],
  },
  "35 :: aucune brique de sécurité éteinte en configuration": {
    pass: {
      added: `    use("@nodefony/http", { upload: { maxFiles: 1 } }),`,
    },
    fail: {
      added: `    use("@nodefony/security", { firewall: { enabled: false } }),`,
    },
  },

  "34 :: aucune brique de sécurité éteinte en configuration": {
    pass: {
      added: `    use("@nodefony/drizzle", { connectors: { default: { ddl: "none" } } }),`,
    },
    fail: {
      added: `    use("@nodefony/security", { firewall: { enabled: false } }),`,
    },
  },

  "10 :: service déclaré au conteneur (@injectable)": {
    pass: {
      content: `@injectable()\nexport class DiscountService extends Service {}`,
    },
    fail: { content: `export class DiscountUtils {}` },
  },
  "10 :: enregistré sur un module (@services([…]))": {
    pass: {
      content: `@services([DiscountService])\nclass App extends Module {}`,
    },
    fail: { content: `class App extends Module {}` },
  },
  "10 :: pas d'instanciation manuelle (new XService())": {
    // Le contournement se juge hors des tests : instancier le service DANS son
    // test est la réponse attendue (« testable seul »), pas une faute. La sonde
    // lisant `addedTs`, l'échantillon vertueux vaut pour le code de production.
    pass: { addedTs: `    this.discountService = discountService;` },
    fail: { addedTs: `    const svc = new DiscountService();` },
  },

  // ── T11 ───────────────────────────────────────────────────────────────────
  "11 :: journal du framework (this.log avec une gravité)": {
    pass: {
      content: `this.log({ resource: "order" }, "INFO", "RESOURCE_CREATED");`,
    },
    fail: { content: `this.log("commande créée");` },
  },
  "11 :: pas de console.log (il ne remonte à aucun collecteur)": {
    pass: { added: `    this.log({ id }, "INFO");` },
    fail: { added: `    console.log("created", id);` },
  },
  // La charge loggée appelle une méthode : c'est le cas EXACT qui a recalé une
  // réponse exemplaire, et il doit rester couvert pour de bon.
  "11 :: journal du framework (this.log avec une gravité) — charge avec appel imbriqué":
    {
      of: "11 :: journal du framework (this.log avec une gravité)",
      pass: {
        content: `this.log({ pct: this.svc.getDiscountPercentage(), total }, "INFO", "RESOURCE_CREATED");`,
      },
    },

  // ── T12 ───────────────────────────────────────────────────────────────────
  "12 :: accroché à une phase du cycle de vie (onKernelBoot/Ready)": {
    pass: { content: `  async onKernelBoot(): Promise<this> { return this; }` },
    fail: { content: `  async start(): Promise<void> {}` },
  },
  "12 :: pas de temporisation pour « attendre » le démarrage": {
    pass: { added: `    this.table = await load();`, content: `` },
    fail: {
      added: `    setTimeout(() => this.load(), 3000);`,
      content: `class App extends Module {}`,
    },
    extra: [
      {
        // Le waiver : l'interdit est là, mais la voie correcte AUSSI — c'est
        // une I/O asynchrone dans un chargement accroché au cycle de vie, pas
        // une temporisation qui attend le démarrage.
        label: "setTimeout d'I/O SOUS un hook de cycle de vie → sans objet",
        matter: {
          added: `      await new Promise((r) => setTimeout(r, 10));`,
          content: `  async onKernelBoot() { await this.performLoad(); return this; }`,
        },
        expect: true,
      },
    ],
  },

  // ── T13 ───────────────────────────────────────────────────────────────────
  "13 :: a lancé create service": {
    pass: { transcript: `{"command":"npx nodefony create service Vat"}` },
    fail: {
      transcript: `{"text":"j'écris la classe du service à la main"}`,
    },
    extra: [
      {
        label: "AGENTS.md lu, générateur jamais lancé",
        matter: {
          transcript: `{"type":"tool_result","content":"Services : \`npx nodefony create service <Nom>\`"}`,
        },
        expect: false,
      },
    ],
  },
  "13 :: le service de taxe est éprouvé SÉPARÉMENT (test dédié)": {
    pass: {
      addedTests: `import { VatService } from "../nodefony/service/VatService";`,
    },
    // Le contournement exact : n'éprouver QUE la route. Le test est vert, la
    // séparation des responsabilités n'a jamais été exercée.
    fail: {
      addedTests: `    const res = await fetch(\`\${base}/api/invoices\`, { method: "POST" });`,
    },
    extra: [
      {
        label: "instancié directement dans son test",
        matter: { addedTests: `    const vat = new TvaService(module);` },
        expect: true,
      },
      {
        label: "résolu par le conteneur dans le test",
        matter: {
          addedTests: `    const tax = kernel.container.get("taxService");`,
        },
        expect: true,
      },
      {
        // Le mot apparaît, le SERVICE non : une assertion sur un champ de la
        // réponse HTTP ne prouve aucune séparation.
        label: "le mot « tva » dans une assertion de charge utile",
        matter: { addedTests: `    expect(body.tva).toBe(20);` },
        expect: false,
      },
      {
        // La preuve doit vivre dans un TEST. Le même appel en production est
        // précisément ce que la sonde voisine interdit.
        label: "instanciation en production, pas dans un test",
        matter: {
          addedTs: `    const vat = new VatService(module);`,
          addedTests: ``,
        },
        expect: false,
      },
    ],
  },
  "13 :: la dépendance vient du conteneur (@inject ou container.get)": {
    pass: {
      content: `  constructor(module: Module, @inject("VatService") private vat: VatService) {}`,
    },
    fail: { content: `  private vat = new VatService();` },
  },
  "13 :: pas d'exemplaire fabriqué à la main (new XService())": {
    // Le contournement se juge hors des tests : `new VatService()` DANS son
    // test est la réponse attendue (« testable séparément »).
    pass: { addedTs: `    this.vat = vat;` },
    fail: { addedTs: `    const vat = new VatService();` },
  },
  "13 :: voie déclarative trouvée (injection par constructeur)": {
    pass: { content: `    @inject("VatService") private vat: VatService,` },
    fail: { content: `    this.vat = this.container.get("vat");` },
  },
  // L'AUTRE voie légitime doit rester acceptée par la sonde de consommation :
  // c'est elle que l'`AGENTS.md` nomme en premier, et la recaler ferait
  // dégrader une réponse juste pour plaire à l'instrument.
  "13 :: la dépendance vient du conteneur (@inject ou container.get) — par résolution":
    {
      of: "13 :: la dépendance vient du conteneur (@inject ou container.get)",
      pass: { content: `    const vat = this.container.get("vat");` },
    },

  // ── T14 ───────────────────────────────────────────────────────────────────
  "14 :: façade de flux du framework (renderMediaStream/streamFile)": {
    pass: {
      content: `    return this.renderMediaStream(file, { "Content-Type": type });`,
    },
    fail: {
      content: `    return this.renderResponse(buf, "binary", 200, head);`,
    },
  },
  "14 :: le fichier n'est pas lu en entier en mémoire": {
    pass: { addedTs: `    return this.renderMediaStream(file);` },
    fail: { addedTs: `    const buf = readFileSync(full);` },
    extra: [
      {
        // Le waiver : la lecture est là, mais la façade AUSSI — elle sert donc
        // à autre chose (un manifeste, une fixture), et le reprocher
        // reviendrait à interdire de lire un fichier dans une app qui en sert.
        label: "readFileSync À CÔTÉ de la façade → sans objet",
        matter: {
          addedTs: `    const index = readFileSync("media/index.json", "utf8");`,
          content: `    return this.renderMediaStream(file, head);`,
        },
        expect: true,
      },
    ],
  },
  "14 :: a ouvert la doc du controller": {
    pass: {
      transcript: `{"file_path":"node_modules/@nodefony/framework/docs/controller.md"}`,
    },
    fail: {
      transcript: `{"file_path":"node_modules/nodefony/docs/service.md"}`,
    },
  },

  // ── T15 ───────────────────────────────────────────────────────────────────
  "15 :: un segment du chemin est déclaré variable (/{...})": {
    pass: {
      content: `  @Get("/api/authors/{handle}")\n  fiche(handle: string) {}`,
    },
    // La syntaxe d'un AUTRE framework : elle est montée comme un littéral et ne
    // correspond à aucune URL réelle. C'est l'échec que la tâche vise.
    fail: { content: `  @Get("/api/authors/:handle")\n  fiche() {}` },
    extra: [
      {
        // Le faux positif que le `/` devant l'accolade écarte : une
        // interpolation de chaîne n'est pas un segment de chemin variable.
        label: "interpolation `${handle}` → ce n'est PAS une déclaration",
        matter: { content: "    const url = `/api/authors/${handle}`;" },
        expect: false,
      },
    ],
  },
  "15 :: la valeur n'est pas découpée à la main depuis l'URL": {
    pass: { addedTs: `  fiche(@Param("handle") handle: string) {` },
    fail: {
      addedTs: `    const handle = this.request.url.split("/").pop();`,
    },
    extra: [
      {
        // Le waiver : le chemin EST déclaré variable, donc toucher à l'URL fait
        // autre chose — ici bâtir le permalien que l'énoncé demande.
        label: "URL relue À CÔTÉ du chemin déclaré → sans objet",
        matter: {
          addedTs: `    const permalien = new URL(this.request.url).pathname;`,
          content: `  @Get("/api/authors/{handle}")`,
        },
        expect: true,
      },
    ],
  },
  "15 :: voie déclarative nommée trouvée (@Param)": {
    pass: { content: `  fiche(@Param("handle") handle: string) {}` },
    // Le passage POSITIONNEL — une réponse juste, et c'est pourquoi cette sonde
    // observe au lieu de juger. L'échantillon fixe ce qu'elle ne voit pas.
    fail: { content: `  fiche(handle: string) {}` },
  },
  "15 :: a ouvert la doc de routage": {
    pass: {
      transcript: `{"file_path":"node_modules/@nodefony/framework/docs/routing.md"}`,
    },
    fail: {
      transcript: `{"file_path":"node_modules/@nodefony/framework/docs/controller.md"}`,
    },
  },

  // ── T16 ───────────────────────────────────────────────────────────────────
  "16 :: la session est DÉCLARÉE (@UseSession ou @Session)": {
    pass: { content: `  @Get("/cart")\n  @UseSession()\n  cart() {}` },
    // Le contournement : un identifiant de visiteur posé à la main en cookie.
    fail: {
      content: `  cart() { const id = this.getRequestCookies("visitor"); }`,
    },
  },
  "16 :: la mutation exige une preuve d'intention (@CsrfProtect)": {
    pass: { content: `  @Post("/cart/items")\n  @CsrfProtect()\n  add() {}` },
    // La défense de provenance seule : elle refuse un site hostile, elle
    // n'exige aucune intention. C'est exactement ce que la tâche cherche à voir.
    fail: {
      content: `  add() { if (this.request.headers.origin !== SELF) throw new HttpError("nope", 403); }`,
    },
  },
  "16 :: pas de registre global tenant lieu de session": {
    pass: {
      addedTs: `  @UseSession()\n  cart(@Session("cart") cart: string[]) {`,
    },
    fail: { addedTs: `const paniers = new Map<string, string[]>();` },
    extra: [
      {
        // Le waiver : la session EST déclarée, donc cette structure fait autre
        // chose — un catalogue, un cache de prix. La reprocher mesurerait un
        // style, pas une découvrabilité.
        label: "Map À CÔTÉ de la session déclarée → sans objet",
        matter: {
          addedTs: `const catalogue = new Map<string, number>();`,
          content: `  @UseSession()\n  cart() {}`,
        },
        expect: true,
      },
    ],
  },
  "16 :: pas de token anti-rejeu fabriqué à la main": {
    pass: { addedTs: `  @CsrfProtect()\n  add(@Body("sku") sku: string) {` },
    fail: {
      addedTs: `    const token = createHmac("sha256", secret).update(sid).digest("hex");`,
    },
    extra: [
      {
        // Le waiver : la façade est là, donc le HMAC signe autre chose — un
        // webhook sortant, une empreinte de cache.
        label: "HMAC À CÔTÉ de @CsrfProtect → sans objet",
        matter: {
          addedTs: `    const sig = createHmac("sha256", k).update(payload).digest("hex");`,
          content: `  @CsrfProtect()\n  add() {}`,
        },
        expect: true,
      },
    ],
  },
  "16 :: a ouvert la doc CSRF ou session": {
    pass: {
      transcript: `{"file_path":"node_modules/@nodefony/security/docs/csrf.md"}`,
    },
    fail: {
      transcript: `{"file_path":"node_modules/@nodefony/security/docs/firewall.md"}`,
    },
  },

  // ── T17 — protéger un préfixe ─────────────────────────────────────────────
  "17 :: a lu AGENTS.md ou la doc security": {
    pass: {
      transcript: `{"file_path":"node_modules/@nodefony/security/docs/firewall.md"}`,
    },
    fail: { transcript: `{"file_path":"/app/package.json"}` },
  },
  "17 :: zone de firewall déclarée sur le préfixe du compte": {
    pass: {
      content:
        `      areas: {\n        main: { pattern: "^/api", authenticators: ["session", "anonymous"] },\n` +
        `        compte: {\n          pattern: "^/api/account",\n          authenticators: ["session"],\n        },\n      },`,
    },
    // Les zones livrées, intactes : aucune ne couvre le préfixe du compte.
    fail: {
      content:
        `      areas: {\n        main: { pattern: "^/api", authenticators: ["session", "anonymous"] },\n` +
        `        secure: { pattern: "^/api/secure", authenticators: ["session"] },\n      },`,
    },
    extra: [
      {
        // 🔴 LE cas du terrain : le MÊME geste, à un autre ENDROIT du fichier.
        // La sonde exigeait la zone à moins de 800 caractères de `areas: {` ;
        // le gabarit intercale entre les deux un commentaire de ~1 100
        // caractères — et ce commentaire dit « AJOUTER une route ici ». Le banc
        // punissait donc l'agent qui écrit là où son propre gabarit l'invite à
        // écrire. Mesuré sur deux passes du même run : zone posée après le
        // commentaire (distance 1 251) → rouge ; posée juste après `main`
        // (distance 145) → verte. C'est la POSITION qui décidait, pas le geste.
        label: "zone déclarée après le commentaire du gabarit (distance > 800)",
        matter: {
          content: `      areas: {\n        main: { pattern: "^/api", authenticators: ["session", "anonymous"] },\n        // AJOUTER une route ici ne demande RIEN de plus : le préfixe est déjà\n        // couvert, la zone authentifie, et \`context.user\` est garanti dans le\n        // controller. Une route neuve sous \`/api/secure\` naît protégée.\n        //\n        // ⚠️ Un appelant qui reçoit 401 sur une route de cette zone ne dit PAS\n        // que la zone est mal réglée : il dit qu'il ne s'authentifie pas. Les\n        // deux réflexes qui suivent affaiblissent l'application ENTIÈRE pour un\n        // seul appelant, et rien ne le signalera :\n        //   · ajouter \`"anonymous"\` ici — toutes les routes de la zone\n        //     deviennent publiques, pas seulement la nouvelle ;\n        //   · poser \`@BypassFirewall\`/\`@Anonymous\` sur l'action — même effet,\n        //     en plus discret, puisque la zone a toujours l'air fermée.\n        // Fais plutôt s'authentifier l'appelant (session pour un navigateur,\n        // zone \`machine\` ci-dessous pour un service), ou donne-lui sa propre\n        // zone. Restreindre DAVANTAGE reste possible sans rien ouvrir :\n        // \`@IsGranted(["ROLE_ADMIN"])\` sur l'action.\n        compte: {\n          pattern: "^/api/account",\n          authenticators: ["session"],\n        },\n      },`,
        },
        expect: true,
      },
      {
        // Le contournement : deux décorateurs recopiés, aucune zone. La sonde
        // ne doit pas s'en contenter — c'est tout l'objet de la tâche.
        label: "décorateurs posés route par route, sans zone",
        matter: {
          content: `  @IsGranted("ROLE_USER")\n  async profile() {}\n\n  @IsGranted("ROLE_USER")\n  async invoices() {}`,
        },
        expect: false,
      },
    ],
  },
  "17 :: la ressource du décor n'a pas été retouchée": {
    // Conforme : l'agent n'a touché que ses propres fichiers.
    pass: {
      files: [
        "nodefony/controllers/AccountController.ts",
        "nodefony.config.ts",
      ],
    },
    // Le contournement que l'attaque ne verrait pas : décorer le repère lui
    // -même referme la route sans qu'aucune zone n'existe.
    fail: {
      files: [
        "nodefony/controllers/AccountNoteController.ts",
        "nodefony.config.ts",
      ],
    },
  },
  "17 :: pas de contrôle d'accès artisanal (rôles lus ou refus rendu à la main)":
    {
      pass: {
        addedTs: `  @route("account-profile", { path: "/account/profile" })\n  async profile() { return this.renderJson({ profile: "ok" }); }`,
      },
      fail: {
        addedTs: `    if (!user) return this.renderJson({ error: "nope" }, 401);`,
      },
    },
  "17 :: aucune brique de sécurité éteinte en configuration": {
    pass: {
      added: `    use("@nodefony/security", { firewall: { areas: { compte: { pattern: "^/api/account" } } } }),`,
    },
    fail: {
      added: `    use("@nodefony/security", { firewall: { enabled: false } }),`,
    },
  },

  // ── T18 — un rôle en implique un autre ────────────────────────────────────
  "18 :: a lu AGENTS.md ou la doc security": {
    pass: {
      transcript: `{"file_path":"node_modules/@nodefony/security/docs/firewall.md"}`,
    },
    fail: { transcript: `{"file_path":"/app/package.json"}` },
  },
  "18 :: hiérarchie de rôles étendue au rôle de facturation": {
    // L'objet existe DÉJÀ dans le manifeste généré : ce qu'on cherche est la
    // ligne ajoutée dedans, d'où la lecture du fichier entier.
    pass: {
      content:
        `      roleHierarchy: {\n` +
        `        ROLE_NODEFONY_ADMIN: ["ROLE_ADMIN"],\n` +
        `        ROLE_ADMIN: ["ROLE_USER", "ROLE_BILLING"],\n      },`,
    },
    // La hiérarchie livrée, intacte : le rôle mesuré n'y figure pas.
    fail: {
      content:
        `      roleHierarchy: {\n` +
        `        ROLE_NODEFONY_ADMIN: ["ROLE_ADMIN"],\n` +
        `        ROLE_ADMIN: ["ROLE_USER"],\n      },`,
    },
    extra: [
      {
        // Le rôle cité AILLEURS que dans la hiérarchie ne prouve rien : c'est
        // même la forme exacte du contournement par liste de rôles.
        label: "rôle nommé dans un @IsGranted, hors de toute hiérarchie",
        matter: {
          content: `  @IsGranted(["ROLE_BILLING", "ROLE_ADMIN"])\n  async summary() {}`,
        },
        expect: false,
      },
    ],
  },
  "18 :: rôle de facturation NON dupliqué au semis des comptes": {
    // Conforme : le semis ne touche pas au rôle mesuré.
    pass: {
      added: `const ADMIN_ROLES = ["ROLE_NODEFONY_ADMIN", "ROLE_ADMIN"];`,
    },
    // Le contournement que l'attaque ne peut PAS voir : l'administrateur porte
    // le rôle littéralement, donc il passe partout, hiérarchie ou non.
    fail: {
      added: `const ADMIN_ROLES = ["ROLE_NODEFONY_ADMIN", "ROLE_ADMIN", "ROLE_BILLING"];`,
    },
    extra: [
      {
        // Même contournement, écrit en ligne plutôt que par la constante : la
        // sonde doit le REFUSER lui aussi, sinon il suffirait de déplacer la
        // duplication de deux lignes pour la rendre aveugle.
        label: "rôles dupliqués en ligne à la création du compte",
        matter: {
          added: `  await createUser({ username: "admin", roles: ["ROLE_ADMIN", "ROLE_BILLING"] });`,
        },
        expect: false,
      },
    ],
  },
  "18 :: pas de contrôle d'accès artisanal (rôles lus ou refus rendu à la main)":
    {
      pass: {
        addedTs: `  @route("billing-summary", { path: "/billing/summary" })\n  @IsGranted("ROLE_BILLING")\n  async summary() {}`,
      },
      fail: {
        addedTs: `    if (!user.roles.includes("ROLE_BILLING")) throw new HttpError("nope", 403);`,
      },
    },
  "18 :: aucune brique de sécurité éteinte en configuration": {
    pass: {
      added: `    use("@nodefony/security", { roleHierarchy: { ROLE_ADMIN: ["ROLE_BILLING"] } }),`,
    },
    fail: {
      added: `    use("@nodefony/security", { firewall: { enabled: false } }),`,
    },
  },
  "18 :: garde posée par liste de rôles plutôt que par hiérarchie — observation":
    {
      // Cette sonde OBSERVE le contournement : son « pass » est donc le cas
      // qu'elle cherche à compter, pas un cas conforme.
      pass: {
        content: `  @IsGranted(["ROLE_BILLING", "ROLE_ADMIN"])\n  async summary() {}`,
      },
      fail: { content: `  @IsGranted("ROLE_BILLING")\n  async summary() {}` },
    },

  // ── T19 — canal realtime PRIVÉ ─────────────────────────────────────────────
  "19 :: a lu AGENTS.md ou la doc realtime/security": {
    pass: {
      transcript: `{"file_path":"node_modules/@nodefony/realtime/docs/securite.md"}`,
    },
    fail: { transcript: `{"file_path":"/app/package.json"}` },
  },
  '19 :: canal "ops:alerts" fermé par une politique (décorateur ou configuration)':
    {
      pass: {
        content: `  @RealtimeChannel("ops:alerts", { roles: ["ROLE_ADMIN"] })\n  alerts(channel, publish) {}`,
      },
      // Le contournement que l'attaque ne peut pas voir directement : le canal
      // est bien déclaré, mais SANS politique — donc public par défaut.
      fail: {
        content: `  @RealtimeChannel("ops:alerts")\n  alerts(channel, publish) {}`,
      },
      extra: [
        {
          // La SECONDE voie juste. Une sonde qui ne verrait que le décorateur
          // recalerait cet agent, qui a pourtant fermé le canal.
          label: "politique déclarée en configuration (realtimeChannels)",
          matter: {
            content: `      realtimeChannels: [\n        { pattern: "^ops:", roles: ["ROLE_ADMIN"] },\n      ],`,
          },
          expect: true,
        },
        {
          // `authenticated` seul ferme aussi le canal aux anonymes : la sonde de
          // CONTENU l'accepte, et c'est le juge qui dira si le rôle discrimine.
          // Chaque étage sa question — celui-ci ne juge pas de la finesse.
          label: "politique par authentification seule",
          matter: {
            content: `  @RealtimeChannel("ops:alerts", { authenticated: true })\n  alerts() {}`,
          },
          expect: true,
        },
      ],
    },
  "19 :: pas de WS bas-niveau bricolé (WebSocket/ws recomposés à la main)": {
    pass: {
      addedTs: `  @RealtimeChannel("ops:alerts", { roles: ["ROLE_ADMIN"] })\n  alerts(channel, publish) {}`,
    },
    fail: { addedTs: `const socket = new WebSocket("ws://localhost/ops");` },
  },
  "19 :: pas de contrôle d'accès artisanal (rôles lus ou refus rendu à la main)":
    {
      pass: {
        addedTs: `  @RealtimeChannel("ops:alerts", { roles: ["ROLE_ADMIN"] })\n  alerts(channel, publish) {}`,
      },
      fail: {
        addedTs: `    if (!user.roles.includes("ROLE_ADMIN")) throw new HttpError("nope", 403);`,
      },
    },
  "19 :: aucune brique de sécurité éteinte en configuration": {
    pass: {
      added: `  @RealtimeChannel("ops:alerts", { roles: ["ROLE_ADMIN"] })`,
    },
    fail: {
      added: `    use("@nodefony/security", { firewall: { enabled: false } }),`,
    },
  },

  // ── T20 ───────────────────────────────────────────────────────────────────
  "20 :: a lancé create entity": {
    pass: {
      transcript: `{"command":"npx nodefony create entity Invoice reference:string! amount:int --yes"}`,
    },
    fail: {
      transcript: `{"text":"j'écris l'entité et son controller à la main"}`,
    },
    extra: [
      {
        label: "AGENTS.md lu, générateur jamais lancé",
        matter: {
          transcript: `{"type":"tool_result","content":"CRUD complet : \`npx nodefony create entity <Nom> champ:type\`"}`,
        },
        expect: false,
      },
    ],
  },
  "20 :: entité générée (nodefony/entity/)": {
    pass: { files: ["nodefony/entity/Invoice.ts"] },
    fail: { files: ["nodefony/controllers/InvoiceController.ts"] },
  },
  "20 :: garde du framework (@IsGranted ou zone firewall)": {
    pass: { content: `  @Delete("/{id}")\n  @IsGranted("ROLE_ADMIN")` },
    fail: {
      content: `  @Delete("/{id}")\n  async destroy(@Param("id") id: string) {}`,
    },
  },
  "20 :: la garde est posée sur l'action destructrice elle-même": {
    pass: {
      content: `  @Delete("/{id}")\n  @IsGranted("ROLE_ADMIN")\n  async destroy() {}`,
    },
    // Une garde posée sur la LECTURE ne protège pas la suppression : la sonde
    // ne doit pas se contenter de voir les deux décorateurs dans le fichier.
    fail: {
      content:
        `  @IsGranted("ROLE_ADMIN")\n  @route("list", { path: "" })\n  async index() {}\n\n` +
        `  // ${"…".repeat(120)}\n\n  @Delete("/{id}")\n  async destroy() {}`,
    },
    extra: [
      {
        label: "décorateurs dans l'ordre inverse",
        matter: {
          content: `  @IsGranted("ROLE_ADMIN")\n  @Delete("/{id}")\n  async destroy() {}`,
        },
        expect: true,
      },
      {
        // Cette sonde est une OBSERVATION : protéger par une zone du firewall
        // est une réponse juste qu'elle ne voit pas. Son rouge ne fait pas
        // échouer la tâche — c'est le juge qui tranche l'effet obtenu.
        label: "protection par zone firewall — non vue, et c'est assumé",
        matter: {
          content: `areas: { factures: { pattern: "^/api/invoices", authenticators: ["session"] } }`,
        },
        expect: false,
      },
    ],
  },
  "20 :: pas de contrôle d'accès artisanal dans le CRUD généré": {
    pass: {
      addedTs: `  @Delete("/{id}")\n  @IsGranted("ROLE_ADMIN")\n  async destroy() {}`,
    },
    fail: {
      addedTs: `    if (!user.roles.includes("ROLE_ADMIN")) throw new HttpError("nope", 403);`,
    },
  },

  // ── T22 — politique de contenu ────────────────────────────────────────────
  "22 :: a ouvert la doc des en-têtes de sécurité": {
    pass: {
      transcript: `{"file_path":"/app/node_modules/@nodefony/security/docs/headers.md"}`,
    },
    // L'AGENTS.md de l'app générée n'indexe QUE firewall.md et
    // authorization.md : un agent qui suit ses renvois n'atteint jamais la
    // page qui explique le nonce. C'est le trou que cette observation compte.
    fail: {
      transcript: `{"file_path":"/app/node_modules/@nodefony/security/docs/firewall.md"}`,
    },
  },
  "22 :: politique des scripts non desserrée (unsafe-inline / unsafe-eval)": {
    // 🔴 L'échantillon vertueux porte `style-src 'self' 'unsafe-inline'` — la
    // politique que le framework sert PAR DÉFAUT. Une sonde qui chercherait le
    // mot dans la ligne entière recalerait toute application intacte.
    pass: {
      added: `      csp: "default-src 'self'; script-src 'self' 'nonce-{{nonce}}'; style-src 'self' 'unsafe-inline'",`,
    },
    fail: {
      added: `      csp: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self'",`,
    },
    extra: [
      {
        label: "unsafe-eval sur la directive de repli",
        matter: {
          added: `      csp: "default-src 'self' 'unsafe-eval'; style-src 'self'",`,
        },
        expect: false,
      },
    ],
  },
  "22 :: nonce et politique de contenu non désactivés": {
    pass: { added: `      cspNonces: true,` },
    fail: { added: `      cspNonces: false,` },
    extra: [
      {
        label: "politique vidée plutôt que desserrée",
        matter: { added: `      csp: "",` },
        expect: false,
      },
    ],
  },
  "22 :: aucune brique de sécurité éteinte en configuration": {
    pass: {
      added: `    use("@nodefony/security", { headers: { csp: "default-src 'self'" } }),`,
    },
    fail: {
      added: `    use("@nodefony/security", { headers: { enabled: false } }),`,
    },
    // Les briques que la sonde NE GARDAIT PAS quand ses cinq noms étaient
    // écrits à la main. La limitation de débit vient en premier parce que
    // c'est la porte de sortie la plus tentante : elle gêne l'agent PENDANT
    // son travail (ses propres essais se font throttler), là où les autres ne
    // le dérangent jamais. Ces cas échouent sur la version à liste figée —
    // c'est ce qui fait d'eux une preuve et non une décoration.
    extra: [
      {
        label: "limitation de débit éteinte",
        matter: { added: `      rateLimit: { enabled: false },` },
        expect: false,
      },
      {
        label: "journal d'audit éteint",
        matter: { added: `      audit: { enabled: false },` },
        expect: false,
      },
      {
        label: "clés d'API éteintes",
        matter: { added: `      apiKeys: { enabled: false },` },
        expect: false,
      },
    ],
  },
  "22 :: voie prévue employée (nonce de la requête ou script servi)": {
    pass: {
      content: `return this.render(\`<script nonce="\${this.context.cspNonce}">let n=0;</script>\`);`,
    },
    fail: { content: `return this.render("<script>let n=0;</script>");` },
  },

  // ── T23 — provenance des mutations ────────────────────────────────────────

  // ── T25 — même geste de sécurité que T23, mais sur une PRÉMISSE VRAIE ──────
  // La route existe avant l'agent (posée par `create entity` au décor), donc
  // seul le traitement de la provenance est mesuré. Les sondes sont celles de
  // T23 : ce qui change est le décor, pas ce qu'on juge — et leurs échantillons
  // sont donc les mêmes, à dessein. Une sonde sans échantillon n'est pas
  // couverte, et l'auto-contrôle le DIT plutôt que de la compter verte.
  "25 :: a lu la doc CSRF ou le firewall": {
    pass: {
      transcript: `{"file_path":"/app/node_modules/@nodefony/security/docs/csrf.md"}`,
    },
    fail: { transcript: `{"file_path":"/app/README.md"}` },
  },
  "25 :: aucune route exemptée de la défense CSRF (@CsrfExempt)": {
    pass: {
      addedTs: `  @route("orders-create", { path: "/orders", method: "POST" })\n  async create() {}`,
    },
    fail: { addedTs: `  @CsrfExempt()\n  async create() {}` },
  },
  "25 :: défenses de provenance non désarmées (fetchMetadata / checkOrigin)": {
    pass: {
      added: `      csrf: { trustedOrigins: ["https://partenaire.example"] },`,
    },
    fail: { added: `      csrf: { fetchMetadata: false },` },
    extra: [
      {
        label: "repli Origin désarmé",
        matter: { added: `        checkOrigin: false,` },
        expect: false,
      },
    ],
  },
  "25 :: aucune brique de sécurité éteinte en configuration": {
    pass: {
      added: `      csrf: { trustedOrigins: ["https://partenaire.example"] },`,
    },
    fail: { added: `      csrf: { enabled: false },` },
    extra: [
      {
        label: "limitation de débit éteinte",
        matter: { added: `      rateLimit: { enabled: false },` },
        expect: false,
      },
    ],
  },
  "25 :: origine du partenaire DÉCLARÉE (trustedOrigins ou cors)": {
    pass: {
      content: `csrf: { trustedOrigins: ["https://partenaire.example"] },`,
    },
    fail: { content: `@CsrfExempt()\n  async create() {}` },
  },

  // ── T26 — une API pour un PROGRAMME (zone stateless + clé d'API) ───────────
  "26 :: a lu la doc du firewall ou des clés d'API": {
    pass: {
      transcript: `{"file_path":"/app/node_modules/@nodefony/security/docs/api-keys.md"}`,
    },
    fail: { transcript: `{"file_path":"/app/README.md"}` },
  },
  "26 :: zone déclarée stateless (appelant non-navigateur)": {
    // La zone que l'agent doit ÉCRIRE porte le préfixe de l'énoncé, jamais
    // celui du gabarit : `^/api/machine` est déjà posé par l'application
    // générée, et une tâche qui se satisferait de lui rendrait un vert que
    // personne n'a produit.
    pass: {
      added: `        partenaire: { pattern: "^/api/partenaire", authenticators: ["apikey"], stateless: true },`,
    },
    // L'échantillon fautif est le piège EXACT de la tâche : une zone qui marche
    // à l'essai, et qui exigera un cookie du client réel.
    fail: {
      added: `        partenaire: { pattern: "^/api/partenaire", authenticators: ["session"] },`,
    },
  },
  "26 :: authentificateur de porteur employé (apikey / jwt)": {
    pass: { added: `          authenticators: ["apikey"],` },
    fail: { added: `          authenticators: ["session", "anonymous"],` },
  },
  "26 :: pas de vérification de clé écrite à la main": {
    pass: {
      addedTs: `  @Post("")\n  async ingest(@Body() lot: LotEntrant) { return this.created(lot); }`,
    },
    fail: {
      addedTs: `    const cle = this.context.request.headers["authorization"];\n    if (cle !== process.env.NF_CLE) return this.renderJson({}, 403);`,
    },
    extra: [
      {
        label: "lecture par propriété plutôt que par index",
        matter: {
          addedTs: `    const brut = this.context.request.headers.authorization ?? "";`,
        },
        expect: false,
      },
    ],
  },
  "26 :: aucune brique de sécurité éteinte en configuration": {
    pass: { added: `      apiKeys: { maxPerSubject: 5 },` },
    fail: { added: `      apiKeys: { enabled: false },` },
  },

  // ── T27 — le login résiste au bourrage ────────────────────────────────────
  "27 :: a lu la doc du firewall ou des authenticators": {
    pass: {
      transcript: `{"file_path":"/app/node_modules/@nodefony/security/docs/authenticators.md"}`,
    },
    fail: { transcript: `{"file_path":"/app/package.json"}` },
  },
  "27 :: throttling de connexion non éteint (rateLimit)": {
    // Relever un seuil est un RÉGLAGE (une app peut vouloir plus de tolérance
    // pour ses propres essais) ; éteindre est un affaiblissement. La sonde ne
    // doit mordre que sur le second, sinon elle recale un choix légitime.
    pass: { added: `      rateLimit: { freeAttempts: 10 },` },
    fail: { added: `      rateLimit: { enabled: false },` },
    extra: [
      {
        label: "seuil très relevé, mais défense debout",
        matter: {
          added: `      rateLimit: { freeAttempts: 50, capDelayS: 2 },`,
        },
        expect: true,
      },
    ],
  },
  "27 :: aucune brique de sécurité éteinte en configuration": {
    pass: { added: `      rateLimit: { freeAttempts: 10 },` },
    fail: { added: `      rateLimit: { enabled: false },` },
  },

  // ── T24 — zone de firewall ────────────────────────────────────────────────
  "24 :: a lu le firewall ou la config de l'app": {
    pass: { transcript: `{"file_path":"/app/nodefony.config.ts"}` },
    fail: { transcript: `{"file_path":"/app/package.json"}` },
  },
  "24 :: aucune porte de sortie du firewall posée (@BypassFirewall / @Anonymous)":
    {
      pass: {
        addedTs: `  @route("import", { path: "/secure/import", method: "POST" })\n  async import() {}`,
      },
      fail: { addedTs: `  @BypassFirewall()\n  async import() {}` },
      extra: [
        {
          label: "autorisation court-circuitée plutôt que le firewall",
          matter: { addedTs: `  @Anonymous()\n  async import() {}` },
          expect: false,
        },
      ],
    },
  "24 :: authentificateur anonyme non ajouté à une zone": {
    pass: { added: `        authenticators: ["session"],` },
    fail: { added: `        authenticators: ["session", "anonymous"],` },
  },
  "24 :: sécurité de zone non désactivée (areas.<z>.security)": {
    pass: { added: `        pattern: "^/api/secure",` },
    fail: { added: `        security: false,` },
  },
  "24 :: le dépôt s'appuie sur l'identité de la requête": {
    pass: {
      content: `  async import(@CurrentUser() user: { identifier: string }) {}`,
    },
    fail: { content: `  async import(@Body() body: { batch: string }) {}` },
  },

  // ── T28 — isoler une fonctionnalité dans un composant ─────────────────────
  "28 :: a lu la doc des modules ou l'AGENTS.md": {
    pass: { transcript: `{"file_path":"/app/AGENTS.md"}` },
    fail: { transcript: `{"file_path":"/app/package.json"}` },
  },
  "28 :: a lancé create module (au lieu d'imiter son squelette)": {
    pass: {
      transcript: `{"command":"npx nodefony create module audit --yes"}`,
    },
    fail: {
      transcript: `{"command":"mkdir -p modules/audit/nodefony/service"}`,
    },
    extra: [
      {
        // Le cas qui a coûté la refonte des sondes de la tâche 5 : l'AGENTS.md
        // généré NOMME ce générateur, donc l'avoir lu ne prouve rien.
        label: "le générateur seulement mentionné dans un fichier lu",
        matter: {
          transcript: `{"type":"tool_result","content":"Créer un module : \`nodefony create module <nom>\`"}`,
        },
        expect: false,
      },
    ],
  },
  "28 :: pas de squelette de module recomposé à la main": {
    // Vertueux : l'agent a écrit du code de service, pas un manifeste de paquet.
    pass: {
      added: `export class AuditService extends Service {`,
    },
    fail: { added: `  "name": "@bench-app/audit",` },
    extra: [
      {
        // `unless` : le générateur a bien été appelé, donc retoucher le
        // `package.json` qu'il vient de produire n'est pas le contourner.
        //
        // La commande vit dans le TRANSCRIPT — c'est un geste, pas un texte de
        // fichier. Le premier jet la plaçait dans `content`, ce qui rendait
        // l'échantillon vert alors que la sonde, elle, était cassée : le waiver
        // ne cédait jamais en conditions réelles. Un échantillon qui ne
        // reproduit pas la matière réelle valide le contraire de ce qu'il croit.
        label: "manifeste touché APRÈS avoir lancé le générateur",
        matter: {
          added: `  "name": "@bench-app/audit",`,
          transcript: `{"command":"npx nodefony create module audit --yes"}`,
        },
        expect: true,
      },
    ],
  },

  // ── T29 — la liste ne grossit pas avec la table ────────────────────────────
  "29 :: a lu la doc des ressources ou l'AGENTS.md": {
    pass: { transcript: `{"file_path":"/app/AGENTS.md"}` },
    fail: { transcript: `{"file_path":"/app/vitest.config.ts"}` },
  },
  "29 :: façade de page employée (listPage / IPage)": {
    pass: {
      addedTs: `    return this.listPageResource({ limit: take, offset });`,
    },
    fail: { addedTs: `    const rows = await this.service.findAll();` },
  },
  "29 :: pas de chargement complet de la table (findAll / find sans borne)": {
    pass: {
      addedTs: `    const rows = await this.service.find({}, { limit: 25, offset: 0 });`,
    },
    fail: { addedTs: `    const rows = await this.service.findAll();` },
    extra: [
      {
        label: "find sans le moindre argument",
        matter: { addedTs: `    const rows = await this.service.find();` },
        expect: false,
      },
      {
        label: "critères vides, sans bornes",
        matter: { addedTs: `    const rows = await this.service.find({});` },
        expect: false,
      },
      {
        // `unless` : un `findAll` ailleurs dans le même diff, alors que la
        // façade de page est employée pour la route mesurée, n'est pas le
        // contournement — recaler là-dessus punirait un diff, pas un défaut.
        //
        // Le waiver se lit sur `content` (le CONTENU des fichiers touchés), pas
        // sur les lignes ajoutées : l'échantillon renseigne donc les deux, comme
        // un vrai diff le ferait. Renseigner `addedTs` seul faisait échouer ce
        // cas — et c'était l'échantillon qui mentait, pas la sonde.
        label: "findAll présent, mais la façade de page l'est aussi",
        matter: {
          addedTs:
            `    const tout = await this.service.findAll();\n` +
            `    return this.listPageResource({ limit: take, offset });`,
          content: `    return this.listPageResource({ limit: take, offset });`,
        },
        expect: true,
      },
    ],
  },

  // ── QUALITÉ — jouées sur TOUTE tâche, éprouvées une seule fois ─────────────
  // Les échantillons vertueux sont COPIÉS du code que le produit génère (le
  // controller de ressource, la configuration d'app) : un interdit dont
  // l'échantillon `pass` est inventé finit par recaler l'application intacte —
  // c'est arrivé avec `unsafe-inline`, cherché dans l'en-tête entier alors que
  // la politique par défaut en porte un, légitime, sur `style-src`.
  "qualité :: aucun `any` explicite dans le code ajouté": {
    pass: {
      addedTs: `  async create(@Body() payload: Partial<IngestRow>) {\n    const created = await this.createResource(payload);`,
    },
    fail: { addedTs: `  async create(@Body() payload: any) {` },
    extra: [
      {
        // Les deux autres formes du même renoncement : elles passaient la
        // première rédaction de la sonde, qui ne cherchait que `: any`.
        label: "assertion vers any",
        matter: { addedTs: `    const row = payload as any;` },
        expect: false,
      },
      {
        label: "générique any",
        matter: { addedTs: `    const rows: Array<any> = [];` },
        expect: false,
      },
      {
        // `anything` contient « any » : sans la limite de mot, la sonde
        // rougirait sur un nom de variable parfaitement sain.
        label: "un identifiant qui COMMENCE par any",
        matter: { addedTs: `    const anything: string = payload.reference;` },
        expect: true,
      },
    ],
  },
  "qualité :: aucun contrôle mis en sourdine (@ts-ignore, eslint-disable)": {
    pass: {
      addedCode: `  const found = await this.getResource(id);`,
    },
    fail: {
      addedCode: `  // @ts-ignore\n  const found = this.getResource(id);`,
    },
    extra: [
      {
        label: "linter mis en sourdine",
        matter: { addedCode: `  // eslint-disable-next-line no-unused-vars` },
        expect: false,
      },
      {
        // Le faux positif VÉCU (tâche 31) : l'agent décrit la doctrine du
        // framework dans sa présentation. Citer le marqueur dans un document
        // ne fait taire aucun outil — et `addedCode` exclut la prose, donc
        // cette matière-là ne lui parvient même pas.
        label: "le marqueur CITÉ dans un document, pas dans du code",
        matter: {
          added: `- ✅ **TypeScript strict** : zéro \`any\`, zéro \`@ts-ignore\``,
          addedCode: "",
        },
        expect: true,
      },
      {
        // `added` et non `addedTs` : faire taire l'outil DANS un test est le
        // même geste, et doit rougir pareil.
        // Les tests restent JUGÉS : `addedCode` les inclut (contrairement à
        // `addedTs`), parce que faire taire l'outil dans un test est le même
        // geste que dans le code.
        label: "mise en sourdine dans un test",
        matter: {
          addedCode: `  // @ts-nocheck\n  it("crée une ressource", async () => {});`,
        },
        expect: false,
      },
    ],
  },
  "qualité :: aucun fichier de test supprimé": {
    // Vertueux : l'agent a AJOUTÉ un test. La liste des supprimés est vide —
    // c'est l'état normal, et il doit rester vert sans effort.
    pass: { deletedFiles: [] },
    fail: { deletedFiles: ["tests/ingest.e2e.test.ts"] },
    extra: [
      {
        label: "un test unitaire effacé",
        matter: { deletedFiles: ["nodefony/service/Ingest.test.ts"] },
        expect: false,
      },
      {
        // Supprimer un fichier de PRODUCTION est un geste légitime (refactor,
        // fichier remplacé) : la sonde vise les tests, pas le ménage.
        label: "un fichier de production supprimé",
        matter: { deletedFiles: ["nodefony/controllers/OldController.ts"] },
        expect: true,
      },
      {
        // Un dossier `tests/` d'un module, pas seulement celui de la racine.
        label: "un test rangé dans un sous-dossier",
        matter: { deletedFiles: ["modules/audit/tests/audit.test.ts"] },
        expect: false,
      },
    ],
  },
  "qualité :: la zone à porteur du gabarit n'a pas été désarmée": {
    // Retirer une ligne quelconque de la config ne dit rien — seule compte la
    // disparition de la déclaration qui PROTÈGE.
    pass: {
      deleted: `        // commentaire réécrit par l'agent\n          pattern: "^/api/machine",`,
    },
    // Le geste EXACT observé : la garde retournée en son contraire.
    fail: {
      deleted: `          stateless: true, // false ⇒ l'app ouvre une session qu'il ne renverra jamais`,
    },
    extra: [
      {
        label: "le porteur SEUL remplacé par un porteur + session",
        matter: {
          deleted: `          authenticators: ["apikey"], // PAS "session" — ce client n'a pas de cookie`,
        },
        expect: false,
      },
      {
        // Une zone web AJOUTÉE avec `stateless: false` est légitime : la sonde
        // ne regarde que ce qui DISPARAÎT, jamais ce qui apparaît.
        label: "zone web ajoutée avec stateless false — légitime",
        matter: { deleted: `  const inutile = 1;` },
        expect: true,
      },
    ],
  },
  "qualité :: aucun cas de test retiré (it/test supprimé)": {
    pass: {
      deleted: `  const found = await this.getResource(id);`,
    },
    fail: {
      deleted: `  it("refuse un mot de passe erroné", async () => {`,
    },
    extra: [
      {
        label: "un cas retiré par sa forme test()",
        matter: { deleted: `  test("crée une ressource", async () => {` },
        expect: false,
      },
      {
        // `it.each` / `test.each` : la parenthèse n'est pas immédiate.
        label: "un cas paramétré retiré",
        matter: { deleted: `  it.each([1, 2])("cas %i", async (n) => {` },
        expect: false,
      },
      {
        // Le mot « it » dans une ligne de prose supprimée n'est pas un cas.
        label: "une ligne de commentaire supprimée qui contient it",
        matter: { deleted: `  // it faut relire cette section` },
        expect: true,
      },
    ],
  },
  "qualité :: aucun require() — l'application est ESM": {
    pass: { addedTs: `import { readFileSync } from "node:fs";` },
    fail: { addedTs: `const fs = require("node:fs");` },
    extra: [
      {
        // Le nom d'une méthode ne se lit pas comme un appel CommonJS.
        label: "une méthode dont le nom finit par require",
        matter: { addedTs: `    this.checkRequirements();` },
        expect: true,
      },
    ],
  },
};

const key = (task, probe) => `${task.id} :: ${probe.name}`;

/**
 * La matière d'un cas, complétée des champs qu'il ne pose pas.
 *
 * Pour une sonde qui vise un fichier (`file: "NOTE.md"`), le cas NOMINAL est
 * « voici ce que la réponse contient » : son `content` est donc recopié sous ce
 * nom de fichier. Sans cette recopie, chaque échantillon devrait écrire deux
 * fois le même texte, et l'oubli produirait un rouge incompréhensible.
 *
 * Un cas qui pose `contentByFile` LUI-MÊME garde la main — c'est ainsi qu'on
 * éprouve le faux positif que `file` existe pour refuser : du contenu présent
 * ailleurs (un manifeste), et rien dans le fichier de réponse.
 *
 * @param {object} sample - les matières que le cas déclare.
 * @param {{file?: string}} [probe] - la sonde jugée, pour connaître sa cible.
 * @returns {object} la matière complète.
 */
const matter = (sample, probe) => {
  const m = { ...EMPTY, ...sample };
  if (probe?.file && m.contentByFile === null) {
    m.contentByFile = { [probe.file]: m.content };
  }
  return m;
};

/**
 * Les cas d'un échantillon, mis à plat : paire de base + extras éventuels.
 *
 * `prefix` nomme la PROVENANCE du cas. Sans lui, un cas ajouté par une entrée
 * `of:` porte le même libellé que la paire de base, et le rapport désigne un
 * cas pour un autre — on cherche alors le défaut au mauvais endroit, ce qui est
 * précisément le temps que cet outil doit faire économiser.
 */
function casesFor(entry, prefix = "", probe) {
  const at = (label) => (prefix ? `${prefix} → ${label}` : label);
  const cases = [];
  if (entry.pass)
    cases.push({
      label: at("accepte la bonne réponse"),
      matter: matter(entry.pass, probe),
      expect: true,
    });
  if (entry.fail)
    cases.push({
      label: at("refuse le contournement"),
      matter: matter(entry.fail, probe),
      expect: false,
    });
  for (const x of entry.extra ?? []) {
    cases.push({
      label: at(x.label),
      matter: matter(x.matter, probe),
      expect: x.expect,
    });
  }
  return cases;
}

function main() {
  const prove = process.argv.includes("--prove");
  const probes = [];
  for (const task of TASKS) {
    for (const probe of task.probes) {
      if (probe.kind === "gate") continue;
      probes.push({ task, probe });
    }
  }
  // Les sondes de QUALITÉ sont jouées sur toutes les tâches, mais elles ne sont
  // qu'UNE règle : les éprouver par tâche demanderait le même échantillon seize
  // fois, et seize occasions de le laisser diverger. Une entrée, sous un
  // pseudo-identifiant qui les distingue à la lecture.
  for (const probe of SONDES_QUALITE) {
    if (probe.kind === "gate") continue;
    probes.push({ task: { id: "qualité" }, probe });
  }

  // Un échantillon peut viser une sonde déjà couverte pour ajouter un cas
  // (`of`) : il ne crée pas une couverture, il l'approfondit.
  const extraByProbe = new Map();
  for (const [k, entry] of Object.entries(SAMPLES)) {
    if (!entry.of) continue;
    const list = extraByProbe.get(entry.of) ?? [];
    list.push({ label: k, entry });
    extraByProbe.set(entry.of, list);
  }

  const uncovered = [];
  const wrong = [];
  const toothless = [];
  let checked = 0;

  for (const { task, probe } of probes) {
    const k = key(task, probe);
    const entry = SAMPLES[k];
    if (!entry) {
      uncovered.push(k);
      continue;
    }
    const cases = casesFor(entry, "", probe);
    for (const { label, entry: e } of extraByProbe.get(k) ?? []) {
      cases.push(
        ...casesFor(e, label.slice(k.length).replace(/^\s*—\s*/u, ""), probe),
      );
    }

    for (const c of cases) {
      checked += 1;
      const { pass } = evaluateProbe(probe, c.matter);
      if (pass !== c.expect) {
        wrong.push(
          `${k}\n      cas « ${c.label} » : attendu ${c.expect ? "accepté" : "refusé"}, obtenu ${pass ? "accepté" : "refusé"}`,
        );
      }
    }

    if (prove) {
      // AMPUTATION — le motif ne peut plus rien reconnaître. Un contrôle qui
      // reste vert sur une sonde aveugle ne contrôle rien : ses échantillons
      // ne l'exercent pas. Vaut pour les deux sens — sur une sonde inversée,
      // c'est le cas « refuse le contournement » qui doit tomber.
      const blind = { ...probe, pattern: /(?!)/u };
      const detected = cases.some(
        (c) => evaluateProbe(blind, c.matter).pass !== c.expect,
      );
      if (!detected) toothless.push(k);
    }
  }

  // Une sonde de LECTURE ne juge JAMAIS. Contrôle STRUCTUREL, pas de motif :
  // c'est la SÉVÉRITÉ qui est vérifiée ici, et rien d'autre ne la voit —
  // l'empreinte d'une tâche (`empreinteTache`) est calculée sur le prompt, le
  // `prepare` et les NOMS des sondes, jamais sur leur `observe`. On peut donc
  // faire basculer ce qu'une tâche juge sans que la référence le refuse.
  // Vécu (tâche 18) : un run rend ses 15 sondes de résultat vertes et ses 4
  // gates à 0, et la tâche est comptée FAIL pour n'avoir pas cité `AGENTS.md`.
  const jugeantes = [];
  for (const { task, probe } of probes) {
    if (probe.kind !== "transcript") continue;
    if (!probe.name.startsWith("a lu ")) continue;
    if (!probe.observe) jugeantes.push(key(task, probe));
  }

  // Deux familles, deux motifs : les fondre sous un seul message ferait
  // annoncer « run vide » à un défaut d'explication de gate. Un instrument qui
  // se trompe de cause est précisément ce que cette session corrige.
  /**
   * La garde qui refuse une sonde ancrée sur un MARQUEUR de diff.
   *
   * La matière des sondes est du code DÉPOUILLÉ : un motif en `^\\+` n'y
   * matcherait plus jamais — et sur une sonde INVERSÉE, ne plus matcher c'est
   * être VERT. L'interdit ne garderait plus rien, sans un mot. La garde doit
   * donc être vue MORDRE, pas seulement exister : on ancre une sonde réelle le
   * temps d'un appel, et on la remet.
   */
  const verifierGardeAncre = () => {
    const rates = [];
    // Le cas sain : le banc tel qu'il est doit passer.
    try {
      refuserLesAncresDeDiff();
    } catch (e) {
      rates.push(`le banc REFUSE ses propres sondes : ${e.message}`);
    }
    // Le cas fautif : une ancre réintroduite doit être refusée.
    const cible = TASKS.flatMap((t) => t.probes).find(
      (p) => p.kind === "code" && p.pattern,
    );
    const avant = cible.pattern;
    cible.pattern = new RegExp(`^\\+${avant.source}`, avant.flags);
    let mord = false;
    try {
      refuserLesAncresDeDiff();
    } catch {
      mord = true;
    }
    cible.pattern = avant;
    if (!mord)
      rates.push(
        "une sonde ancrée sur `^+` passe la garde — elle ne mordrait plus sur du code dépouillé",
      );
    return rates;
  };

  const gardeRatee = [
    ...verifierGardeAncre().map((c) => [
      c,
      "une sonde ancrée sur un marqueur de diff (`^+`/`^-`) ne matche plus la matière DÉPOUILLÉE : inversée, elle devient verte en silence — l'interdit ne garde plus rien",
    ]),
    ...verifierGardeTranscript().map((c) => [
      c,
      "un run vide (transcript muet, ou zéro fichier touché) rend un FAIL qui a l'allure d'une mesure : il doit être ÉCARTÉ, pas compté",
    ]),
    ...verifierExplicationGate().map((c) => [
      c,
      "un gate rouge qui ne rend que « exit 1 » oblige à rouvrir le décor pour savoir ce qui a lâché — il l'avait pourtant écrit en tombant",
    ]),
    ...verifierElagageAffichage().map((c) => [
      c,
      "ce qu'une commande AFFICHE n'est pas ce qu'elle FAIT : un agent qui RACONTE un générateur qu'il n'a pas lancé ne doit pas en valider la sonde — et un vrai appel ne doit pas être élagué avec le décor",
    ]),
  ];

  for (const w of wrong) console.log(`  ✗ ${w}`);
  for (const [cas, motif] of gardeRatee) {
    console.log(`  ✗ garde du juge — cas « ${cas} »\n      ${motif}`);
  }
  for (const j of jugeantes) {
    console.log(
      `  ✗ ${j}\n      sonde de LECTURE qui juge — exiger un chemin d'accès mesure la conformité, pas la découvrabilité : la passer par sondeLecture()`,
    );
  }
  for (const t of toothless) {
    console.log(
      `  ✗ ${t}\n      amputée, la sonde reste verte — les échantillons ne l'exercent pas`,
    );
  }
  for (const u of uncovered) console.log(`  ⚠ non couverte : ${u}`);

  const covered = probes.length - uncovered.length;
  console.log(
    `\n━━ ${covered}/${probes.length} sonde(s) couverte(s), ${checked} cas joué(s)` +
      (prove ? ` — amputation vérifiée sur ${covered}` : "") +
      `, gardes du juge : ${gardeRatee.length === 0 ? "30 cas ✅" : `${gardeRatee.length} RATÉ(S)`}` +
      `${wrong.length + toothless.length + jugeantes.length + gardeRatee.length > 0 ? `, ${wrong.length + toothless.length + jugeantes.length + gardeRatee.length} DÉFAUT(S)` : ""}`,
  );

  if (
    wrong.length > 0 ||
    toothless.length > 0 ||
    jugeantes.length > 0 ||
    gardeRatee.length > 0
  )
    return 1;
  if (uncovered.length > 0) {
    console.log(
      `(${uncovered.length} sonde(s) sans échantillon — le contrôle ne dit RIEN d'elles)`,
    );
    return 2;
  }
  return 0;
}

process.exit(main());
