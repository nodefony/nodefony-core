// ─────────────────────────────────────────────────────────────────────────────
// Lit une capture `sample <pid> <s> -file <f>` (macOS) et rend le temps PROPRE
// du fil principal, par famille et par frame, en µs par requête.
//
// Pourquoi : le profileur V8 (`--cpu-prof`) ne voit que le JavaScript ; sur le
// banc de #508 il laissait échapper ~40 % du CPU du fil (C++ de Node, runtime
// V8, builtins, noyau). `sample` échantillonne TOUTE la pile, sans droits root.
// Les frames JIT y sont anonymes (`???`) : comptées en bloc.
//
// Usage :
//   node native-sample.mjs <capture> <rps>                      # un camp
//   node native-sample.mjs <capA> <rpsA> <capB> <rpsB> [top=40]  # écart A − B
// ─────────────────────────────────────────────────────────────────────────────
import fs from "node:fs";

/** Arbre du fil principal → Map<frame, échantillons propres>, total. */
export function parseMainThread(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let i = lines.findIndex((l) => /Thread_\d+.*com\.apple\.main-thread/.test(l));
  if (i < 0) throw new Error(`fil principal introuvable dans ${file}`);
  const rootDepth = lines[i].search(/\d/);
  const total = Number(/^\s*(\d+)/.exec(lines[i])[1]);
  const self = new Map();
  const stack = []; // { depth, name, count, childSum }
  const flush = (upTo) => {
    while (stack.length && stack.at(-1).depth >= upTo) {
      const n = stack.pop();
      const own = n.count - n.childSum;
      if (own > 0) self.set(n.name, (self.get(n.name) ?? 0) + own);
    }
  };
  for (i++; i < lines.length; i++) {
    const l = lines[i];
    const depth = l.search(/\d/);
    if (depth <= rootDepth || !/^[\s+!:|]+\d+ /.test(l)) break;
    const m = /^[\s+!:|]*(\d+) (.*)$/.exec(l);
    const count = Number(m[1]);
    const name = m[2]
      // offsets simples ou multiples (« + 10,20  [0x…,0x…] ») : même frame
      .replace(/\s+\+ [\d,.]+\s+\[.*$/, "")
      .replace(/\s+\[0x.*$/, "")
      .replace(/ \(\.cold\.\d+\)/, "")
      .trim();
    flush(depth);
    if (stack.length) stack.at(-1).childSum += count;
    stack.push({ depth, name, count, childSum: 0 });
  }
  flush(-1);
  return { self, total };
}

/** Famille d'une frame — le découpage qui dit OÙ part le temps hors JS. */
export function family(name) {
  if (name.startsWith("???")) return "JS compilé (JIT)";
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
  const { self, total } = parseMainThread(file);
  const usPerReq = 1e6 / rps;
  const toUs = (n) => (n / total) * usPerReq;
  const fam = new Map();
  for (const [k, v] of self) fam.set(family(k), (fam.get(family(k)) ?? 0) + v);
  return { self, total, toUs, fam, usPerReq };
}

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
} else {
  console.error(
    "usage : native-sample.mjs <capture> <rps> [<captureB> <rpsB> [top]]",
  );
  process.exit(2);
}
