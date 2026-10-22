/**
 * Auto-contrôle des grammaires de transcript.
 *
 * Ce que ce contrôle cherche VRAIMENT, et qui n'est pas « est-ce que ça
 * parse » : les deux fautes qui fabriquent un diagnostic faux.
 *
 * 1. **La CONFUSION de grammaire.** Reconnaître du Copilot comme du Claude ne
 *    lève aucune erreur : ça rend « 0 tour, 0 appel MCP », c'est-à-dire le
 *    symptôme exact d'une application devenue indécouvrable. Chaque dialecte
 *    est donc éprouvé contre l'échantillon de TOUS les autres — la seule forme
 *    qui morde.
 * 2. **Le ZÉRO qui se fait passer pour une mesure.** Codex ne publie pas de
 *    durée ; rendre `0` la ferait comparer à un run Claude. Le contrôle exige
 *    `null`, jamais `0`.
 *
 * S'y ajoute l'appariement : deux appels ENTRELACÉS, dont les retours arrivent
 * dans l'ordre inverse. Un appariement par proximité — « le retour suivant » —
 * attribuerait chaque sortie au mauvais geste et rendrait une timeline
 * parfaitement lisible et fausse.
 *
 * Les échantillons Copilot et vibe sont RÉELS, relevés sur des sessions
 * jouées ; les autres suivent la forme que le banc lit déjà en production
 * (cf `bench-discoverability.mjs`, d'où ces grammaires ont été extraites).
 *
 * Usage : `node lib/transcript-dialectes.selftest.mjs`
 * Sorties : `0` tout tient · `1` un écart.
 *
 * @module
 */
import {
  DIALECTES,
  PAR_NOM,
  argSaillant,
  detecterDialecte,
  exitDansTexte,
  lireReleve,
  lireTimeline,
  objetsJsonl,
} from "./transcript-dialectes.mjs";

let echecs = 0;
const dire = (ok, quoi, detail = "") => {
  if (!ok) echecs += 1;
  console.log(`${ok ? "✅" : "❌"} ${quoi.padEnd(56)} ${detail}`);
};

// ───────────────────────────────────────────────────────────────────────────
//  Échantillons — un par grammaire
// ───────────────────────────────────────────────────────────────────────────

/** Forme lue par le banc en production (stream-json du CLI claude). */
const CLAUDE = [
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: "Je regarde." },
        {
          type: "tool_use",
          id: "tu_1",
          name: "Bash",
          input: { command: "ls -la" },
        },
      ],
    },
  }),
  JSON.stringify({
    type: "user",
    message: {
      content: [
        { type: "tool_result", tool_use_id: "tu_1", content: "total 0" },
      ],
    },
  }),
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "tu_2",
          name: "mcp__nodefony__routes",
          input: {},
        },
      ],
    },
  }),
  JSON.stringify({
    type: "result",
    num_turns: 12,
    duration_ms: 45000,
    total_cost_usd: 0.31,
  }),
].join("\n");

/** RÉEL — `~/.copilot/session-state/<id>/events.jsonl`, session du 09-13. */
const COPILOT = [
  JSON.stringify({
    type: "tool.execution_start",
    timestamp: "2026-09-13T15:01:27.000Z",
    data: {
      toolCallId: "call_A",
      toolName: "bash",
      arguments: { command: "npm create nodefony@10.0.0-alpha.6" },
    },
  }),
  JSON.stringify({
    type: "tool.execution_complete",
    timestamp: "2026-09-13T15:01:30.000Z",
    data: {
      toolCallId: "call_A",
      success: true,
      result: {
        content:
          "create app : nom requis\n<shellId: 81 completed with exit code 64>",
      },
    },
  }),
  JSON.stringify({
    type: "assistant.turn_end",
    timestamp: "2026-09-13T15:01:31.000Z",
  }),
  JSON.stringify({
    type: "user.message",
    timestamp: "2026-09-13T15:26:01.000Z",
    data: { content: "moi rien ne marche" },
  }),
].join("\n");

/**
 * RÉEL — compagnon VS Code, session du 23/10 : un patch (argument = le patch
 * en CHAÎNE, retours à la ligne réels) et une attente `read_bash`, qui relève
 * un shell sans agir.
 */
const COPILOT_OUTILS = [
  JSON.stringify({
    type: "tool.execution_start",
    data: {
      toolCallId: "call_P",
      toolName: "apply_patch",
      arguments:
        '*** Begin Patch\n*** Add File: nodefony/entity/Message.ts\n+import { randomUUID } from "node:crypto";\n*** Update File: index.ts\n@@\n',
    },
  }),
  JSON.stringify({
    type: "tool.execution_start",
    data: {
      toolCallId: "call_R",
      toolName: "read_bash",
      arguments: { shellId: "31", delay: 8 },
    },
  }),
  JSON.stringify({ type: "assistant.turn_end" }),
].join("\n");

/** RÉEL — `~/.vibe/logs/session/<id>/messages.jsonl`, session du 09-13. */
const VIBE = [
  JSON.stringify({
    role: "assistant",
    injected: false,
    tool_calls: [
      {
        id: "Bb9QsBoRj",
        index: 0,
        type: "function",
        function: {
          name: "bash",
          arguments:
            '{"command": "npm create nodefony@10.0.0-alpha.6", "timeout": 120}',
        },
      },
    ],
  }),
  JSON.stringify({
    role: "tool",
    name: "bash",
    tool_call_id: "Bb9QsBoRj",
    content: "<tool_error>bash failed\nReturn code: 64\n",
  }),
].join("\n");

const CODEX = [
  JSON.stringify({ type: "item.completed", item: { type: "mcp_tool_call" } }),
  JSON.stringify({ type: "turn.completed" }),
  JSON.stringify({ type: "turn.completed" }),
].join("\n");

/**
 * Forme RÉELLE — `~/.codex/sessions/…/rollout-*.jsonl`, sessions des 13/10 et
 * 23/10 (CLI 0.162.1, 0.163.0), réduite : un appel qui échoue, un process
 * laissé en vol puis relevé par une ATTENTE, un patch, et les deux injections
 * du harness en rôle `user`.
 */
const exec = (id, script) =>
  JSON.stringify({
    timestamp: "2026-10-22T22:40:00.000Z",
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      call_id: id,
      name: "exec",
      input: script,
    },
  });
const sortie = (id, corps) =>
  JSON.stringify({
    timestamp: "2026-10-22T22:40:01.000Z",
    type: "response_item",
    payload: {
      type: "custom_tool_call_output",
      call_id: id,
      output: [
        {
          type: "input_text",
          text: "Script completed\nWall time 0.1 seconds\nOutput:\n",
        },
        { type: "input_text", text: JSON.stringify(corps) },
      ],
    },
  });
const message = (role, text) =>
  JSON.stringify({
    type: "response_item",
    payload: { type: "message", role, content: [{ type: "input_text", text }] },
  });
const evt = (payload) => JSON.stringify({ type: "event_msg", payload });
const CODEX_SESSION = [
  JSON.stringify({
    type: "session_meta",
    payload: { cwd: "/x/testharness-codex", cli_version: "0.163.0" },
  }),
  message(
    "user",
    "<environment_context>\n  <cwd>/x</cwd>\n</environment_context>",
  ),
  message("user", "# AGENTS.md instructions for /x\n\n<INSTRUCTIONS>…"),
  message("user", "Ce dossier est vide. Crée une application Nodefony."),
  message("assistant", "Je lance le générateur."),
  exec(
    "c1",
    'const r = await tools.exec_command({cmd:"npm create nodefony@beta ."}); text(r.output);\n',
  ),
  sortie("c1", { exit_code: 64, output: "create: name invalide « . »" }),
  exec(
    "c2",
    'const r = await tools.exec_command({cmd:"npm test","yield_time_ms":10000});\n',
  ),
  sortie("c2", { session_id: 71437, output: "RUN v4\n" }),
  exec(
    "c3",
    'const r = await tools.write_stdin({session_id:71437,chars:"",yield_time_ms:1000});\n',
  ),
  sortie("c3", { exit_code: 0, output: "Tests 19 passed" }),
  exec(
    "c4",
    'const patch = "*** Begin Patch\\n*** Update File: /x/nodefony/config/security.ts\\n@@"; await tools.apply_patch(patch);\n',
  ),
  evt({ type: "token_count", info: { total_token_usage: {} } }),
  evt({ type: "token_count", info: { total_token_usage: {} } }),
  evt({ type: "token_count", info: { total_token_usage: {} } }),
  evt({ type: "task_complete", duration_ms: 5000 }),
].join("\n");

const GEMINI = [
  JSON.stringify({
    type: "tool_use",
    tool_name: "nodefony_routes",
    args: { q: "chat" },
  }),
  JSON.stringify({ type: "result", stats: { duration_ms: 31000 } }),
].join("\n");

const AGY = [
  JSON.stringify({ event: "step_update", step_type: "agent_response" }),
  JSON.stringify({
    event: "result",
    result: { num_turns: 9, duration_seconds: 22.5 },
  }),
].join("\n");

const ECHANTILLONS = {
  claude: CLAUDE,
  copilot: COPILOT,
  vibe: VIBE,
  codex: CODEX,
  "codex-session": CODEX_SESSION,
  gemini: GEMINI,
  agy: AGY,
};

// ───────────────────────────────────────────────────────────────────────────
//  1. Reconnaissance — et surtout NON-reconnaissance des autres
// ───────────────────────────────────────────────────────────────────────────

console.log("\n— Reconnaissance de chaque grammaire —");
for (const [nom, texte] of Object.entries(ECHANTILLONS)) {
  const vu = detecterDialecte(texte);
  dire(
    vu?.nom === nom,
    `${nom} se reconnaît`,
    vu ? `→ ${vu.nom}` : "→ (aucun)",
  );
}

console.log("\n— Aucune grammaire ne revendique l'échantillon d'une autre —");
for (const d of DIALECTES) {
  for (const [nom, texte] of Object.entries(ECHANTILLONS)) {
    if (nom === d.nom) continue;
    const revendique = objetsJsonl(texte).filter(({ o }) => {
      try {
        return d.reconnait(o);
      } catch {
        return false;
      }
    }).length;
    if (revendique > 0)
      dire(false, `${d.nom} revendique du ${nom}`, `${revendique} ligne(s)`);
  }
}
dire(true, "confusion croisée", "(aucune ci-dessus = pas de recouvrement)");

// ───────────────────────────────────────────────────────────────────────────
//  2. Relevé — `null` n'est pas `0`
// ───────────────────────────────────────────────────────────────────────────

console.log("\n— Relevé d'effort —");
const rClaude = lireReleve(CLAUDE);
dire(rClaude?.tours === 12, "claude : tours", `${rClaude?.tours}`);
dire(rClaude?.dureeMs === 45000, "claude : durée", `${rClaude?.dureeMs} ms`);
dire(rClaude?.coutUsd === 0.31, "claude : coût", `${rClaude?.coutUsd} $`);
dire(rClaude?.mcpCalls === 1, "claude : appels MCP", `${rClaude?.mcpCalls}`);

const rCopilot = lireReleve(COPILOT);
dire(rCopilot?.tours === 1, "copilot : tours", `${rCopilot?.tours}`);
dire(
  rCopilot?.dureeMs ===
    Date.parse("2026-09-13T15:26:01.000Z") -
      Date.parse("2026-09-13T15:01:27.000Z"),
  "copilot : durée déduite des bornes",
  `${rCopilot?.dureeMs} ms`,
);
dire(
  rCopilot?.coutUsd === null,
  "copilot : coût NULL (nano-AIU, pas des dollars)",
  `${rCopilot?.coutUsd}`,
);

const rCodex = lireReleve(CODEX);
dire(rCodex?.tours === 2, "codex : tours", `${rCodex?.tours}`);
dire(
  rCodex?.dureeMs === null,
  "codex : durée NULL, jamais 0",
  `${rCodex?.dureeMs}`,
);
dire(
  rCodex?.coutUsd === null,
  "codex : coût NULL, jamais 0",
  `${rCodex?.coutUsd}`,
);
dire(
  rCodex?.mcpCalls === 1,
  "codex : appel MCP compté une SEULE fois",
  `${rCodex?.mcpCalls}`,
);

const rSession = lireReleve(CODEX_SESSION);
dire(
  rSession?.tours === 3,
  "codex-session : tours = réponses du modèle",
  `${rSession?.tours}`,
);
dire(
  rSession?.dureeMs === 5000,
  "codex-session : durée = somme des tâches qu'il mesure",
  `${rSession?.dureeMs} ms`,
);
dire(
  rSession?.attentes === 1,
  "codex-session : attentes comptées À PART",
  `${rSession?.attentes}`,
);
dire(
  rSession?.coutUsd === null,
  "codex-session : coût NULL, jamais 0",
  `${rSession?.coutUsd}`,
);
dire(
  rClaude?.attentes === null,
  "claude : attentes NULL (n'en émet pas)",
  `${rClaude?.attentes}`,
);

const rGemini = lireReleve(GEMINI);
dire(
  rGemini?.tours === null,
  "gemini : tours NULL (non émis)",
  `${rGemini?.tours}`,
);
dire(rGemini?.dureeMs === 31000, "gemini : durée", `${rGemini?.dureeMs} ms`);
dire(rGemini?.mcpCalls === 1, "gemini : appel MCP", `${rGemini?.mcpCalls}`);

const rAgy = lireReleve(AGY);
dire(rAgy?.tours === 9, "agy : tours", `${rAgy?.tours}`);
dire(
  rAgy?.dureeMs === 22500,
  "agy : durée convertie des SECONDES",
  `${rAgy?.dureeMs} ms`,
);

dire(lireReleve("") === null, "transcript vide → null (pas un relevé à zéro)");
dire(lireReleve('{"type":"assistant"') === null, "transcript illisible → null");

// ───────────────────────────────────────────────────────────────────────────
//  3. Appariement — deux appels ENTRELACÉS, retours en ordre inverse
// ───────────────────────────────────────────────────────────────────────────

console.log("\n— Appariement appel ↔ retour —");
const ENTRELACE = [
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "A",
          name: "Bash",
          input: { command: "echo un" },
        },
        {
          type: "tool_use",
          id: "B",
          name: "Bash",
          input: { command: "echo deux" },
        },
      ],
    },
  }),
  // Les retours arrivent DANS L'ORDRE INVERSE — c'est le cas qui piège un
  // appariement par proximité.
  JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "B", content: "deux" }],
    },
  }),
  JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: "A", content: "un" }],
    },
  }),
].join("\n");

const tl = lireTimeline(ENTRELACE);
const pasA = tl?.pas.find((p) => p.arg === "echo un");
const pasB = tl?.pas.find((p) => p.arg === "echo deux");
dire(
  pasA?.sortie === "un",
  "l'appel A reçoit la sortie de A",
  `« ${pasA?.sortie} »`,
);
dire(
  pasB?.sortie === "deux",
  "l'appel B reçoit la sortie de B",
  `« ${pasB?.sortie} »`,
);

const ORPHELIN = JSON.stringify({
  type: "assistant",
  message: {
    content: [
      {
        type: "tool_use",
        id: "Z",
        name: "Bash",
        input: { command: "sleep 99" },
      },
    ],
  },
});
const tlOrph = lireTimeline(ORPHELIN);
dire(
  tlOrph?.pas.length === 1 && tlOrph.pas[0].sortie === "",
  "un appel SANS retour reste dans le déroulé (agent coupé en vol)",
);

console.log("\n— Déroulé des grammaires tierces —");
const tlCop = lireTimeline(COPILOT);
dire(
  tlCop?.pas.length === 1,
  "copilot : 1 pas apparié",
  `${tlCop?.pas.length}`,
);
dire(
  tlCop?.pas[0].exit === 64,
  "copilot : exit lu dans la sortie",
  `${tlCop?.pas[0].exit}`,
);
dire(
  tlCop?.pas[0].arg === "npm create nodefony@10.0.0-alpha.6",
  "copilot : argument saillant = la commande",
);
dire(
  tlCop?.paroles.some((g) => g.texte === "moi rien ne marche"),
  "copilot : les messages du user ressortent",
);

const tlCopOutils = lireTimeline(COPILOT_OUTILS, { dialecte: "copilot" });
dire(
  tlCopOutils?.pas.find((p) => p.outil === "apply_patch")?.arg ===
    "nodefony/entity/Message.ts index.ts",
  "copilot : un patch se lit par ses fichiers",
  `« ${tlCopOutils?.pas.find((p) => p.outil === "apply_patch")?.arg?.slice(0, 60)} »`,
);
dire(
  tlCopOutils?.pas.some((p) => p.outil === "attente") &&
    !tlCopOutils.pas.some((p) => p.outil === "read_bash"),
  "copilot : read_bash est une ATTENTE, pas un geste",
);
dire(
  lireReleve(COPILOT_OUTILS, { dialecte: "copilot" })?.attentes === 1,
  "copilot : attentes comptées À PART",
  `${lireReleve(COPILOT_OUTILS, { dialecte: "copilot" })?.attentes}`,
);

const tlVibe = lireTimeline(VIBE);
dire(tlVibe?.pas.length === 1, "vibe : 1 pas apparié", `${tlVibe?.pas.length}`);
dire(
  tlVibe?.pas[0].exit === 64,
  "vibe : exit lu dans la sortie",
  `${tlVibe?.pas[0].exit}`,
);
dire(
  tlVibe?.pas[0].ok === false,
  "vibe : <tool_error> vaut échec",
  `${tlVibe?.pas[0].ok}`,
);

const tlSession = lireTimeline(CODEX_SESSION);
const pasDe = (outil) => tlSession?.pas.filter((p) => p.outil === outil) ?? [];
dire(
  pasDe("exec_command")[0]?.exit === 64,
  "codex-session : exit lu dans le JSON imbriqué",
  `${pasDe("exec_command")[0]?.exit}`,
);
dire(
  pasDe("exec_command")[1]?.exit === null,
  "codex-session : process EN VOL → exit null, jamais 0",
  `${pasDe("exec_command")[1]?.exit}`,
);
dire(
  pasDe("attente")[0]?.arg === "↳ npm test",
  "codex-session : l'attente hérite de la commande qu'elle relève",
  `« ${pasDe("attente")[0]?.arg} »`,
);
dire(
  pasDe("attente")[0]?.exit === 0 &&
    pasDe("attente")[0]?.sortie === "Tests 19 passed",
  "codex-session : l'attente porte la fin du process",
);
dire(
  pasDe("apply_patch")[0]?.arg === "/x/nodefony/config/security.ts",
  "codex-session : un patch se lit par ses fichiers",
  `« ${pasDe("apply_patch")[0]?.arg} »`,
);
const humains = tlSession?.paroles.filter((g) => g.nature === "user") ?? [];
dire(
  humains.length === 1 && humains[0].texte.startsWith("Ce dossier est vide"),
  "codex-session : contexte et AGENTS.md injectés ≠ messages humains",
  `${humains.length} message(s)`,
);

console.log("\n— Limites DÉCLARÉES (ce qu'on ne sait pas lire, on le dit) —");
for (const nom of ["codex", "agy"])
  dire(
    PAR_NOM[nom].timeline === "non observée",
    `${nom} : déroulé annoncé « non observée »`,
    PAR_NOM[nom].timeline,
  );
dire(
  PAR_NOM.gemini.timeline === "partielle",
  "gemini : déroulé annoncé « partielle »",
  PAR_NOM.gemini.timeline,
);
dire(lireTimeline(CODEX)?.pas.length === 0, "codex : aucun pas inventé");

// ───────────────────────────────────────────────────────────────────────────
//  4. Helpers
// ───────────────────────────────────────────────────────────────────────────

console.log("\n— Helpers —");
dire(
  exitDansTexte("<shellId: 83 completed with exit code 1>") === 1,
  "exit : forme copilot",
);
dire(exitDansTexte("Return code: 64") === 64, "exit : forme vibe");
dire(exitDansTexte("exit_code: 0") === 0, "exit : forme vibe (bloc structuré)");
dire(exitDansTexte("rien à signaler") === null, "exit : absent → null");
dire(argSaillant({ command: "ls" }) === "ls", "arg : command l'emporte");
dire(
  argSaillant('{"file_path":"/x/y.ts"}') === "/x/y.ts",
  "arg : JSON en chaîne",
);
dire(
  objetsJsonl('{"a":1}\nPAS DU JSON\n{"b":2}').length === 2,
  "jsonl : une ligne illisible n'emporte pas les autres",
);

console.log(
  `\n${echecs === 0 ? "✅ toutes les grammaires tiennent" : `❌ ${echecs} écart(s)`}`,
);
process.exit(echecs === 0 ? 0 : 1);
