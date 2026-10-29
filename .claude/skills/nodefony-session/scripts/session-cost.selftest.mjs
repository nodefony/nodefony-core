#!/usr/bin/env node
// Éprouve `session-cost.mjs --session` sur des transcripts FORGÉS : le principal et
// chaque sous-agent sur leur ligne, nommés par leur méta, une réponse répétée comptée
// une seule fois, le pic de contexte pris sur la plus grosse réponse, `fable` au tarif
// connu, et un préfixe ambigu refusé plutôt que deviné.
//
// `@usage` node .claude/skills/nodefony-session/scripts/session-cost.selftest.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { findSession, priceOf, summarizeSession } from "./session-cost.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "session-cost-"));
let echecs = 0;
const check = (ok, pourquoi, detail) => {
  if (!ok) echecs++;
  console.log(`${ok ? "✓" : "✗"} ${pourquoi}${ok ? "" : `\n    ${detail}`}`);
};
const reponse = (id, model, usage, sidechain = false) =>
  JSON.stringify({
    type: "assistant",
    isSidechain: sidechain,
    timestamp: "2026-10-29T10:00:00Z",
    message: { id, model, usage },
  });
const ecrire = (f, lignes) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `${lignes.join("\n")}\n`);
};

try {
  const proj = path.join(root, "-x-nodefony-core");
  const sid = "aaaa1111-session";
  ecrire(path.join(proj, `${sid}.jsonl`), [
    reponse("m1", "claude-opus-5-5", {
      input_tokens: 10,
      output_tokens: 100,
      cache_read_input_tokens: 1000,
    }),
    // la même réponse, répétée par le JSONL : comptée une fois
    reponse("m1", "claude-opus-5-5", {
      input_tokens: 10,
      output_tokens: 100,
      cache_read_input_tokens: 1000,
    }),
    reponse("m2", "claude-opus-5-5", {
      input_tokens: 0,
      output_tokens: 50,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 200,
    }),
  ]);
  const sub = path.join(proj, sid, "subagents", "agent-z.jsonl");
  ecrire(sub, [
    reponse(
      "s1",
      "claude-fable-5-1",
      { input_tokens: 0, output_tokens: 1_000_000, cache_read_input_tokens: 0 },
      true,
    ),
  ]);
  fs.writeFileSync(
    sub.replace(/\.jsonl$/, ".meta.json"),
    JSON.stringify({
      agentType: "Plan",
      description: "[fable] Siège contradicteur",
    }),
  );
  // une seconde session au même préfixe court : « aaaa » devient ambigu
  ecrire(path.join(proj, "aaaa2222-autre.jsonl"), [
    reponse("o1", "claude-haiku-5-5", { output_tokens: 1 }),
  ]);

  const r = await summarizeSession(root, "aaaa1111");
  const [principal, agent] = r.rows;
  check(
    r.rows.length === 2,
    "un principal et un sous-agent",
    `lignes : ${r.rows.length}`,
  );
  check(
    principal.msgs === 2,
    "réponse répétée comptée une fois",
    `réponses du principal : ${principal.msgs}`,
  );
  check(
    principal.peak === 5200,
    "pic = la plus grosse réponse (lu + écrit)",
    `pic : ${principal.peak}`,
  );
  check(
    agent.label === "[fable] Siège contradicteur (Plan)",
    "le sous-agent porte sa description et son type",
    `libellé : ${agent.label}`,
  );
  check(
    Math.abs(agent.cost - 50) < 1e-9,
    "fable au tarif connu (50 $/M en sortie)",
    `coût : ${agent.cost}`,
  );
  check(
    r.unknownModels.size === 0,
    "aucun tarif deviné",
    [...r.unknownModels].join(", "),
  );
  check(
    r.total.msgs === 3,
    "le total cumule principal et sous-agent",
    `total : ${r.total.msgs}`,
  );
  const opus41 = JSON.stringify(priceOf("claude-opus-4-1-20250805"));
  check(
    opus41 === "[15,75]",
    "date retirée, préfixe exact retenu",
    `tarif : ${opus41}`,
  );
  let refus = "";
  try {
    findSession(root, "aaaa");
  } catch (err) {
    refus = err instanceof Error ? err.message : String(err);
  }
  check(
    refus.includes("2 sessions"),
    "un préfixe ambigu est refusé",
    `message : ${refus || "aucun refus"}`,
  );
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log(
  echecs
    ? `\n✗ ${echecs} contrôle(s) rouge(s)`
    : "\n✓ session-cost : tous les contrôles verts",
);
process.exitCode = echecs ? 1 : 0;
