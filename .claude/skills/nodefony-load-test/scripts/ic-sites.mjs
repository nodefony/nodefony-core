// ─────────────────────────────────────────────────────────────────────────────
// Lit un journal V8 `--log-ic` et rend les sites d'accès aux propriétés qui ont
// basculé en MÉGAMORPHE (état `N`) — là où V8 renonce au chemin rapide et passe
// par un cache global (`LoadIC_Megamorphic`, `KeyedLoadIC_Megamorphic`…).
//
// Pourquoi : ce coût est DIFFUS (quelques dizaines de ns par accès, sur chaque
// fonction du framework) — un profil le disperse, un micro-banc monomorphe ne le
// voit pas. Le journal, lui, est un COMPTAGE : insensible au thermal et au bruit.
//
// Chaque évènement IC porte l'adresse (`pc`) du code qui a fait l'accès ; il est
// rattaché au DERNIER `code-creation` couvrant cette adresse ET antérieur à
// l'évènement (horodatage) — une adresse réutilisée par V8 ne trompe donc pas.
//
// Décor (depuis la racine, décor de wait-compare.sh) :
//   env NODE_ENV=production NF_LOG_DRIVER=null NF_BENCH_ROUTE=1 NF_WITH_DEV_MODULES=1 PORT=5151 \
//     node --log-ic --logfile=<dir>/v8.log --no-logfile-per-isolate src/nodefony/bin/nodefony production
//   wrk -t4 -c128 -d8s http://127.0.0.1:5151/nodefony/test/als-test/state
// Usage :
//   node ic-sites.mjs <v8.log> [top=40] [filtre=regex sur le fichier]
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";

const IC_TYPES = new Set([
  "LoadIC",
  "StoreIC",
  "KeyedLoadIC",
  "KeyedStoreIC",
  "LoadGlobalIC",
  "StoreInArrayLiteralIC",
]);

/** Découpe une ligne CSV du journal V8 (champs éventuellement entre guillemets). */
function splitLine(line) {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * Journal → sites mégamorphes.
 *
 * @returns `{ sites: Map<clé, {type, where, keys:Set, maps:Set, count}>, unresolved }`
 */
export function parseIcLog(text) {
  const code = []; // [début, fin, nom, temps]
  const events = [];
  for (const line of text.split("\n")) {
    if (line.startsWith("code-creation,")) {
      // code-creation,<type>,<kind>,<temps>,<adresse>,<taille>,<nom>,…
      const f = splitLine(line);
      const start = Number.parseInt(f[4], 16);
      code.push([start, start + Number(f[5]), f[6], Number(f[3])]);
    } else {
      const comma = line.indexOf(",");
      if (comma < 0 || !IC_TYPES.has(line.slice(0, comma))) continue;
      // <type>,<pc>,<temps>,<ligne>,<colonne>,<ancien>,<nouveau>,<map>,<clé>,…
      const f = splitLine(line);
      if (f[6] !== "N") continue;
      events.push(f);
    }
  }
  code.sort((a, b) => a[0] - b[0]);
  let maxLen = 0;
  for (const c of code) maxLen = Math.max(maxLen, c[1] - c[0]);
  const owner = (pc, t) => {
    let lo = 0;
    let hi = code.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (code[mid][0] <= pc) lo = mid + 1;
      else hi = mid - 1;
    }
    let best = null;
    for (let k = hi; k >= 0 && code[k][0] > pc - maxLen; k--) {
      const c = code[k];
      if (pc < c[1] && c[3] <= t && (best === null || c[3] > best[3])) best = c;
    }
    return best;
  };
  const sites = new Map();
  let unresolved = 0;
  for (const f of events) {
    const c = owner(Number.parseInt(f[1], 16), Number(f[2]));
    if (!c) {
      unresolved++;
      continue;
    }
    // nom : « JS:~fn file:///…/x.js:L:C » → fichier de la fonction
    const m = /^(?:JS:)?[~^+*]?(\S*)\s+(\S+?):\d+:\d+$/.exec(c[2]);
    const fn = m ? m[1] || "(anonyme)" : c[2];
    const file = m
      ? m[2]
          .replace(/^file:\/\//, "")
          .replace(/^.*?\/(src|node_modules)\//, "$1/")
      : "?";
    const where = `${file}:${f[3]}:${f[4]}`;
    const key = `${f[0]} ${where}`;
    let s = sites.get(key);
    if (!s)
      sites.set(
        key,
        (s = {
          type: f[0],
          where,
          fn,
          keys: new Set(),
          maps: new Set(),
          count: 0,
        }),
      );
    s.count++;
    if (f[8]) s.keys.add(f[8]);
    s.maps.add(f[7]);
  }
  return { sites, unresolved, events: events.length };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [file, topArg, filter] = process.argv.slice(2);
  if (!file) {
    console.error("usage : ic-sites.mjs <v8.log> [top=40] [filtre]");
    process.exit(2);
  }
  const { sites, unresolved, events } = parseIcLog(
    fs.readFileSync(file, "utf8"),
  );
  const re = filter ? new RegExp(filter) : null;
  const rows = [...sites.values()].filter((s) => !re || re.test(s.where));
  const byFile = new Map();
  for (const s of rows) {
    const f = s.where.replace(/:\d+:\d+$/, "");
    byFile.set(f, (byFile.get(f) ?? 0) + 1);
  }
  console.log(
    `${events} transitions vers mégamorphe · ${sites.size} sites · ${unresolved} non rattachées${re ? ` · filtre ${re} → ${rows.length}` : ""}\n`,
  );
  console.log("sites mégamorphes par fichier :");
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1]).slice(0, 25))
    console.log(`  ${String(n).padStart(4)}  ${f}`);
  console.log(`\nsites (top ${topArg ?? 40}, par nombre de clés vues) :`);
  for (const s of rows
    .sort((a, b) => b.keys.size - a.keys.size || b.count - a.count)
    .slice(0, Number(topArg ?? 40)))
    console.log(
      `  ${s.type.padEnd(12)} ${s.where}  ${s.fn}  clés=${s.keys.size} [${[...s.keys].slice(0, 5).join(",")}]`,
    );
}
