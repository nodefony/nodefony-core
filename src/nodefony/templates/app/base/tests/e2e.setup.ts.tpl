import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Démarre l'application UNE fois pour toute la suite E2E, et l'arrête à la fin.
 *
 * Pourquoi ici et pas dans chaque fichier de test : chaque entité générée apporte
 * son propre fichier `*.e2e.test.ts`, et un `beforeAll` par fichier signifierait
 * un démarrage complet par fichier — la suite se paierait en minutes, et deux
 * fichiers qui démarrent la même application se marcheraient dessus.
 *
 * La mécanique est 100 % native Nodefony :
 *   - `nodefony production --detach --wait` : lancement détaché, exit 0 seulement
 *     quand la readiness est sondée (ports ouverts) — aucun sleep arbitraire ;
 *   - `nodefony stop` : arrêt propre de tout runtime de l'application.
 *
 * Les tests ne reçoivent pas le port par ce fichier : ils le lisent eux-mêmes
 * avec `readRuntimeState(process.cwd())`. Un port écrit en dur casse dès que
 * l'application déclare le sien (`NF_PORT`, `PORT` en PaaS) ou qu'un port occupé
 * l'a fait glisser.
 */
const bin = path.resolve("node_modules/.bin/nodefony");

export async function setup(): Promise<void> {
  execFileSync(bin, ["production", "--detach", "--wait"], {
    stdio: "inherit",
    timeout: 120_000,
  });
}

export async function teardown(): Promise<void> {
  // Jamais de serveur laissé derrière : un runtime orphelin tient les ports et
  // fait échouer le run suivant sur une erreur qui ne parle pas de lui.
  execFileSync(bin, ["stop"], { stdio: "inherit", timeout: 30_000 });
}
