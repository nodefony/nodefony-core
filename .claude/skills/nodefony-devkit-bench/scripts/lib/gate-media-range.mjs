/**
 * Juge de la tâche « servir un gros média » — et il NOMME sa cause.
 *
 * Écrit dans un fichier, et non en `node -e` dans la commande du gate, pour une
 * raison qui a coûté un faux verdict : un juge inline ne peut pas être éprouvé
 * seul. Celui-ci l'a été sur quatre décors conservés, un par cause.
 *
 * Le défaut qu'il corrige : l'ancien juge faisait UNE requête avec `Range` et
 * rendait un seul rouge. Or au moins quatre situations très différentes le
 * produisaient, et confondre les deux premières fait accuser la découvrabilité
 * quand elle n'est pas en cause :
 *
 * | Sortie | Cause                     | Ce que ça dit                                    |
 * | -----: | ------------------------- | ------------------------------------------------ |
 * |    `0` | conforme                  | 206 + `Content-Range` + exactement les octets    |
 * |    `1` | plages non honorées       | le fichier EST servi — la façade ignore `Range`  |
 * |    `3` | échantillon non servi     | route ou dossier : l'énoncé nommait `media/`     |
 * |    `4` | aucune réponse            | la réponse ne se termine jamais (client bloqué)  |
 * |    `5` | port déjà tenu AVANT boot | on mesurerait un serveur ÉTRANGER                |
 *
 * La sortie `5` est une garde d'INSTRUMENT, pas un critère sur l'agent : un
 * `--detach --wait` sonde des ports, et un serveur étranger qui répond fait
 * déclarer la readiness — le juge interroge alors une autre application et son
 * rouge n'accuse personne. Vécu sur ce banc : un agent avec le bon dossier ET la
 * bonne façade est sorti rouge, puis a rendu 206 en rejouant le juge à la main.
 *
 * @module
 */
import http from "node:http";
import net from "node:net";

const PORT = process.env.NF_PORT ?? "5371";
const CHEMIN = "/api/media/gate-sample.mp4";

/** Le port répond-il déjà ? (avant boot : quelqu'un d'autre l'occupe.) */
const portTenu = (port) =>
  new Promise((resolve) => {
    const s = net.connect(Number(port), "127.0.0.1");
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });

/**
 * Une requête sur l'échantillon du gate.
 *
 * @param {Record<string,string>} headers - en-têtes à envoyer (`Range` ou rien).
 * @returns {Promise<object>} statut, `content-range`, octets reçus — ou `erreur`.
 */
const demander = (headers) =>
  new Promise((resolve) => {
    const r = http.request(
      { host: "127.0.0.1", port: PORT, path: CHEMIN, headers },
      (res) => {
        let n = 0;
        res.on("data", (c) => (n += c.length));
        res.on("end", () =>
          resolve({
            statut: res.statusCode,
            plage: res.headers["content-range"],
            octets: n,
          }),
        );
      },
    );
    r.on("error", (e) => resolve({ erreur: e.message }));
    r.setTimeout(15_000, () => {
      r.destroy();
      resolve({ erreur: "aucune réponse en 15 s" });
    });
    r.end();
  });

// `--check-port-free` : appelé AVANT le boot, il ne fait que la garde.
if (process.argv.includes("--check-port-free")) {
  if (await portTenu(PORT)) {
    console.error(
      `CAUSE=port-deja-tenu — le port ${PORT} répond AVANT le boot du décor : ` +
        `le juge mesurerait un serveur étranger. Verdict non rendu.`,
    );
    process.exit(5);
  }
  process.exit(0);
}

// ─── 1. PRÉALABLE — l'échantillon est-il servi, tout court ? ─────────────────
const plein = await demander({});
if (plein.erreur) {
  console.error(`CAUSE=aucune-reponse — ${plein.erreur}`);
  process.exit(4);
}
if (plein.statut !== 200) {
  console.error(
    `CAUSE=echantillon-non-servi — GET sans Range rend ${plein.statut} : la route ou le ` +
      `dossier ne mène pas à \`media/\`, que l'énoncé nomme. La façade n'est PAS en cause.`,
  );
  process.exit(3);
}

// ─── 2. LE JUGE — une demande de MORCEAU (RFC 9110 §14) ─────────────────────
const morceau = await demander({ Range: "bytes=0-99" });
if (morceau.erreur) {
  console.error(`CAUSE=aucune-reponse-sur-plage — ${morceau.erreur}`);
  process.exit(1);
}
if (morceau.statut !== 206 || !morceau.plage || morceau.octets !== 100) {
  console.error(
    `CAUSE=plages-non-honorees — statut=${morceau.statut} content-range=${morceau.plage} ` +
      `octets=${morceau.octets} · le fichier EST servi : c'est la façade qui ne traite pas \`Range\``,
  );
  process.exit(1);
}
console.log(`ok — 206, ${morceau.plage}, ${morceau.octets} octets`);
process.exit(0);
