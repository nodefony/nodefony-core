/**
 * Auto-contrôle de la COLLECTE — tous les juges, sans aucune application.
 *
 * Les auto-contrôles de ce dossier éprouvent chacun la fonction de JUGEMENT de
 * son juge, sur des faits déjà collectés. C'est utile et insuffisant : les
 * défauts qui ont coûté le plus cher ici étaient dans la COLLECTE, en amont de
 * tout jugement — un `ReferenceError` à la première ligne, une sortie qui oublie
 * de nommer sa cause. Aucun contrôle par juge ne les voit, parce qu'aucun ne
 * lance le juge.
 *
 * Celui-ci lance TOUS les juges, dans un décor volontairement VIDE : un dossier
 * temporaire, un port libre, aucune application. Chacun doit alors se comporter
 * en juge : sortir en rouge, et NOMMER sa cause.
 *
 * Ce qu'il exige, et pourquoi chaque exigence a un mort au tableau :
 *
 * | Exigence                        | Ce qu'elle ferme                            |
 * | ------------------------------- | ------------------------------------------- |
 * | sortie non nulle                | un juge VERT sans application ne mesure rien |
 * | une ligne `CAUSE=`              | un rouge muet est OPPOSABLE À L'AGENT        |
 * | aucune signature de plantage    | un juge cassé se lit comme un agent fautif   |
 *
 * La deuxième est la moins évidente et la plus chère. Le banc n'écarte un rouge
 * que si une cause nommée porte une imputation qui n'accuse pas l'agent ; sans
 * `CAUSE=`, le rouge lui reste imputé. Un juge qui sait parfaitement que « le
 * décor n'a pas répondu » mais ne le DIT pas fait donc condamner l'agent pour
 * une panne d'instrument — et son code source, lui, a l'air juste.
 *
 * Ce contrôle ne remplace pas les auto-contrôles par juge : il ne dit rien de
 * la JUSTESSE d'un verdict. Il dit seulement qu'aucun juge ne se tait.
 *
 * Usage : `node lib/juges-collecte.selftest.mjs`
 * Sorties : `0` tous les juges parlent · `1` au moins un se tait ou se casse.
 *
 * @module
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { portLibre } from "./http-probe.mjs";
import { estUnPlantageDeJuge } from "./imputation.mjs";

const ICI = path.dirname(fileURLToPath(import.meta.url));

/** Les juges, tels qu'ils sont sur le disque — pas une liste écrite à la main. */
const juges = fs
  .readdirSync(ICI)
  .filter((n) => /^gate-.*\.mjs$/u.test(n) && !n.includes(".selftest."))
  .sort();

let echecs = 0;
const dire = (ok, nom, detail) => {
  if (!ok) echecs++;
  console.log(`${ok ? "✅" : "❌"} ${nom.padEnd(28)} ${detail}`);
};

// Un décor VIDE : aucun fichier du dépôt ne doit influer sur ce que rend un
// juge. Le lancer depuis la racine ferait lire à certains des fichiers qui
// n'existent jamais dans une application témoin.
const vide = fs.mkdtempSync(path.join(os.tmpdir(), "nf-juges-collecte-"));

try {
  for (const nom of juges) {
    const port = await portLibre();
    const r = spawnSync(process.execPath, [path.join(ICI, nom)], {
      cwd: vide,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, NF_PORT: String(port) },
    });
    const sortie = `${r.stderr ?? ""}\n${r.stdout ?? ""}`;
    const cause = sortie
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("CAUSE="));
    const plante = estUnPlantageDeJuge(sortie);

    if (r.status === 0) {
      dire(false, nom, "VERT sans application — ce juge ne mesure rien");
      continue;
    }
    if (plante) {
      dire(
        false,
        nom,
        `PLANTAGE : ${(sortie.split("\n").find((l) => l.trim()) ?? "").trim().slice(0, 70)}`,
      );
      continue;
    }
    if (!cause) {
      dire(
        false,
        nom,
        `exit ${r.status} SANS \`CAUSE=\` — ce rouge sera imputé À L'AGENT`,
      );
      continue;
    }
    dire(true, nom, `exit ${r.status}  ${cause.slice(6, 52)}`);
  }
} finally {
  fs.rmSync(vide, { recursive: true, force: true });
}

console.log(
  echecs
    ? `\n━━ ${echecs} juge(s) se taisent ou se cassent — leurs rouges accusent l'agent`
    : `\n━━ ${juges.length} juges : tous parlent, aucun ne se casse`,
);
process.exit(echecs ? 1 : 0);
