/**
 * Socle commun des bancs qui démarrent une APPLICATION Nodefony réelle.
 *
 * Ces gestes — lire un argument, attendre qu'une condition devienne vraie,
 * savoir si un port répond, démarrer un pod et attendre qu'il écoute, l'arrêter
 * proprement — étaient écrits une fois par banc. Deux copies d'un démarrage de
 * pod divergent en silence : chacune passe son propre banc, et le jour où l'une
 * corrige un défaut d'attente, l'autre le garde.
 *
 * Le lanceur n'est jamais deviné : il vient de `node_modules/nodefony/bin`, le
 * même que celui qu'une application installée exécute.
 */
import { spawn, execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

/** Lit `--nom valeur` sur la ligne de commande, ou rend `defaut`. */
export const arg = (nom, defaut) => {
  const i = process.argv.indexOf(`--${nom}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : defaut;
};

/** Vrai si `--nom` est présent (drapeau sans valeur). */
export const drapeau = (nom) => process.argv.includes(`--${nom}`);

export const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lance `docker` sans jamais jeter — rend `ERR:…` pour que l'appelant décide. */
export const docker = (...a) => {
  try {
    return execFileSync("docker", a, { encoding: "utf8" }).trim();
  } catch (e) {
    return `ERR:${String(e.message).slice(0, 60)}`;
  }
};

/** Attend qu'une condition devienne vraie, ou rend `false` au bout de `maxMs`. */
export async function jusqua(verif, maxMs) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await verif()) {
      return true;
    }
    await dormir(250);
  }
  return false;
}

/**
 * L'APPLICATION répond-elle ? (sans juger du code de retour)
 *
 * Vise `/`, donc la pile entière — session comprise. C'est la question d'un
 * banc qui veut savoir si l'application SERT encore, pas seulement si son port
 * est ouvert : y répondre pendant que la base est tombée est un résultat, et le
 * remplacer par une sonde de santé le ferait disparaître.
 */
export async function repond(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(3000),
    });
    return r.status > 0;
  } catch {
    return false;
  }
}

/**
 * Le port ÉCOUTE-t-il ? — sonde de vie, court-circuit total du pipeline.
 *
 * C'est une AUTRE question que `repond`, et les confondre fabrique un verdict
 * faux : un pod dont le schéma est en retard écoute, journalise, et retient la
 * mise en service ; `/` échoue alors dans le magasin de session, et un banc qui
 * sondait `/` concluait « n'a jamais écouté » — un message qui envoie chercher
 * un port fermé là où il n'y a qu'une table absente (mesuré, deux heures).
 *
 * `/livez` ne touche ni la session ni la base : il répond tant que le processus
 * sert. Un 503 compte donc comme « écoute » — la disponibilité se lit sur
 * `/readyz`, pas ici.
 */
export async function ecoute(port, chemin = "/livez") {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${chemin}`, {
      signal: AbortSignal.timeout(3000),
    });
    return r.status > 0;
  } catch {
    return false;
  }
}

/** Chemin du lanceur `nodefony` tel qu'une application installée l'exécute. */
export function nodefonyBin(racine = process.cwd()) {
  return path.join(racine, "node_modules", "nodefony", "bin", "nodefony");
}

/**
 * Le pod est-il EN SERVICE ? — sonde de disponibilité (`/readyz`, 200 exigé).
 *
 * Troisième question, et la seule qui décide d'un déploiement : un pod peut
 * écouter (`ecoute`) et servir des pages (`repond`) tout en étant retenu hors
 * du service par un schéma en retard. Un banc qui n'exige jamais cet état
 * mesure un pod qu'aucun orchestrateur n'aurait mis en ligne — et reste vert
 * quand son décor est faux, ce qui est le pire des verdicts.
 *
 * @returns `true` uniquement sur 200 ; un 503 est un refus de service, pas une panne.
 */
export async function enService(port, chemin = "/readyz") {
  try {
    const r = await fetch(`http://127.0.0.1:${port}${chemin}`, {
      signal: AbortSignal.timeout(3000),
    });
    return r.status === 200;
  } catch {
    return false;
  }
}

/**
 * Applique les migrations sur la base du décor — le geste d'un DÉPLOIEMENT.
 *
 * En production le schéma n'est fabriqué par personne (`ddl: "none"`) : c'est
 * un travail externe qui migre avant que le trafic n'arrive, et le produit le
 * dit lui-même quand il retient la mise en service. Un banc qui démarre un pod
 * en production sans ce geste ne mesure pas ce qu'il croit — il mesure une base
 * vide, et son verdict tient à ce que la machine avait déjà en base (vécu : vert
 * sur un poste dont la base traînait les tables d'une session en développement,
 * rouge dans la forge sur une base neuve).
 *
 * ⚠️ `NODE_ENV=production` n'est pas un détail de décor : sans lui la commande
 * démarre en mode `auto`, FABRIQUE le schéma en s'initialisant, puis refuse
 * d'appliquer quoi que ce soit sur une base qu'elle vient elle-même de remplir
 * (`NF_MIGRATE_BASELINE_REQUIRED`). La commande a raison ; c'est l'appelant qui
 * doit dire dans quel monde il l'invoque.
 *
 * @param options.url - URL de la base (`NF_DATABASE_URL` du pod à venir).
 * @param options.racine - racine de l'application (défaut : répertoire courant).
 * @returns `{ ok, sortie }` — ne jette jamais : le banc décide quoi faire d'un échec.
 */
export function migrerBase({ url, racine = process.cwd() } = {}) {
  try {
    const sortie = execFileSync(
      process.execPath,
      [nodefonyBin(racine), "orm:migrate"],
      {
        cwd: racine,
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "production",
          ...(url ? { NF_DATABASE_URL: url } : {}),
        },
      },
    );
    return { ok: true, sortie };
  } catch (e) {
    return {
      ok: false,
      sortie: `${e.stdout ?? ""}${e.stderr ?? ""}` || String(e.message),
    };
  }
}

/**
 * Démarre un pod et attend qu'il écoute.
 *
 * @param options.port - port HTTP (le port HTTPS est `port + 1`).
 * @param options.mode - commande du lanceur : `production` (défaut) ou `development`.
 * @param options.env - variables ajoutées à celles du process courant.
 * @param options.attenteMs - budget d'attente du boot (défaut 90 s).
 * @returns `{ enfant, port, journal, estMort, debout }` — `debout: false` veut
 *   dire « n'a jamais ÉCOUTÉ » (sonde `/livez`), que le process soit mort ou
 *   simplement muet — un schéma en retard, lui, laisse le pod DEBOUT ;
 *   `journal` porte la sortie complète, seule chose qui explique un boot raté.
 */
export async function demarrerPod({
  port,
  mode = "production",
  env = {},
  attenteMs = 90_000,
  racine = process.cwd(),
} = {}) {
  const enfant = spawn(process.execPath, [nodefonyBin(racine), mode], {
    cwd: racine,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      NODE_ENV: mode === "development" ? "development" : "production",
      NF_PORT: String(port),
      NF_PORT_HTTPS: String(port + 1),
      ...env,
    },
  });
  const journal = [];
  enfant.stdout.on("data", (d) => journal.push(String(d)));
  enfant.stderr.on("data", (d) => journal.push(String(d)));
  let mort = null;
  enfant.on("exit", (code, sig) => {
    mort = { code, sig };
  });

  // La question ici est « le port écoute-t-il », pas « l'application sert-elle » :
  // un pod qui retient sa mise en service (schéma en retard) écoute et doit être
  // rendu DEBOUT — c'est au banc de juger ce qu'il en fait.
  const debout = await jusqua(async () => {
    if (mort) {
      return false;
    }
    return ecoute(port);
  }, attenteMs);
  return { enfant, port, journal, estMort: () => mort, debout };
}

/**
 * Arrête un pod et attend sa mort EFFECTIVE.
 *
 * Le `SIGKILL` de secours n'est pas une ceinture de confort : sous Windows un
 * arbre ne s'arrête pas gracieusement, et un dossier ne se supprime pas tant
 * qu'un process l'a pour répertoire courant. Rendre la main avant la mort réelle
 * fait échouer le banc SUIVANT, sur le port que celui-ci n'a pas encore rendu.
 *
 * @returns `true` si l'arrêt a été gracieux (le process est parti sur SIGTERM).
 */
export async function arreterPod(pod, { graceMs = 10_000 } = {}) {
  if (pod.estMort() !== null) {
    return true;
  }
  try {
    process.kill(pod.enfant.pid, "SIGTERM");
  } catch {
    return true;
  }
  const gracieux = await jusqua(async () => pod.estMort() !== null, graceMs);
  if (!gracieux) {
    try {
      process.kill(pod.enfant.pid, "SIGKILL");
    } catch {
      /* déjà mort */
    }
    await jusqua(async () => pod.estMort() !== null, 5_000);
  }
  return gracieux;
}

/** Petit rapporteur de banc — accumule le verdict au lieu de sortir au premier échec. */
export function rapporteur() {
  let verdict = 0;
  return {
    dire(ok, texte) {
      console.log(`  ${ok ? "✔" : "✘"} ${texte}`);
      if (!ok) {
        verdict = 1;
      }
    },
    verdict: () => verdict,
  };
}
