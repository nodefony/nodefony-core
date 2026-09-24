#!/usr/bin/env node
/**
 * session-resume.mjs — la reprise de session en UN appel, sortie bornée (~30 l).
 *
 * La reprise coûtait cinq ou six appels d'outils, dont des doublons (le lint du
 * tableau lancé deux fois), des lectures vides (`gh run list --commit` sur un
 * commit non poussé) et des sorties hors sujet (la table du jalon SUIVANT). Et
 * elle ratait trois contrôles que personne n'y faisait : la CI du dernier
 * commit, les commits non poussés, la fraîcheur des `dist`. Ce script les fait
 * tous, dans l'ordre où l'un éclaire l'autre, et DIT ce qu'il n'a pas vérifié.
 *
 * Il ne remplace pas la lecture du `_state` : il la désigne, et calcule le
 * garde-fou qui dit si elle est périmée (règles dans `session-lib.mjs`).
 *
 * @usage   npm run session:resume
 * @option  --offline   ne joint pas GitHub (empreinte du dernier END, datée)
 * @output  ~30 lignes ; code 0 toujours — c'est un état des lieux, pas un gate
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseNextTicket, openItemsOf } from "./board-next.mjs";
import {
  ciVerdict,
  clip,
  linksInSection,
  liveRetexThemes,
  modifiedOf,
  stateWrittenAt,
  newlyDone,
  uncitedWork,
} from "./session-lib.mjs";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
/** Dossier de mémoire de Claude Code : le chemin du projet, non-alphanumériques → `-`. */
const MEM = path.join(
  os.homedir(),
  ".claude",
  "projects",
  ROOT.replace(/[^a-zA-Z0-9]/gu, "-"),
  "memory",
);

const sh = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
  return {
    ok: r.status === 0,
    out: (r.stdout ?? "").trim(),
    err: (r.stderr ?? "").trim(),
  };
};
const git = (...args) => sh("git", args);
const out = [];
const say = (line = "") => out.push(line);

// ── 0. GitHub joignable ? Un seul sondage, qui gouverne tout le reste.
const online =
  !process.argv.includes("--offline") &&
  sh("gh", ["api", "rate_limit", "--jq", ".rate.remaining"], {
    timeout: 10_000,
  }).ok;

// ── 1. Git : branche, avance/retard, arbre.
if (online) git("fetch", "-q");
const branch = git("branch", "--show-current").out;
const ahead = git("rev-list", "--count", "@{u}..HEAD").out || "?";
const behind = git("rev-list", "--count", "HEAD..@{u}").out || "?";
const dirty = git("status", "--porcelain").out.split("\n").filter(Boolean);
const dirtyAi = dirty.filter((l) => l.slice(3).startsWith(".ai/")).length;
say(
  `Git ${branch} · non poussés ${ahead}${ahead !== "0" ? " ⚠️ (CI aveugle)" : ""} · en retard ${behind}` +
    ` · non commités ${dirty.length - dirtyAi}${dirtyAi ? ` (+${dirtyAi} .ai/)` : ""}`,
);

// ── 2. Mémoire : synchronisée d'abord (une session faite ailleurs), puis le dernier `_state`.
if (online && fs.existsSync(MEM)) {
  const pull = sh("git", ["-C", MEM, "pull", "-q", "--ff-only"], {
    timeout: 30_000,
  });
  if (!pull.ok)
    say(
      `⚠️ mémoire IA : pull refusé — ${clip(pull.err.split("\n")[0] ?? "", 70)}`,
    );
}
const states = fs.existsSync(MEM)
  ? fs
      .readdirSync(MEM)
      .filter((f) => /^project_session_.*_state\.md$/u.test(f))
      .sort()
  : [];
const stateFile = states.at(-1);
if (!stateFile) {
  say(
    "⚠️ aucun _state — reprendre sur le dernier retex de docs/session-retros/",
  );
} else {
  const text = fs.readFileSync(path.join(MEM, stateFile), "utf8");
  const since = stateWrittenAt({
    committedAt:
      git("-C", MEM, "log", "-1", "--format=%cI", "--", stateFile).out || null,
    modified: modifiedOf(text),
    mtime: fs.statSync(path.join(MEM, stateFile)).mtime.toISOString(),
  });
  say(
    `_state ${stateFile}${since ? ` (écrit ${since.slice(0, 16).replace("T", " ")})` : ""}`,
  );
  // ── 3. Garde-fou `_state` ↔ commits, CALCULÉ.
  if (since) {
    const commits = git("log", `--since=${since}`, "--format=%h%x09%s")
      .out.split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, ...rest] = l.split("\t");
        return { hash, subject: rest.join("\t") };
      });
    const missing = uncitedWork(commits, text);
    if (missing.length) {
      say(
        `🚨 _state PÉRIMÉ — ${missing.length} feat/fix postérieur(s) non cité(s) : la suite se lit sur eux`,
      );
      for (const c of missing.slice(0, 3))
        say(`   ${c.hash} ${clip(c.subject, 80)}`);
    }
  }
  const kits = linksInSection(text, "Reste");
  if (kits.length) say(`Kits cités au Reste : ${kits.slice(0, 5).join(", ")}`);
}

// ── 4. CI du dernier commit POUSSÉ (un commit non poussé n'a pas de CI).
if (online) {
  const shas = git("log", "@{u}", "-5", "--format=%H")
    .out.split("\n")
    .filter(Boolean);
  const runs = sh("gh", [
    "run",
    "list",
    "--branch",
    branch,
    "--limit",
    "40",
    "--json",
    "headSha,status,conclusion,workflowName",
  ]);
  const all = runs.ok ? JSON.parse(runs.out || "[]") : [];
  // Le dernier commit poussé peut n'avoir aucun run (`paths-ignore` sur la prose) :
  // on remonte au premier qui en a.
  const sha = shas.find((s) => all.some((r) => r.headSha === s));
  if (!sha) say("CI : aucun run sur les 5 derniers commits poussés");
  else {
    const v = ciVerdict(all.filter((r) => r.headSha === sha));
    const icon = {
      success: "✅",
      running: "⏳",
      failure: "❌",
      cancelled: "⚠️",
      none: "·",
    }[v.state];
    const detail = v.failed.length
      ? ` — rouge : ${v.failed.join(", ")}`
      : v.running.length
        ? ` — en cours : ${v.running.join(", ")}`
        : v.cancelled.length
          ? ` — ANNULÉ (job figé ?) : ${v.cancelled.join(", ")}`
          : "";
    say(`CI ${sha.slice(0, 8)} ${icon} ${v.state}${clip(detail, 80)}`);
  }
}

// ── 5. Empreinte du tableau : LA voie de lecture, rafraîchie si on peut.
const BOARD = path.join(ROOT, ".ai", "board.json");
if (online) {
  const snap = sh(
    process.execPath,
    [
      path.join(
        ROOT,
        ".claude/skills/nodefony-session/scripts/board-snapshot.mjs",
      ),
    ],
    { timeout: 120_000 },
  );
  if (!snap.ok)
    say(
      `⚠️ empreinte NON rafraîchie — ${clip((snap.err || snap.out).split("\n")[0], 80)}`,
    );
}
const board = JSON.parse(fs.readFileSync(BOARD, "utf8"));
const ageDays = Math.floor(
  (Date.now() - Date.parse(board.generatedAt)) / 86_400_000,
);
if (!online)
  say(
    `⚠️ GitHub injoignable — empreinte du ${board.generatedAt.slice(0, 10)} (il y a ${ageDays} j)`,
  );
const open = board.items.filter((i) => i.status !== "Done");
const choice = chooseNextTicket(open, board.milestones);
if (choice) {
  const ms = board.milestones.find((m) => m.title === choice.milestone);
  if (ms)
    say(
      `Jalon courant ${ms.title} : ${ms.open} ouverts / ${ms.closed} fermés · échéance ${ms.dueOn?.slice(0, 10) ?? "—"}`,
    );
  const [next, ...after] = openItemsOf(open, choice.milestone);
  say(
    `➡️ #${next.number} ${clip(next.title, 70)} · ordre ${next.ordre ?? "—"} · ${next.priorite ?? "—"}`,
  );
  for (const t of after.slice(0, 2))
    say(`   puis #${t.number} ${clip(t.title, 70)}`);
}

// ── 6. Fermés depuis le dernier END (empreinte commitée vs fraîche) — lisible hors ligne.
const committed = git("show", "HEAD:.ai/board.json");
if (committed.ok) {
  const done = newlyDone(JSON.parse(committed.out).items, board.items);
  if (done.length)
    say(
      `Fermés depuis la dernière empreinte : ${done.map((i) => `#${i.number}`).join(" ")}`,
    );
}

// ── 7. Lint du tableau, UNE fois.
if (online) {
  const lint = sh(
    process.execPath,
    [
      path.join(ROOT, ".claude/skills/nodefony-ticket/scripts/board-lint.mjs"),
      "--json",
    ],
    { timeout: 120_000 },
  );
  try {
    const { findings } = JSON.parse(lint.out);
    const errors = findings.filter((f) => f.severity === "erreur");
    const warns = findings.length - errors.length;
    say(
      `Tableau : ${errors.length} erreur(s), ${warns} avertissement(s)${errors.length ? " — à solder MAINTENANT" : ""}`,
    );
    for (const f of errors.slice(0, 3))
      say(`   [${f.code}] #${f.n} ${clip(f.message ?? "", 70)}`);
  } catch {
    say("⚠️ lint du tableau illisible — lancer `npm run ticket:lint`");
  }
}

// ── 8. Fraîcheur des `dist` et de l'installation — 1ʳᵉ cause d'échec de session.
const newestTs = (dir) => {
  let max = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (
        e.name === "node_modules" ||
        e.name === "dist" ||
        e.name.startsWith(".")
      )
        continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts"))
        max = Math.max(max, fs.statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return max;
};
const modules = [
  path.join(ROOT, "src", "nodefony"),
  ...["src/packages/@nodefony", "src/modules"].flatMap((base) => {
    const abs = path.join(ROOT, base);
    return fs.existsSync(abs)
      ? fs.readdirSync(abs).map((n) => path.join(abs, n))
      : [];
  }),
];
const stale = modules.filter((m) => {
  const dist = path.join(m, "dist", "index.js");
  return fs.existsSync(dist) && newestTs(m) > fs.statSync(dist).mtimeMs;
});
const lock = path.join(ROOT, "package-lock.json");
const installed = path.join(ROOT, "node_modules", ".package-lock.json");
const npmStale =
  fs.existsSync(installed) &&
  fs.statSync(lock).mtimeMs > fs.statSync(installed).mtimeMs;
say(
  stale.length || npmStale
    ? `⚠️ ${
        stale.length
          ? `dist périmé : ${stale
              .map((m) => path.basename(m))
              .slice(0, 5)
              .join(", ")}${stale.length > 5 ? "…" : ""} → npm run build`
          : ""
      }${npmStale ? " · package-lock plus récent que l'installation → npm install" : ""}`
    : "✅ dist et installation à jour",
);

// ── 9. Sas des retex : les TITRES des thèmes vivants — ce sont les règles.
const sas = path.join(ROOT, "docs", "session-retros", "RETEX.md");
if (fs.existsSync(sas)) {
  const live = liveRetexThemes(fs.readFileSync(sas, "utf8"));
  say(
    `Sas RETEX — ${live.length} thème(s) vivant(s) (n'ouvrir que celui qui touche le travail du jour) :`,
  );
  for (const t of live.slice(0, 6)) say(`   · ${clip(t, 84)}`);
}

console.log(out.join("\n"));
