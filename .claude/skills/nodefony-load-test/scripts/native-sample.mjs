// ─────────────────────────────────────────────────────────────────────────────
// Lit une capture `sample <pid> <s> -file <f>` (macOS) et rend le temps PROPRE
// du fil principal, par famille et par frame, en µs par requête — et, quand la
// table `perf.map` du process est posée à côté de la capture, QUI l'a payé :
// chaque échantillon natif est imputé à son premier ancêtre JavaScript.
//
// Pourquoi : le profileur V8 (`--cpu-prof`) ne voit que le JavaScript ; sur le
// banc de #508 il laissait échapper ~40 % du CPU du fil (C++ de Node, runtime
// V8, builtins, noyau). `sample` échantillonne TOUTE la pile, sans droits root,
// mais les frames JIT y sont anonymes (`???  [0x…]`). `node --perf-basic-prof`
// écrit `/tmp/perf-<pid>.map` (adresse, taille, nom de chaque code JS compilé) :
// c'est ce qui NOMME ces frames. `node --prof` ne convient pas sous macOS : il
// impute les builtins embarqués à un faux symbole C++.
//
// Usage :
//   node native-sample.mjs <capture> <rps>                      # un camp
//   node native-sample.mjs <capA> <rpsA> <capB> <rpsB> [top=40]  # écart A − B
// Table perf : `<dossier de la capture>/perf.map` si présente (wait-compare.sh
// l'y copie sous NF_NATIVE_SAMPLE=1).
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";
import path from "node:path";

/**
 * Charge une table `perf-<pid>.map` → résolveur adresse → nom JS (sans le
 * marqueur de palier `~ ^ + *`, pour qu'une fonction garde UN nom quel que soit
 * son niveau d'optimisation), ou `null` si la table est absente.
 */
export function loadPerfMap(file) {
  if (!fs.existsSync(file)) return null;
  const entries = [];
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = /^([0-9a-f]+) ([0-9a-f]+) (.*)$/.exec(line);
    if (!m) continue;
    const start = Number.parseInt(m[1], 16);
    const name = m[3]
      .replace(/^JS:[~^+*]?'?/, "JS: ")
      .replace(/file:\/\/\S*?\/(src|node_modules)\//, "$1/");
    entries.push([start, start + Number.parseInt(m[2], 16), name]);
  }
  entries.sort((a, b) => a[0] - b[0]);
  return (addr) => {
    let lo = 0;
    let hi = entries.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const e = entries[mid];
      if (addr < e[0]) hi = mid - 1;
      else if (addr >= e[1]) lo = mid + 1;
      else return e[2];
    }
    return null;
  };
}

const isJs = (name) => name.startsWith("JS: ");

/**
 * Arbre du fil principal → temps propre par frame, et imputation de chaque
 * échantillon propre NON-JS à son premier ancêtre JS (`callers`).
 *
 * @returns `{ self: Map<frame, n>, callers: Map<fonction JS, Map<famille, n>>, total }`
 */
export function parseMainThread(file, resolve = null) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let i = lines.findIndex((l) => /Thread_\d+.*com\.apple\.main-thread/.test(l));
  if (i < 0) throw new Error(`fil principal introuvable dans ${file}`);
  const rootDepth = lines[i].search(/\d/);
  const total = Number(/^\s*(\d+)/.exec(lines[i])[1]);
  const self = new Map();
  const callers = new Map();
  const stack = []; // { depth, name, count, childSum, js }
  const flush = (upTo) => {
    while (stack.length && stack.at(-1).depth >= upTo) {
      const n = stack.pop();
      const own = n.count - n.childSum;
      if (own <= 0) continue;
      self.set(n.name, (self.get(n.name) ?? 0) + own);
      const owner = isJs(n.name) ? n.name : (n.js ?? "(aucun JS au-dessus)");
      const fam = family(n.name);
      let byFam = callers.get(owner);
      if (!byFam) callers.set(owner, (byFam = new Map()));
      byFam.set(fam, (byFam.get(fam) ?? 0) + own);
    }
  };
  for (i++; i < lines.length; i++) {
    const l = lines[i];
    const depth = l.search(/\d/);
    if (depth <= rootDepth || !/^[\s+!:|]+\d+ /.test(l)) break;
    const m = /^[\s+!:|]*(\d+) (.*)$/.exec(l);
    const count = Number(m[1]);
    let name = null;
    if (resolve && m[2].startsWith("???")) {
      const addr = /\[0x([0-9a-f]+)/.exec(m[2]);
      if (addr) name = resolve(Number.parseInt(addr[1], 16));
    }
    name ??= m[2]
      // offsets simples ou multiples (« + 10,20  [0x…,0x…] ») : même frame
      .replace(/\s+\+ [\d,.]+\s+\[.*$/, "")
      .replace(/\s+\[0x.*$/, "")
      .replace(/ \(\.cold\.\d+\)/, "")
      .trim();
    flush(depth);
    const parent = stack.at(-1);
    if (parent) parent.childSum += count;
    const js = isJs(name) ? name : (parent?.js ?? null);
    stack.push({ depth, name, count, childSum: 0, js });
  }
  flush(-1);
  return { self, callers, total };
}

/** Famille d'une frame — le découpage qui dit OÙ part le temps hors JS. */
export function family(name) {
  if (isJs(name)) return "JS (nommé)";
  if (name.startsWith("???")) return "JS compilé (JIT, non nommé)";
  if (/\(in libsystem_kernel\.dylib\)/.test(name))
    return "noyau (appels système)";
  if (/Heap|Scaveng|MarkCompact|GC|Sweep|Evacuat|Marking/.test(name))
    return "V8 GC";
  if (name.startsWith("Builtins_")) return "V8 builtins";
  if (
    /Runtime_|v8::internal::(Dictionary|HashTable|BaseNameDictionary|Map::|JSObject|LookupIterator|Object::)/.test(
      name,
    )
  )
    return "V8 runtime (objets lents, dictionnaires)";
  if (/Compil|Maglev|Turbofan|compiler::|Deoptim|Deopt/.test(name))
    return "V8 compilation / désopt.";
  if (/String|Intl::|FastAsciiConvert|JsonStringif|ArrayJoin/.test(name))
    return "V8 chaînes (internement, casse, JSON)";
  if (/v8::internal::|v8::/.test(name)) return "V8 autre";
  if (/llhttp|http_parser/.test(name)) return "parseur HTTP";
  if (/^uv_|^uv__|\(in libuv/.test(name)) return "libuv";
  if (/node::/.test(name)) return "Node C++";
  if (/\(in libsystem_/.test(name)) return "libc / malloc";
  return "autre";
}

function summarize(file, rps) {
  const resolve = loadPerfMap(path.join(path.dirname(file), "perf.map"));
  const { self, callers, total } = parseMainThread(file, resolve);
  const usPerReq = 1e6 / rps;
  const toUs = (n) => (n / total) * usPerReq;
  const fam = new Map();
  for (const [k, v] of self) fam.set(family(k), (fam.get(family(k)) ?? 0) + v);
  const owner = new Map();
  for (const [k, byFam] of callers)
    owner.set(
      k,
      [...byFam.values()].reduce((a, b) => a + b, 0),
    );
  return { self, callers, owner, total, toUs, fam, usPerReq, named: !!resolve };
}

/** « 3,1 builtins · 0,8 chaînes » — ce qu'une fonction JS paie, par famille. */
const breakdown = (S, k) =>
  [...(S.callers.get(k) ?? new Map())]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(
      ([f, n]) =>
        `${S.toUs(n).toFixed(2)} ${f.split(" ")[0].toLowerCase()}${f.includes("chaînes") ? "/chaînes" : ""}`,
    )
    .join(" · ");

const isMain = import.meta.url === `file://${process.argv[1]}`;
const args = isMain ? process.argv.slice(2) : null;
const fmt = (x) => x.toFixed(2).padStart(7);
if (!args) {
  // importé comme bibliothèque
} else if (args.length === 2) {
  const s = summarize(args[0], Number(args[1]));
  console.log(
    `${s.total} échantillons, ${s.usPerReq.toFixed(1)} µs/req (fil saturé)\n`,
  );
  for (const [k, v] of [...s.fam].sort((a, b) => b[1] - a[1]))
    console.log(`${fmt(s.toUs(v))} µs  ${k}`);
  console.log("");
  for (const [k, v] of [...s.self].sort((a, b) => b[1] - a[1]).slice(0, 40))
    console.log(`${fmt(s.toUs(v))} µs  ${k.slice(0, 150)}`);
  if (s.named) {
    console.log(
      "\nQUI paie — fonction JS, temps propre + natif appelé (top 40) :",
    );
    for (const [k, v] of [...s.owner].sort((a, b) => b[1] - a[1]).slice(0, 40))
      console.log(
        `${fmt(s.toUs(v))} µs  ${k.slice(0, 110)}   [${breakdown(s, k)}]`,
      );
  }
} else if (args.length >= 4) {
  const A = summarize(args[0], Number(args[1]));
  const B = summarize(args[2], Number(args[3]));
  const top = Number(args[4] ?? 40);
  console.log(
    `A : ${A.usPerReq.toFixed(1)} µs/req · B : ${B.usPerReq.toFixed(1)} µs/req · écart ${(A.usPerReq - B.usPerReq).toFixed(1)}\n`,
  );
  console.log("      A        B    A−B  famille");
  const fams = new Set([...A.fam.keys(), ...B.fam.keys()]);
  const famRows = [...fams].map((k) => [
    k,
    A.toUs(A.fam.get(k) ?? 0),
    B.toUs(B.fam.get(k) ?? 0),
  ]);
  for (const [k, a, b] of famRows.sort((x, y) => y[1] - y[2] - (x[1] - x[2])))
    console.log(`${fmt(a)} ${fmt(b)} ${fmt(a - b)}  ${k}`);
  console.log(`\n      A        B    A−B  frame (top ${top} par écart absolu)`);
  const keys = new Set([...A.self.keys(), ...B.self.keys()]);
  const rows = [...keys].map((k) => [
    k,
    A.toUs(A.self.get(k) ?? 0),
    B.toUs(B.self.get(k) ?? 0),
  ]);
  for (const [k, a, b] of rows
    .sort((x, y) => Math.abs(y[1] - y[2]) - Math.abs(x[1] - x[2]))
    .slice(0, top))
    console.log(`${fmt(a)} ${fmt(b)} ${fmt(a - b)}  ${k.slice(0, 140)}`);
  // Les fonctions des deux camps ne portent pas les mêmes noms : pas d'écart
  // fonction par fonction, mais deux listes — qui paie quoi, dans chaque camp.
  for (const label of ["A", "B"]) {
    const S = label === "A" ? A : B;
    if (!S.named) {
      console.log(
        `\n(${label} : pas de perf.map à côté de la capture — imputation indisponible)`,
      );
      continue;
    }
    console.log(
      `\n${label} — QUI paie : fonction JS, propre + natif appelé (top ${top})`,
    );
    for (const [k, v] of [...S.owner].sort((a, b) => b[1] - a[1]).slice(0, top))
      console.log(
        `${fmt(S.toUs(v))} µs  ${k.slice(0, 110)}   [${breakdown(S, k)}]`,
      );
  }
} else {
  console.error(
    "usage : native-sample.mjs <capture> <rps> [<captureB> <rpsB> [top]]",
  );
  process.exit(2);
}
