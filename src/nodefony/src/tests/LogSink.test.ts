/*
 *   NODEFONY FRAMEWORK UNIT TEST — MOCHA STYLE
 *
 *   Driver de sink LB.W : FileSink (write async/borné), NULL_LOG_SINK (noop),
 *   Syslog.setLogSink / logSinkName (bascule du sink process-global).
 */
import assert from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import Syslog, { NULL_LOG_SINK } from "../syslog/Syslog";
import { FileSink } from "../syslog/sinks/FileSink";

const wait = (ms = 30): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Rend la CONFIRMATION d'écriture observable, au lieu de la parier sur un délai.
 *
 * Un `writeOut` remet son chunk au pool de threads et le garde dans `#inFlight`
 * tant que le rappel n'a pas tourné. Attendre un délai fixe suppose que le pool
 * a répondu : sur une machine chargée il n'a pas répondu, `close()` déclenche le
 * secours synchrone, et celui-ci réécrit un chunk DÉJÀ sur le disque. Le sink
 * assume ce doublon — il le préfère à une perte (`FileSink.flushSync`) — donc ce
 * qu'un délai fixe finit par mesurer, c'est la vitesse du pool, pas le sink.
 * Constaté en intégration : `a\na\nb\nc\n` là où le banc attendait `a\nb\nc\n`.
 *
 * L'enveloppe compte les écritures NON confirmées. Le compteur ne retombe à zéro
 * qu'une fois la chaîne entière éteinte : le rappel du sink relance un drain pour
 * ce qui s'est accumulé pendant le vol, et cette relance incrémente avant que la
 * précédente ne décrémente. C'est ce que `FileSinkOptions.write` existe pour
 * permettre — le banc du descripteur en vol s'en sert déjà.
 */
const sondeDeDrain = (): {
  write: typeof fs.write;
  auRepos: () => Promise<void>;
} => {
  let enVol = 0;
  let reveiller: (() => void) | null = null;
  const write = ((
    fd: number,
    data: string,
    cb: (err: NodeJS.ErrnoException | null) => void,
  ): void => {
    enVol++;
    fs.write(fd, data, (err) => {
      cb(err); // le sink peut relancer un drain ICI — donc avant le décompte
      enVol--;
      if (enVol === 0 && reveiller) {
        const r = reveiller;
        reveiller = null;
        r();
      }
    });
  }) as unknown as typeof fs.write;
  const auRepos = (): Promise<void> =>
    enVol === 0
      ? Promise.resolve()
      : new Promise<void>((r) => {
          reveiller = r;
        });
  return { write, auRepos };
};

describe("Log sink driver (LB.W)", () => {
  describe("FileSink", () => {
    let tmpDir: string;
    let tmpFile: string;
    // Dossier temporaire demandé à l'OS, comme partout ailleurs dans ces bancs
    // (`detachedStart`, `devProcess`, `completion`…). L'unicité est alors une
    // GARANTIE du système, là où un nom composé d'un horodatage et d'un tirage
    // aléatoire n'est qu'un pari : deux cas qui démarrent dans la même
    // milliseconde reposaient sur le seul `Math.random()`, et le perdant relisait
    // le fichier du cas précédent. C'est ce qui faisait apparaître un `x` — écrit
    // par le banc d'idempotence de `close()` — en tête d'une assertion d'ordre.
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nf-filesink-"));
      tmpFile = path.join(tmpDir, "sink.log");
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("écrit les lignes en async sur le fichier (FIFO préservé)", async () => {
      const { write, auRepos } = sondeDeDrain();
      const sink = new FileSink({ path: tmpFile, write });
      sink.writeOut("a\n");
      sink.writeOut("b\n");
      sink.writeOut("c\n");
      // Le premier chunk part seul ; `b` et `c` s'accumulent derrière lui et
      // partent au rappel. On attend l'extinction de la CHAÎNE, pas un délai.
      await auRepos();
      sink.close(); // plus rien en vol → le secours synchrone n'a rien à réécrire
      assert.strictEqual(fs.readFileSync(tmpFile, "utf8"), "a\nb\nc\n");
    });

    it("close() flush le pending (rien perdu) + est idempotent", () => {
      const sink = new FileSink({ path: tmpFile });
      sink.writeOut("x\n");
      sink.close(); // flushSync + closeSync
      sink.close(); // idempotent — pas de throw
      assert.ok(fs.readFileSync(tmpFile, "utf8").includes("x\n"));
    });

    it("writeErr (fatal) est DURABLE immédiatement — sync hors buffer, jamais perdu au crash", () => {
      const sink = new FileSink({ path: tmpFile });
      sink.writeErr("FATAL\n");
      // PAS de await ni close : en mode async, writeOut ne serait pas encore drainé,
      // mais writeErr (sévérité ≤ 3) doit être SUR DISQUE tout de suite (durable même
      // si SIGKILL/OOM avant le drain async).
      assert.ok(
        fs.readFileSync(tmpFile, "utf8").includes("FATAL\n"),
        "le fatal doit être écrit en sync immédiat",
      );
      sink.close();
    });

    it("writeErr après un stdout drainé → ordre causal out→err préservé", async () => {
      // Ce cas porte la MÊME fragilité que le précédent, et elle s'y voit moins :
      // si le rappel n'a pas tourné, `out` reste en vol, `err` part en synchrone,
      // puis `close()` réécrit `out` PAR-DESSUS — l'ordre lu devient `out err out`.
      // Ce que le cas veut établir suppose donc un drain CONFIRMÉ, pas espéré.
      const { write, auRepos } = sondeDeDrain();
      const sink = new FileSink({ path: tmpFile, write });
      sink.writeOut("out\n");
      await auRepos(); // plus aucune écriture en vol — le fait, pas le pari
      sink.writeErr("err\n"); // pending vide → writeSync direct, ordonné après "out"
      sink.close();
      assert.strictEqual(fs.readFileSync(tmpFile, "utf8"), "out\nerr\n");
    });

    it("drop borné quand le buffer sature (jamais OOM, jamais throw)", async () => {
      // maxPendingBytes minuscule : le 1er write part en drain async, les writes
      // suivants du MÊME tick s'accumulent jusqu'au cap → drop. Boucle sync donc
      // déterministe (le callback async ne tourne qu'au tick suivant).
      const sink = new FileSink({ path: tmpFile, maxPendingBytes: 8 });
      for (let i = 0; i < 100; i++) sink.writeOut("0123456789\n");
      assert.ok(sink.dropped > 0, `attendu des drops, reçu ${sink.dropped}`);
      await wait();
      sink.close();
    });

    it("writeOut après close() = noop (pas d'écriture sur fd fermé)", () => {
      const sink = new FileSink({ path: tmpFile });
      sink.close();
      assert.doesNotThrow(() => sink.writeOut("late\n"));
    });

    it("close() ne rend PAS le descripteur sous une écriture en vol", async () => {
      // Un descripteur est un ENTIER que le système réattribue au premier `open`
      // venu. Le rendre pendant qu'une écriture asynchrone attend son tour dans le
      // pool de threads, c'est la laisser atterrir dans le fichier — ou la socket —
      // de quelqu'un d'autre, sans la moindre erreur visible. Le symptôme observé
      // était une ligne d'un banc en tête du fichier d'un autre ; il avait été pris
      // pour un défaut d'isolation et « corrigé » par un dossier temporaire unique,
      // d'où son retour.
      //
      // Cette course ne se provoque pas à volonté : en local le pool répond avant
      // le `close`. On la PILOTE donc, en retenant le rappel de l'écriture — et on
      // interroge le seul fait qui tranche : le descripteur est-il encore valide au
      // moment où l'écriture s'exécuterait ?
      let released: (() => void) | null = null;
      let capturedFd = -1;
      const sink = new FileSink({
        path: tmpFile,
        write: ((
          fd: number,
          data: string,
          cb: (err: NodeJS.ErrnoException | null) => void,
        ): void => {
          capturedFd = fd;
          released = () => {
            fs.writeSync(fd, data);
            cb(null);
          };
        }) as unknown as typeof fs.write,
      });
      sink.writeOut("en-vol\n"); // écriture partie, rappel RETENU par le banc
      sink.close(); // ferme SOUS l'écriture en vol

      // Le descripteur doit être encore ouvert : c'est exactement ce que `close()`
      // a délégué au rappel. `fstatSync` sur un descripteur rendu lève `EBADF`.
      assert.doesNotThrow(
        () => fs.fstatSync(capturedFd),
        "le descripteur a été rendu alors qu'une écriture était en vol",
      );

      // Le rappel s'exécute : il écrit puis rend le descripteur, dans cet ordre.
      assert.ok(released, "le banc devait retenir le rappel");
      (released as unknown as () => void)();
      await wait(5);
      assert.throws(
        () => fs.fstatSync(capturedFd),
        "le descripteur devait être rendu une fois l'écriture confirmée",
      );
      assert.ok(fs.readFileSync(tmpFile, "utf8").includes("en-vol\n"));
    });
  });

  describe("FileSink (mode sync)", () => {
    let tmpFile: string;
    beforeEach(() => {
      tmpFile = path.join(
        os.tmpdir(),
        `nf-filesink-sync-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
      );
    });
    afterEach(() => {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* fichier absent */
      }
    });

    it("writeSync direct : contenu présent SANS attente async (FIFO)", () => {
      const sink = new FileSink({ path: tmpFile, sync: true });
      sink.writeOut("a\n");
      sink.writeOut("b\n");
      // Pas de `await` : en mode sync le write atterrit immédiatement sur le fd.
      assert.strictEqual(fs.readFileSync(tmpFile, "utf8"), "a\nb\n");
      sink.close();
    });

    it("writeErr partage le fd (ordre causal) + close idempotent", () => {
      const sink = new FileSink({ path: tmpFile, sync: true });
      sink.writeOut("out\n");
      sink.writeErr("err\n");
      sink.close();
      sink.close(); // idempotent
      assert.strictEqual(fs.readFileSync(tmpFile, "utf8"), "out\nerr\n");
    });

    it("writeOut après close() = noop", () => {
      const sink = new FileSink({ path: tmpFile, sync: true });
      sink.close();
      assert.doesNotThrow(() => sink.writeOut("late\n"));
    });
  });

  describe("NULL_LOG_SINK", () => {
    it("name='null' et toutes les ops sont noop", () => {
      assert.strictEqual(NULL_LOG_SINK.name, "null");
      assert.doesNotThrow(() => {
        NULL_LOG_SINK.writeOut("x");
        NULL_LOG_SINK.writeErr("y");
        NULL_LOG_SINK.flushSync();
        NULL_LOG_SINK.close();
      });
    });
  });

  describe("Syslog.setLogSink / logSinkName", () => {
    afterEach(() => {
      // CRITIQUE : le sink est process-global → reset pour ne pas contaminer les
      // autres suites (et libérer un éventuel fd FileSink ouvert).
      Syslog.setLogSink(null);
    });

    it("défaut = stdout", () => {
      assert.strictEqual(Syslog.logSinkName, "stdout");
    });

    it("bascule vers null puis revient à stdout via setLogSink(null)", () => {
      Syslog.setLogSink(NULL_LOG_SINK);
      assert.strictEqual(Syslog.logSinkName, "null");
      Syslog.setLogSink(null);
      assert.strictEqual(Syslog.logSinkName, "stdout");
    });

    it("bascule vers un FileSink (name='file')", () => {
      const tmp = path.join(os.tmpdir(), `nf-setsink-${Date.now()}.log`);
      Syslog.setLogSink(new FileSink({ path: tmp }));
      assert.strictEqual(Syslog.logSinkName, "file");
      Syslog.setLogSink(null); // close le FileSink (libère le fd)
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* absent */
      }
    });
  });
});
