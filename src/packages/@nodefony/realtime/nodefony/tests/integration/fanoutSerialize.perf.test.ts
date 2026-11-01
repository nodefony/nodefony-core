import { describe, it, expect } from "vitest";
import {
  RealtimeHub,
  type ChannelFrame,
} from "../../src/server/RealtimeHub.js";
import { JsonRpcPeer, frameCodecSet } from "nodefony";

/**
 * **Ce que le plan S1 économise, mesuré sur l'étage seul** — opt-in `NF_RUN_PERF=1`
 * (doctrine perf du dépôt : une mesure chronométrée n'est pas une non-régression).
 *
 * Pourquoi ici et pas au banc multi-pods : le banc sature le transport WebSocket
 * et sa variance atteint un facteur 3 d'un tir à l'autre — il ne peut pas isoler
 * un écart de quelques dizaines de pour-cent. On mesure donc l'étage concerné, et
 * les **deux chemins dans le même binaire** (`buildFrame` est optionnel), ce qui
 * élimine tout biais de compilation.
 *
 * Ce que la mesure dit — et ne dit pas : elle chiffre le travail de sérialisation
 * supprimé (N frames identiques → 1), pas un débit de bout en bout. Sur une
 * livraison WebSocket réelle, l'écriture réseau reste le poste dominant à faible
 * charge : le gain n'y devient visible qu'à mesure que la charge grossit.
 */

const NF_RUN_PERF = process.env.NF_RUN_PERF === "1";

const ABONNES = 200;
const PUBLICATIONS = 2000;

const TEXT = frameCodecSet().text;
const builder =
  (channel: string) =>
  (payload: unknown): unknown =>
    JsonRpcPeer.buildNotification(channel, payload);
/** Ce que le pair écrit quand rien n'a été mutualisé : construire puis encoder. */
const encodeAlone = (channel: string, payload: unknown): string =>
  TEXT.encode(JsonRpcPeer.buildNotification(channel, payload)) as string;

/**
 * Chronomètre le fan-out d'un canal à `ABONNES` abonnés, avec ou sans frame
 * mutualisée. Le sink imite le vrai : frame prête → il l'écrit ; sinon il la
 * fabrique lui-même.
 *
 * @returns durée en ms et volume écrit (le volume doit être identique des deux
 *   côtés, sinon on comparerait deux quantités de travail différentes).
 */
function mesure(
  mutualise: boolean,
  charge: object,
): { ms: number; octets: number } {
  const hub = new RealtimeHub();
  const build = builder("chat:room1");
  let octets = 0;
  for (let i = 0; i < ABONNES; i += 1) {
    const sink = (payload: unknown, frame?: ChannelFrame): void => {
      octets += (frame?.encodeFor(TEXT) ?? encodeAlone("chat:room1", payload))
        .length;
    };
    hub.subscribe(
      "chat:room1",
      sink,
      () => () => {},
      mutualise ? build : undefined,
    );
  }
  const t0 = performance.now();
  for (let i = 0; i < PUBLICATIONS; i += 1) hub.publish("chat:room1", charge);
  return { ms: performance.now() - t0, octets };
}

describe("Fan-out mutualisé — coût de sérialisation (NF_RUN_PERF=1)", () => {
  it.skipIf(!NF_RUN_PERF)(
    "à charge réaliste, l'étage de sérialisation coûte au moins 10× moins",
    () => {
      const charge = { seq: 1, ts: 0, pad: "x".repeat(2000) };
      // Chauffe : le JIT doit avoir compilé les deux chemins avant le chrono.
      mesure(false, charge);
      mesure(true, charge);

      const avant = mesure(false, charge);
      const apres = mesure(true, charge);

      // Garde-fou : même volume écrit des deux côtés.
      expect(apres.octets).to.equal(avant.octets);
      // Seuil volontairement bas devant le facteur observé (~60×) : on verrouille
      // la propriété « le travail n'est plus refait par abonné », pas une machine.
      expect(avant.ms / apres.ms).to.be.greaterThan(10);
    },
  );

  it.skipIf(!NF_RUN_PERF)("un seul abonné : aucun surcoût introduit", () => {
    const charge = { seq: 1, pad: "x".repeat(2000) };
    const hub = new RealtimeHub();
    let appels = 0;
    hub.subscribe(
      "chat:room1",
      (p, frame) => {
        appels +=
          (frame?.encodeFor(TEXT) ?? encodeAlone("chat:room1", p)).length > 0
            ? 1
            : 0;
      },
      () => () => {},
      builder("chat:room1"),
    );
    for (let i = 0; i < 100; i += 1) hub.publish("chat:room1", charge);
    expect(appels).to.equal(100); // chemin d'avant, strictement
  });
});
