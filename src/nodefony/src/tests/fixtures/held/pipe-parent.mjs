// Parent en rendu TERMINAL (#908) : relance `supervisor.mjs` en rôle serveur
// (`NF_DEV_CHILD=1`) avec la plomberie du vrai superviseur quand il possède le
// terminal — sortie en TUBES vers lui, plus le canal IPC
// (`DevSupervisor.ts#DevSupervisor.#spawnChild`). Il relaie la sortie de
// l'enfant sur la sienne, comme `DevTerminal`. Le vrai superviseur ne prend
// ce rendu que devant un vrai terminal, qu'un test n'a pas : ce parent en
// reproduit la seule chose qui compte ici — tué net, il emporte le lecteur
// des tubes, et la prochaine écriture de l'enfant rencontre `EPIPE`.
//
// argv[2] = la configuration de `supervisor.mjs`, transmise telle quelle.
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const child = spawn(
  process.execPath,
  [
    ...process.execArgv,
    fileURLToPath(new URL("./supervisor.mjs", import.meta.url)),
    process.argv[2],
  ],
  {
    env: { ...process.env, NF_DEV_CHILD: "1" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    // Comme le vrai superviseur sous POSIX : l'enfant est leader de son
    // groupe, la mort du parent ne lui parvient pas par le groupe.
    detached: process.platform !== "win32",
  },
);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
// Le plan du faux serveur n'attend aucune réponse ici.
child.on("message", () => {});
