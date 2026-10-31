// Coût d'un canal par personne sur le hub, SANS serveur : mémoire par abonnement, coût d'un publish.
// Usage : node --expose-gc micro-user-channel.mjs <chemin absolu de @nodefony/realtime/dist/index.js> [N=10000]
// Mesure de référence (table #622, ADR-0022 §6) : 494 o/abonnement, ~60 ns/envoi, ~185 ns nom construit.
// Rejouer 3 fois (médiane) ; le dist doit être rebâti AVANT (sinon on mesure l'ancienne version).
import { pathToFileURL } from "node:url";
const dist = process.argv[2];
const { RealtimeHub } = await import(pathToFileURL(dist).href);
const N = Number(process.argv[3] ?? 10000);
const gc = globalThis.gc;
const heap = () => {
  gc();
  gc();
  return process.memoryUsage().heapUsed;
};
const hub = new RealtimeHub();
let received = 0;
const noopFactory = () => () => {};
// échauffement : crée la Map
hub.subscribe("warm", () => {}, noopFactory);
const h0 = heap();
const sinks = [];
for (let i = 0; i < N; i++) {
  const sink = (p) => {
    received++;
  }; // une fermeture par connexion, comme le contrôleur
  sinks.push(sink);
  hub.subscribe(`user:${i}`, sink, noopFactory);
}
const h1 = heap();
console.log(`abonnements      : ${N} canaux user:<id>, 1 abonné chacun`);
console.log(
  `mémoire hub      : ${((h1 - h0) / N).toFixed(0)} octets par abonnement (${((h1 - h0) / 1048576).toFixed(2)} Mo au total)`,
);
// publish ciblé vs publish de salon
hub.subscribe(
  "chat:room",
  () => {
    received++;
  },
  noopFactory,
);
const msg = { author: "alice", text: "salut", sentAt: 1 };
const M = 2_000_000;
const ids = Array.from({ length: 1024 }, (_, i) => `user:${(i * 7919) % N}`); // noms pré-calculés
/** @type {{ label: string; run: (k: number) => void }[]} */
const benches = [
  { label: "publish user:<id> ", run: (k) => hub.publish(ids[k & 1023], msg) },
  { label: "publish chat:room  ", run: () => hub.publish("chat:room", msg) },
];
for (const { label, run: fn } of benches) {
  for (let k = 0; k < 200_000; k++) fn(k);
  const t = process.hrtime.bigint();
  for (let k = 0; k < M; k++) fn(k);
  const ns = Number(process.hrtime.bigint() - t) / M;
  console.log(`${label}: ${ns.toFixed(0)} ns par message (1 destinataire)`);
}
// le nom construit à chaque envoi (`user:${id}`) : une chaîne par message
const t2 = process.hrtime.bigint();
for (let k = 0; k < M; k++) hub.publish(`user:${k % N}`, msg);
console.log(
  `publish avec nom construit : ${(Number(process.hrtime.bigint() - t2) / M).toFixed(0)} ns par message`,
);
console.log(`(reçus : ${received})`);
