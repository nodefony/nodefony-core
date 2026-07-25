import { describe, it } from "vitest";
import { assert } from "chai";
import { buildEnvReport } from "../cli/envReport";
import { envFileOrder } from "../runtime/loadEnv";
import type { NamedEnvVarMeta } from "../config/defineEnv";

/**
 * Le rapport d'environnement — calcul PUR, donc éprouvable sans écrire un seul
 * fichier.
 *
 * Ce qui est réellement testé ici n'est pas « la fonction rend un objet », mais
 * les trois affirmations sur lesquelles un utilisateur va se fier pour corriger
 * sa configuration : d'où vient une valeur, ce qui est masqué, et ce qui n'a
 * aucun effet. Se tromper sur l'une des trois est pire que de ne rien afficher —
 * on croit alors le rapport et on cherche ailleurs.
 */

const meta = (
  name: string,
  over: Partial<NamedEnvVarMeta> = {},
): NamedEnvVarMeta => ({
  name,
  kind: "string",
  optional: false,
  ...over,
});

describe("rapport d'environnement (nodefony env)", () => {
  it("l'ordre affiché EST celui qui est appliqué (une seule source)", () => {
    // Si ces deux listes divergeaient, la commande décrirait une cascade que le
    // framework n'applique pas — le pire service à rendre à qui cherche pourquoi
    // sa variable est ignorée. D'où l'extraction de `envFileOrder`.
    assert.deepEqual(envFileOrder({ runtimeEnv: "development" }), [
      ".env.development.local",
      ".env.local",
      ".env.development",
      ".env",
    ]);
    // Un environnement de déploiement s'insère AU-DESSUS du mode, à chaque rang :
    // il est plus spécifique.
    assert.deepEqual(
      envFileOrder({ runtimeEnv: "production", appEnv: "staging" }),
      [
        ".env.staging.local",
        ".env.production.local",
        ".env.local",
        ".env.staging",
        ".env.production",
        ".env",
      ],
    );
    // Déploiement égal au mode → pas de niveau en double.
    assert.deepEqual(
      envFileOrder({ runtimeEnv: "production", appEnv: "production" }),
      [".env.production.local", ".env.local", ".env.production", ".env"],
    );
  });

  it("attribue la valeur au PREMIER fichier qui la porte, et masque les autres", () => {
    const report = buildEnvReport({
      runtimeEnv: "development",
      processEnv: { NF_PORT: "5152" },
      files: [
        { source: ".env.local", vars: { NF_PORT: "5152" } },
        { source: ".env", vars: { NF_PORT: "3000" } },
      ],
      catalog: [meta("NF_PORT", { kind: "number" })],
    });
    const port = report.vars[0];
    assert.equal(port.origin, ".env.local");
    assert.equal(port.value, "5152");
    // Le piège n°1 : la variable EST écrite dans `.env`, et n'a aucun effet.
    assert.deepEqual(port.shadowed, [{ source: ".env", value: "3000" }]);
  });

  it("le shell gagne, et le fichier qui le contredit est signalé masqué", () => {
    const report = buildEnvReport({
      runtimeEnv: "development",
      // Valeur effective ≠ celle du fichier → c'est le shell qui l'a posée.
      processEnv: { NF_PORT: "9999" },
      files: [{ source: ".env.local", vars: { NF_PORT: "5152" } }],
      catalog: [meta("NF_PORT", { kind: "number" })],
    });
    assert.equal(report.vars[0].origin, "process.env");
    assert.deepEqual(report.vars[0].shadowed, [
      { source: ".env.local", value: "5152" },
    ]);
  });

  it("une variable requise absente est nommée comme telle", () => {
    const report = buildEnvReport({
      runtimeEnv: "development",
      processEnv: {},
      files: [],
      catalog: [
        meta("NF_DATABASE_URL"),
        meta("NF_LOG_DRIVER", { default: "stdout" }),
        meta("NF_OPTIONAL", { optional: true }),
      ],
    });
    const missing = report.vars.filter((v) => v.missing).map((v) => v.name);
    // Un défaut ou l'optionnalité suffisent à ne PAS être manquante.
    assert.deepEqual(missing, ["NF_DATABASE_URL"]);
    assert.isTrue(report.vars[0].required);
    assert.isFalse(report.vars[1].required);
    assert.isFalse(report.vars[2].required);
  });

  it("ne rend JAMAIS la valeur d'un secret, sans mentir sur sa présence", () => {
    const report = buildEnvReport({
      runtimeEnv: "development",
      processEnv: { NF_TOTP_KEY: "s3cr3t-en-clair" },
      files: [
        { source: ".env.local", vars: { NF_TOTP_KEY: "s3cr3t-en-clair" } },
      ],
      catalog: [meta("NF_TOTP_KEY")],
    });
    const v = report.vars[0];
    assert.isTrue(v.secret);
    assert.notInclude(JSON.stringify(report), "s3cr3t-en-clair");
    // Masquée, mais on voit qu'elle est là, d'où elle vient et sa longueur.
    assert.include(String(v.value), "15 car.");
    assert.equal(v.origin, ".env.local");
  });

  it("distingue une surcharge NF__ d'une variable déclarée", () => {
    const report = buildEnvReport({
      runtimeEnv: "development",
      processEnv: {
        NF_PORT: "5152",
        NF__HTTP__SERVERS__HTTPS__PORT: "8443",
        NF__SECURITY__JWT__SECRET: "abc",
      },
      files: [],
      catalog: [meta("NF_PORT", { kind: "number" })],
    });
    // `NF__…` ne passe PAS par env.ts : il vise directement une clé de module.
    // Le confondre avec une variable déclarée est l'erreur que la commande évite.
    assert.deepEqual(
      report.overrides.map((o) => `${o.module}.${o.path.join(".")}`),
      ["http.servers.https.port", "security.jwt.secret"],
    );
    assert.equal(report.overrides[0].value, "8443");
    // Un chemin qui porte un secret est masqué comme une variable secrète.
    assert.notInclude(JSON.stringify(report.overrides[1]), "abc");
    // Et surtout : elles ne polluent pas la liste des variables INCONNUES.
    assert.deepEqual(report.unknown, []);
  });

  it("nomme les NF_ inconnues et suggère la bonne orthographe", () => {
    const report = buildEnvReport({
      runtimeEnv: "development",
      processEnv: { NF_PROT: "5152", PATH: "/usr/bin", HOME: "/home/x" },
      files: [{ source: ".env.local", vars: { NF_PROT: "5152" } }],
      catalog: [meta("NF_PORT", { kind: "number" })],
    });
    // Une faute de frappe sur une variable d'env est INVISIBLE au démarrage : la
    // valeur est ignorée et le défaut s'applique en silence. C'est le seul
    // endroit qui peut la montrer.
    assert.deepEqual(
      report.unknown.map((u) => [u.name, u.suggestion, u.origin]),
      [["NF_PROT", "NF_PORT", ".env.local"]],
    );
    // Le reste de l'environnement système n'est pas listé — il noierait le signal.
    assert.notInclude(
      report.unknown.map((u) => u.name),
      "PATH",
    );
  });

  it("ne réclame pas la déclaration d'un `<KEY>_FILE` (secret monté)", () => {
    const report = buildEnvReport({
      runtimeEnv: "development",
      processEnv: { NF_TOTP_KEY_FILE: "/run/secrets/totp" },
      files: [],
      catalog: [meta("NF_TOTP_KEY")],
    });
    // La convention `<KEY>_FILE` porte la MÊME variable, montée par Docker ou
    // Kubernetes : la signaler « inconnue » enverrait corriger ce qui est juste.
    assert.deepEqual(report.unknown, []);
  });

  it("sans catalogue, la cascade reste exacte et le manque est DIT", () => {
    const report = buildEnvReport({
      runtimeEnv: "development",
      processEnv: { NF_PORT: "5152" },
      files: [{ source: ".env", vars: { NF_PORT: "5152" } }],
      catalog: null,
    });
    assert.isFalse(report.catalogAvailable);
    assert.deepEqual(report.vars, []);
    assert.equal(report.levels[1].source, ".env");
    assert.isTrue(report.levels[1].exists);
    // Un rapport partiel qui ne dit pas qu'il est partiel se lit comme complet.
    assert.match(report.notes.join(" "), /catalogue des variables illisible/u);
  });
});
