/**
 * Unit — recherche globale de la page Configuration
 * (`frontend/src/routes/config/configSearchEngine.ts`).
 *
 * Ce qu'un humain tape pour trouver un réglage doit le trouver : morceau de clé,
 * clé écrite à la façon d'une variable, mot de la description, nom du module,
 * variable `NF_…`, faute de frappe, synonyme français. Et un secret ne doit
 * jamais être retrouvé par sa valeur.
 */
import { describe, it } from "vitest";
import { expect } from "vitest";
import {
  buildConfigSearchIndex,
  searchConfig,
  withinOneEdit,
  type ISearchableField,
  type ISearchableModule,
} from "../../../frontend/src/routes/config/configSearchEngine";

function field(
  key: string,
  extra: Partial<ISearchableField> = {},
): ISearchableField {
  return { key, ...extra };
}

function mod(
  key: string,
  name: string,
  config: Record<string, unknown>,
  fields: ISearchableField[],
  extra: { isApp?: boolean; envKeys?: Record<string, string> } = {},
): ISearchableModule {
  return {
    entry: {
      key,
      name,
      isApp: extra.isApp ?? false,
      config,
      envKeys: extra.envKeys ?? {},
    },
    sections: [{ fields }],
  };
}

const MODULES: ISearchableModule[] = [
  mod(
    "app",
    "mon-app",
    { domain: "localhost", servers: { http: { port: 5151 } } },
    [
      field("domain", { description: "Domaine d'écoute des serveurs" }),
      field("servers.http.port", {
        description: "Port HTTP",
        recipe: "NF__APP__SERVERS__HTTP__PORT",
      }),
    ],
    { isApp: true },
  ),
  mod(
    "security",
    "@nodefony/security",
    { jwt: { accessTtlS: 900, secret: "chut-ne-le-dis-pas" } },
    [
      field("jwt.accessTtlS", {
        description: "Durée de vie d'un jeton d'accès, en secondes",
        recipe: "NF__SECURITY__JWT__ACCESSTTLS",
        source: "env",
      }),
      field("jwt.secret", {
        secret: true,
        recipe: "NF__SECURITY__JWT__SECRET",
      }),
    ],
    { envKeys: { "jwt.accessttls": "NF__SECURITY__JWT__ACCESSTTLS" } },
  ),
  mod("redis", "@nodefony/redis", { host: "127.0.0.1" }, [
    field("host", { env: "NF_REDIS_HOST", recipe: "NF__REDIS__HOST" }),
  ]),
  mod("syslog", "@nodefony/syslog", { level: "info" }, [
    field("level", { description: "Niveau minimal des journaux" }),
  ]),
];

const INDEX = buildConfigSearchIndex(MODULES);
const keys = (q: string): string[] =>
  searchConfig(INDEX, q).hits.map(
    (h) => `${h.doc.moduleKey}:${h.doc.field.key}`,
  );

describe("configSearch — ce qu'on tape trouve le réglage", () => {
  it("un mot de clé camelCase éclaté : « ttl » trouve jwt.accessTtlS", () => {
    expect(keys("ttl")).to.deep.equal(["security:jwt.accessTtlS"]);
  });

  it("la clé écrite comme une variable ou avec des espaces est la même clé", () => {
    expect(keys("JWT__ACCESSTTLS")).to.include("security:jwt.accessTtlS");
    expect(keys("jwt.accessTtlS")).to.include("security:jwt.accessTtlS");
    expect(keys("jwt accessttls")).to.include("security:jwt.accessTtlS");
  });

  it("une variable NF_ ne cherche que dans les variables", () => {
    expect(keys("NF_REDIS_HOST")).to.deep.equal(["redis:host"]);
    expect(keys("NF__SECURITY__JWT__ACCESSTTLS")).to.deep.equal([
      "security:jwt.accessTtlS",
    ]);
  });

  it("un mot de la description, accents ignorés", () => {
    expect(keys("duree de vie")).to.deep.equal(["security:jwt.accessTtlS"]);
  });

  it("le nom du module", () => {
    expect(keys("redis")).to.deep.equal(["redis:host"]);
  });

  it("tous les mots doivent répondre", () => {
    expect(keys("port redis")).to.deep.equal([]);
  });

  it("une faute de frappe sur un mot de clé est pardonnée", () => {
    expect(keys("acess")).to.include("security:jwt.accessTtlS");
    expect(keys("domian")).to.include("app:domain");
  });

  it("un synonyme français mène à la clé anglaise", () => {
    expect(keys("domaine")).to.include("app:domain");
    expect(keys("journal")).to.deep.equal(["syslog:level"]); // `syslog`
    expect(keys("jeton")).to.include("security:jwt.accessTtlS"); // `jwt`
  });

  it("une valeur effective retrouve son réglage", () => {
    expect(keys("5151")).to.deep.equal(["app:servers.http.port"]);
  });
});

describe("configSearch — classement et secrets", () => {
  it("la clé exacte passe avant la description", () => {
    const hits = searchConfig(INDEX, "port").hits.map((h) => h.doc.field.key);
    expect(hits[0]).to.equal("servers.http.port");
  });

  it("un secret n'est jamais retrouvé par sa valeur", () => {
    expect(keys("chut")).to.deep.equal([]);
    // …mais il l'est par sa clé
    expect(keys("secret")).to.include("security:jwt.secret");
  });

  it("le compte total reste exact quand la liste est plafonnée", () => {
    const r = searchConfig(INDEX, "nodefony", 1);
    expect(r.hits).to.have.length(1);
    expect(r.total).to.equal(4);
  });

  it("une requête vide ne rend rien", () => {
    expect(searchConfig(INDEX, "   ")).to.deep.equal({ hits: [], total: 0 });
  });
});

describe("configSearch — withinOneEdit", () => {
  it("accepte une substitution, une insertion, une inversion", () => {
    expect(withinOneEdit("domain", "domein")).to.equal(true);
    expect(withinOneEdit("domain", "domainn")).to.equal(true);
    expect(withinOneEdit("domain", "domian")).to.equal(true);
  });
  it("refuse deux opérations", () => {
    expect(withinOneEdit("domain", "dmian")).to.equal(false);
    expect(withinOneEdit("domain", "dommainn")).to.equal(false);
  });
});
