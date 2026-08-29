import assert from "node:assert/strict";
import { Container } from "nodefony";
import type { Module, Pdu, Severity } from "nodefony";
import { WebhookService } from "../../nodefony/service/webhooks";
import type { IWebhookStore } from "../../nodefony/contracts/IWebhookStore";

/**
 * #107 — une base SANS TABLES n'est pas une panne.
 *
 * Le nœud circulaire résiduel : pour migrer il faut booter, et le boot recharge
 * l'instantané des webhooks depuis une base qui n'a évidemment aucune table —
 * puisque c'est précisément ce que `orm:migrate` s'apprête à créer. Quinze
 * lignes de pile rouge tombaient alors au PREMIER geste que l'utilisateur fait
 * avec le framework, sans que rien ne lui dise qu'elles sont normales.
 *
 * Ce banc verrouille les DEUX moitiés, parce que la seconde est celle qui rend
 * la première acceptable : le bruit disparaît, et **toute autre erreur remonte
 * entière**. Un `catch` large masquerait un vrai défaut de persistance, ce qui
 * coûterait bien plus cher que le bruit supprimé.
 */

/** Une erreur de pilote, enveloppée comme Drizzle le fait. */
function driverError(code: string, message: string): Error {
  const inner = new Error(message) as Error & { code: string };
  inner.code = code;
  const outer = new Error(
    "Failed query: select from webhook_endpoint",
  ) as Error & {
    cause: unknown;
  };
  outer.name = "DrizzleQueryError";
  outer.cause = inner;
  return outer;
}

/** Un store qui ne sait faire qu'une chose : échouer sur `listAll`. */
function failingStore(error: Error): IWebhookStore {
  const refuse = (): never => {
    throw error;
  };
  return {
    listAll: refuse,
    create: refuse,
    findById: refuse,
    update: refuse,
    delete: refuse,
  } as unknown as IWebhookStore;
}

interface ILogged {
  severity: Severity | undefined;
  payload: unknown;
}

/**
 * Démarre le service avec un store qui échoue, et rend ce qui a été journalisé.
 *
 * Le rechargement part de `#build` (`void this.#reloadSnapshot()`) : on laisse
 * la micro-tâche se résoudre avant de lire les journaux, sinon on observe
 * l'instant d'avant.
 */
async function bootWith(error: Error): Promise<ILogged[]> {
  const container = new Container();
  const handlers: Record<string, (...a: unknown[]) => void> = {};
  container.set("kernel", {
    container,
    once(ev: string, cb: (...a: unknown[]) => void) {
      handlers[ev] = cb;
    },
    registerStoreResolution() {},
  });
  container.set("webhookStore", failingStore(error));
  const module = {
    container,
    notificationsCenter: false,
    options: {
      webhooks: { encryptionKey: "clé-de-test-webhook-0123456789abcdef" },
    },
  } as unknown as Module;

  const svc = new WebhookService(module);
  const logged: ILogged[] = [];
  svc.log = ((payload: unknown, severity?: Severity): Pdu => {
    logged.push({ severity, payload });
    return undefined as unknown as Pdu;
  }) as typeof svc.log;

  handlers.onBoot?.();
  await new Promise((r) => setImmediate(r));
  return logged;
}

describe("webhooks — recharger un instantané sur une base sans schéma", () => {
  it("🔴 table absente : aucune pile d'appels, une phrase qui dit la normalité", async () => {
    const logged = await bootWith(
      driverError("SQLITE_ERROR", "no such table: webhook_endpoint"),
    );
    const erreurs = logged.filter((l) => l.severity === "ERROR");
    assert.deepEqual(
      erreurs,
      [],
      "une base pas encore migrée ne doit produire AUCUNE erreur",
    );
    const dit = logged.find(
      (l) => l.severity === "INFO" && String(l.payload).includes("migration"),
    );
    assert.ok(
      dit,
      `rien n'explique la situation : ${JSON.stringify(logged.map((l) => l.severity))}`,
    );
    // Dégrader en silence serait pire que la pile : l'exploitant doit savoir où
    // regarder, et la commande qui répond est nommée.
    assert.match(String(dit.payload), /orm:migrate:status/);
  });

  it("🔴 PostgreSQL et MySQL aussi — la reconnaissance ne dépend pas du pilote", async () => {
    for (const code of ["42P01", "ER_NO_SUCH_TABLE"]) {
      const logged = await bootWith(driverError(code, "relation absente"));
      assert.deepEqual(
        logged.filter((l) => l.severity === "ERROR"),
        [],
        code,
      );
    }
  });

  it("🔴 CONTRÔLE : une VRAIE panne de persistance remonte ENTIÈRE", async () => {
    // La moitié qui rend l'autre acceptable. Sans elle, on aurait acheté le
    // silence au prix d'un défaut de base masqué.
    const panne = driverError("ECONNREFUSED", "connexion refusée");
    const logged = await bootWith(panne);
    const erreurs = logged.filter((l) => l.severity === "ERROR");
    assert.equal(erreurs.length, 1, "la panne doit être journalisée");
    assert.equal(
      erreurs[0]?.payload,
      panne,
      "c'est l'erreur ELLE-MÊME qui remonte, pas un résumé qui perd la pile",
    );
  });

  it("🔴 une faute de syntaxe SQLite n'est PAS une base sans schéma", async () => {
    // Le code de SQLite est générique : sans la signature du message, conclure
    // « pas encore migré » avalerait un bug du framework.
    const logged = await bootWith(
      driverError("SQLITE_ERROR", 'near "SELCT": syntax error'),
    );
    assert.equal(logged.filter((l) => l.severity === "ERROR").length, 1);
  });
});
