import assert from "node:assert/strict";
import {
  describeConnectFailure,
  diagnoseConnectionFailure,
  parseConnectionTarget,
} from "../../nodefony/src/connectionDiagnosis";

/**
 * **Un message d'erreur qui n'énonce QU'UNE cause envoie chercher là où il n'y
 * a rien — et il est d'autant plus suivi qu'il paraît précis.**
 *
 * Vécu : le PostgreSQL de l'application n'était pas démarré, mais le conteneur
 * d'un autre projet écoutait sur `127.0.0.1:5432`. L'application s'y est
 * connectée et a reçu « password authentication failed ». Message EXACT, et
 * trompeur pour cette raison même : il envoyait vérifier des identifiants qui
 * étaient justes, quand la vraie question était « à quelle base suis-je
 * connecté ? ».
 *
 * Le fait qui tranche est dans le CODE, pas dans le texte : `ECONNREFUSED` vient
 * du système et dit que personne n'a répondu ; un refus d'authentification vient
 * du SERVEUR, et prouve donc qu'il y en a un.
 */

describe("diagnoseConnectionFailure — personne n'écoute", () => {
  it("ECONNREFUSED : dit que rien n'écoute, et le nomme", () => {
    const d = diagnoseConnectionFailure(
      { code: "ECONNREFUSED" },
      {
        host: "127.0.0.1",
        port: 5432,
      },
    );
    assert.equal(d.verdict, "unreachable");
    assert.equal(d.code, "ECONNREFUSED");
    assert.match(d.explanation, /personne n'écoute/);
    assert.match(d.explanation, /127\.0\.0\.1:5432/);
  });

  it("un hôte introuvable est aussi « personne n'écoute »", () => {
    for (const code of [
      "ENOTFOUND",
      "EHOSTUNREACH",
      "ENETUNREACH",
      "EAI_AGAIN",
    ]) {
      assert.equal(diagnoseConnectionFailure({ code }).verdict, "unreachable");
    }
  });

  it("ne propose AUCUN geste « qui tient le port » — il n'y a personne", () => {
    const d = diagnoseConnectionFailure(
      { code: "ECONNREFUSED" },
      {
        host: "127.0.0.1",
        port: 5432,
      },
    );
    assert.ok(!d.explanation.includes("docker ps"));
  });
});

describe("diagnoseConnectionFailure — quelqu'un a répondu", () => {
  it("28P01 (PostgreSQL) : nomme la cause qui manquait — un AUTRE serveur", () => {
    const d = diagnoseConnectionFailure(
      { code: "28P01" },
      {
        host: "127.0.0.1",
        port: 5432,
      },
    );
    assert.equal(d.verdict, "answered");
    assert.match(d.explanation, /a RÉPONDU/);
    assert.match(d.explanation, /AUTRE SERVEUR/);
    // Le geste qui tranche en une commande, port réel inclus.
    assert.match(d.explanation, /docker ps --filter publish=5432/);
  });

  it("les refus MySQL/MariaDB et MongoDB comptent comme une réponse", () => {
    for (const code of [
      "ER_ACCESS_DENIED_ERROR",
      "ER_BAD_DB_ERROR",
      "ER_DBACCESS_DENIED_ERROR",
      "AuthenticationFailed",
      "Unauthorized",
      "3D000",
      "53300",
    ]) {
      assert.equal(
        diagnoseConnectionFailure({ code }).verdict,
        "answered",
        `${code} prouve qu'un serveur a parlé`,
      );
    }
  });

  it("MongoDB pose son code sous `codeName`", () => {
    const d = diagnoseConnectionFailure({ codeName: "AuthenticationFailed" });
    assert.equal(d.verdict, "answered");
    assert.equal(d.code, "AuthenticationFailed");
  });

  it("le geste est écrit pour la plateforme VISÉE, pas pour la courante", () => {
    const cible = { host: "127.0.0.1", port: 5432 };
    const win = diagnoseConnectionFailure({ code: "28P01" }, cible, "win32");
    const nix = diagnoseConnectionFailure({ code: "28P01" }, cible, "linux");
    const mac = diagnoseConnectionFailure({ code: "28P01" }, cible, "darwin");
    // `lsof` n'existe pas sous Windows : proposer une commande introuvable
    // ajoute un mystère au lieu d'en retirer un.
    assert.match(win.explanation, /netstat -ano \| findstr :5432/);
    assert.ok(!win.explanation.includes("lsof"));
    for (const d of [nix, mac]) {
      assert.match(d.explanation, /lsof -nP -iTCP:5432 -sTCP:LISTEN/);
      assert.ok(!d.explanation.includes("netstat"));
    }
  });
});

describe("diagnoseConnectionFailure — connecté, puis une instruction refusée", () => {
  it("🔴 SQLSTATE 42804 (FK uuid → text) : ne parle PAS de connexion, nomme le refus", () => {
    // Vécu en CI : rapporté « échec de connexion à 127.0.0.1:5432 (42804) »
    // alors que la base répondait très bien — une clé étrangère était refusée.
    const d = diagnoseConnectionFailure(
      { code: "42804" },
      { host: "127.0.0.1", port: 5432 },
    );
    assert.equal(d.verdict, "rejected");
    assert.equal(d.code, "42804");
    assert.match(d.explanation, /a ABOUTI/);
    assert.match(d.explanation, /refusé une instruction \(42804\)/);
    assert.ok(!d.explanation.includes("démarrée"));
    assert.ok(!d.explanation.includes("échec de connexion"));
  });

  it("toute classe SQLSTATE hors connexion prouve que la connexion avait abouti", () => {
    for (const code of ["42P07", "23505", "0A000", "XX000"]) {
      assert.equal(
        diagnoseConnectionFailure({ code }).verdict,
        "rejected",
        code,
      );
    }
  });

  it("MySQL/MariaDB : un `ER_*` d'instruction est un refus, pas une connexion manquée", () => {
    for (const code of [
      "ER_FK_INCOMPATIBLE_COLUMNS",
      "ER_CANNOT_ADD_FOREIGN",
    ]) {
      assert.equal(
        diagnoseConnectionFailure({ code }).verdict,
        "rejected",
        code,
      );
    }
  });

  it("les classes de CONNEXION (08, 57) et la phase d'établissement MySQL n'y entrent pas", () => {
    for (const code of [
      "08006",
      "57P01",
      "57P03",
      "ER_CON_COUNT_ERROR",
      "ER_SERVER_SHUTDOWN",
      "EPIPE",
    ]) {
      assert.notEqual(
        diagnoseConnectionFailure({ code }).verdict,
        "rejected",
        code,
      );
    }
  });
});

describe("diagnoseConnectionFailure — ce qu'on ne sait pas", () => {
  it("un code inconnu ne fait affirmer NI l'un NI l'autre", () => {
    const d = diagnoseConnectionFailure({ code: "PROTOCOL_CONNECTION_LOST" });
    assert.equal(d.verdict, "unknown");
    assert.equal(d.code, "PROTOCOL_CONNECTION_LOST");
    assert.ok(!d.explanation.includes("AUTRE SERVEUR"));
    assert.ok(!d.explanation.includes("personne n'écoute"));
  });

  it("une erreur sans code reste lisible", () => {
    const d = diagnoseConnectionFailure(new Error("boom"), {
      host: "db.example",
      port: 5432,
    });
    assert.equal(d.verdict, "unknown");
    assert.equal(d.code, null);
    assert.match(d.explanation, /db\.example:5432/);
  });

  it("sans adresse connue, le message ne prétend pas en avoir une", () => {
    const d = diagnoseConnectionFailure({ code: "ECONNREFUSED" });
    assert.match(d.explanation, /l'adresse configurée/);
  });
});

describe("parseConnectionTarget — l'adresse, jamais le secret", () => {
  it("extrait hôte et port des trois familles d'URL", () => {
    assert.deepEqual(
      parseConnectionTarget("postgres://user:motdepasse@127.0.0.1:5432/base"),
      { host: "127.0.0.1", port: 5432 },
    );
    assert.deepEqual(
      parseConnectionTarget("mysql://user:motdepasse@db.local:3306/base"),
      { host: "db.local", port: 3306 },
    );
    assert.deepEqual(
      parseConnectionTarget("mongodb://user:motdepasse@127.0.0.1:27017/base"),
      { host: "127.0.0.1", port: 27017 },
    );
  });

  it("une URL sans port explicite ne s'en invente pas un", () => {
    assert.deepEqual(
      parseConnectionTarget("mongodb+srv://grappe.example/base"),
      {
        host: "grappe.example",
        port: null,
      },
    );
  });

  it("URL absente ou illisible → aucun champ affirmé", () => {
    for (const url of [undefined, null, "", "pas une url"]) {
      assert.deepEqual(parseConnectionTarget(url), { host: null, port: null });
    }
  });
});

describe("diagnoseConnectionFailure — la forme RÉELLE d'une erreur MongoDB", () => {
  it("`code` numérique ET `codeName` : c'est le NOM qui est lu", () => {
    // Un `MongoServerError` porte les deux ; lu en premier, `18` masquait
    // `AuthenticationFailed` et le refus n'était jamais reconnu.
    const d = diagnoseConnectionFailure({
      code: 18,
      codeName: "AuthenticationFailed",
    });
    assert.equal(d.verdict, "answered");
    assert.equal(d.code, "AuthenticationFailed");
  });
});

describe("describeConnectFailure — la phrase de démarrage", () => {
  const subject = `Drizzle : le connecteur "default" (postgres: 127.0.0.1:5432/app)`;
  const cause = 'foreign key constraint "user_ref_fk" cannot be implemented';

  it("🔴 un refus d'instruction ne commence PAS par « n'a pas pu se connecter », et la cause passe en tête", () => {
    const d = diagnoseConnectionFailure(
      { code: "42804" },
      { host: "127.0.0.1", port: 5432 },
    );
    const msg = describeConnectFailure(
      subject,
      d,
      cause,
      " Si l'adresse est la bonne, …",
    );
    assert.ok(!msg.includes("n'a pas pu se connecter"), msg);
    assert.ok(
      !msg.includes("Si l'adresse"),
      "le conseil de connexion n'a rien à faire ici",
    );
    assert.ok(
      msg.indexOf(cause) < msg.indexOf("a ABOUTI"),
      "la cause du pilote doit précéder l'explication",
    );
    assert.match(msg, /\(42804\)/);
  });

  it("un échec de CONNEXION garde sa phrase et son conseil (inchangé)", () => {
    const d = diagnoseConnectionFailure({ code: "ECONNREFUSED" });
    const msg = describeConnectFailure(
      subject,
      d,
      "connect ECONNREFUSED",
      " Conseil.",
    );
    assert.match(msg, /n'a pas pu se connecter — personne n'écoute/);
    assert.match(msg, / Conseil\. Cause : connect ECONNREFUSED$/);
  });

  // Le module de `create app` est lourd à transpiler : l'importer DANS le test
  // faisait compter son chargement dans le budget de 5 s du cas — dépassé sur
  // un exécuteur macOS lent (CI 90574134), sans rien dire de la parité. Le
  // chargement a son propre budget ; le cas, lui, ne mesure que la parité.
  let migrationFailureCause: (typeof import("../../../../../nodefony/src/cli/create"))["migrationFailureCause"];
  beforeAll(async () => {
    ({ migrationFailureCause } =
      await import("../../../../../nodefony/src/cli/create"));
  }, 60_000);

  it("parité avec `create app` : un refus d'instruction n'y est PAS une base injoignable", () => {
    // Le cœur ne peut pas importer orm-core : il lit sa propre copie du
    // marqueur. Ce test compose la phrase ICI et la fait lire LÀ-BAS.
    const d = diagnoseConnectionFailure({ code: "42804" });
    const sortie = `ERROR drizzle : BootConfigurationError: ${describeConnectFailure(subject, d, cause)}\n    at x\n`;
    const v = migrationFailureCause(sortie, 70);
    assert.equal(v.databaseUnreachable, false);
    assert.match(v.pattern, /schéma refusé par la base/);
    assert.ok(v.pattern.includes(cause), v.pattern);
    assert.ok(!v.pattern.includes("    at "));
  });
});
