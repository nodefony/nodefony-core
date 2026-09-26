/**
 * Seuils de rétention mémoire et assertion commune du gate (`memory.test.ts`)
 * et des bancs de charge (`tests/load/*`).
 *
 * 🔴 SOURCE UNIQUE des seuils mémoire du dépôt : les documents (CLAUDE.md,
 * skills, guides) renvoient à ce fichier, ils ne recopient pas ces valeurs.
 */
import { expect } from "chai";
import https from "node:https";
import { measureRetention, type IRetentionPlan } from "./heapSlope.js";
import { asError } from "./wsText";

const PROBE = { hostname: "localhost", port: 5152, rejectUnauthorized: false };

function probeJson(path: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const req = https.request({ ...PROBE, path, method: "GET" }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString()));
        } catch (e) {
          reject(asError(e));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

/** Tas du serveur de banc, relevé APRÈS un GC forcé (`/nodefony/test/memory`). */
export async function serverHeap(): Promise<number> {
  return (await probeJson("/nodefony/test/memory")).heapUsed as number;
}

/**
 * Coupe ou rétablit le ring de relecture du syslog du serveur de banc.
 *
 * Borné (2 000 Pdu en développement) mais RE-REMPLI par chaque scénario avec
 * des lignes d'une autre taille : il fabrique plusieurs Ko de pente par
 * requête — 2,45 Mo sur les 1 000 premières requêtes d'un serveur neuf,
 * identiques sur les trois systèmes de la CI. Un banc de rétention le coupe
 * en `beforeAll` et le rétablit en `afterAll`.
 *
 * @param enabled - `false` pour couper, `true` pour rétablir
 */
export async function setSyslogRing(enabled: boolean): Promise<void> {
  const r = await probeJson(
    `/nodefony/test/memory/syslog-ring/${enabled ? "on" : "off"}`,
  );
  expect(r.ringEnabled, "état du ring du syslog").to.equal(enabled);
}

/**
 * Octets RETENUS par unité au-delà desquels une boucle est déclarée fuyante.
 *
 * Posés sur le bruit MESURÉ de la pente, pas choisis à l'œil : 10 passages,
 * chacun sur un serveur NEUF (le régime de la CI). Distribution complète au
 * ticket #490. Resserrer demande de refaire ces 10 passages ; desserrer pour
 * faire passer un run est exclu.
 *
 * Gate (`memory.test.ts`), pente maximale observée en Ko par itération :
 * GET 0,04 · crashs 0,19 · mixtes 0,26 · uploads 0,38 · WS 0,06 / 0,15. Un
 * seuil commun de 1 Ko laisse au moins ×2,6 au pire scénario, et vaut la
 * MOITIÉ de la fuite témoin : 2 Ko retenus par scope (`Container.enterScope`)
 * ont fait tomber les huit contrôles, mesurés entre 1,55 et 2,40 Ko.
 */
export const THRESHOLDS = {
  get: 1024,
  crashSync: 1024,
  crashAsync: 1024,
  crashNative: 1024,
  mixed: 1024,
  upload: 1024,
  wsOpenClose: 1024,
  wsEcho: 1024,
  // Portée `request` de l'injecteur (#485) — 5 passages sur serveur neuf, pas
  // 10 : le seuil commun ne s'y resserre pas, il s'y applique. Maximum observé
  // entre parenthèses. Une première mesure rendait 0,29 / 0,53 Ko : c'étaient
  // les tables NON BORNÉES de la sonde du module test — la sonde est le
  // premier suspect. Ce qui voit une vraie fuite de services request, ce sont
  // les comptes EXACTS du scénario : une fuite témoin retenant chaque service
  // (0,57 Ko de pente, sous ce seuil) y a été vue — 381 services non réclamés.
  /** GET résolvant deux services `request` — (0,04 Ko) */
  requestService: 1024,
  /** connexion WS résolvant un service `request` à chaque message — (0,14 Ko) */
  wsRequestService: 1024,
  // Bancs de charge (`npm run test:load`, 10 passages sur serveur neuf), par
  // unité indiquée — maximum observé entre parenthèses.
  /** par connexion WS portant 10 messages (`als-load`) — (0,46 Ko) */
  alsMessages: 1024,
  /** par connexion WS ouverte / message / fermée (`als-load`) — (0,24 Ko) */
  alsLifecycle: 1024,
  /**
   * par trame WS échangée (`ws-messages-load`) — (0,58 Ko sur des paliers de
   * 1 000 trames, d'où les paliers de 2 000 : hors production, le contenu des
   * trames est journalisé et les écritures en vol font varier le tas).
   */
  wsFrame: 1024,
  /** par stream servi (`stream-load`) — (0,02 Ko) */
  stream: 1024,
  /**
   * COÛT d'une connexion WS TENUE ouverte (`ws-connections-load`) — pas une
   * rétention : ce que le serveur paye tant que la connexion vit. Mesuré
   * entre 1,8 et 14,2 Ko (tas lu socket ouvertes, donc bimodal selon le
   * moment du GC) ; 32 Ko = ×2,25 le maximum. L'ancien plafond (60 Mo pour
   * 500 connexions) en tolérait 120.
   */
  wsHeldConnection: 32 * 1024,
} as const;

const ko = (octets: number): string => `${(octets / 1024).toFixed(2)} Ko`;

/**
 * Mesure ce qu'une boucle retient par unité, PUBLIE la mesure, et rend
 * l'assertion à jouer — APRÈS les comptes exacts (scopes, contextes), qui
 * nomment la cause quand la pente, elle, ne fait que la chiffrer.
 *
 * Une pente (Theil–Sen sur des paliers relevés GC forcé, `heapSlope.ts`) et
 * non un écart avant/après : l'ancien écart sur 1 000 requêtes laissait passer
 * jusqu'à 35 Ko par requête, et un conteneur volontairement cassé qui gardait
 * 1 043 scopes est resté vert.
 *
 * Une pente au-dessus du seuil est CONFIRMÉE par une seconde fenêtre avant de
 * conclure : une fuite retient à chaque itération, donc elle se retrouve ; un
 * à-coup du serveur de développement (profileur, HMR) ne tombe qu'une fois. Le
 * rouge exige les deux — sans cela, le gate flancherait en CI sur un à-coup.
 *
 * @param quoi - libellé de la boucle, repris dans la ligne publiée
 * @param plan - sonde, action, échauffement, paliers et unité
 * @param seuil - octets retenus par unité, pris dans {@link THRESHOLDS}
 * @returns l'assertion, à appeler après les comptes exacts
 */
export async function retention(
  quoi: string,
  plan: IRetentionPlan,
  seuil: number,
): Promise<() => void> {
  const first = await measureRetention(plan);
  const confirm =
    first.slope < seuil ? null : await measureRetention({ ...plan, warmup: 0 });
  const verdict = confirm ?? first;
  const marge =
    verdict.slope <= 0 ? "∞" : `×${(seuil / verdict.slope).toFixed(1)}`;
  console.log(
    `[retention] ${quoi} : ${ko(first.slope)} / unité` +
      (confirm ? ` → confirmation ${ko(confirm.slope)}` : "") +
      ` · seuil ${ko(seuil)} · marge ${marge}`,
  );
  return () => {
    expect(
      verdict.slope,
      `${quoi} : ${ko(verdict.slope)} retenus par unité, confirmé sur une ` +
        `seconde fenêtre (première : ${ko(first.slope)}). Tas relevé (Mo) : ` +
        verdict.points.map((p) => (p / 1048576).toFixed(2)).join(" "),
    ).to.be.below(seuil);
  };
}
