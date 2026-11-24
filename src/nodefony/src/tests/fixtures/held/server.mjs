// Faux serveur enfant (ADR-0030 §D3) : envoie, dans l'ordre, chaque message
// reçu en argument (le plan, puis d'éventuels `held-owners`) sur le canal IPC,
// et écrit chaque acquittement reçu sur sa sortie standard — une ligne JSON
// par acquittement, que le test lit.
process.on("message", (message) => {
  if (message?.type === "held-plan-ack") {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }
});
for (const arg of process.argv.slice(2)) process.send(JSON.parse(arg));
// Vivant jusqu'à ce que le test le tue, comme un vrai serveur.
setInterval(() => {}, 1_000);
