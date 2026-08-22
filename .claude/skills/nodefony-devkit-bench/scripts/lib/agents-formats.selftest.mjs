/**
 * Selftest des TROIS grammaires de transcript — Claude, Codex, Gemini.
 *
 * 🔴 **Pourquoi ce fichier existe.** Un agent qui se sert de la porte MCP et un
 * agent qui ne l'a jamais eue rendent, pour un banc qui ne connaît qu'une
 * grammaire, exactement le même relevé : « zéro appel MCP ». Or c'est un
 * symptôme que ce banc apprend à lire comme « il n'a pas eu d'outils » — donc
 * une grammaire manquante ne produit pas une mesure absente, elle produit un
 * DIAGNOSTIC FAUX. Même chose pour la garde « l'agent a-t-il parlé ? » : elle
 * arrête la passe, et un run Codex parfait serait déclaré muet.
 *
 * Les formes ne sont pas devinées d'un transcript observé, elles viennent du
 * SOURCE de chaque agent :
 *
 * | Agent  | Tour d'agent                     | Appel MCP                              | Source |
 * | ------ | -------------------------------- | -------------------------------------- | ------ |
 * | Claude | `type: assistant`                | bloc `tool_use`, `name: mcp__…`        | mesuré |
 * | Codex  | item `agent_message`             | item `mcp_tool_call` (`server`+`tool`) | `sdk/typescript/src/items.ts` |
 * | Gemini | `type: message`, `role: assistant` | `type: tool_use`, `tool_name: <srv>_<outil>` | `packages/core/src/output/types.ts` |
 *
 * Le séparateur de Gemini est `_`, jamais `mcp__`
 * (`MCP_QUALIFIED_NAME_SEPARATOR`, `packages/core/src/tools/mcp-tool.ts`).
 *
 * Usage : `node agents-formats.selftest.mjs`
 *
 * @module
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  appelOutilMcp,
  gesteParCommandeOuMcp,
  lireEffort,
  transcriptExploitable,
} from "../bench-discoverability.mjs";

let echecs = 0;

/**
 * @param {string} nom - ce qu'on éprouve.
 * @param {boolean} vrai - le fait constaté.
 * @param {string} [detail] - ce qu'on a vu, quand c'est faux.
 */
function verifier(nom, vrai, detail = "") {
  if (vrai) {
    process.stdout.write(`  ✓ ${nom}\n`);
    return;
  }
  echecs += 1;
  process.stdout.write(`  ✗ ${nom}${detail ? ` — ${detail}` : ""}\n`);
}

/** Un transcript écrit sur disque, puis lu par `lireEffort`. */
function effortDe(lignes) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "formats-"));
  const f = path.join(dir, "t.jsonl");
  try {
    writeFileSync(f, lignes.map((l) => JSON.stringify(l)).join("\n"), "utf8");
    return lireEffort(f);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// ─── Les trois transcripts, réduits à ce qui compte ──────────────────────────

const CLAUDE = [
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          name: "mcp__nodefony__nodefony_inspect",
          input: {},
        },
      ],
    },
  },
  { type: "result", num_turns: 4, duration_ms: 1200, total_cost_usd: 0.01 },
];

const CODEX = [
  { type: "thread.started", thread_id: "x" },
  { type: "turn.started" },
  {
    type: "item.completed",
    item: {
      id: "i1",
      type: "mcp_tool_call",
      server: "nodefony",
      tool: "nodefony_inspect",
      status: "completed",
    },
  },
  {
    type: "item.completed",
    item: { id: "i2", type: "agent_message", text: "145 routes" },
  },
  {
    type: "turn.completed",
    usage: { input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 5 },
  },
];

const GEMINI = [
  { type: "init", session_id: "s" },
  {
    type: "tool_use",
    tool_name: "nodefony_nodefony_inspect",
    tool_id: "t1",
    parameters: {},
  },
  { type: "message", role: "assistant", content: "145 routes" },
  { type: "result", status: "success", stats: { duration_ms: 900 } },
];

// ─── Le compteur d'appels MCP voit-il les trois ? ─────────────────────────────

for (const [nom, lignes] of [
  ["claude", CLAUDE],
  ["codex", CODEX],
  ["gemini", GEMINI],
]) {
  const e = effortDe(lignes);
  verifier(
    `${nom} : l'appel MCP est COMPTÉ (1)`,
    e?.mcpCalls === 1,
    `mcpCalls=${e?.mcpCalls}`,
  );
}

// 🔴 Le contre-exemple, sans lequel le compteur pourrait tout compter : un appel
// d'outil qui n'est PAS servi par la porte ne doit rien ajouter.
{
  const e = effortDe([
    {
      type: "assistant",
      message: { content: [{ type: "tool_use", name: "Bash", input: {} }] },
    },
    {
      type: "item.completed",
      item: { id: "i", type: "command_execution", command: "ls" },
    },
    { type: "tool_use", tool_name: "read_file", tool_id: "t", parameters: {} },
  ]);
  // `null` est la réponse JUSTE ici : rien d'observable n'a été émis (aucun tour
  // achevé, aucun appel de porte). Ce qui doit être vrai, c'est qu'AUCUN appel
  // MCP n'a été compté — pas qu'un relevé existe.
  verifier(
    "un outil NON-MCP n'est jamais compté, dans aucune grammaire",
    e === null || e.mcpCalls === 0,
    JSON.stringify(e),
  );
}

// Codex répète son item au fil de son cycle : `item.started` ne doit pas
// compter, sinon un appel unique en vaudrait deux.
{
  const e = effortDe([
    {
      type: "item.started",
      item: { id: "i1", type: "mcp_tool_call", server: "nodefony", tool: "x" },
    },
    {
      type: "item.completed",
      item: { id: "i1", type: "mcp_tool_call", server: "nodefony", tool: "x" },
    },
  ]);
  verifier(
    "codex : un appel n'est compté qu'à son ACHÈVEMENT",
    e?.mcpCalls === 1,
    `mcpCalls=${e?.mcpCalls}`,
  );
}

// ─── L'effort, quand l'agent en émet ─────────────────────────────────────────

{
  const c = effortDe(CODEX);
  verifier(
    "codex : les tours sont comptés",
    c?.tours === 1,
    `tours=${c?.tours}`,
  );
  const g = effortDe(GEMINI);
  verifier(
    "gemini : la durée vient de SES stats",
    g?.dureeMs === 900,
    `dureeMs=${g?.dureeMs}`,
  );
  const cl = effortDe(CLAUDE);
  verifier(
    "claude : tours, durée et coût restent lus comme avant",
    cl?.tours === 4 && cl?.dureeMs === 1200 && cl?.coutUsd === 0.01,
    JSON.stringify(cl),
  );
}

// ─── La sonde de GESTE accepte les trois voies ───────────────────────────────

{
  const motif = gesteParCommandeOuMcp(
    "nodefony\\s+(?:inspect\\b|(?:devkit:)?card\\b)",
    "inspect|card",
  );
  for (const [nom, lignes] of [
    ["claude", CLAUDE],
    ["codex", CODEX],
    ["gemini", GEMINI],
  ]) {
    const texte = lignes.map((l) => JSON.stringify(l)).join("\n");
    verifier(
      `${nom} : le GESTE « interroger l'app » est reconnu`,
      motif.test(texte),
    );
  }
  // La voie shell reste acceptée : c'est tout l'objet de cette sonde.
  verifier(
    "la voie ligne de commande passe toujours",
    motif.test('{"command":"npx nodefony inspect routes"}'),
  );
  // 🔴 Et le contre-exemple : un outil d'un AUTRE serveur MCP ne vaut pas le
  // geste. Sans lui, la sonde dirait oui à n'importe quel outil nommé.
  verifier(
    "un outil MCP étranger au geste ne le prouve pas",
    !motif.test('{"tool_name":"github_list_issues"}') &&
      !motif.test('{"tool":"read_file"}'),
  );
}

// ─── La garde « l'agent a-t-il parlé ? » ─────────────────────────────────────

{
  // Le motif est celui du banc, recopié ici À DESSEIN : ce selftest doit
  // échouer si quelqu'un le restreint là-bas sans y penser.
  const aParle = (t) =>
    /["'](?:type|role)["']\s*:\s*["']assistant["']/u.test(t) ||
    /["']agent_message["']/u.test(t);
  for (const [nom, lignes] of [
    ["claude", CLAUDE],
    ["codex", CODEX],
    ["gemini", GEMINI],
  ]) {
    verifier(
      `${nom} : le tour d'agent est reconnu`,
      aParle(lignes.map((l) => JSON.stringify(l)).join("\n")),
    );
  }
  verifier(
    "un transcript SANS tour d'agent reste muet",
    !aParle('{"type":"thread.started"}\n{"type":"error","message":"401"}'),
  );
}

// ─── Et le transcript reste exploitable dans les trois formes ────────────────

for (const [nom, lignes] of [
  ["claude", CLAUDE],
  ["codex", CODEX],
  ["gemini", GEMINI],
]) {
  verifier(
    `${nom} : transcript exploitable`,
    transcriptExploitable(lignes.map((l) => JSON.stringify(l)).join("\n")),
  );
}

// Le motif nu, pour qu'une régression se lise à l'endroit exact.
verifier(
  "les trois clés de nommage sont dans le motif",
  ["mcp__", "tool_name", '"tool"'].every((c) =>
    appelOutilMcp("inspect").includes(c.replaceAll('"', "")),
  ),
  appelOutilMcp("inspect"),
);

process.stdout.write(
  echecs === 0
    ? "\n━━ trois grammaires d'agent : toutes reconnues ✅\n"
    : `\n━━ ${echecs} échec(s) ❌\n`,
);
process.exit(echecs === 0 ? 0 : 1);
