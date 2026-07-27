/*
 *   Champs d'entité : `title:string` → colonne Drizzle du dialecte visé.
 *
 *   C'est la pièce où une erreur ne se voit pas à la relecture (un `notNull()` oublié,
 *   un type qui ne survit pas au changement de moteur) et se paye en production. D'où
 *   des tests sur les TROIS dialectes, pas seulement sur celui du développement.
 */

import assert from "node:assert";
import {
  parseEntityFields,
  parseEntityIndexes,
  buildEntityCodegen,
  toSnakeCase,
  EntityFieldError,
  type IEntityField,
} from "../cli/scaffold/entityFields";
import { sampleValue } from "../cli/scaffold/engine";

describe("scaffold — analyse des champs", () => {
  it("nom seul → string par défaut, NON NULL", () => {
    const [f] = parseEntityFields("title");
    assert.deepStrictEqual(f, {
      name: "title",
      type: "string",
      nullable: false,
      unique: false,
      indexed: false,
    });
  });

  it("lit type, nullable (?), unique (!) et index", () => {
    const fields = parseEntityFields("slug:string! bio:text? views:int:index");
    assert.strictEqual(fields[0].unique, true);
    assert.strictEqual(fields[0].nullable, false);
    assert.strictEqual(fields[1].nullable, true);
    assert.strictEqual(fields[2].indexed, true);
    assert.strictEqual(fields[2].type, "int");
  });

  it("accepte les modificateurs dans les deux ordres (?! et !?)", () => {
    const a = parseEntityFields("email:string?!")[0];
    const b = parseEntityFields("email:string!?")[0];
    assert.deepStrictEqual(a, b);
    assert.strictEqual(a.nullable, true);
    assert.strictEqual(a.unique, true);
  });

  it("relation : author:ref:User", () => {
    const [f] = parseEntityFields("author:ref:User");
    assert.strictEqual(f.type, "ref");
    assert.strictEqual(f.target, "User");
  });

  it("une colonne de relation est INDEXÉE d'office (c'est par elle qu'on joint)", () => {
    // `?include=` émet une requête `IN (…)` sur cette colonne, comme toute
    // jointure écrite ensuite : sans index, chacune balaie la table — et ça ne
    // se voit jamais sur les dix lignes du développement.
    const [f] = parseEntityFields("author:ref:User");
    assert.strictEqual(f.indexed, true);
    // `!` (unique) pose DÉJÀ un index : en ajouter un second serait du poids
    // mort à l'écriture, sans un seul lecteur de plus.
    const [u] = parseEntityFields("owner:ref:User!");
    assert.strictEqual(u.unique, true);
    assert.strictEqual(u.indexed, false);
  });

  it("l'index de relation est bien ÉMIS dans la table générée", () => {
    // Contre-épreuve au niveau du rendu : le drapeau ne sert à rien s'il ne
    // ressort pas en `CREATE INDEX`.
    const c = buildEntityCodegen(parseEntityFields("author:ref:User"), {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.match(c.tableExtras, /author/u);
    assert.notStrictEqual(c.tableExtras.trim(), "");
  });

  it("refuse ce qui produirait du code faux (le mot « invalide » → EX_USAGE)", () => {
    const rejected = [
      "title:unknownType", // type inconnu
      "Title:string", // pas camelCase
      "author:ref:user", // cible pas en PascalCase
      "author:ref", // cible manquante
      "id:string", // l'id est posé par --id
      "a:string a:int", // doublon
      "a:string:extra", // segments en trop
    ];
    for (const spec of rejected) {
      assert.throws(
        () => parseEntityFields(spec),
        (e: Error) =>
          e instanceof EntityFieldError && /invalide/u.test(e.message),
        `« ${spec} » aurait dû être refusé`,
      );
    }
  });

  it("chaîne vide → aucun champ (l'entité n'a que sa clé et ses horodatages)", () => {
    assert.deepStrictEqual(parseEntityFields("   "), []);
  });

  it("énumération : status:enum(draft,published)", () => {
    const [f] = parseEntityFields("status:enum(draft,published)");
    assert.strictEqual(f.type, "enum");
    assert.deepStrictEqual(f.values, ["draft", "published"]);
    assert.strictEqual(f.nullable, false);
  });

  it("énumération avec modificateurs et défaut", () => {
    const [f] = parseEntityFields("status:enum(draft,published)?=draft:index");
    assert.deepStrictEqual(f.values, ["draft", "published"]);
    assert.strictEqual(f.defaultValue, "draft");
    assert.strictEqual(f.nullable, true);
    assert.strictEqual(f.indexed, true);
  });

  it("valeurs par défaut : nombre, booléen, texte", () => {
    const fields = parseEntityFields(
      "views:int=0 ok:bool=true tag:string=neuf",
    );
    assert.strictEqual(fields[0].defaultValue, "0");
    assert.strictEqual(fields[1].defaultValue, "true");
    assert.strictEqual(fields[2].defaultValue, "neuf");
  });

  it("un défaut incohérent est refusé AVANT d'écrire du code faux", () => {
    const rejected = [
      "views:int=abc", // pas un nombre
      "ok:bool=oui", // ni true ni false
      "meta:json={}", // type sans défaut littéral
      "at:date=now", // idem
      "author:ref:User=x", // une relation n'a pas de défaut
      "status:enum(draft,published)=archived", // défaut hors des valeurs
      "status:enum()", // enum sans valeur
      "status:enum", // enum sans parenthèses
      "title:string=", // `=` sans valeur
    ];
    for (const spec of rejected) {
      assert.throws(
        () => parseEntityFields(spec),
        (e: Error) =>
          e instanceof EntityFieldError && /invalide/u.test(e.message),
        `« ${spec} » aurait dû être refusé`,
      );
    }
  });
});

describe("scaffold — code des colonnes", () => {
  const fields = parseEntityFields(
    "title:string! body:text? views:int meta:json published:bool at:date author:ref:User",
  );

  it("sqlite : types natifs du moteur, booléen et json en mode", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: true,
      softDelete: false,
      table: "posts",
    });
    assert.match(c.drizzleImport, /from "drizzle-orm\/sqlite-core"/u);
    assert.strictEqual(c.tableFn, "sqliteTable");
    assert.match(c.columns, /title: text\("title"\)\.notNull\(\)\.unique\(\)/u);
    assert.match(
      c.columns,
      /published: integer\("published", \{ mode: "boolean" \}\)/u,
    );
    assert.match(c.columns, /meta: text\("meta", \{ mode: "json" \}\)/u);
    // Nullable → PAS de notNull (et l'inverse doit rester vrai).
    assert.match(c.columns, /body: text\("body"\),/u);
  });

  it("postgres : jsonb (pas json) et timestamptz", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "postgres",
      id: "uuid7",
      timestamps: true,
      softDelete: false,
      table: "posts",
    });
    assert.strictEqual(c.tableFn, "pgTable");
    assert.match(c.columns, /meta: jsonb\("meta"\)/u);
    assert.match(
      c.columns,
      /at: timestamp\("at", \{ withTimezone: true, precision: 3 \}\)/u,
    );
  });

  it("mysql : l'uuid est un varchar — InnoDB ne sait pas indexer un TEXT", () => {
    const c = buildEntityCodegen([], {
      dialect: "mysql",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.strictEqual(c.tableFn, "mysqlTable");
    assert.match(
      c.columns,
      /id: varchar\("id", \{ length: 36 \}\)\.primaryKey\(\)/u,
    );
  });

  it("clé primaire uuid7 : valeur produite côté JS (le DDL dev n'émet pas les DEFAULT SQL)", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.match(
      c.columns,
      /\$defaultFn\(\(\) => Nodefony\.generateSortableId\(\)\)/u,
    );
    assert.strictEqual(c.needsNodefony, true);
    assert.strictEqual(c.idType, "string");
  });

  it("clé primaire uuid4 : générateur imprévisible", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid4",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.match(c.columns, /\$defaultFn\(\(\) => Nodefony\.generateId\(\)\)/u);
  });

  it("clé primaire serial : entier auto-incrémenté, aucun générateur JS", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "serial",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.match(
      c.columns,
      /id: integer\("id"\)\.primaryKey\(\{ autoIncrement: true \}\)/u,
    );
    assert.strictEqual(c.needsNodefony, false);
    assert.strictEqual(c.idType, "number");
  });

  it("horodatages posés côté JS, updatedAt rafraîchi à chaque écriture", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: true,
      softDelete: false,
      table: "posts",
    });
    assert.match(
      c.columns,
      /createdAt: .*\$defaultFn\(\(\) => new Date\(\)\)/u,
    );
    assert.match(
      c.columns,
      /updatedAt: .*\$onUpdateFn\(\(\) => new Date\(\)\)/u,
    );
    assert.match(c.rowProps, /createdAt: Date;/u);
  });

  it("sans horodatages : les colonnes disparaissent vraiment", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.doesNotMatch(c.columns, /createdAt/u);
  });

  it("suppression douce : colonne deletedAt nullable", () => {
    const c = buildEntityCodegen([], {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: true,
      table: "posts",
    });
    assert.match(
      c.columns,
      /deletedAt: integer\("deleted_at", \{ mode: "timestamp_ms" \}\),/u,
    );
    assert.match(c.rowProps, /deletedAt: Date \| null;/u);
  });

  it("l'interface de ligne suit la nullabilité", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.match(c.rowProps, /title: string;/u);
    assert.match(c.rowProps, /body: string \| null;/u);
    assert.match(c.rowProps, /views: number;/u);
  });

  it("le schéma Zod suit la nullabilité", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.match(c.zodProps, /title: z\.string\(\)\.min\(1\)\.max\(255\),/u);
    assert.match(
      c.zodProps,
      /body: z\.string\(\)\.nullable\(\)\.optional\(\),/u,
    );
    // Ni id ni horodatages dans le contrat d'entrée : ils sont posés par le serveur.
    assert.doesNotMatch(c.zodProps, /\bid\b/u);
    assert.doesNotMatch(c.zodProps, /createdAt/u);
  });

  it("une relation est annotée — la contrainte FK n'est PAS promise", () => {
    const c = buildEntityCodegen(parseEntityFields("author:ref:User"), {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.match(
      c.columns,
      /author: text\("author"\)\.notNull\(\), \/\/ → User\.id/u,
    );
  });

  // Une énumération doit contraindre pour de vrai — au typage ET à l'entrée.
  it("énumération : colonne typée, union TS et z.enum", () => {
    const c = buildEntityCodegen(
      parseEntityFields("status:enum(draft,published)"),
      {
        dialect: "sqlite",
        id: "uuid7",
        timestamps: false,
        softDelete: false,
        table: "posts",
      },
    );
    assert.match(
      c.columns,
      /status: text\("status", \{ enum: \["draft", "published"\] as const \}\)/u,
    );
    assert.match(c.rowProps, /status: "draft" \| "published";/u);
    assert.match(c.zodProps, /status: z\.enum\(\["draft", "published"\]\),/u);
  });

  it("postgres : une énumération reste une colonne texte (pas de CREATE TYPE)", () => {
    const c = buildEntityCodegen(
      parseEntityFields("status:enum(draft,published)"),
      {
        dialect: "postgres",
        id: "uuid7",
        timestamps: false,
        softDelete: false,
        table: "posts",
      },
    );
    // `pgEnum` exigerait un `CREATE TYPE` que le DDL dérivé du dev n'émet pas :
    // la table ne se créerait jamais au boot.
    assert.doesNotMatch(c.drizzleImport, /pgEnum/u);
    assert.match(
      c.columns,
      /status: varchar\("status", \{ length: 255, enum:/u,
    );
  });

  // Un défaut SQL ne serait pas émis par le DDL dérivé : il doit vivre côté JS.
  it("valeur par défaut : $defaultFn côté JS, et le Zod l'accepte", () => {
    const c = buildEntityCodegen(
      parseEntityFields("views:int=0 tag:string=neuf"),
      {
        dialect: "sqlite",
        id: "uuid7",
        timestamps: false,
        softDelete: false,
        table: "posts",
      },
    );
    assert.match(
      c.columns,
      /views: integer\("views"\)\.notNull\(\)\.\$defaultFn\(\(\) => 0\)/u,
    );
    assert.match(
      c.columns,
      /tag: text\("tag"\)\.notNull\(\)\.\$defaultFn\(\(\) => "neuf"\)/u,
    );
    assert.doesNotMatch(c.columns, /\.default\(/u);
    assert.match(c.zodProps, /views: z\.number\(\)\.int\(\)\.default\(0\),/u);
  });

  // `:index` était parsé mais jamais émis — la promesse de la grammaire était vide.
  it("`:index` produit un vrai index, nommé d'après la table", () => {
    const c = buildEntityCodegen(parseEntityFields("title:string:index"), {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.match(c.drizzleImport, /\bindex\b/u);
    // Le préfixe de table n'est pas cosmétique : un nom d'index est unique pour
    // toute la base en PostgreSQL comme en SQLite.
    assert.match(c.tableExtras, /index\("posts_title_idx"\)\.on\(t\.title\)/u);
  });

  it("sans `:index`, la table garde sa forme à deux arguments", () => {
    const c = buildEntityCodegen(parseEntityFields("title:string"), {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "posts",
    });
    assert.strictEqual(c.tableExtras, "");
    assert.doesNotMatch(c.drizzleImport, /\bindex\b/u);
  });
});

/*
 *   Index de TABLE — ce que le modificateur `:index` ne peut pas exprimer.
 *
 *   Mesuré sur un schéma réel (Umami, 18 tables) : 28 de ses index portent
 *   plusieurs colonnes, contre 45 une seule. Une grammaire qui n'indexe que
 *   colonne par colonne laisse donc de côté la moitié de ce qui fait la
 *   performance d'une table — et le manque est invisible, puisque le code produit
 *   compile et fonctionne.
 */
describe("scaffold — index de table (plusieurs colonnes)", () => {
  const fields = parseEntityFields("siteId:uuid visitId:uuid path:string");
  const opts = { timestamps: true, softDelete: false };

  it("l'ordre des colonnes est conservé — il décide des requêtes servies", () => {
    const [idx] = parseEntityIndexes(["siteId,createdAt"], fields, opts);
    assert.deepStrictEqual(idx.columns, ["siteId", "createdAt"]);
    assert.strictEqual(idx.unique, false);
  });

  it("une colonne implicite est indexable (createdAt, id)", () => {
    const [idx] = parseEntityIndexes(["id,createdAt"], fields, opts);
    assert.deepStrictEqual(idx.columns, ["id", "createdAt"]);
  });

  it("colonne inconnue → refus AVANT d'écrire, avec les noms disponibles", () => {
    assert.throws(
      () => parseEntityIndexes(["siteId,inexistante"], fields, opts),
      (e: unknown) =>
        e instanceof EntityFieldError &&
        /inexistante/u.test((e as Error).message) &&
        /colonnes disponibles/u.test((e as Error).message),
    );
  });

  it("colonne répétée dans le même index → refus", () => {
    assert.throws(
      () => parseEntityIndexes(["siteId,siteId"], fields, opts),
      EntityFieldError,
    );
  });

  it("createdAt n'est PAS indexable sans horodatages", () => {
    assert.throws(
      () =>
        parseEntityIndexes(["siteId,createdAt"], fields, {
          timestamps: false,
          softDelete: false,
        }),
      EntityFieldError,
    );
  });

  it("deux déclarations identiques → un seul index (la base refuserait la seconde)", () => {
    const out = parseEntityIndexes(
      ["siteId,visitId", "siteId,visitId"],
      fields,
      opts,
    );
    assert.strictEqual(out.length, 1);
  });

  it("émission : deux index de deux colonnes, jamais un de quatre", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "postgres",
      id: "uuid7",
      timestamps: true,
      softDelete: false,
      table: "events",
      indexes: parseEntityIndexes(
        ["siteId,createdAt", "visitId,createdAt"],
        fields,
        opts,
      ),
    });
    assert.match(
      c.tableExtras,
      /index\("events_siteId_createdAt_idx"\)\.on\(t\.siteId, t\.createdAt\)/u,
    );
    assert.match(
      c.tableExtras,
      /index\("events_visitId_createdAt_idx"\)\.on\(t\.visitId, t\.createdAt\)/u,
    );
  });

  it("`--unique` produit une contrainte, pas un simple index", () => {
    const c = buildEntityCodegen(fields, {
      dialect: "postgres",
      id: "uuid7",
      timestamps: true,
      softDelete: false,
      table: "events",
      indexes: parseEntityIndexes(["siteId,visitId"], fields, opts, true),
    });
    assert.match(
      c.tableExtras,
      /uniqueIndex\("events_siteId_visitId_key"\)\.on\(t\.siteId, t\.visitId\)/u,
    );
    assert.match(c.drizzleImport, /\buniqueIndex\b/u);
  });

  it("`:index` sur un champ et `--index` sur la même colonne → un seul index", () => {
    const withMarker = parseEntityFields("siteId:uuid:index");
    const c = buildEntityCodegen(withMarker, {
      dialect: "sqlite",
      id: "uuid7",
      timestamps: false,
      softDelete: false,
      table: "events",
      indexes: parseEntityIndexes(["siteId"], withMarker, {
        timestamps: false,
        softDelete: false,
      }),
    });
    const occurrences = c.tableExtras.match(/events_siteId_idx/gu) ?? [];
    assert.strictEqual(
      occurrences.length,
      1,
      `index émis deux fois → la création de la table échouerait :\n${c.tableExtras}`,
    );
  });
});

/*
 *   Tailles de colonne — `string(200)`, `char(2)`, `decimal(12,2)`.
 *
 *   Mesuré sur le schéma Umami : onze longueurs de chaîne distinctes, huit
 *   colonnes décimales, un code pays sur deux caractères fixes. Sans ces tailles,
 *   tout partait en `varchar(255)` — de la place perdue à chaque ligne, et surtout
 *   aucune borne là où le métier en pose une.
 *
 *   Les trois moteurs ne se valent pas ici, et les tests le disent plutôt que de
 *   l'aplanir : SQLite n'a ni `varchar` ni `char`, MySQL n'a pas `numeric`.
 */
describe("scaffold — tailles de colonne", () => {
  const fields = parseEntityFields(
    "title:string(200) country:char(2) price:decimal(12,2)",
  );
  const base = {
    id: "uuid7" as const,
    timestamps: false,
    softDelete: false,
    table: "t",
  };

  it("postgres : varchar borné, char fixe, numeric à précision", () => {
    const c = buildEntityCodegen(fields, { ...base, dialect: "postgres" });
    assert.match(c.columns, /title: varchar\("title", \{ length: 200 \}\)/u);
    assert.match(c.columns, /country: char\("country", \{ length: 2 \}\)/u);
    assert.match(
      c.columns,
      /price: numeric\("price", \{ precision: 12, scale: 2 \}\)/u,
    );
  });

  it("mysql : decimal, car le moteur n'expose pas numeric", () => {
    const c = buildEntityCodegen(fields, { ...base, dialect: "mysql" });
    assert.match(
      c.columns,
      /price: decimal\("price", \{ precision: 12, scale: 2 \}\)/u,
    );
    assert.doesNotMatch(c.drizzleImport, /\bnumeric\b/u);
  });

  it("sqlite : la longueur n'existe pas côté moteur — la borne vit dans Zod", () => {
    const c = buildEntityCodegen(fields, { ...base, dialect: "sqlite" });
    assert.match(c.columns, /title: text\("title"\)/u);
    assert.match(c.columns, /country: text\("country"\)/u);
    // La garantie ne disparaît pas pour autant : elle change de gardien.
    assert.match(c.zodProps, /title: z\.string\(\)\.min\(1\)\.max\(200\)/u);
    assert.match(c.zodProps, /country: z\.string\(\)\.length\(2\)/u);
  });

  it("un décimal transite en chaîne — un flottant perdrait la précision", () => {
    const c = buildEntityCodegen(fields, { ...base, dialect: "postgres" });
    assert.match(c.rowProps, /price: string;/u);
    assert.match(c.zodProps, /price: z\.string\(\)\.regex\(/u);
  });

  it("char sans longueur → refus (char(1) ne serait presque jamais l'intention)", () => {
    assert.throws(
      () => parseEntityFields("country:char"),
      (e: unknown) =>
        e instanceof EntityFieldError && /longueur/u.test((e as Error).message),
    );
  });

  it("decimal sans précision → refus (la garantie recherchée disparaîtrait)", () => {
    assert.throws(
      () => parseEntityFields("price:decimal"),
      (e: unknown) =>
        e instanceof EntityFieldError &&
        /précision/u.test((e as Error).message),
    );
  });

  it("échelle supérieure à la précision → refus", () => {
    assert.throws(
      () => parseEntityFields("price:decimal(2,5)"),
      EntityFieldError,
    );
  });

  it("sans taille déclarée, rien ne change pour l'existant", () => {
    const c = buildEntityCodegen(parseEntityFields("title:string"), {
      ...base,
      dialect: "postgres",
    });
    assert.match(c.columns, /title: varchar\("title", \{ length: 255 \}\)/u);
    assert.match(c.zodProps, /max\(255\)/u);
  });
});

/*
 *   Une référence porte le TYPE de la clé qu'elle désigne.
 *
 *   La colonne de relation sortait en texte quel que soit l'identifiant visé. En
 *   PostgreSQL, comparer un `text` à un `uuid` échoue — « operator does not
 *   exist » — donc la jointure que cette colonne existe pour servir refusait de
 *   s'exécuter, `?include=` compris. Le défaut était invisible en développement :
 *   SQLite accepte la comparaison sans broncher, et la panne attendait le premier
 *   vrai serveur.
 */
describe("scaffold — la référence suit la clé primaire", () => {
  const fields = parseEntityFields("author:ref:User");
  const base = { timestamps: false, softDelete: false, table: "posts" };

  it("postgres + uuid : la référence est un uuid, pas un texte", () => {
    const c = buildEntityCodegen(fields, {
      ...base,
      dialect: "postgres",
      id: "uuid7",
    });
    assert.match(c.columns, /id: uuid\("id"\)/u);
    assert.match(c.columns, /author: uuid\("author"\)/u);
    // Le défaut exact que ce banc verrouille.
    assert.doesNotMatch(c.columns, /author: text\("author"\)/u);
  });

  it("mysql + uuid : même largeur que la clé (36), pas 255", () => {
    const c = buildEntityCodegen(fields, {
      ...base,
      dialect: "mysql",
      id: "uuid7",
    });
    assert.match(c.columns, /author: varchar\("author", \{ length: 36 \}\)/u);
  });

  it("clé auto-incrémentée : la référence est un ENTIER, jamais du texte", () => {
    for (const dialect of ["postgres", "mysql", "sqlite"] as const) {
      const c = buildEntityCodegen(fields, { ...base, dialect, id: "serial" });
      assert.match(
        c.columns,
        /author: (integer|int)\("author"\)/u,
        `${dialect} : une référence vers une clé numérique doit être numérique\n${c.columns}`,
      );
      // Et le contrat TypeScript suit, sinon le code appelant compile faux.
      assert.match(c.rowProps, /author: number;/u, dialect);
    }
  });

  it("le schéma de validation suit le type, pas l'inverse", () => {
    const numeric = buildEntityCodegen(fields, {
      ...base,
      dialect: "postgres",
      id: "serial",
    });
    assert.match(numeric.zodProps, /author: z\.number\(\)\.int\(\)/u);
    const uuid = buildEntityCodegen(fields, {
      ...base,
      dialect: "postgres",
      id: "uuid7",
    });
    assert.match(uuid.zodProps, /author: z\.string\(\)/u);
  });
});

/*
 *   L'échantillon d'un champ doit satisfaire le schéma de ce champ.
 *
 *   Règle évidente, cassée trois fois — à l'ajout de l'énumération, puis du
 *   décimal, puis du caractère fixe. Chaque fois la valeur générique `nom-1`
 *   passait à côté d'une contrainte, l'entité naissait avec un test rouge, et le
 *   défaut ne se voyait qu'en LANÇANT le test généré : les assertions du dépôt
 *   lisent des chaînes dans des fichiers rendus, elles n'exécutent rien.
 *
 *   Ce banc ferme la récidive : tout type qui restreint ses valeurs est confronté
 *   ici à la contrainte réelle. Un type ajouté sans sa valeur d'exemple tombera.
 */
describe("scaffold — l'échantillon respecte le schéma", () => {
  const field = (spec: string): IEntityField => parseEntityFields(spec)[0];

  it("décimal : la valeur s'écrit comme un décimal", () => {
    const { fixed } = sampleValue(field("price:decimal(12,2)"), "uuid7");
    assert.match(String(fixed), /^-?\d+(\.\d+)?$/u);
  });

  it("caractère fixe : longueur EXACTE, dans les deux formes", () => {
    const f = field("country:char(3)");
    const { fixed, expr } = sampleValue(f, "uuid7");
    assert.strictEqual(String(fixed).length, 3);
    // La fabrique varie avec `n` : sa longueur doit tenir pour n'importe quel n.
    for (const n of [1, 42, 123456]) {
      const value = String(n).padStart(3, "A").slice(-3);
      assert.strictEqual(value.length, 3, `n=${n} → « ${value} »`);
    }
    assert.match(expr, /padStart\(3/u);
  });

  it("identifiant : un uuid bien formé, pas « nom-1 »", () => {
    const { fixed } = sampleValue(field("siteId:uuid"), "uuid7");
    assert.match(
      String(fixed),
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
      "le schéma exige un identifiant valide (z.string().uuid())",
    );
  });

  it("chaîne bornée : l'exemple ne dépasse pas la borne", () => {
    // Un nom de champ long dans une colonne courte : c'est là que ça casse.
    const { fixed } = sampleValue(
      field("descriptionDetaillee:string(5)"),
      "uuid7",
    );
    assert.ok(
      String(fixed).length <= 5,
      `« ${String(fixed)} » dépasse la longueur déclarée`,
    );
  });

  it("énumération : une des valeurs déclarées, jamais une inventée", () => {
    const f = field("status:enum(draft,published)");
    const { fixed } = sampleValue(f, "uuid7");
    assert.ok(f.values?.includes(String(fixed)));
  });

  it("référence vers une clé auto-incrémentée : un NOMBRE", () => {
    const { fixed, expr } = sampleValue(field("author:ref:User"), "serial");
    assert.strictEqual(typeof fixed, "number");
    assert.strictEqual(expr, "n");
  });
});

/*
 *   Épouser une table qui EXISTE — sans toucher au code TypeScript.
 *
 *   Un schéma déjà en production impose ses noms : `site_id` et non `siteId`,
 *   `website_id` et non `id`. Sans ces réglages il ne restait qu'à renommer à la
 *   main — 134 renommages pour le seul schéma d'Umami, dont 115 mécaniques.
 *
 *   L'invariant que ce banc verrouille est le même partout : la COLONNE change, la
 *   PROPRIÉTÉ jamais. Le service CRUD, le controller, le tri par défaut et les tests
 *   générés nomment `id` et `siteId` ; les faire suivre aurait transformé un réglage
 *   de nommage SQL en refonte de la chaîne complète.
 */
describe("scaffold — nommage SQL d'une table existante", () => {
  const fields = parseEntityFields("siteId:uuid pageTitle:string:index");
  const base = {
    dialect: "postgres" as const,
    id: "uuid7" as const,
    timestamps: true,
    softDelete: false,
    table: "websites",
  };

  it("par défaut, RIEN ne change — la colonne porte le nom de la propriété", () => {
    const c = buildEntityCodegen(fields, base);
    assert.match(c.columns, /id: uuid\("id"\)/u);
    assert.match(c.columns, /siteId: uuid\("siteId"\)/u);
    assert.match(c.columns, /pageTitle: varchar\("pageTitle"/u);
  });

  it("snake_case : la colonne change, la propriété reste intacte", () => {
    const c = buildEntityCodegen(fields, { ...base, columnCase: "snake" });
    assert.match(c.columns, /siteId: uuid\("site_id"\)/u);
    assert.match(c.columns, /pageTitle: varchar\("page_title"/u);
    // Ce que le reste du code généré continue de nommer.
    assert.match(c.rowProps, /siteId: string;/u);
    assert.match(c.zodProps, /pageTitle: z\.string\(\)/u);
    // Et surtout : aucune propriété n'a été renommée au passage.
    assert.doesNotMatch(c.columns, /site_id:/u);
    assert.doesNotMatch(c.rowProps, /page_title/u);
  });

  it("la clé primaire prend le nom de la colonne, jamais celui de la propriété", () => {
    const c = buildEntityCodegen(fields, { ...base, idName: "website_id" });
    assert.match(c.columns, /id: uuid\("website_id"\)\.primaryKey\(\)/u);
    assert.match(c.rowProps, /id: string;/u);
  });

  it("clé auto-incrémentée : le nom porte aussi, sur les trois dialectes", () => {
    for (const dialect of ["postgres", "mysql", "sqlite"] as const) {
      const c = buildEntityCodegen(fields, {
        ...base,
        dialect,
        id: "serial",
        idName: "website_id",
      });
      assert.match(
        c.columns,
        /id: (serial|int|integer)\("website_id"\)/u,
        `${dialect}\n${c.columns}`,
      );
    }
  });

  it("une référence suit la casse — c'est la colonne de jointure", () => {
    const c = buildEntityCodegen(parseEntityFields("ownerUser:ref:User"), {
      ...base,
      columnCase: "snake",
    });
    assert.match(c.columns, /ownerUser: uuid\("owner_user"\)/u);
    assert.match(c.rowProps, /ownerUser: string;/u);
  });

  it("le nom d'index est un objet SQL — il suit la casse des colonnes", () => {
    const camel = buildEntityCodegen(fields, base);
    assert.match(camel.tableExtras, /index\("websites_pageTitle_idx"\)/u);
    const snake = buildEntityCodegen(fields, { ...base, columnCase: "snake" });
    assert.match(snake.tableExtras, /index\("websites_page_title_idx"\)/u);
    // Les colonnes VISÉES restent nommées côté Drizzle : c'est du TypeScript.
    assert.match(snake.tableExtras, /\.on\(t\.pageTitle\)/u);
  });

  it("un index de table composite suit la même règle", () => {
    const indexes = parseEntityIndexes(["siteId,pageTitle"], fields, {
      timestamps: true,
      softDelete: false,
    });
    const c = buildEntityCodegen(fields, {
      ...base,
      columnCase: "snake",
      indexes,
    });
    assert.match(c.tableExtras, /index\("websites_site_id_page_title_idx"\)/u);
    assert.match(c.tableExtras, /\.on\(t\.siteId, t\.pageTitle\)/u);
  });

  it("les horodatages étaient DÉJÀ en snake_case — ils ne bougent pas", () => {
    for (const columnCase of ["camel", "snake"] as const) {
      const c = buildEntityCodegen(fields, { ...base, columnCase });
      assert.match(
        c.columns,
        /createdAt: timestamp\("created_at"/u,
        columnCase,
      );
    }
  });

  it("toSnakeCase couvre les formes qu'un nom de champ peut prendre", () => {
    assert.strictEqual(toSnakeCase("siteId"), "site_id");
    assert.strictEqual(toSnakeCase("BlogPost"), "blog_post");
    assert.strictEqual(toSnakeCase("blog-post"), "blog_post");
    assert.strictEqual(toSnakeCase("url2Path"), "url2_path");
    // Déjà en snake : idempotent, sinon un second passage ajouterait des tirets bas.
    assert.strictEqual(toSnakeCase("site_id"), "site_id");
  });
});
