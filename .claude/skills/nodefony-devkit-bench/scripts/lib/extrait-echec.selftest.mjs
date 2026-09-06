#!/usr/bin/env node
/**
 * Auto-contrôle de l'extrait d'échec — « la cause est-elle DANS ce qu'on
 * montre ? »
 *
 * L'échantillon central n'est pas inventé : c'est la forme exacte de la sortie
 * qui a coûté deux jobs rouges à la forge — une erreur nommée tôt, puis des
 * centaines de réécritures d'une barre de progression qui poussaient la cause
 * hors de la fenêtre. La règle AMPUTÉE (`--prove`) est l'ancienne : « les 1 500
 * derniers caractères », littéralement. Elle doit faire tomber les cas qui
 * portent le défaut ; si elle reste verte, c'est que l'échantillon ne reproduit
 * rien et que l'auto-contrôle ne garde rien.
 *
 * Usage :
 *   node lib/extrait-echec.selftest.mjs
 *   node lib/extrait-echec.selftest.mjs --prove
 */
import { extraitEchec, lignesLisibles } from "./extrait-echec.mjs";

const PROVE = process.argv.includes("--prove");
const ESC = String.fromCharCode(27);

/** L'ANCIENNE règle, mot pour mot : la fin brute de la sortie. */
const amputee = (brut) => String(brut ?? "").slice(-1500);

const regle = PROVE ? amputee : extraitEchec;

/**
 * La sortie qui a produit le défaut : `drizzle-kit` refuse en NOMMANT sa cause,
 * puis déroule sa barre de progression jusqu'à noyer le message.
 */
function sortieMigrationReelle() {
  const l = [];
  l.push("$ npx drizzle-kit pull --config=drizzle.config.ts");
  l.push("Reading config file 'drizzle.config.ts'");
  l.push(
    `${ESC}[31mError: MySQL does not support CHECK constraints on this server${ESC}[0m`,
  );
  l.push("    at PullCommand.run (node_modules/drizzle-kit/bin.cjs:1204:11)");
  // La barre : une seule ligne, réécrite des centaines de fois par `\r`.
  const spin = ["⣾", "⣽", "⣻", "⢿", "⡿", "⣟", "⣯", "⣷"];
  let barre = "";
  for (let i = 0; i < 260; i++)
    barre += `[${spin[i % spin.length]}] ${i}  views fetching\r`;
  l.push(`${barre}[✓] 4  tables fetched`);
  l.push("[✓] 0  views fetched");
  return l.join("\n");
}

const cas = [
  {
    quoi: "la cause NOMMÉE survit à 260 réécritures de la barre de progression",
    calcul: () => regle(sortieMigrationReelle()).includes("does not support"),
    attendu: true,
  },
  {
    quoi: "la queue reste visible — le contexte immédiat de l'arrêt",
    calcul: () => regle(sortieMigrationReelle()).includes("tables fetched"),
    attendu: true,
  },
  {
    quoi: "l'extrait tient dans son budget",
    calcul: () => regle(sortieMigrationReelle()).length <= 1500,
    attendu: true,
  },
  {
    quoi: "une pile d'erreur `npm ERR!` émise tôt est gardée",
    calcul: () => {
      const brut = [
        "npm ERR! code ELIFECYCLE",
        "npm ERR! errno 1",
        ...Array.from({ length: 400 }, (_, i) => `  ok ${i}  rien à signaler`),
      ].join("\n");
      return regle(brut).includes("ELIFECYCLE");
    },
    attendu: true,
  },
  {
    quoi: "un refus du PRODUIT, en français, est gardé",
    calcul: () => {
      const brut = [
        "nodefony: module @app/blog introuvable dans le manifeste",
        ...Array.from({ length: 400 }, (_, i) => `  chargé ${i}  service ok`),
      ].join("\n");
      return regle(brut).includes("introuvable");
    },
    attendu: true,
  },
  {
    quoi: "une sortie courte est rendue ENTIÈRE, sans mention d'écart",
    calcul: () => {
      const brut = "ligne A\nligne B\nligne C";
      return regle(brut) === brut;
    },
    attendu: true,
  },
  {
    quoi: "ce qui est écarté est DIT (un extrait muet se lit comme un tout)",
    calcul: () => {
      const brut = Array.from(
        { length: 400 },
        (_, i) => `  étape ${i} terminée`,
      ).join("\n");
      return /\d+ ligne\(s\) écartée\(s\)/u.test(regle(brut));
    },
    attendu: true,
  },
];

/** Ce que seule la NOUVELLE règle sait faire — non muté, donc hors `--prove`. */
const casPurs = [
  {
    quoi: "un retour chariot n'ouvre pas une ligne : la barre tient en UNE",
    calcul: () => lignesLisibles("a\rb\rc\nsuite").length === 2,
    attendu: true,
  },
  {
    quoi: "les codes ANSI sont retirés",
    calcul: () => lignesLisibles(`${ESC}[31mrouge${ESC}[0m`)[0] === "rouge",
    attendu: true,
  },
  {
    quoi: "une sortie vide rend une chaîne vide, pas du bruit",
    calcul: () => extraitEchec("") === "" && extraitEchec(null) === "",
    attendu: true,
  },
  {
    quoi: "un crochet qui n'est PAS de l'ANSI survit — `[✓] 4 tables`",
    calcul: () => lignesLisibles("[✓] 4  tables fetched")[0].includes("[✓]"),
    attendu: true,
  },
];

let verts = 0;
let rouges = 0;
for (const c of [...cas, ...(PROVE ? [] : casPurs)]) {
  const obtenu = c.calcul();
  const ok = obtenu === c.attendu;
  if (ok) verts += 1;
  else rouges += 1;
  process.stdout.write(`  ${ok ? "✅" : "❌"} ${c.quoi}\n`);
}

if (PROVE) {
  // L'ancienne règle garde la fin brute : la cause nommée tôt disparaît, et
  // rien ne signale l'écart. Trois cas au moins doivent tomber.
  const attendus = 3;
  if (rouges < attendus) {
    process.stdout.write(
      `\n❌ règle amputée : ${rouges} cas tombé(s), ${attendus} attendus — ` +
        `les échantillons ne reproduisent pas la sortie qui a coûté deux jobs\n`,
    );
    process.exit(2);
  }
  process.stdout.write(
    `\n✅ amputée, la règle fait tomber ${rouges} cas — elle mord bien\n`,
  );
  process.exit(0);
}

process.stdout.write(
  `\n━━ ${verts}/${cas.length + casPurs.length} : l'extrait porte la cause\n`,
);
process.exit(rouges === 0 ? 0 : 1);
