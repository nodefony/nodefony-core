/**
 * Auto-contrôle du juge de la PORTE CLIENTE.
 *
 * Il éprouve `jugerPorteClient`, qui est PURE : aucune application n'est
 * montée, aucun fichier n'est lu. La règle qu'il garde est celle que le banc
 * n'appliquait pas — le critère client suit le moteur RÉELLEMENT choisi, pas
 * celui du gabarit qu'on avait sous les yeux en écrivant la sonde.
 *
 * `--prove` mute le VRAI module et exige que des cas tombent, la ligne TÉMOIN
 * comprise : sans elle, une mutation qui « tombe » ne prouve pas qu'elle est
 * tombée pour sa règle.
 *
 * @module
 */
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MODULE =
  process.argv.indexOf("--module") === -1
    ? "./gate-porte-client.mjs"
    : path.resolve(process.argv[process.argv.indexOf("--module") + 1]);
const { jugerPorteClient, sourcesDe } = await import(MODULE);

const PROVE =
  process.argv.includes("--prove") && MODULE === "./gate-porte-client.mjs";
const ici = path.dirname(fileURLToPath(import.meta.url));
let verts = 0;
const rouges = [];

/**
 * @param {string} nom - ce qu'on affirme.
 * @param {boolean} condition - le fait.
 */
function cas(nom, condition) {
  if (condition) verts += 1;
  else rouges.push(nom);
}

const pkgDe = (marker) => ({
  dependencies: { nodefony: "10.0.0" },
  devDependencies: marker ? { [marker]: "1.0.0" } : {},
});

// ── Chaque moteur est jugé sur SA porte ─────────────────────────────────────
cas(
  "Svelte : la porte svelte est acceptée",
  jugerPorteClient(pkgDe("svelte"), [
    'import { useChannel } from "nodefony/svelte";',
  ]).code === 0,
);

// 🔴 LE cas qui fonde tout : avec l'ancien critère écrit en dur, cette
// application rendait un FAUX ROUGE sur un travail juste.
cas(
  "Svelte : la porte de REACT ne suffit PAS",
  jugerPorteClient(pkgDe("svelte"), [
    'import { useChannel } from "nodefony/react";',
  ]).cause === "porte-client-absente",
);

cas(
  "Vue : la porte vue est acceptée",
  jugerPorteClient(pkgDe("vue"), ['import { useChannel } from "nodefony/vue";'])
    .code === 0,
);

cas(
  "Angular : reconnu par @angular/core, pas par « angular »",
  jugerPorteClient(pkgDe("@angular/core"), [
    'import { ChannelService } from "nodefony/angular";',
  ]).code === 0,
);

cas(
  "React : la porte react est acceptée",
  jugerPorteClient(pkgDe("react"), [
    'import { useChannel } from "nodefony/react";',
  ]).code === 0,
);

cas(
  "sans moteur front : la façade isomorphe de base est exigée",
  jugerPorteClient(pkgDe(null), ['import { Client } from "nodefony/client";'])
    .code === 0,
);

cas(
  "la façade RealtimeClient est acceptée quel que soit le moteur",
  jugerPorteClient(pkgDe("vue"), ["const c = new RealtimeClient({ url });"])
    .code === 0,
);

// ── Un client recomposé à la main ne passe pas ──────────────────────────────
cas(
  "WebSocket bricolé : la porte manque, et c'est l'AGENT",
  (() => {
    const v = jugerPorteClient(pkgDe("svelte"), [
      'const ws = new WebSocket("wss://…");',
    ]);
    return v.code === 1 && v.cause === "porte-client-absente";
  })(),
);

cas(
  "aucune source : la porte manque, pas de verdict inventé",
  jugerPorteClient(pkgDe("react"), []).cause === "porte-client-absente",
);

// ── L'instrument se tait plutôt que de deviner ──────────────────────────────
cas(
  "deux moteurs signés ⇒ INSTRUMENT, verdict non rendu",
  (() => {
    const v = jugerPorteClient(
      { devDependencies: { react: "19", svelte: "5" } },
      ['import "nodefony/react";'],
    );
    return v.code === 3 && v.cause === "moteur-front-ambigu";
  })(),
);

cas(
  "manifeste illisible ⇒ INSTRUMENT, jamais l'agent",
  (() => {
    const v = jugerPorteClient(null, ['import "nodefony/react";']);
    return v.code === 2 && v.cause === "manifeste-illisible";
  })(),
);

// ── sourcesDe — les extensions des moteurs qui écrivent DANS le composant ───
// Un juge borné aux extensions TypeScript serait aveugle là précisément où
// Svelte et Vue écrivent leur logique : la même faute que le critère
// React-centré, un cran plus bas.
{
  const tmp = path.join(ici, `.selftest-sources-${process.pid}`);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(path.join(tmp, "frontend", "src"), { recursive: true });
  mkdirSync(path.join(tmp, "node_modules", "piege"), { recursive: true });
  writeFileSync(path.join(tmp, "frontend", "src", "App.svelte"), "x");
  writeFileSync(path.join(tmp, "frontend", "src", "Vue.vue"), "x");
  writeFileSync(path.join(tmp, "frontend", "src", "main.ts"), "x");
  writeFileSync(path.join(tmp, "node_modules", "piege", "index.ts"), "x");
  const vus = new Set(sourcesDe(tmp).map((p) => path.basename(p)));
  cas("un composant .svelte est LU", vus.has("App.svelte"));
  cas("un composant .vue est LU", vus.has("Vue.vue"));
  cas("node_modules n'est jamais lu", !vus.has("index.ts"));
  rmSync(tmp, { recursive: true, force: true });
}

// ── --prove ─────────────────────────────────────────────────────────────────
if (PROVE) {
  const source = readFileSync(path.join(ici, "gate-porte-client.mjs"), "utf8");
  const mutations = [
    {
      // Elle ne change RIEN, et le contrôle doit rester VERT : sans ce témoin,
      // une mutation qui tombe ne prouve pas qu'elle tombe pour SA règle.
      regle: "TÉMOIN — une mutation inoffensive ne fait tomber personne",
      de: " * @module",
      vers: " * @module (témoin)",
      temoin: true,
    },
    {
      // Le critère React-centré, restauré à l'identique.
      regle: "la porte exigée suit le moteur choisi",
      de: "  const motif = motifPorteClient(porte.subpath);",
      vers: '  const motif = motifPorteClient("nodefony/react");',
    },
    {
      // Deviner entre deux moteurs, c'est juger sur le mauvais critère.
      regle: "l'ambiguïté est imputée à l'INSTRUMENT",
      de: "  if (!porte.ok) {",
      vers: "  if (false) {",
    },
    {
      // Sans les extensions des composants, Svelte et Vue sont invisibles.
      regle: "les composants .svelte et .vue sont lus",
      de: "const EXTENSIONS = /\\.(?:[cm]?[jt]sx?|svelte|vue)$/u;",
      vers: "const EXTENSIONS = /\\.[cm]?[jt]sx?$/u;",
    },
  ];
  console.log(
    "\n━━ --prove : mutation de chaque règle (le contrôle doit TOMBER)",
  );
  const moi = fileURLToPath(import.meta.url);
  for (const m of mutations) {
    if (!source.includes(m.de)) {
      rouges.push(
        `[--prove] ancre introuvable pour « ${m.regle} » — mutation MORTE`,
      );
      continue;
    }
    // À CÔTÉ du module : ses imports relatifs doivent continuer de résoudre.
    const copie = path.join(
      ici,
      `.prove-gate-porte-client.${mutations.indexOf(m)}.mjs`,
    );
    writeFileSync(copie, source.replace(m.de, m.vers));
    const r = spawnSync(process.execPath, [moi, "--module", copie], {
      encoding: "utf8",
    });
    rmSync(copie, { force: true });
    const attenduVert = m.temoin === true;
    if ((r.status === 0) === attenduVert) {
      verts += 1;
      console.log(
        `  ✅ ${m.regle} — ${attenduVert ? "le contrôle reste vert" : "le contrôle tombe"}`,
      );
    } else if (attenduVert) {
      rouges.push(
        `[--prove] TÉMOIN tombé : les mutations ne prouvent PAS leur règle ` +
          `(${(r.stderr ?? "").split("\n")[0] || `exit ${r.status}`})`,
      );
      console.log(
        `  ❌ ${m.regle} — il tombe sans raison, les verdicts sont NULS`,
      );
    } else {
      rouges.push(`[--prove] « ${m.regle} » mutée : RIEN n'est tombé`);
      console.log(`  ❌ ${m.regle} — le contrôle reste vert, il ne garde rien`);
    }
  }
}

console.log(
  rouges.length === 0
    ? `✅ gate-porte-client.selftest — ${verts} cas, le critère suit le moteur`
    : `❌ gate-porte-client.selftest — ${rouges.length} rouge(s) :\n   ${rouges.join("\n   ")}`,
);
process.exit(rouges.length === 0 ? 0 : 1);
