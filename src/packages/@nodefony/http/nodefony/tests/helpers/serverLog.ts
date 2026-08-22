/// <reference types="node" />
import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { randomUUID } from "node:crypto";

/**
 * Le journal que le serveur sous test alimente RÉELLEMENT — découvert, jamais
 * supposé.
 *
 * 🔴 **Le défaut que ce helper existe pour fermer.** Deux bancs lisaient
 * `/tmp/nodefony-server.log`, chemin qui n'est PAS celui du framework : c'est la
 * redirection de sortie du lanceur `start.sh`. Un serveur démarré à la main
 * (`npx nodefony development`) écrit sur SON terminal et dans
 * `logs/nodefony-<pid>.jsonl` — le fichier de `/tmp` reste alors figé sur une
 * exécution d'un autre jour. Le banc du 499 y cherchait sa preuve et rendait un
 * **faux rouge** ; celui de l'abandon client y cherchait une absence et rendait
 * un **faux vert**. Aucun des deux ne savait distinguer « journal non alimenté »
 * de « rien à voir dans le journal ».
 *
 * La découverte se fait donc par un MARQUEUR : on provoque une requête dont le
 * chemin est unique, puis on cherche ce chemin dans les journaux candidats. Le
 * fichier qui le porte est celui de ce serveur — et le fait qu'il le porte
 * prouve, par construction, qu'il est vivant.
 */
export interface IJournalServeur {
  /** Chemin du fichier qui porte les lignes de CE serveur. */
  chemin: string;
  /** Lignes déjà présentes : ce qui suit appartient au test. */
  depuis: number;
}

/** Racine du projet — le premier ancêtre qui porte `nodefony.config.ts`. */
function racineProjet(depart: string): string | null {
  let courant = path.resolve(depart);
  for (;;) {
    if (fs.existsSync(path.join(courant, "nodefony.config.ts"))) return courant;
    const parent = path.dirname(courant);
    if (parent === courant) return null;
    courant = parent;
  }
}

/**
 * Retire les échappements ANSI, sous leurs DEUX formes.
 *
 * Le sink texte écrit l'octet d'échappement ; le JSONL, lui, sérialise la même
 * séquence en `[36m` — six caractères littéraux qu'un filtre écrit pour
 * l'octet ne voit pas. Une couleur activée (serveur lancé dans un terminal)
 * s'intercale alors entre le verbe et le code, et le motif ne mord plus.
 */
export function sansAnsi(texte: string): string {
  return texte.replace(/\[[0-9;]*m/g, "").replace(/\\u001b\[[0-9;]*m/g, "");
}

/** Journaux candidats, du plus récemment écrit au plus ancien. */
function candidats(racine: string | null): string[] {
  const liste: { chemin: string; mtime: number }[] = [];
  if (racine !== null) {
    const dossier = path.join(racine, "logs");
    let noms: string[] = [];
    try {
      noms = fs.readdirSync(dossier);
    } catch {
      noms = [];
    }
    for (const nom of noms) {
      if (!nom.endsWith(".jsonl") && !nom.endsWith(".log")) continue;
      const chemin = path.join(dossier, nom);
      try {
        liste.push({ chemin, mtime: fs.statSync(chemin).mtimeMs });
      } catch {
        /* disparu entre le listing et le stat — sans conséquence */
      }
    }
  }
  // La redirection du lanceur `start.sh` reste un candidat LÉGITIME : quand
  // c'est lui qui a démarré le serveur, c'est là que tout arrive.
  const redirection = path.join("/tmp", "nodefony-server.log");
  try {
    liste.push({
      chemin: redirection,
      mtime: fs.statSync(redirection).mtimeMs,
    });
  } catch {
    /* absent : le serveur n'a pas été lancé par le script */
  }
  return liste.sort((a, b) => b.mtime - a.mtime).map((e) => e.chemin);
}

/** GET nu — on ne lit pas la réponse, seule la trace au journal compte. */
function frappe(
  base: { hostname: string; port: number },
  chemin: string,
): Promise<void> {
  return new Promise((resolve) => {
    const req = https.request(
      { ...base, path: chemin, method: "GET", rejectUnauthorized: false },
      (res) => {
        res.resume();
        res.on("end", () => resolve());
      },
    );
    req.on("error", () => resolve());
    req.end();
  });
}

/**
 * Découvre le journal alimenté par le serveur qui écoute sur `base`.
 *
 * @param base - hôte et port du serveur sous test.
 * @param attenteMs - patience totale accordée à l'écriture de la ligne.
 * @returns le journal et la position à partir de laquelle compter, ou `null`
 *   quand AUCUN candidat ne porte le marqueur — l'appelant doit alors SAUTER
 *   son assertion en le disant, jamais rougir : il n'a pas mesuré le serveur,
 *   il n'a rien mesuré du tout.
 */
export async function journalDuServeur(
  base: { hostname: string; port: number },
  attenteMs = 3000,
): Promise<IJournalServeur | null> {
  const racine = racineProjet(process.cwd());
  const marqueur = `journal-${randomUUID().slice(0, 8)}`;
  await frappe(base, `/nodefony/test/${marqueur}`);
  const echeance = Date.now() + attenteMs;
  for (;;) {
    for (const chemin of candidats(racine)) {
      let contenu: string;
      try {
        contenu = fs.readFileSync(chemin, "utf8");
      } catch {
        continue;
      }
      if (!contenu.includes(marqueur)) continue;
      return { chemin, depuis: contenu.split("\n").length };
    }
    if (Date.now() >= echeance) return null;
    await new Promise((r) => setTimeout(r, 200));
  }
}

/**
 * Compte, APRÈS la position découverte, les lignes qui satisfont `motif`.
 *
 * @returns le compte. Un fichier devenu illisible rend `-1` — distinct de zéro,
 *   qui signifie « lu, et rien trouvé ».
 */
export function compteDansJournal(
  journal: IJournalServeur,
  motif: RegExp,
): number {
  let texte: string;
  try {
    texte = fs.readFileSync(journal.chemin, "utf8");
  } catch {
    return -1;
  }
  return sansAnsi(texte)
    .split("\n")
    .slice(journal.depuis)
    .filter((ligne) => motif.test(ligne)).length;
}
