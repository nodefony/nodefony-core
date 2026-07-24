#!/usr/bin/env node
/**
 * Banc de DÉCOUVRABILITÉ du devkit — les « 3 tâches » (gate de la release 10.0.0).
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
 *
 * Chaque tâche est déroulée par un agent en mode headless dans l'app témoin,
 * puis JUGÉE sur pièces — le transcript (a-t-il APPELÉ l'outil ?) et le diff
 * git (qu'a-t-il ÉCRIT ?). Aucun juge LLM : que des sondes objectives.
 *
 * Usage :
 *   node scripts/devkit-bench.mjs                # décor + 3 tâches + rapport
 *   node scripts/devkit-bench.mjs --task 2       # une seule tâche
 *   node scripts/devkit-bench.mjs --setup-only   # juste l'app témoin (--link)
 *   node scripts/devkit-bench.mjs --analyze-only tmp/devkit-bench/<run>
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

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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
 * Les 3 tâches — LIBELLÉS FIGÉS : reformuler une tâche change ce que le banc
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
        where: "content",
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
        where: "content",
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
      "aux abonnés, et documente en commentaire comment un client s'y abonne. Utilise ce que " +
      "le framework offre de plus haut niveau. Termine en prouvant que les tests de l'app passent.",
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
        where: "content",
        invert: true,
      },
      { kind: "gate", name: "npm test vert dans l'app", cmd: ["npm", "test"] },
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
    },
  );
  writeFileSync(transcriptPath, res.stdout ?? "");
  if (res.status !== 0) {
    console.log(`  ⚠️ agent sorti en ${res.status} (transcript conservé)`);
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
  const probes = task.probes.map((p) => {
    let pass = false;
    let evidence = "";
    if (p.kind === "transcript") {
      pass = p.pattern.test(transcript);
      evidence = pass ? "vu dans le transcript" : "absent du transcript";
    } else if (p.kind === "code") {
      const haystack = p.where === "files" ? files.join("\n") : content;
      const hit = p.pattern.test(haystack);
      pass = p.invert ? !hit : hit;
      evidence = `${files.length} fichier(s) touchés`;
    } else if (p.kind === "gate") {
      const r = spawnSync(p.cmd[0], p.cmd.slice(1), {
        cwd: app,
        encoding: "utf8",
        timeout: 300_000,
      });
      pass = r.status === 0;
      evidence = pass ? "exit 0" : `exit ${r.status}`;
    }
    console.log(`  ${pass ? "✅" : "❌"} ${p.name} (${evidence})`);
    return { name: p.name, kind: p.kind, pass, evidence };
  });
  const guessed = probes.filter((p) => !p.pass).length;
  const verdict = guessed === 0 ? "PASS" : "FAIL";
  console.log(
    `  → ${verdict} — ${guessed} sonde(s) rouge(s) sur ${probes.length}`,
  );
  return { id: task.id, name: task.name, verdict, guessed, probes };
}

function main() {
  const args = process.argv.slice(2);
  const only = args.includes("--task")
    ? Number(args[args.indexOf("--task") + 1])
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
  const tasks = TASKS.filter((t) => only === null || t.id === only);

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
