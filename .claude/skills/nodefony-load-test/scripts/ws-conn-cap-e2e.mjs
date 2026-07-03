// Banc e2e du BACKSTOP de connexions WS concurrentes par IP (@nodefony/http, F6c
// revue 0.6) — sans navigateur. Prouve le CÂBLAGE bout-en-bout du plafond OPT-IN :
// au-delà de `wsMaxConnectionsPerIp` sockets simultanément ouvertes depuis une même
// IP, l'upgrade est fermé (RFC 6455 close 1013). Distinct du rate-limit (débit) : ici
// ce sont des sockets HELD open EN MÊME TEMPS (pas une rafale séquentielle).
//
// ⚠️ Backstop PAR PROCESS (le vrai plafond global/IP = ingress). Ce banc valide juste
// que le knob n'est pas mort (cf F9 : une clé de config qui ne pilote rien).
//
// Prérequis : serveur dev booté AVEC le cap activé (bas pour un run net) :
//   NF__HTTP__WSMAXCONNECTIONSPERIP=3 bash .claude/skills/nodefony-start-server/start.sh
// Lancement (racine repo) :
//   node .claude/skills/nodefony-load-test/scripts/ws-conn-cap-e2e.mjs
// Env du banc : WS_URL (défaut wss://127.0.0.1:5152/nodefony/test/ws/echo) · N (défaut 8)
import WebSocket from "ws";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const WS_URL =
  process.env.WS_URL ?? "wss://127.0.0.1:5152/nodefony/test/ws/echo";
const N = Number(process.env.N ?? 8);

// Ouvre une socket et la TIENT ouverte ; résout { open, closeCode }. On garde toutes
// les sockets vivantes jusqu'à la fin (le cap CONCURRENT n'a de sens que si elles se
// chevauchent) → les excédentaires reçoivent 1013 pendant que les autres tiennent.
const held = [];
function openHeld() {
  return new Promise((res) => {
    const ws = new WebSocket(WS_URL, { rejectUnauthorized: false });
    held.push(ws);
    let settled = false;
    const done = (o) => {
      if (!settled) {
        settled = true;
        res(o);
      }
    };
    let opened = false;
    ws.on("open", () => {
      opened = true;
      // reste ouvert : on ne resout PAS tout de suite, on laisse une chance à un
      // éventuel close 1013 tardif — mais en pratique le cap ferme AVANT/juste après
      // l'open. On résout après un court délai si pas de close.
      setTimeout(() => done({ open: true, closeCode: null }), 300);
    });
    ws.on("close", (code) => done({ open: opened, closeCode: code }));
    ws.on("error", () => done({ open: false, closeCode: null }));
  });
}

const fails = [];
const ok = (cond, msg) => {
  if (!cond) fails.push(msg);
};

// Ouvre N sockets EN PARALLÈLE (elles se chevauchent → teste le cap concurrent).
const results = await Promise.all(Array.from({ length: N }, openHeld));
const alive = held.filter((w) => w.readyState === WebSocket.OPEN).length;
const rejected1013 = results.filter((r) => r.closeCode === 1013).length;

// Sonde : si AUCUN 1013 et TOUTES vivantes, soit le cap est désactivé, soit ≥ N.
if (rejected1013 === 0 && alive === N) {
  console.error(
    `✗ Aucune connexion refusée (${alive}/${N} vivantes). Le cap est-il activé et < ${N} ?\n` +
      "  Relance le serveur avec :\n" +
      "  NF__HTTP__WSMAXCONNECTIONSPERIP=3 bash .claude/skills/nodefony-start-server/start.sh",
  );
  for (const w of held)
    try {
      w.close();
    } catch {}
  process.exit(2);
}

ok(
  rejected1013 >= 1,
  `≥ 1 connexion au-delà du plafond refusée (close 1013) — obtenu ${rejected1013}`,
);
ok(
  alive >= 1,
  `≥ 1 connexion sous le plafond reste OUVERTE (obtenu ${alive} vivantes)`,
);

console.log(`\nOuverture de ${N} sockets concurrentes depuis une même IP :`);
console.log(`  vivantes (sous le plafond)          : ${alive}`);
console.log(`  refusées (close 1013 « too many »)  : ${rejected1013}`);

for (const w of held)
  try {
    w.close();
  } catch {}

if (fails.length) {
  console.error(`\n✗ ÉCHEC (${fails.length}) :`);
  fails.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}
console.log(
  "\n✓ Cap connexions WS concurrentes/IP e2e — le backstop opt-in est câblé (close 1013 au-delà du plafond).",
);
setTimeout(() => process.exit(0), 300);
