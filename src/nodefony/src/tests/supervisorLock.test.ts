import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  suspendSupervisor,
  resumeSupervisor,
  readSupervisorSuspension,
  supervisorLockFile,
} from "../service/dev/devProcess";

/**
 * Suspension du superviseur dev : « je suis en train d'écrire dans les sources, ne me
 * redémarre pas maintenant ».
 *
 * Mécanisme GÉNÉRIQUE, pas propre au scaffold : toute opération serveur qui touche aux
 * fichiers surveillés (génération de code, migration, installation d'un module) l'utilise
 * en DISANT pourquoi. L'enjeu : le watcher regarde `nodefony/` et `index.ts` — exactement
 * là où ces opérations écrivent. Sans suspension, le rechargement part au milieu et tue
 * le `npm install` en cours (process enfant du serveur) → `node_modules` à moitié écrit.
 *
 * Le danger SYMÉTRIQUE — celui que ces tests verrouillent surtout : un verrou qui ne se
 * lève jamais muselle le rechargement pour toute la session. On éditerait ses fichiers
 * sans que rien ne se recharge, et sans la moindre explication. D'où la règle
 * **fail-safe** : dans le doute, on répond « pas suspendu », et le watcher travaille.
 */
describe("suspension du superviseur dev (verrou générique)", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(path.join(tmpdir(), "nf-lock-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it("aucune suspension = le watcher travaille (cas nominal)", () => {
    assert.equal(readSupervisorSuspension(cwd), null);
  });

  it("une opération en cours suspend le rechargement, et DIT pourquoi", () => {
    suspendSupervisor(cwd, "génération de code", "module blog");

    const lock = readSupervisorSuspension(cwd);
    assert.ok(lock, "le verrou doit être vu");
    // La raison n'est pas décorative : le superviseur l'affiche. Un rechargement qui ne
    // part pas sans explication est un mystère pour celui qui édite.
    assert.equal(lock.reason, "génération de code");
    assert.equal(lock.detail, "module blog");
    assert.equal(lock.pid, process.pid);
  });

  it("la fin de l'opération rend la main", () => {
    suspendSupervisor(cwd, "génération de code");
    resumeSupervisor(cwd);
    assert.equal(readSupervisorSuspension(cwd), null);
  });

  it("un verrou ORPHELIN (process mort) ne muselle rien, et il est nettoyé", () => {
    // Le cas vécu : le serveur est tué en pleine opération (Ctrl+C, crash, `nodefony
    // stop`). Le fichier reste sur le disque. Le croire sur parole musellerait le watcher
    // pour toujours — on vérifie donc que son poseur est encore VIVANT.
    const file = supervisorLockFile(cwd);
    mkdirSync(path.dirname(file), { recursive: true });
    // PID hors de l'espace des PID de tout OS courant → certainement mort.
    writeFileSync(
      file,
      JSON.stringify({
        pid: 4194304,
        reason: "zombie",
        ts: Date.now(),
      }),
      "utf8",
    );

    assert.equal(
      readSupervisorSuspension(cwd),
      null,
      "un verrou orphelin ne doit rien museler",
    );
    assert.equal(
      readSupervisorSuspension(cwd),
      null,
      "et il doit avoir été supprimé — on ne se repose pas la question",
    );
  });

  it("un verrou PÉRIMÉ est ignoré, même si son process vit encore", () => {
    // Filet contre un PID recyclé par l'OS : passé le délai, on ne muselle plus, quoi
    // qu'il arrive. Une opération légitime très longue reste couverte (15 min).
    const file = supervisorLockFile(cwd);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(
      file,
      JSON.stringify({
        pid: process.pid,
        reason: "vieux",
        ts: Date.now() - 16 * 60 * 1000,
      }),
      "utf8",
    );

    assert.equal(readSupervisorSuspension(cwd), null);
  });

  it("un verrou ILLISIBLE ne muselle rien (fail-safe)", () => {
    const file = supervisorLockFile(cwd);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ceci n'est pas du json", "utf8");

    assert.equal(readSupervisorSuspension(cwd), null);
  });
});
