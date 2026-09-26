#!/usr/bin/env node
/**
 * session-end.mjs — la clôture de session en deux passes, mécanique d'un côté,
 * jugement de l'autre.
 *
 * La clôture était une page de 350 lignes que l'agent exécutait à la main : des
 * étapes écrites deux fois, une section qui contredisait la règle « retex sans
 * stats », une variable jamais définie, et des contrôles qu'on sautait parce
 * qu'ils coûtaient une commande chacun. Tout ce qui se compte passe ici ; ne
 * reste à l'agent que ce qu'aucun automate ne sait faire : fermer un ticket
 * avec son compte rendu, écrire le retex, la mémoire de reprise.
 *
 * Passe 1 — PRÉPARATION (défaut) : ce que la session a touché, les tickets à
 * fermer ou relire, le tableau contrôlé puis photographié, les chemins à écrire.
 * Passe 2 — `--verify` : un GATE, qui échoue tant que la clôture n'est pas
 * complète. On ne dit « session close » que sur son vert.
 *
 * @usage   npm run session:end                 # préparation
 * @usage   npm run session:end -- --verify     # gate de clôture (code 1 si incomplet)
 * @option  --since <rév>   début de la session (défaut : date du dernier `_state`)
 * @option  --no-publish    ne republie pas le README ni l'issue du tableau de bord
 * @output  ≤ 25 lignes en préparation ; la liste des manques en `--verify`
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dependentsOf } from "../../nodefony-ticket/scripts/dependents.mjs";
import {
  ciVerdict,
  clip,
  datesIn,
  modifiedOf,
  sessionLogArgs,
  stateWrittenAt,
  uncitedWork,
  nextStateName,
} from "./session-lib.mjs";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const MEM = path.join(
  os.homedir(),
  ".claude",
  "projects",
  ROOT.replace(/[^a-zA-Z0-9]/gu, "-"),
  "memory",
);
const argv = process.argv.slice(2);
const VERIFY = argv.includes("--verify");
const PUBLISH = !argv.includes("--no-publish");
const sinceAt = argv.indexOf("--since");

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return {
    ok: r.status === 0,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
  };
};
const git = (...a) => sh("git", a);
const node = (script, ...a) =>
  sh(process.execPath, [path.join(ROOT, ".claude/skills", script), ...a]);
const today = new Date().toLocaleDateString("sv-SE"); // AAAA-MM-JJ, heure locale

// ── Les `_state`, triés par NOM (`2026-09-24` < `2026-09-24b`). Plusieurs sessions
// par jour portent une lettre : « celui du jour » ne se reconnaît donc PAS au
// préfixe de date — `_2026-09-24b` contient `_2026-09-24`, et la session d'avant
// passait pour la nôtre. La règle est positionnelle : en préparation, le dernier
// `_state` est celui qui a OUVERT la session ; en vérification, la session vient
// d'écrire le sien, qui est donc le dernier, et celui qui l'a ouverte le précède.
const states = fs.existsSync(MEM)
  ? fs
      .readdirSync(MEM)
      .filter((f) => /^project_session_.*_state\.md$/u.test(f))
      .sort()
  : [];
const readMem = (f) => (f ? fs.readFileSync(path.join(MEM, f), "utf8") : "");
const closingState = VERIFY ? states.at(-1) : null;
const openingState = VERIFY ? states.at(-2) : states.at(-1);

// ── Plage de la session : `--since`, sinon l'instant où le `_state` qui l'ouvre a
// été écrit (cf `stateWrittenAt` : le commit du dépôt mémoire fait foi).
const writtenAt = (file) =>
  file
    ? stateWrittenAt({
        committedAt:
          sh("git", ["-C", MEM, "log", "-1", "--format=%cI", "--", file]).out ||
          null,
        modified: modifiedOf(readMem(file)),
        mtime: fs.statSync(path.join(MEM, file)).mtime.toISOString(),
      })
    : null;
const since = sinceAt !== -1 ? argv[sinceAt + 1] : writtenAt(openingState);
const { args: logArgs, anchored } = sessionLogArgs(since, (rev) => {
  const r = git("rev-parse", "--verify", "--quiet", `${rev}^{commit}`);
  return r.ok && r.out ? r.out : null;
});
const commits = git("log", ...logArgs, "--format=%h%x09%s")
  .out.split("\n")
  .filter(Boolean)
  .map((l) => {
    const [hash, ...s] = l.split("\t");
    return { hash, subject: s.join("\t") };
  });
const first = commits.at(-1)?.hash;
const range = first ? `${first}^..HEAD` : null;

if (VERIFY) verify();
else prepare();

function prepare() {
  const say = (l = "") => console.log(l);
  say(
    `Session : ${commits.length} commit(s) depuis ${since ?? "?"}${range ? ` (${range})` : ""}` +
      (anchored
        ? ""
        : " ⚠️ AUCUNE ancre : 20 derniers commits — passer `--since <rév>`"),
  );

  // Tickets cités par les commits de la session, et leur état.
  // Le corps compte autant que le sujet : `Refs #466` s'écrit en pied de message.
  const messages = range ? git("log", range, "--format=%B").out : "";
  const cited = [
    ...new Set([...messages.matchAll(/#(\d+)/gu)].map((m) => Number(m[1]))),
  ];
  const online = sh("gh", ["api", "rate_limit", "--jq", ".rate.remaining"], {
    timeout: 10_000,
  }).ok;
  if (!online)
    say(
      "⚠️ GitHub injoignable — tickets, lint et empreinte NON traités : relancer une fois en ligne",
    );
  if (online && cited.length) {
    const states = JSON.parse(
      sh("gh", [
        "issue",
        "list",
        "--state",
        "all",
        "--limit",
        "1000",
        "--json",
        "number,state,title",
      ]).out || "[]",
    );
    for (const n of cited) {
      const t = states.find((i) => i.number === n);
      say(
        `  #${n} ${t ? (t.state === "OPEN" ? "ouvert → à fermer (compte rendu) ou à commenter ?" : "fermé") : "?"} ${clip(t?.title ?? "", 60)}`,
      );
    }
  }
  // Voisins à relire : ceux qui citent les fichiers touchés, et ceux qui DÉPENDENT d'un ticket cité.
  if (online && range) {
    const touched = node(
      "nodefony-ticket/scripts/ticket-verify.mjs",
      "--touched-by",
      range,
    );
    const hits = touched.out
      .split("\n")
      .filter((l) => /^#\d+/u.test(l))
      .map((l) => l.split(/\s/u)[0]);
    say(
      `Tickets qui citent les fichiers touchés : ${hits.length ? `${hits.slice(0, 12).join(" ")}${hits.length > 12 ? ` … (+${hits.length - 12}, voir ticket-verify --touched-by ${range})` : ""}` : "aucun"}`,
    );
  }
  if (online && cited.length) {
    const open = JSON.parse(
      sh("gh", [
        "issue",
        "list",
        "--state",
        "open",
        "--limit",
        "1000",
        "--json",
        "number,title,body",
      ]).out || "[]",
    );
    for (const n of cited) {
      const { declared } = dependentsOf(open, n);
      if (declared.length)
        say(
          `  dépendent de #${n} : ${declared.map((t) => `#${t.number}`).join(" ")} — relire avant de fermer`,
        );
    }
  }
  // Tableau : contrôlé AVANT d'être photographié, puis vitrines.
  if (online) {
    const lint = node("nodefony-ticket/scripts/board-lint.mjs", "--json");
    try {
      const errors = JSON.parse(lint.out).findings.filter(
        (f) => f.severity === "erreur",
      );
      say(
        `Tableau : ${errors.length ? `❌ ${errors.map((f) => `[${f.code}] #${f.n}`).join(" ")} — solder AVANT l'empreinte` : "✅ cohérent"}`,
      );
      if (!errors.length) {
        const snap = node(
          "nodefony-session/scripts/board-snapshot.mjs",
          ...(PUBLISH ? ["--readme", "--issue"] : []),
        );
        say(
          snap.ok
            ? `Empreinte ${PUBLISH ? "+ README + issue " : ""}✅`
            : `⚠️ empreinte refusée — ${clip((snap.err || snap.out).split("\n")[0], 70)}`,
        );
      }
    } catch {
      say("⚠️ lint illisible — `npm run ticket:lint`");
    }
  }
  // Sas : seuil de graduation et taille.
  const sas = path.join(ROOT, "docs/session-retros/RETEX.md");
  const seuil = node("nodefony-session/scripts/retex-seuil.mjs");
  const lines = fs.existsSync(sas)
    ? fs.readFileSync(sas, "utf8").split("\n").length
    : 0;
  say(
    `Sas RETEX : ${lines} lignes${lines > 300 ? " (au-delà d'un écran → CONSOLIDATE à programmer)" : ""} · ${clip(seuil.out.split("\n")[0] ?? "", 70)}`,
  );
  // Chemins à écrire.
  const transcripts = path.dirname(MEM);
  const latest = fs.existsSync(transcripts)
    ? fs
        .readdirSync(transcripts)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({ f, t: fs.statSync(path.join(transcripts, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t)[0]?.f
    : null;
  say(
    `À écrire : docs/session-retros/${today}-${latest ? latest.slice(0, 8) : "<id>"}.md (≤ 30 l., sans stats)`,
  );
  say(
    `           ${path.join(MEM, nextStateName(states, today))} + son pointeur dans MEMORY.md`,
  );
  if (new Date().getHours() >= 22)
    say(
      "🌙 Tard : proposer le travail de nuit en attente (mémoires project_*_night_runs.md) — attendre le OUI",
    );
  say(
    "Puis : commit, push (dépôt + mémoire), et `npm run session:end -- --verify`.",
  );
}

function verify() {
  const fails = [];
  const warns = [];
  const dirty = git("status", "--porcelain").out;
  if (dirty)
    fails.push(
      `arbre non propre (${dirty.split("\n").length} entrée(s)) — commiter, .ai/ compris`,
    );
  const ahead = git("rev-list", "--count", "@{u}..HEAD").out;
  if (ahead !== "0") fails.push(`${ahead} commit(s) non poussé(s)`);
  const stateFile = closingState;
  if (!stateFile?.includes(`_${today}`))
    fails.push(`aucun _state du ${today} dans ${MEM}`);
  else {
    const missing = uncitedWork(commits, readMem(stateFile));
    if (missing.length)
      fails.push(
        `_state ${stateFile} ne cite pas : ${missing.map((c) => c.hash).join(" ")}`,
      );
    const index = fs.readFileSync(path.join(MEM, "MEMORY.md"), "utf8");
    if (!index.includes(stateFile))
      fails.push(`MEMORY.md ne pointe pas ${stateFile}`);
  }
  const retex = fs
    .readdirSync(path.join(ROOT, "docs/session-retros"))
    .filter((f) => f.startsWith(`${today}-`));
  if (!retex.length)
    fails.push(`aucun retex docs/session-retros/${today}-*.md`);
  // Anti-journal : dates AJOUTÉES par la session dans un MEMORY.md / CLAUDE.md du dépôt.
  if (range) {
    const diff = git(
      "diff",
      "-U0",
      range,
      "--",
      "*MEMORY.md",
      "*CLAUDE.md",
    ).out;
    const added = diff
      .split("\n")
      .filter((l) => l.startsWith("+") && !l.startsWith("+++"));
    const dated = added.flatMap(datesIn);
    if (dated.length)
      fails.push(
        `dates ajoutées dans MEMORY.md/CLAUDE.md : ${[...new Set(dated)].join(" ")} — ces fichiers décrivent le présent`,
      );
  }
  // Mémoire IA : sauvegardée (dépôt git de ~/.claude).
  const memDirty = sh("git", ["-C", MEM, "status", "--porcelain"]);
  if (memDirty.ok && memDirty.out) fails.push("mémoire IA non commitée");
  const memAhead = sh("git", ["-C", MEM, "rev-list", "--count", "@{u}..HEAD"]);
  if (memAhead.ok && memAhead.out !== "0")
    fails.push(`mémoire IA : ${memAhead.out} commit(s) non poussé(s)`);
  // CI du commit poussé : une information, un rouge est un manque.
  const runs = sh("gh", [
    "run",
    "list",
    "--commit",
    git("rev-parse", "HEAD").out,
    "--json",
    "status,conclusion,workflowName",
  ]);
  if (runs.ok) {
    const v = ciVerdict(JSON.parse(runs.out || "[]"));
    if (v.state === "failure") fails.push(`CI rouge : ${v.failed.join(", ")}`);
    else if (v.state === "running")
      warns.push(
        `CI en cours (${v.running.join(", ")}) — le prochain « session:resume » la relira`,
      );
  } else warns.push("CI non lue (GitHub injoignable)");

  for (const w of warns) console.log(`⏳ ${w}`);
  if (fails.length) {
    for (const f of fails) console.log(`❌ ${f}`);
    console.log(`\nClôture INCOMPLÈTE — ${fails.length} manque(s).`);
    process.exit(1);
  }
  console.log(
    "✅ Session close : arbre propre, poussé, _state et retex écrits, mémoire sauvegardée.",
  );
}
