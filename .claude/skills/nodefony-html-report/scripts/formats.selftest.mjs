#!/usr/bin/env node
/**
 * Auto-contrôle des FORMATS d'un rapport et du tri de ses tableaux.
 *
 * Ces deux-là ne se corrigent jamais l'un sans l'autre, et c'est tout l'objet de
 * ce fichier. Le point décimal anglais est resté longtemps dans `fmt.dec` pour
 * une raison précise : le tri des tableaux relisait le TEXTE affiché en effaçant
 * tout sauf les chiffres et les points. Une virgule décimale y devenait un
 * séparateur de milliers — « 4,66 » lu « 466 » — et la colonne se triait à
 * l'envers, sans le moindre message. Passer les nombres en français exigeait
 * donc de réparer le tri d'abord.
 *
 * ```bash
 * node .claude/skills/nodefony-html-report/scripts/formats.selftest.mjs
 * ```
 */
import { fmt, nombreDepuisTexte } from "../lib/report.mjs";

let rouges = 0;
const cas = (nom, obtenu, attendu) => {
  const ok = Object.is(obtenu, attendu) || obtenu === attendu;
  if (!ok) rouges += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${nom}${ok ? "" : ` — attendu « ${attendu} », obtenu « ${obtenu} »`}`,
  );
};
/** Les espaces de groupement varient selon l'ICU : on compare sur une forme normalisée. */
const sansEspaces = (s) => String(s).replace(/[\s  ]/g, " ");

console.log("━━ les nombres s'écrivent en français");
cas("un entier groupe ses milliers", sansEspaces(fmt.int(12226)), "12 226");
cas("un décimal porte une VIRGULE", sansEspaces(fmt.dec(4.66)), "4,7");
cas("deux décimales", sansEspaces(fmt.dec(12226.4567, 2)), "12 226,46");
cas("un pourcentage", sansEspaces(fmt.pct(0.9257, 1)), "92,6 %");
cas("une durée courte", sansEspaces(fmt.ms(0.57)), "0,57 ms");
cas("une durée longue passe en secondes", sansEspaces(fmt.ms(1250)), "1,25 s");
cas("des octets", sansEspaces(fmt.bytes(1536)), "1,5 Ko");
cas("une valeur absente rend un tiret", fmt.dec(null), "—");

console.log("━━ le tri relit ces mêmes nombres");
const lu = (t) => nombreDepuisTexte(t);
cas("« 12 226,45 » se relit entier", lu("12 226,45"), 12226.45);
cas("« 4,66 » n'est PAS lu 466", lu("4,66"), 4.66);
cas("une unité collée n'empêche rien", lu("245 Mo"), 245);
cas("un pourcentage", lu("92,6 %"), 92.6);
cas("un négatif garde son signe", lu("-0,04"), -0.04);
cas("un entier groupé", lu("12 226"), 12226);
cas("un texte ne rend pas un nombre", Number.isNaN(lu("indisponible")), true);

console.log("━━ l'aller-retour : ce qui est ÉCRIT doit se relire");
for (const v of [0, 1, 4.66, 12226, 12226.45, -0.04, 1234567.89]) {
  const relu = nombreDepuisTexte(fmt.dec(v, 2));
  const ok = Math.abs(relu - Number(v.toFixed(2))) < 1e-9;
  if (!ok) rouges += 1;
  console.log(
    `  ${ok ? "✅" : "❌"} ${v} → « ${sansEspaces(fmt.dec(v, 2))} » → ${relu}`,
  );
}

console.log(
  "━━ témoin fautif — l'ANCIENNE lecture doit échouer sur le français",
);
// La règle d'avant : effacer tout sauf chiffres et points.
const ancienne = (v) => parseFloat(String(v).replace(/[^\d.-]/g, ""));
const ancienRes = ancienne("4,66");
const detecte = ancienRes !== 4.66;
if (!detecte) rouges += 1;
console.log(
  `  ${detecte ? "✅" : "❌"} l'ancienne lecture rend ${ancienRes} sur « 4,66 » — c'est le défaut que ce fichier garde fermé`,
);

console.log(
  rouges === 0
    ? "\n━━ tout vert — formats et tri d'accord"
    : `\n━━ ${rouges} ROUGE(S)`,
);
process.exit(rouges === 0 ? 0 : 1);
