/**
 * Banc de `clusterIpcBytes.test.ts` : un VRAI master Nodefony
 * (`startClusterMaster`, celui des commandes `cluster` et `production`) et deux
 * workers. Chaque worker publie une enveloppe realtime portant les 256 valeurs
 * d'octet, jusqu'à recevoir celle de l'autre par le relais du master ; il écrit
 * alors une ligne `RESULT {…}` sur la sortie standard, que le test lit.
 *
 * Exécuté par un `node` nu sur le `dist` : c'est le produit livré qu'on éprouve.
 */
import cluster from "node:cluster";
import { CLUSTER_RT_KIND, CLUSTER_IPC_SERIALIZATION_ENV } from "nodefony";
import { startClusterMaster } from "../../../dist/node/service/cluster/clusterMaster.js";

if (cluster.isPrimary) {
  startClusterMaster({ workers: 2, log: () => {} });
} else {
  const all = Uint8Array.from({ length: 256 }, (_v, i) => i);
  const timer = setInterval(() => {
    process.send?.({
      kind: CLUSTER_RT_KIND,
      channel: "bytes:probe",
      payload: { frame: all },
      originId: String(process.pid),
    });
  }, 50);
  process.on("message", (msg) => {
    if (msg === null || typeof msg !== "object" || msg.kind !== CLUSTER_RT_KIND)
      return;
    clearInterval(timer);
    const frame = msg.payload?.frame;
    const intact =
      frame instanceof Uint8Array &&
      frame.length === 256 &&
      frame.every((v, i) => v === i);
    process.stdout.write(
      `RESULT ${JSON.stringify({
        env: process.env[CLUSTER_IPC_SERIALIZATION_ENV] ?? null,
        isUint8Array: frame instanceof Uint8Array,
        intact,
      })}\n`,
    );
  });
}
