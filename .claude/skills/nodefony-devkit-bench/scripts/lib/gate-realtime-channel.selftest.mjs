/**
 * Auto-contrôle du juge « canal realtime PRIVÉ ».
 *
 * Une application jouet joue tour à tour chaque défaillance, et le juge doit
 * rendre EXACTEMENT le code annoncé par sa table. Aucun agent, aucun décor,
 * quelques secondes, zéro jeton.
 *
 * Node ne fournit PAS de `WebSocketServer` : ce jouet fait lui-même l'upgrade
 * RFC 6455 (`Sec-WebSocket-Accept` = SHA1(clé + GUID) en base64) et le framing
 * texte (masquage client→serveur, aucun masquage serveur→client) — la même
 * paire poignée de main / trame que `gate-realtime-channel.mjs` attaque avec
 * le `WebSocket` natif de Node, éprouvée manuellement avant d'écrire ce
 * fichier (un client natif contre un serveur à la main, `realtime:welcome`
 * puis `subscribe` puis une donnée de canal, aller-retour complet).
 *
 * Le cas central est `canalOuvertAnonyme` : un canal SANS politique — le
 * comportement par défaut, documenté, du framework — sert quiconque s'abonne.
 * C'est le trou que la tâche mesure, et c'est donc le premier que l'auto-
 * contrôle doit être capable de voir rougir.
 *
 * Usage : `node lib/gate-realtime-channel.selftest.mjs`
 * Sorties : `0` toutes les causes distinguées · `1` au moins un écart.
 *
 * ⚠️ `spawnSync` est proscrit ici : le serveur jouet vit dans CE processus (il
 * doit rester debout pendant que le juge, lancé en sous-processus, s'y connecte).
 *
 * @module
 */
import crypto from "node:crypto";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CANAL_OPS_ALERTES,
  CANAL_TEMOIN_PUBLIC,
  CHEMIN_REALTIME_LIVE,
  CHEMIN_REALTIME_OPS,
} from "./enonces.mjs";
import { portLibre } from "./http-probe.mjs";

const JUGE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "gate-realtime-channel.mjs",
);

/**
 * Le port, obtenu du SYSTÈME et non écrit en dur.
 *
 * Un port fixe est un état PARTAGÉ : trois selftests écoutaient sur 5394,
 * trois sur 5395, deux sur 5393, et deux exécutions consécutives du lot
 * rendaient deux verdicts différents — des rouges qui n'accusaient personne.
 */
const PORT = String(await portLibre());

const LOGIN = "/nodefony/security/api/auth/login";
const MOI = "/nodefony/security/api/auth/me";

const run = (args) =>
  new Promise((resolve) => {
    const p = spawn("node", args, {
      env: { ...process.env, NF_PORT: PORT, NF_ADMIN_PASSWORD: "" },
    });
    let out = "";
    let err = "";
    p.stdout.on("data", (c) => (out += c));
    p.stderr.on("data", (c) => (err += c));
    p.on("close", (status) => resolve({ status, stdout: out, stderr: err }));
  });

/** Lit le corps d'une requête HTTP, JSON ou rien. */
const corpsDe = (req) =>
  new Promise((resolve) => {
    let brut = "";
    req.on("data", (c) => (brut += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(brut));
      } catch {
        resolve({});
      }
    });
  });

/** Qui frappe ? — déduit du cookie de session semé au login. */
const quiEst = (cookieHeader) => {
  const cookie = cookieHeader ?? "";
  if (cookie.includes("nodefony=sess-admin")) return "admin";
  if (cookie.includes("nodefony=sess-bench-temoin")) return "temoin";
  return "anonyme";
};

const repondre = (res, status, objet) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(objet));
};

// ── RFC 6455 — poignée de main + framing texte, à la main ──────────────────

const GUID_WEBSOCKET = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** `Sec-WebSocket-Accept` — SHA1(clé du client + GUID RFC 6455) en base64. */
const accepterCle = (cle) =>
  crypto
    .createHash("sha1")
    .update(cle + GUID_WEBSOCKET)
    .digest("base64");

/** Encode une trame TEXTE serveur→client (FIN=1, opcode texte, JAMAIS masquée). */
function encoderTrame(texte) {
  const payload = Buffer.from(texte, "utf8");
  const len = payload.length;
  let entete;
  if (len < 126) {
    entete = Buffer.from([0x81, len]);
  } else {
    entete = Buffer.alloc(4);
    entete[0] = 0x81;
    entete[1] = 126;
    entete.writeUInt16BE(len, 2);
  }
  return Buffer.concat([entete, payload]);
}

/**
 * Tente de décoder UNE trame client→serveur (toujours masquée) en tête du
 * buffer accumulé. `null` si incomplète (attendre plus de données).
 *
 * @returns {{total: number, texte?: string, fermeture?: boolean}|null}
 */
function decoderTrame(buf) {
  if (buf.length < 2) return null;
  const octet1 = buf[1];
  const masque = (octet1 & 0x80) !== 0;
  let len = octet1 & 0x7f;
  let decalage = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    decalage = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    decalage = 10;
  }
  let cleMasque = null;
  if (masque) {
    if (buf.length < decalage + 4) return null;
    cleMasque = buf.subarray(decalage, decalage + 4);
    decalage += 4;
  }
  if (buf.length < decalage + len) return null;
  const payload = buf.subarray(decalage, decalage + len);
  const total = decalage + len;
  const opcode = buf[0] & 0x0f;
  if (opcode === 0x8) return { total, fermeture: true };
  let data = payload;
  if (masque) {
    data = Buffer.alloc(len);
    for (let i = 0; i < len; i++) data[i] = payload[i] ^ cleMasque[i % 4];
  }
  return { total, texte: data.toString("utf8") };
}

/**
 * Un canal jouet : `null` = chemin absent (upgrade refusée, 404) ; sinon
 * `{ channels, autorise }` où `autorise(qui, canal)` décide qui reçoit quoi.
 *
 * @typedef {{channels: string[], autorise: (qui: string, canal: string) => boolean}} CanalJouet
 */

/**
 * UN serveur WebSocket jouet paramétrable, pas un par cause.
 *
 * @param {{
 *   ops?: CanalJouet|null,
 *   live?: CanalJouet|null,
 *   loginRefuse?: string[],
 *   rejeterHandshake?: (chemin: string, qui: string) => boolean,
 * }} opts - `ops`/`live` décrivent les deux chemins candidats ; `rejeterHandshake`
 *   simule une zone resserrée qui ferme l'upgrade AVANT tout welcome.
 * @returns {http.Server}
 */
function creerServeur({
  ops = { channels: [CANAL_OPS_ALERTES], autorise: (qui) => qui === "admin" },
  live = {
    channels: [CANAL_TEMOIN_PUBLIC],
    autorise: (_qui, canal) => canal === CANAL_TEMOIN_PUBLIC,
  },
  loginRefuse = [],
  rejeterHandshake = () => false,
} = {}) {
  const chemins = { [CHEMIN_REALTIME_OPS]: ops, [CHEMIN_REALTIME_LIVE]: live };

  const srv = http.createServer(async (req, res) => {
    const url = (req.url ?? "").split("?")[0];
    if (url === LOGIN && req.method === "POST") {
      const { username } = await corpsDe(req);
      if (loginRefuse.includes(username)) {
        return repondre(res, 401, { error: "Invalid credentials" });
      }
      res.setHeader(
        "set-cookie",
        `nodefony=sess-${username}; Path=/; HttpOnly`,
      );
      return repondre(res, 200, { user: { username, roles: [] } });
    }
    if (url === MOI) {
      const qui = quiEst(req.headers.cookie);
      if (qui === "anonyme") return repondre(res, 401, { error: "no session" });
      const username = qui === "admin" ? "admin" : "bench-temoin";
      return repondre(res, 200, { user: { username } });
    }
    return repondre(res, 404, { error: "not found" });
  });

  srv.on("upgrade", (req, socket) => {
    const url = (req.url ?? "").split("?")[0];
    const cfg = chemins[url];
    const qui = quiEst(req.headers.cookie);
    if (!cfg || rejeterHandshake(url, qui)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const cle = req.headers["sec-websocket-key"];
    if (!cle) {
      socket.destroy();
      return;
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${accepterCle(cle)}\r\n\r\n`,
    );
    socket.write(
      encoderTrame(
        JSON.stringify({
          jsonrpc: "2.0",
          method: "realtime:welcome",
          params: { channels: cfg.channels },
        }),
      ),
    );

    let buf = Buffer.alloc(0);
    const timers = [];
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const r = decoderTrame(buf);
        if (!r) break;
        buf = buf.subarray(r.total);
        if (r.fermeture) {
          socket.end();
          return;
        }
        if (!r.texte) continue;
        let msg;
        try {
          msg = JSON.parse(r.texte);
        } catch {
          continue;
        }
        if (msg.method === "subscribe") {
          const canal = msg.params?.channel;
          if (!canal || !cfg.autorise(qui, canal)) continue; // silence, comme documenté
          // Ticker accéléré (jouet) : la cadence réelle (1/s) n'a aucune
          // importance ici, seule compte l'arrivée d'AU MOINS une trame dans
          // la fenêtre du juge.
          const t = setInterval(() => {
            if (socket.destroyed) {
              clearInterval(t);
              return;
            }
            socket.write(
              encoderTrame(
                JSON.stringify({
                  jsonrpc: "2.0",
                  method: canal,
                  params: { ts: Date.now() },
                }),
              ),
            );
          }, 100);
          timers.push(t);
        }
      }
    });
    socket.on("close", () => {
      for (const t of timers) clearInterval(t);
    });
  });

  return srv;
}

const ecouter = (srv) =>
  new Promise((resolve) => srv.listen(Number(PORT), "127.0.0.1", resolve));
const fermer = (srv) => new Promise((resolve) => srv.close(resolve));

/** Politique fermée : seul `admin` est autorisé sur le canal donné. */
const seulAdmin = (canal) => ({
  channels: [canal],
  autorise: (qui, c) => c === canal && qui === "admin",
});
/** Politique ouverte : tout le monde, y compris l'anonyme. */
const ouvertATous = (canal) => ({
  channels: [canal],
  autorise: (_qui, c) => c === canal,
});
/** Politique « authentifié suffit » : anonyme dehors, tout le reste dedans. */
const authentifieSuffit = (canal) => ({
  channels: [canal],
  autorise: (qui, c) => c === canal && qui !== "anonyme",
});
/** Personne ne reçoit jamais rien — le canal existe, mais ne sert personne. */
const personne = (canal) => ({ channels: [canal], autorise: () => false });

const CAS = {
  conforme: [0, { ops: seulAdmin(CANAL_OPS_ALERTES) }],

  // ── ce que l'AGENT a mal fait ────────────────────────────────────────────
  // 🔴 LE cas qui justifie la tâche : un canal SANS politique — défaut du
  // framework — sert quiconque s'abonne.
  canalOuvertAnonyme: [1, { ops: ouvertATous(CANAL_OPS_ALERTES) }],
  canalNonDiscriminant: [2, { ops: authentifieSuffit(CANAL_OPS_ALERTES) }],
  // Ni /api/ops/realtime ni /api/live/realtime n'annoncent le canal demandé —
  // connectivité WS intacte (live sert bien live:ticker), canal introuvable.
  canalAbsent: [3, { ops: null }],
  // Le canal existe, personne ne reçoit jamais rien — même l'administrateur.
  adminRefuse: [8, { ops: personne(CANAL_OPS_ALERTES) }],
  // Le témoin gratuit a été fermé PAR POLITIQUE (silence), pas par le handshake.
  canalTemoinFermeParPolitique: [
    6,
    {
      ops: seulAdmin(CANAL_OPS_ALERTES),
      live: authentifieSuffit(CANAL_TEMOIN_PUBLIC),
    },
  ],
  // Le témoin gratuit a été fermé par une ZONE resserrée — le handshake lui-même
  // refuse l'anonyme sur /api/live/realtime (silence encore plus tôt : jamais
  // de welcome).
  canalTemoinFermeParZone: [
    6,
    {
      ops: seulAdmin(CANAL_OPS_ALERTES),
      rejeterHandshake: (chemin, qui) =>
        chemin === CHEMIN_REALTIME_LIVE && qui === "anonyme",
    },
  ],

  // ── ce que le DÉCOR a raté — l'agent n'y est pour rien ───────────────────
  aucuneConnexionWs: [4, { ops: null, live: null }],
  adminIndisponible: [
    7,
    { ops: seulAdmin(CANAL_OPS_ALERTES), loginRefuse: ["admin"] },
  ],
  temoinIndisponible: [
    9,
    { ops: seulAdmin(CANAL_OPS_ALERTES), loginRefuse: ["bench-temoin"] },
  ],
};

let echecs = 0;
const dire = (ok, nom, attendu, obtenu, cause = "") => {
  if (!ok) echecs++;
  console.log(
    `${ok ? "✅" : "❌"} ${nom.padEnd(28)} attendu=${attendu} obtenu=${obtenu}  ${cause.slice(0, 92)}`,
  );
};

for (const [nom, [attendu, opts]] of Object.entries(CAS)) {
  const srv = creerServeur(opts);
  await ecouter(srv);
  const res = await run([JUGE]);
  await fermer(srv);
  const cause = (res.stderr || res.stdout).trim().split("\n")[0] ?? "";
  dire(res.status === attendu, nom, attendu, res.status, cause);
}

// ── les drapeaux d'INSTRUMENT ──────────────────────────────────────────────
{
  const srv = creerServeur();
  await ecouter(srv);
  const res = await run([JUGE, "--check-port-free"]);
  await fermer(srv);
  dire(res.status === 5, "portTaken", 5, res.status, (res.stderr || "").trim());
}
{
  const res = await run([JUGE, "--check-port-free"]);
  dire(res.status === 0, "portLibre", 0, res.status);
}
{
  const res = await run([JUGE, "--temoin-args"]);
  dire(
    res.status === 0 && res.stdout.includes("--password"),
    "temoinArgs",
    "0+args",
    `${res.status}:${res.stdout.trim().slice(0, 40)}`,
  );
}
{
  const res = await run([JUGE]);
  const cause = (res.stderr || "").trim().split("\n")[0] ?? "";
  dire(res.status === 4, "injoignable", 4, res.status, cause);
}

console.log(
  echecs
    ? `\n━━ ${echecs} écart(s) — le juge ne distingue PAS ce qu'il annonce`
    : `\n━━ toutes les causes distinguées, canal ouvert et canal discriminant séparés`,
);
process.exit(echecs ? 1 : 0);
