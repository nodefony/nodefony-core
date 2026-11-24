// Faux serveur enfant (ADR-0030 §D3) : envoie le plan reçu en argument
// sur le canal IPC, et écrit chaque acquittement reçu sur sa sortie standard —
// une ligne JSON par acquittement, que le test lit.
process.on("message", (message) => {
  if (message?.type === "held-plan-ack") {
    process.stdout.write(`${JSON.stringify(message)}\n`);
  }
});
process.send(JSON.parse(process.argv[2]));
// Vivant jusqu'à ce que le test le tue, comme un vrai serveur.
setInterval(() => {}, 1_000);
