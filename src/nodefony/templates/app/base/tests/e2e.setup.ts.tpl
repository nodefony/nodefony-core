import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";
<% if (it.hasSecurity) { %>import { readRuntimeState } from "nodefony";
<% } %>
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

/**
 * Base de données de la suite E2E — jetable, et surtout SÉPARÉE de celle du
 * développement.
 *
 * Une suite qui écrit dans la base de dev ne fait pas que la salir : elle y
 * sème un compte `admin` dont le mot de passe est celui, écrit en clair dans ce
 * fichier. Le seed étant idempotent, `admin` / `admin` — le couple annoncé par
 * le `.env` et le README — cesse alors de fonctionner pour toujours, sans le
 * moindre message. Symétriquement, un `admin` déjà semé en développement fait
 * échouer `connexionAdmin()`, et la suite accuse la route qu'elle mesure au
 * lieu de son décor. Un fichier à part supprime les deux pannes d'un coup, et
 * rend la suite reproductible.
 *
 * Surcharge : `NF_E2E_DATABASE_URL` — pour éprouver la suite sur le dialecte
 * réel de production (PostgreSQL, MySQL) plutôt que sur SQLite.
 */
const URL_BASE_E2E =
  process.env.NF_E2E_DATABASE_URL ??
  `sqlite:${path.resolve("var/databases/e2e.db")}`;
<% if (it.hasSecurity) { %>
/**
 * Mot de passe du compte d'administration, POUR LA SUITE DE TESTS UNIQUEMENT.
 *
 * La suite tourne en `production`, où aucun compte n'est semé sans mot de passe
 * explicite — c'est voulu : une application ne doit jamais naître en production
 * avec des identifiants connus. Les tests, eux, ont besoin d'une identité pour
 * éprouver les routes protégées (la suppression, notamment), d'où cette valeur
 * jetable, posée dans l'environnement du serveur de test et nulle part ailleurs.
 */
export const MOT_DE_PASSE_ADMIN = "e2e-admin-jetable";

/**
 * Ouvre une session d'administration et rend l'en-tête `Cookie` à rejouer.
 *
 * C'est ainsi qu'un client réel s'authentifie auprès de l'application : un POST
 * sur la route de connexion du framework, puis le cookie de session sur chaque
 * requête suivante. Les tests d'une route protégée s'en servent ; les autres
 * l'ignorent.
 *
 * @returns L'en-tête `Cookie` complet, à passer tel quel à `fetch`.
 * @throws Si la connexion échoue — mieux vaut un test qui dit « je n'ai pas pu
 * m'authentifier » qu'un test qui conclut « accès refusé » sur un décor cassé.
 */
export async function connexionAdmin(): Promise<string> {
  const port = readRuntimeState(process.cwd())?.ports[0] ?? 5151;
  const res = await fetch(
    `http://127.0.0.1:${port}/nodefony/security/api/auth/login`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "admin",
        password: MOT_DE_PASSE_ADMIN,
      }),
    },
  );
  if (res.status !== 200) {
    throw new Error(
      `connexion admin impossible (${res.status}) — le décor de test, pas la route mesurée`,
    );
  }
  const cookies = res.headers.getSetCookie?.() ?? [];
  return cookies.map((c) => c.split(";")[0]).join("; ");
}
<% } %>
export async function setup(): Promise<void> {
  // Repartir d'une base VIERGE : une suite dont le verdict dépend de ce qu'un
  // run précédent a laissé n'est pas reproductible. Les compagnons `-wal` et
  // `-shm` partent avec le fichier, sinon SQLite ressuscite l'état d'avant.
  if (URL_BASE_E2E.startsWith("sqlite:")) {
    const fichier = URL_BASE_E2E.slice("sqlite:".length);
    for (const suffixe of ["", "-wal", "-shm"]) {
      rmSync(`${fichier}${suffixe}`, { force: true });
    }
  }
  execFileSync(bin, ["production", "--detach", "--wait"], {
    stdio: "inherit",
    timeout: 120_000,
    env: {
      ...process.env,
      // La suite ne touche JAMAIS la base de développement — cf `URL_BASE_E2E`.
      NF_DATABASE_URL: URL_BASE_E2E,
<% if (it.hasSecurity) { %>      // Sans cette variable, la production ne sème AUCUN compte : les tests des
      // routes protégées n'auraient aucune identité à présenter, et échoueraient
      // en accusant la garde plutôt que le décor.
      NF_ADMIN_PASSWORD: MOT_DE_PASSE_ADMIN,
<% } %>    },
  });
}

export async function teardown(): Promise<void> {
  // Jamais de serveur laissé derrière : un runtime orphelin tient les ports et
  // fait échouer le run suivant sur une erreur qui ne parle pas de lui.
  execFileSync(bin, ["stop"], { stdio: "inherit", timeout: 30_000 });
}
