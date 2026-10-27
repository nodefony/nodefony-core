#!/usr/bin/env node
// POC #690 — preuve que le flux bidirectionnel est ENTRELACÉ dans le pipeline.
//
// Ping-pong : le message N+1 ne part qu'après RÉCEPTION de la réponse N. Un
// serveur qui attendrait la fin du flux client ne répondrait jamais au
// premier message — l'échange se bloquerait et le délai le ferait échouer.
// La preuve tient sans comparer deux horloges : c'est l'ordre causal qui la
// porte, pas un horodatage.
//
//   node nodefony/poc/grpc/proof-converse.mjs                 # h2c, 5153
//   node nodefony/poc/grpc/proof-converse.mjs --tls 5152       # TLS
//
// Exige `grpcurl` sur le PATH (`brew install grpcurl`).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const tls = process.argv.includes("--tls");
const port =
  process.argv.find((arg) => /^\d+$/.test(arg)) ?? (tls ? "5152" : "5153");
const rounds = 3;
const timeoutMs = 5000;

const child = spawn(
  "grpcurl",
  [
    tls ? "-insecure" : "-plaintext",
    "-import-path",
    path.join(here, "proto"),
    "-proto",
    "nodefony/poc/v1/echo.proto",
    "-d",
    "@",
    `localhost:${port}`,
    "nodefony.poc.v1.EchoService/Converse",
  ],
  { stdio: ["pipe", "pipe", "inherit"] },
);

let output = "";
let waiting = null;
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  output += chunk;
  if (waiting !== null && output.includes(`"received": ${waiting.round}`)) {
    const { resolve } = waiting;
    waiting = null;
    resolve();
  }
});

function awaitResponse(round) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `réponse ${round} jamais reçue en ${timeoutMs} ms — flux non entrelacé`,
          ),
        ),
      timeoutMs,
    );
    waiting = {
      round,
      resolve: () => {
        clearTimeout(timer);
        resolve();
      },
    };
  });
}

try {
  for (let round = 1; round <= rounds; round += 1) {
    const response = awaitResponse(round);
    child.stdin.write(`${JSON.stringify({ sentence: `message ${round}` })}\n`);
    await response;
    console.log(
      round < rounds
        ? `✓ réponse ${round} reçue AVANT l'envoi du message ${round + 1}`
        : `✓ réponse ${round} reçue, flux client encore OUVERT`,
    );
  }
  child.stdin.end();
  const code = await new Promise((resolve) => child.once("close", resolve));
  console.log(`grpcurl sorti en ${code} — ${rounds} allers-retours entrelacés`);
  process.exitCode = code === 0 ? 0 : 1;
} catch (error) {
  console.error(`✗ ${error.message}`);
  child.kill();
  process.exitCode = 1;
}
