/**
 * Champs d'entité : de la syntaxe `title:string` au code Drizzle du dialecte visé.
 *
 * Module **pur** (aucune I/O, aucun template) : c'est lui qui porte la traduction
 * « vocabulaire Nodefony → colonne Drizzle native », donc c'est lui qu'on teste.
 *
 * Vocabulaire volontairement restreint — le scaffold doit produire du code qu'un
 * humain relit et étend, pas couvrir toute la surface SQL. Un besoin exotique
 * (`numeric(12,4)`, `citext`, tableau PG…) s'écrit à la main dans la table générée :
 * c'est du Drizzle natif, il n'y a rien à contourner.
 */

/** Dialectes SQL supportés par le scaffold (ceux de `@nodefony/drizzle`). */
export const ENTITY_DIALECTS = ["sqlite", "postgres", "mysql"] as const;
export type TEntityDialect = (typeof ENTITY_DIALECTS)[number];

/** Stratégies de clé primaire. */
export const ENTITY_ID_KINDS = ["uuid7", "uuid4", "serial"] as const;
export type TEntityIdKind = (typeof ENTITY_ID_KINDS)[number];

/**
 * Nom de l'entité d'IDENTITÉ — la table `User` que `create app` pose et que le
 * framework (sessions, jetons, audit) référence.
 *
 * Copie de `USER_TABLE_NAME` (`@nodefony/user`), que le cœur ne peut pas
 * importer : `identityEntity.test.ts` (`@nodefony/drizzle`) compare les deux.
 *
 * Sa clé n'obéit pas à la stratégie de l'entité qu'on génère : c'est un UUID
 * applicatif rangé en TEXTE dans les trois moteurs (`KIND_BY_TYPE.uuid` de
 * `@nodefony/drizzle`). Une référence vers elle typée `uuid` ou `integer`
 * compile, passe en SQLite, et fait refuser la contrainte par PostgreSQL
 * (`42804`, types incompatibles).
 */
export const IDENTITY_ENTITY = "User";

/**
 * Une référence désigne-t-elle une clé NUMÉRIQUE ?
 *
 * La seule règle qui décide du type d'une référence — colonne, schéma,
 * échantillon et filtre l'appellent tous, sans quoi l'un finirait par
 * contredire l'autre.
 *
 * Elle suit la clé de la CIBLE, lue sur son fichier par le moteur
 * (`targetSerial`, {@link entityKeyIsSerial}). Supposer que la cible partage
 * la stratégie de l'entité générée était faux dès qu'une application en
 * mélange deux : un `Book` en `serial` visant un `Author` en uuid recevait un
 * schéma `z.number()` pour une clé uuid — toute création refusée en 422.
 * La stratégie de l'entité générée ne sert plus que de repli, quand la cible
 * n'existe pas encore sur le disque.
 *
 * @param field - la référence ; `targetSerial` dit la clé de sa cible.
 * @param id - stratégie de clé de l'entité en cours de génération.
 * @returns `true` si la clé visée est un entier auto-incrémenté.
 */
export function refTargetsSerial(
  field: Pick<IEntityField, "target" | "targetSerial">,
  id: TEntityIdKind,
): boolean {
  if (field.target === IDENTITY_ENTITY) return false;
  return field.targetSerial ?? id === "serial";
}

/**
 * La clé primaire d'une entité, lue sur la SOURCE de son fichier, est-elle un
 * entier auto-incrémenté ?
 *
 * Reconnaît les quatre formes que ce générateur écrit — description portable
 * (`id: { kind: "serial"`) et tables natives SQLite, PostgreSQL, MySQL —, et
 * rien d'autre : une forme inconnue rend `null`, et l'appelant retombe sur sa
 * règle de repli plutôt que de deviner.
 *
 * @param source - contenu du fichier d'entité.
 * @returns `true` (serial), `false` (clé textuelle), `null` (illisible).
 */
export function entityKeyIsSerial(source: string): boolean | null {
  if (/\bid:\s*\{\s*kind:\s*"serial"/u.test(source)) return true;
  if (/\bid:\s*\{\s*kind:\s*"(?:uuid|text|string|char)"/u.test(source)) {
    return false;
  }
  if (
    /\bid:\s*(?:integer|int)\("[^"]*"\)\s*\.(?:primaryKey\(\{\s*autoIncrement:\s*true|autoincrement\(\))/u.test(
      source,
    ) ||
    /\bid:\s*serial\("[^"]*"\)/u.test(source)
  ) {
    return true;
  }
  if (/\bid:\s*(?:uuid|varchar|text)\(/u.test(source)) return false;
  return null;
}

/**
 * Les entités qu'un fichier d'entité RÉFÉRENCE, lues sur sa source.
 *
 * Une référence vers une autre entité importe sa table depuis le fichier
 * voisin (`import { authorTable } from "./Author"`) — c'est la seule forme
 * que ce générateur écrit, en portable comme en natif. Le nom du fichier EST
 * le nom de l'entité. Une référence vers soi n'importe rien et n'y figure pas.
 *
 * @param source - contenu du fichier d'entité ; vide si absent.
 * @returns les entités visées, dans l'ordre des imports, sans doublon.
 */
export function entityRefTargetsOf(source: string): string[] {
  const targets = new Set<string>();
  for (const m of source.matchAll(
    /^import\s*\{[^}]*\b\w+Table\b[^}]*\}\s*from\s*"\.\/(\w+)";/gmu,
  )) {
    if (m[1] !== undefined) targets.add(m[1]);
  }
  return [...targets];
}

/**
 * L'échantillon d'un fichier d'entité attend-il les identifiants de ses parents
 * (`refs`) ? Lu sur la signature que le gabarit écrit.
 *
 * @param source - contenu du fichier d'entité ; vide si absent.
 * @returns `true` si `<nom>Sample(n, refs)`.
 */
export function entitySampleTakesRefs(source: string): boolean {
  return /export const \w+Sample = \(\s*\w+: number,\s*refs\b/u.test(source);
}

/** Types de champ du vocabulaire Nodefony (jamais le vocabulaire Drizzle). */
export const ENTITY_FIELD_TYPES = [
  "string",
  "text",
  "int",
  "float",
  "bool",
  "json",
  "date",
  "uuid",
  "enum",
  "char",
  "decimal",
] as const;
export type TEntityFieldType = (typeof ENTITY_FIELD_TYPES)[number];

/** Un champ déclaré, après analyse de `title:string` ou `author:ref:User`. */
export interface IEntityField {
  /** Nom de la propriété (camelCase). */
  name: string;
  /** Type Nodefony, ou `ref` pour une clé étrangère. */
  type: TEntityFieldType | "ref";
  /** Entité cible quand `type === "ref"`. */
  target?: string;
  /**
   * La clé de la cible est-elle un `serial` ? Résolue par le moteur en lisant
   * le fichier de la cible ({@link entityKeyIsSerial}) — jamais par l'analyse,
   * qui ne voit que la ligne de commande. Absente : la cible n'est pas encore
   * sur le disque, et la référence suit la clé de l'entité générée.
   */
  targetSerial?: boolean;
  /** Valeurs admises quand `type === "enum"` (`status:enum(draft,published)`). */
  values?: string[];
  /**
   * Longueur déclarée d'une chaîne (`title:string(200)`, `country:char(2)`).
   *
   * Absente pour `string`, la colonne retombe sur 255 — la valeur par défaut
   * historique. Un schéma réel dimensionne ses colonnes (onze longueurs
   * distinctes chez Umami) : la place perdue se paie en octets par ligne, et
   * l'absence de borne laisse passer des valeurs qu'aucune règle ne veut.
   */
  length?: number | undefined;
  /** Chiffres significatifs d'un décimal exact (`price:decimal(12,2)` → 12). */
  precision?: number | undefined;
  /** Chiffres après la virgule d'un décimal exact (`price:decimal(12,2)` → 2). */
  scale?: number | undefined;
  /**
   * Valeur par défaut littérale, telle qu'écrite (`price:float=0` → `"0"`).
   *
   * Conservée en texte : c'est le générateur qui sait la traduire en littéral du
   * bon type, et lui seul connaît le dialecte visé.
   */
  defaultValue?: string | undefined;
  /** `true` si `?` — la colonne accepte `NULL`. Non-null par DÉFAUT. */
  nullable: boolean;
  /** `true` si `:unique` — contrainte d'unicité. */
  unique: boolean;
  /** `true` si `:index`. */
  indexed: boolean;
  /**
   * Horodatage posé à l'insertion (`new Date()`), sans `DEFAULT` SQL.
   *
   * La grammaire de champs ne peut pas l'exprimer — « maintenant » n'est pas une
   * valeur littérale —, et pourtant le contrat utilisateur en porte deux. Sans
   * cette propriété, ces colonnes seraient écrites à la main quelque part, donc
   * en double.
   */
  defaultNow?: boolean;
  /** Horodatage RÉÉCRIT à chaque mise à jour (`$onUpdateFn`). */
  refreshedOnWrite?: boolean;
  /**
   * Ce défaut se pose côté JavaScript SEULEMENT — aucun `DEFAULT` SQL émis.
   *
   * 🔴 Posé sur les colonnes REPRISES d'un contrat du framework, et sur elles
   * seules. La fabrique que ces colonnes remplacent (`createUserTable`) n'émet
   * pas de `DEFAULT` SQL — c'est la règle du colKit —, si bien qu'en émettre un
   * ici change le schéma de colonnes que personne n'a demandé à changer :
   * l'outil de migration y voit des colonnes MODIFIÉES, recrée la table entière
   * (sqlite ne sait pas faire autrement) et sa recopie inclut la colonne neuve,
   * qui n'existe pas encore dans la table source. La migration échoue alors sur
   * `no such column`, et laisse un marqueur qui bloque les passages suivants.
   *
   * Ces colonnes naissent AVEC la table, jamais par un `ADD COLUMN` sur une
   * table peuplée — le seul cas où un défaut SQL est indispensable. Même
   * raisonnement que `defaultNow`, dont la parité était déjà tenue.
   */
  defaultJsOnly?: boolean;
  /**
   * Colonne REPRISE d'un contrat du framework (`User`) — sa description portable
   * doit reproduire le genre que la fabrique du framework lui donne, sans quoi
   * la migration suivante recrée la table : une chaîne du contrat y est un
   * `text`, jamais un `string(255)`.
   */
  fromContract?: boolean;
}

/**
 * Casses de nom de colonne SQL proposées — la propriété TypeScript ne bouge jamais.
 *
 * `camel` reproduit la propriété telle quelle (défaut historique) ; `snake` émet
 * `site_id` là où la propriété reste `siteId`. Drizzle porte nativement cette
 * dissociation — le premier argument d'un constructeur de colonne EST le nom SQL.
 *
 * Une seule option couvre l'écrasante majorité des schémas existants : sur les 134
 * renommages qu'exige le schéma d'Umami, **115 sont ce passage mécanique** au
 * `snake_case`. Les nommer un par un aurait demandé un dictionnaire ; ils tiennent
 * dans un choix.
 */
export const COLUMN_CASES = ["camel", "snake"] as const;
export type TColumnCase = (typeof COLUMN_CASES)[number];

/** `BlogPost` / `blog-post` / `siteId` → `blog_post` / `site_id`. */
export function toSnakeCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replaceAll("-", "_")
    .toLowerCase();
}

/**
 * Nom SQL d'une colonne, dérivé de sa propriété TypeScript.
 *
 * @param property - nom de la propriété (`siteId`).
 * @param columnCase - casse demandée ; `camel` rend la propriété inchangée.
 */
export function sqlColumn(property: string, columnCase: TColumnCase): string {
  return columnCase === "snake" ? toSnakeCase(property) : property;
}

/** Erreur de syntaxe dans la déclaration d'un champ — message actionnable. */
export class EntityFieldError extends Error {}

const NAME_RE = /^[a-z][a-zA-Z0-9]*$/u;
const ENTITY_RE = /^[A-Z][A-Za-z0-9]*$/u;

/** Types qui n'acceptent pas de valeur par défaut littérale. */
export const TYPES_WITHOUT_DEFAULT: ReadonlySet<string> = new Set([
  "json",
  "date",
  "ref",
]);

/**
 * Noms qu'on tape par habitude d'un autre outil, et le type Nodefony qu'ils
 * désignent. Une SUGGESTION, jamais un alias accepté : deux orthographes
 * valides pour un même type, c'est deux grammaires à documenter, à tester et à
 * faire lire à un agent — et la seconde finit par diverger.
 */
const FIELD_TYPE_HINTS: Readonly<Record<string, TEntityFieldType>> = {
  boolean: "bool",
  integer: "int",
  number: "float",
  double: "float",
  datetime: "date",
  timestamp: "date",
  object: "json",
  varchar: "string",
  str: "string",
  numeric: "decimal",
};

/**
 * Type Nodefony le plus probable derrière une saisie inconnue — casse
 * (`String`, `INT`) ou habitude d'un autre outil (`boolean`, `integer`).
 *
 * @param typed - le type tel que tapé.
 * @returns le type suggéré, ou `null` si rien ne s'en approche.
 */
export function suggestFieldType(typed: string): TEntityFieldType | null {
  const lower = typed.toLowerCase();
  if ((ENTITY_FIELD_TYPES as readonly string[]).includes(lower)) {
    return lower as TEntityFieldType;
  }
  return FIELD_TYPE_HINTS[lower] ?? null;
}

/**
 * Analyse la déclaration textuelle des champs.
 *
 * Grammaire : `nom:type[?][=defaut][:index|:unique]` · `nom:ref:Entité[?][:index|:unique]`
 * - `?` → nullable (sinon **NOT NULL** : une colonne nullable est une décision, pas un oubli) ;
 * - `=valeur` → valeur par défaut (`price:float=0`, `status:enum(draft,published)=draft`) ;
 * - `:index` → index simple ;
 * - `:unique` → contrainte d'unicité.
 *
 * Le type `enum` porte ses valeurs entre parenthèses : `status:enum(draft,published)`.
 *
 * 🔴 **`!` est REFUSÉ, et c'est le seul suffixe qui l'est.** Il a longtemps voulu
 * dire « unique » ici, alors qu'il veut dire « non-null » partout ailleurs —
 * GraphQL, TypeScript, Kotlin, Swift, Prisma. Le dépôt lui-même s'y est trompé :
 * son aide l'annonçait comme « requis » quand le code en faisait une contrainte
 * d'unicité, et l'exemple canonique `create entity Article title:string!` posait
 * donc une table où deux articles ne peuvent pas porter le même titre. Vécu sur
 * un agent tiers : un champ `content:text!` a rendu un salon de discussion
 * incapable de recevoir deux fois le même message, défaut invisible au
 * typecheck, au lint, aux tests et au `doctor` — il n'est sorti qu'à l'usage.
 * Le refuser plutôt que l'ignorer est délibéré : un `!` devenu silencieusement
 * sans effet trahirait qui voulait VRAIMENT l'unicité.
 *
 * @param input - `"title:string content:text? views:int=0 slug:string:unique"`.
 * @returns les champs, dans l'ordre de déclaration.
 * @throws EntityFieldError si un champ est mal formé (le mot « invalide » est attendu
 *   par le routeur d'erreurs du CLI pour sortir en `EX_USAGE`).
 */
export function parseEntityFields(input: string): IEntityField[] {
  const fields: IEntityField[] = [];
  const seen = new Set<string>();

  for (const raw of input.split(/\s+/u).filter(Boolean)) {
    // Des champs séparés par des VIRGULES arrivent collés en un seul mot, et
    // le refus tombait sur le premier défaut venu (« id est la clé
    // primaire ») sans dire que c'est le séparateur qui est faux. Vécu (banc
    // devkit, tâche 0) : l'agent a dû deviner. Les virgules d'un `enum(a,b)`
    // ou d'un `decimal(10,2)` sont hors de cause — on les retire avant de
    // chercher.
    // `[^()]` et non `[^)]` : une suite de `(` sans `)` relançait un balayage
    // jusqu'au bout depuis CHACUNE (temps quadratique, CodeQL).
    if (/,\s*[A-Za-z_]\w*:/u.test(raw.replace(/\([^()]*\)/gu, ""))) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — les champs se séparent par des ESPACES, ` +
          `pas par des virgules (ex : title:string author:ref:User)`,
      );
    }
    // Modificateurs collés au type : `content:text?`, `slug:string:unique`.
    let spec = raw;
    let indexed = false;
    let unique = false;
    if (spec.endsWith(":index")) {
      indexed = true;
      spec = spec.slice(0, -":index".length);
    } else if (spec.endsWith(":unique")) {
      unique = true;
      spec = spec.slice(0, -":unique".length);
    }
    // Valeur par défaut. Le `=` est cherché APRÈS la parenthèse fermante d'un
    // éventuel `enum(...)` : sans cette précaution, `status:enum(a=1,b)` couperait
    // au milieu de la liste de valeurs.
    let defaultValue: string | undefined;
    const equalsAt = spec.indexOf("=", spec.lastIndexOf(")") + 1);
    if (equalsAt >= 0) {
      defaultValue = spec.slice(equalsAt + 1);
      spec = spec.slice(0, equalsAt);
      if (defaultValue === "") {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — valeur par défaut vide après « = » (ex : views:int=0)`,
        );
      }
    }
    let nullable = false;
    for (;;) {
      if (spec.endsWith("?")) {
        nullable = true;
        spec = spec.slice(0, -1);
        continue;
      }
      // Le message nomme les DEUX intentions possibles, parce qu'on ne peut pas
      // deviner laquelle était la bonne — et parce que celui qui écrit `!` croit
      // presque toujours dire « obligatoire », ce qui est déjà le défaut.
      if (spec.endsWith("!")) {
        const bare = raw.replaceAll("!", "");
        throw new EntityFieldError(
          `champ invalide « ${raw} » — « ! » n'a pas de sens ici. ` +
            `Une colonne est NON-NULL par défaut : écris « ${bare} ». ` +
            `Pour une contrainte d'unicité : « ${bare}:unique ».`,
        );
      }
      break;
    }

    const parts = spec.split(":");
    const name = parts[0];
    if (!name || !NAME_RE.test(name)) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — nom attendu en camelCase (ex : title, publishedAt)`,
      );
    }
    if (seen.has(name)) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — « ${name} » déclaré deux fois`,
      );
    }
    if (name === "id") {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — « id » est la clé primaire, posée par --id (uuid7 | uuid4 | serial)`,
      );
    }
    seen.add(name);

    // Relation : `author:ref:User`
    if (parts[1] === "ref") {
      const target = parts[2];
      if (!target || !ENTITY_RE.test(target)) {
        // La faute la plus fréquente est la casse (`ref:user`) : la corriger à
        // la place de l'utilisateur, c'est lui dire EXACTEMENT quoi retaper.
        const fixed =
          target && /^[a-z][A-Za-z0-9]*$/u.test(target)
            ? ` → ${name}:ref:${target.charAt(0).toUpperCase()}${target.slice(1)} ?`
            : "";
        throw new EntityFieldError(
          `champ invalide « ${raw} » — cible attendue : nom d'entité en PascalCase (ex : author:ref:User)${fixed}`,
        );
      }
      if (defaultValue !== undefined) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — une relation n'a pas de valeur par défaut`,
        );
      }
      // Une colonne de relation est INDEXÉE d'office. C'est par elle que passent
      // le `?include=` (une requête `IN (…)` par relation) et toute jointure
      // écrite ensuite : sans index, chacune balaie la table entière, et le
      // ralentissement n'apparaît qu'une fois les données arrivées — jamais sur
      // les dix lignes de développement. La contrainte d'intégrité (FOREIGN KEY)
      // est posée plus bas et reste un sujet DISTINCT : elle protège la
      // COHÉRENCE, l'index sert la VITESSE — un moteur n'exige aucune contrainte
      // pour joindre, et n'accélère rien parce qu'il y en a une. `unique` se
      // passe de l'index : il en pose déjà un (relation 1-1).
      fields.push({
        name,
        type: "ref",
        target,
        nullable,
        unique,
        indexed: indexed || !unique,
      });
      continue;
    }

    // Énumération : `status:enum(draft,published)`.
    const enumMatch = /^enum\((.*)\)$/u.exec(parts[1] ?? "");
    if (enumMatch) {
      const values = (enumMatch[1] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
      if (values.length === 0) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — enum sans valeur (ex : status:enum(draft,published))`,
        );
      }
      if (defaultValue !== undefined && !values.includes(defaultValue)) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — défaut « ${defaultValue} » absent des valeurs (${values.join(", ")})`,
        );
      }
      fields.push({
        name,
        type: "enum",
        values,
        nullable,
        unique,
        indexed,
        // Clé posée seulement si une valeur existe : un `defaultValue: undefined`
        // explicite change la forme de l'objet sans rien apporter.
        ...(defaultValue !== undefined ? { defaultValue } : {}),
      });
      continue;
    }

    // Tailles de colonne : `string(200)`, `char(2)`, `decimal(12,2)`. Meme forme
    // que l'énumération, parce que c'est la même idée — un type qui se précise.
    const spec2 = parts[1] ?? "string";
    let length: number | undefined;
    let precision: number | undefined;
    let scale: number | undefined;
    const sized = /^(string|char)\((\d+)\)$/u.exec(spec2);
    const decimalMatch = /^decimal\((\d+),\s*(\d+)\)$/u.exec(spec2);
    if (sized) {
      length = Number(sized[2]);
      if (length < 1) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — longueur nulle (ex : title:string(200), country:char(2))`,
        );
      }
      parts[1] = sized[1] ?? "";
    } else if (decimalMatch) {
      precision = Number(decimalMatch[1]);
      scale = Number(decimalMatch[2]);
      if (precision < 1 || scale > precision) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — décimal incohérent : l'échelle (${scale}) ne peut dépasser la précision (${precision}), ex : price:decimal(12,2)`,
        );
      }
      parts[1] = "decimal";
    } else if (spec2 === "char" || spec2 === "decimal") {
      // Ces deux types NE SE DEVINENT PAS : un `char` sans longueur vaudrait
      // `char(1)` chez la plupart des moteurs — presque jamais l'intention —, et
      // un décimal sans précision perd la garantie même qu'on venait chercher.
      throw new EntityFieldError(
        spec2 === "char"
          ? `champ invalide « ${raw} » — char doit déclarer sa longueur (ex : country:char(2))`
          : `champ invalide « ${raw} » — décimal doit déclarer sa précision et son échelle (ex : price:decimal(12,2))`,
      );
    }

    const type = (parts[1] ?? "string") as TEntityFieldType;
    if (!(ENTITY_FIELD_TYPES as readonly string[]).includes(type)) {
      // Un `=` resté COLLÉ au type veut dire qu'une valeur par défaut a été
      // écrite dans une forme que la grammaire ne reconnaît pas — typiquement
      // un appel SQL, `createdAt:date=now()`. Le message générique (« type
      // inconnu ») envoie alors chercher un type, quand la faute est ailleurs :
      // il faut NOMMER la forme acceptée. Vécu au banc de découvrabilité, à la
      // minute 1 du run.
      const equals = type.indexOf("=");
      if (equals > 0) {
        const bareType = type.slice(0, equals);
        const written = type.slice(equals + 1);
        const isCall = /\(\s*\)$|^current_timestamp$/iu.test(written);
        throw new EntityFieldError(
          `champ invalide « ${raw} » — une valeur par défaut est une valeur LITTÉRALE, ` +
            `pas un appel : « ${written} » n'en est pas une. ` +
            (isCall
              ? `Un horodatage posé à l'insertion ne se déclare pas : « createdAt » et ` +
                `« updatedAt » sont générées d'office (--no-timestamps les retire). ` +
                `Pour une autre date, laisse-la vide et pose-la dans ton service.`
              : `Écris « ${name}:${bareType}=<valeur> » avec une valeur du type ` +
                `(ex : views:int=0, status:enum(draft,published)=draft).`),
        );
      }
      const suggestion = suggestFieldType(type);
      throw new EntityFieldError(
        `champ invalide « ${raw} » — type « ${type} » inconnu ; attendus : ${ENTITY_FIELD_TYPES.join(" | ")} | ref:<Entité>` +
          (suggestion ? ` → ${name}:${suggestion} ?` : ""),
      );
    }
    if (type === "enum") {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — enum doit lister ses valeurs (ex : status:enum(draft,published))`,
      );
    }
    if (parts.length > 2) {
      throw new EntityFieldError(
        `champ invalide « ${raw} » — trop de segments (attendu nom:type[?][=defaut][:index|:unique])`,
      );
    }
    if (defaultValue !== undefined) {
      if (TYPES_WITHOUT_DEFAULT.has(type)) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — le type « ${type} » n'accepte pas de valeur par défaut`,
        );
      }
      if (
        (type === "int" || type === "float") &&
        !Number.isFinite(Number(defaultValue))
      ) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — défaut « ${defaultValue} » n'est pas un nombre`,
        );
      }
      if (
        type === "bool" &&
        defaultValue !== "true" &&
        defaultValue !== "false"
      ) {
        throw new EntityFieldError(
          `champ invalide « ${raw} » — défaut d'un booléen : true ou false`,
        );
      }
    }
    fields.push({
      name,
      type,
      nullable,
      unique,
      indexed,
      ...(length !== undefined ? { length } : {}),
      ...(precision !== undefined ? { precision, scale } : {}),
      ...(defaultValue !== undefined ? { defaultValue } : {}),
    });
  }

  return fields;
}

/**
 * Écrit un champ dans la grammaire de la ligne de commande — l'inverse exact de
 * {@link parseEntityFields}.
 *
 * Il sert à ceux qui COMPOSENT un champ au lieu de l'écrire : le dialogue du
 * terminal, qui montre en récapitulatif la ligne équivalente (on apprend la
 * syntaxe en passant, sans avoir dû la connaître), et Studio, dont la copie est
 * confrontée à celle-ci. L'ordre des suffixes est celui que l'analyseur défait :
 * `?`, puis `=défaut`, puis `:unique` ou `:index`.
 *
 * Une relation est indexée d'office par l'analyseur : son `:index` ne s'écrit
 * donc pas — la forme la plus courte est la forme canonique.
 *
 * @param field - un champ tel que l'analyseur le rend.
 * @returns la déclaration, ex. `price:decimal(12,2)?=0:index`.
 */
export function formatEntityField(field: IEntityField): string {
  let type: string;
  if (field.type === "ref") {
    type = `ref:${field.target ?? ""}`;
  } else if (field.type === "enum") {
    type = `enum(${(field.values ?? []).join(",")})`;
  } else if (field.type === "decimal") {
    type = `decimal(${field.precision ?? 0},${field.scale ?? 0})`;
  } else if (field.length !== undefined) {
    type = `${field.type}(${field.length})`;
  } else {
    type = field.type;
  }
  let out = `${field.name}:${type}`;
  if (field.nullable) out += "?";
  if (field.defaultValue !== undefined) out += `=${field.defaultValue}`;
  if (field.unique) out += ":unique";
  else if (field.indexed && field.type !== "ref") out += ":index";
  return out;
}

/**
 * Index portant sur PLUSIEURS colonnes, déclaré au niveau de la table.
 *
 * Un index composite n'appartient à aucune colonne en particulier — il décrit une
 * façon d'interroger la table (« les événements de ce site, du plus récent au plus
 * ancien »). C'est pourquoi il se déclare à part de la grammaire de champs, et non
 * par un modificateur : il n'y aurait pas de champ légitime où l'accrocher.
 *
 * L'ORDRE des colonnes est significatif et se conserve : un index sur `(site, date)`
 * sert les requêtes qui filtrent sur le site, celles qui ne filtrent que sur la date
 * ne le verront pas.
 */
export interface IEntityIndex {
  /** Colonnes indexées, dans l'ordre déclaré. */
  columns: string[];
  /** `true` pour une contrainte d'unicité portant sur la combinaison. */
  unique: boolean;
}

/**
 * Colonnes qu'une entité possède SANS qu'un champ les déclare.
 *
 * Elles sont indexables comme les autres — un index composite sur la date de
 * création est même le cas le plus courant sur une table d'événements — mais elles
 * n'apparaissent pas dans la liste des champs analysés, d'où cette table.
 */
function implicitColumns(options: {
  timestamps: boolean;
  softDelete: boolean;
}): string[] {
  const names = ["id"];
  if (options.timestamps) names.push("createdAt", "updatedAt");
  if (options.softDelete) names.push("deletedAt");
  return names;
}

/**
 * Analyse les index de table déclarés par `--index` / `--unique`.
 *
 * Chaque valeur est une liste de colonnes séparées par des virgules
 * (`"websiteId,createdAt"`). Toute colonne citée doit exister : sans ce contrôle, on
 * écrirait une entité qui ne compile pas, et l'erreur tomberait chez l'utilisateur
 * sous la forme d'une propriété inconnue — loin de la commande qui l'a causée.
 *
 * @param specs - valeurs brutes des options, dans l'ordre de la ligne de commande.
 * @param fields - champs déjà analysés, qui fournissent les noms légitimes.
 * @param options - présence des colonnes implicites (horodatages, suppression douce).
 * @param unique - `true` quand ces valeurs viennent de `--unique`.
 * @returns les index analysés, doublons retirés.
 * @throws {EntityFieldError} colonne inconnue, liste vide, ou colonne répétée.
 */
export function parseEntityIndexes(
  specs: readonly string[],
  fields: readonly IEntityField[],
  options: { timestamps: boolean; softDelete: boolean },
  unique = false,
): IEntityIndex[] {
  const known = new Set([
    ...implicitColumns(options),
    ...fields.map((f) => f.name),
  ]);
  const out: IEntityIndex[] = [];
  const seen = new Set<string>();

  for (const raw of specs) {
    const columns = raw
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    if (columns.length === 0) {
      throw new EntityFieldError(
        `index « ${raw} » : aucune colonne — attendu une liste séparée par des virgules, ex. --index "websiteId,createdAt"`,
      );
    }
    for (const column of columns) {
      if (!known.has(column)) {
        throw new EntityFieldError(
          `index « ${raw} » : la colonne « ${column} » n'existe pas sur cette entité — ` +
            `colonnes disponibles : ${[...known].join(", ")}`,
        );
      }
    }
    // Une colonne répétée dans le même index ne veut rien dire, et le moteur
    // l'accepterait sans broncher en créant un index inutile.
    const duplicate = columns.find((c, i) => columns.indexOf(c) !== i);
    if (duplicate !== undefined) {
      throw new EntityFieldError(
        `index « ${raw} » : la colonne « ${duplicate} » est citée deux fois`,
      );
    }
    // Deux déclarations identiques produiraient deux fois le même nom d'index, et
    // la base refuserait la seconde au premier démarrage.
    const key = `${unique ? "u" : "i"}:${columns.join(",")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ columns, unique });
  }
  return out;
}

/** Liste de valeurs d'énumération, écrite comme option Drizzle (`{ enum: [...] }`). */
const enumOption = (values: readonly string[] = []): string =>
  `enum: [${values.map((value) => toCodeLiteral(value)).join(", ")}] as const`;

/** Taille déclarée d'une colonne, telle que l'analyse l'a lue. */
interface IColumnSize {
  length?: number | undefined;
  precision?: number | undefined;
  scale?: number | undefined;
}

/** Longueur d'une chaîne, avec le repli historique quand rien n'est déclaré. */
const len = (size?: IColumnSize): number => size?.length ?? 255;

/**
 * Option de précision d'un décimal, écrite comme Drizzle l'attend.
 *
 * Sans précision déclarée, on n'écrit RIEN plutôt qu'un défaut inventé : les
 * moteurs n'ont pas la même idée d'un `numeric` nu, et choisir à leur place
 * masquerait ce désaccord au lieu de le laisser paraître.
 */
const decimalOption = (size?: IColumnSize): string =>
  size?.precision === undefined
    ? ""
    : `, { precision: ${size.precision}, scale: ${size.scale ?? 0} }`;

/**
 * Constructeur de colonne Drizzle par (dialecte, type) — le cœur de la traduction.
 *
 * Le second argument ne sert qu'aux énumérations, le troisième aux tailles
 * (longueur d'une chaîne, précision d'un décimal).
 *
 * Les trois moteurs n'offrent pas le même vocabulaire, et la table le dit au lieu
 * de le contourner : SQLite ignore `varchar` et `char` — toute chaîne y est un
 * `text`, la longueur n'y est de toute façon pas appliquée —, et MySQL n'expose
 * pas `numeric`, dont `decimal` est l'exact équivalent.
 */
const COLUMN: Record<
  TEntityDialect,
  Record<
    TEntityFieldType | "ref",
    (col: string, values?: readonly string[], size?: IColumnSize) => string
  >
> = {
  sqlite: {
    string: (c) => `text("${c}")`,
    // SQLite n'applique aucune contrainte de longueur : une chaîne bornée y est
    // un `text` comme les autres. La borne reste tenue par le schéma Zod, donc
    // sur tous les transports — c'est la seule à mordre ici.
    char: (c) => `text("${c}")`,
    // `text`, pas `numeric` : l'affinité NUMERIC de SQLite convertit la valeur
    // en flottant à l'écriture — mesuré, `"12.50"` se relit `"12.5"` et un
    // montant de 24 chiffres `"1.2345678901234568e+21"`. Le type annoncé est
    // `string` (comme `numeric` PostgreSQL et `decimal` MySQL) : seul `text`
    // rend la chaîne écrite, chiffre pour chiffre.
    decimal: (c) => `text("${c}")`,
    text: (c) => `text("${c}")`,
    int: (c) => `integer("${c}")`,
    float: (c) => `real("${c}")`,
    bool: (c) => `integer("${c}", { mode: "boolean" })`,
    // SQLite n'a pas de type JSON : `mode: "json"` sérialise/désérialise pour nous.
    json: (c) => `text("${c}", { mode: "json" })`,
    date: (c) => `integer("${c}", { mode: "timestamp_ms" })`,
    uuid: (c) => `text("${c}")`,
    ref: (c) => `text("${c}")`,
    enum: (c, v) => `text("${c}", { ${enumOption(v)} })`,
  },
  postgres: {
    string: (c, _v, s) => `varchar("${c}", { length: ${len(s)} })`,
    char: (c, _v, s) => `char("${c}", { length: ${len(s)} })`,
    decimal: (c, _v, s) => `numeric("${c}"${decimalOption(s)})`,
    text: (c) => `text("${c}")`,
    int: (c) => `integer("${c}")`,
    float: (c) => `doublePrecision("${c}")`,
    bool: (c) => `boolean("${c}")`,
    // `jsonb` et pas `json` : indexable, comparé sans reparser.
    json: (c) => `jsonb("${c}")`,
    date: (c) => `timestamp("${c}", { withTimezone: true, precision: 3 })`,
    uuid: (c) => `uuid("${c}")`,
    ref: (c) => `text("${c}")`,
    // Pas de `pgEnum` : un type PostgreSQL nommé exige un `CREATE TYPE` que le
    // DDL dérivé du mode dev n'émet pas — la table ne se créerait pas au boot.
    // La contrainte vit donc au typage TS et dans le schéma Zod, qui la fait
    // respecter sur TOUS les transports (REST, socket, CLI).
    enum: (c, v) => `varchar("${c}", { length: 255, ${enumOption(v)} })`,
  },
  mysql: {
    string: (c, _v, s) => `varchar("${c}", { length: ${len(s)} })`,
    char: (c, _v, s) => `char("${c}", { length: ${len(s)} })`,
    // MySQL n'expose pas `numeric` chez Drizzle : `decimal` en est l'équivalent
    // exact côté moteur, le nom seul diffère.
    decimal: (c, _v, s) => `decimal("${c}"${decimalOption(s)})`,
    text: (c) => `text("${c}")`,
    int: (c) => `int("${c}")`,
    float: (c) => `double("${c}")`,
    bool: (c) => `boolean("${c}")`,
    json: (c) => `json("${c}")`,
    date: (c) => `datetime("${c}", { fsp: 3 })`,
    // InnoDB ne peut pas indexer un TEXT : toute colonne indexable est un varchar.
    uuid: (c) => `varchar("${c}", { length: 36 })`,
    ref: (c) => `varchar("${c}", { length: 255 })`,
    // `mysqlEnum` existe, mais produirait un type de colonne différent des deux
    // autres dialectes pour la même déclaration Nodefony. On garde la même
    // colonne partout : porter une entité d'un moteur à l'autre ne doit rien
    // changer d'autre que le fichier de configuration.
    enum: (c, v) => `varchar("${c}", { length: 255, ${enumOption(v)} })`,
  },
};

/**
 * Type SQL que la base reçoit pour chaque type de champ d'une entité générée,
 * moteur par moteur — ce que le kit de colonnes de `@nodefony/drizzle` pose en
 * migration pour la description portable qu'écrit
 * {@link buildPortableEntityCodegen}.
 *
 * Colonne d'exemple : `string` sans longueur (255), `char(2)`,
 * `decimal(12,2)`, `enum(a,b)`. « + CHECK » nomme la contrainte que le kit
 * ajoute là où le type seul ne borne rien.
 *
 * RECOPIÉE : le cœur ne peut pas dépendre du kit. Le test
 * `colkit-generator-parity.test.ts` de `@nodefony/drizzle` la confronte au DDL
 * que le kit produit réellement à partir de la sortie de ce générateur.
 */
export const PORTABLE_COLUMN_SQL: Readonly<
  Record<TEntityFieldType | "ref", Readonly<Record<TEntityDialect, string>>>
> = {
  string: {
    sqlite: "text(255) + CHECK longueur",
    postgres: "varchar(255)",
    mysql: "varchar(255)",
  },
  text: { sqlite: "text", postgres: "text", mysql: "text" },
  int: { sqlite: "integer", postgres: "integer", mysql: "int" },
  float: { sqlite: "real", postgres: "double precision", mysql: "double" },
  bool: { sqlite: "integer", postgres: "boolean", mysql: "boolean" },
  json: { sqlite: "text", postgres: "jsonb", mysql: "json" },
  date: {
    sqlite: "integer",
    postgres: "timestamp (3) with time zone",
    mysql: "datetime(3)",
  },
  uuid: { sqlite: "text", postgres: "uuid", mysql: "varchar(36)" },
  enum: {
    sqlite: "text + CHECK valeurs",
    postgres: "text + CHECK valeurs",
    mysql: "varchar(64) + CHECK valeurs",
  },
  char: {
    sqlite: "text + CHECK longueur",
    postgres: "char(2) + CHECK longueur",
    mysql: "char(2) + CHECK longueur",
  },
  decimal: {
    sqlite: "text",
    postgres: "numeric(12, 2)",
    mysql: "decimal(12,2)",
  },
  ref: {
    sqlite: "type de la clé visée",
    postgres: "type de la clé visée",
    mysql: "type de la clé visée",
  },
};

/**
 * Ce que chaque type de champ devient, dans chaque moteur.
 *
 * Montrer la traduction plutôt que la promettre : `json` devient `jsonb` en
 * PostgreSQL et une colonne texte en SQLite, `string` un `varchar(255)` ici et un
 * `text` borné par CHECK là. C'est une information dont dépend le choix de celui
 * qui modélise, et elle n'est déductible d'aucune documentation générique.
 *
 * Décrit la sortie PAR DÉFAUT du générateur — la description portable — telle
 * que la base la reçoit : {@link PORTABLE_COLUMN_SQL}, confrontée au kit. Une
 * entité forcée en natif (`--dialect`) écrit le Drizzle du moteur, hors de ce
 * catalogue.
 *
 * @returns un descripteur par type, avec son type SQL par dialecte et sa
 *   définition Mongoose.
 */
export function describeColumnTypes(): Array<{
  type: string;
  byDialect: Record<string, string>;
}> {
  const types = [...ENTITY_FIELD_TYPES, "ref"] as const;
  return types.map((type) => ({
    type,
    byDialect: Object.fromEntries([
      ...ENTITY_DIALECTS.map((dialect): [string, string] => [
        dialect,
        PORTABLE_COLUMN_SQL[type][dialect],
      ]),
      // MongoDB : la définition que {@link buildMongooseEntityCodegen} écrit
      // réellement, relue sur sa sortie — pas une seconde table à tenir.
      ["mongodb", mongooseDefinitionOf(type)] as [string, string],
    ]),
  }));
}

/**
 * Définition Mongoose d'un champ d'exemple obligatoire du type donné, telle
 * que le générateur l'écrit (`{ type: String, maxlength: 255, required: true }`).
 */
function mongooseDefinitionOf(type: TEntityFieldType | "ref"): string {
  const field: IEntityField = {
    name: "exemple",
    type,
    nullable: false,
    unique: false,
    indexed: false,
    ...(type === "ref" ? { target: "User" } : {}),
    ...(type === "enum" ? { values: ["a", "b"] } : {}),
    ...(type === "char" ? { length: 2 } : {}),
  };
  const line = buildMongooseEntityCodegen([field], {
    timestamps: false,
    softDelete: false,
  }).schemaFields;
  return line.replace(/^exemple: /u, "").replace(/,( \/\/.*)?$/u, "");
}

/**
 * Nom de la variable qui porte la table Drizzle d'une entité (`User` → `userTable`).
 *
 * Une seule implémentation, parce qu'il y a deux producteurs : le gabarit d'entité
 * DÉCLARE cette variable, et une entité voisine la RÉFÉRENCE (`.references()`).
 * Deux conventions écrites séparément se seraient accordées le premier jour puis
 * auraient divergé au premier ajustement, en produisant un import introuvable.
 *
 * @param entity - nom de l'entité en PascalCase.
 * @returns le nom de la variable exportée par son fichier.
 */
export function entityTableSymbol(entity: string): string {
  return `${entity.charAt(0).toLowerCase()}${entity.slice(1)}Table`;
}

/**
 * Type de colonne « n'importe laquelle » du dialecte — l'annotation qu'exige une
 * référence CIRCULAIRE (une entité qui se désigne elle-même, `parent:ref:Category`).
 *
 * Sans elle, TypeScript refuse de compiler le fichier généré : la table est en cours
 * de définition au moment où la lambda la nomme, donc son type s'infère à partir de
 * lui-même (« implicitly has type 'any' »). L'annotation coupe la récursion.
 */
const ANY_COLUMN: Record<TEntityDialect, string> = {
  sqlite: "AnySQLiteColumn",
  postgres: "AnyPgColumn",
  mysql: "AnyMySqlColumn",
};

/** Fonction de table Drizzle du dialecte (`sqliteTable`…) et son import. */
export const TABLE_FN: Record<TEntityDialect, { fn: string; module: string }> =
  {
    sqlite: { fn: "sqliteTable", module: "drizzle-orm/sqlite-core" },
    postgres: { fn: "pgTable", module: "drizzle-orm/pg-core" },
    mysql: { fn: "mysqlTable", module: "drizzle-orm/mysql-core" },
  };

/** Type TypeScript de la propriété correspondante (interface `XRow`). */
const TS_TYPE: Record<TEntityFieldType | "ref", string> = {
  string: "string",
  text: "string",
  int: "number",
  float: "number",
  bool: "boolean",
  json: "unknown",
  date: "Date",
  uuid: "string",
  ref: "string",
  enum: "string",
  char: "string",
  // Un décimal exact transite en CHAÎNE, dans les trois moteurs : le convertir en
  // nombre JavaScript lui ferait perdre en route la précision qu'on est venu
  // chercher (0.1 + 0.2 ne fait pas 0.3 en virgule flottante).
  decimal: "string",
};

/**
 * Un entier que TOUS les moteurs rangent : 32 bits signés. Au-delà, SQLite
 * accepte (ses entiers font 64 bits) quand PostgreSQL et MySQL lèvent — un 500
 * sur les uns, un 201 sur l'autre. Le schéma refuse donc partout, en 422.
 *
 * `z.int32()` et non `.int().min().max()` : même frontière, une vérification
 * au lieu de trois — mesuré, +11 ns par entier contre +210 ns, payés à chaque
 * requête qui écrit.
 */
const ZOD_INT32 = "z.int32()";

/**
 * Le caractère NUL, refusé dans toute chaîne : PostgreSQL ne le stocke pas
 * (« invalid byte sequence ») quand SQLite et MySQL l'acceptent. Refusé à la
 * frontière, il l'est pareil sur tous les moteurs et tous les transports.
 *
 * `includes` et non une regex : la recherche native d'un caractère coûte ~55 ns
 * par champ, la regex `/^[^\\u0000]*$/u` en coûtait ~500 sur un texte de 2 000
 * caractères — parcouru caractère par caractère, à chaque requête qui écrit.
 */
const ZOD_NO_NUL =
  '.refine((value) => !value.includes("\\u0000"), "caractère NUL refusé")';

/** Schéma Zod correspondant (validation à la frontière). */
const ZOD_TYPE: Record<TEntityFieldType | "ref", string> = {
  string: `z.string().min(1).max(255)${ZOD_NO_NUL}`,
  text: `z.string()${ZOD_NO_NUL}`,
  int: ZOD_INT32,
  float: "z.number()",
  bool: "z.boolean()",
  json: "z.unknown()",
  date: "z.coerce.date()",
  uuid: "z.uuid()",
  ref: "z.string()",
  enum: "z.string()",
  char: "z.string()",
  decimal: "z.string()",
};

/**
 * Littéral TypeScript d'une valeur par défaut, selon le type du champ.
 *
 * Les nombres et booléens sont écrits nus, tout le reste est une chaîne : c'est
 * la seule interprétation possible d'un texte saisi en ligne de commande.
 */
/** Échappements `\uXXXX` des caractères qu'un littéral de code ne doit pas porter bruts. */
const CODE_LITERAL_ESCAPES: Readonly<Record<string, string>> = {
  "<": "\\u003C",
  ">": "\\u003E",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * Littéral de code sûr pour une valeur saisie au générateur : `JSON.stringify`,
 * puis `<`, `>`, U+2028 et U+2029 échappés en `\uXXXX`.
 *
 * `JSON.stringify` seul est l'assainissement que CodeQL refuse
 * (`js/bad-code-sanitization`) : sans conséquence dans un `.ts`, mais le même
 * littéral inséré dans une page ou un script deviendrait une injection. Dans un
 * JSON compact, ces caractères ne peuvent figurer QU'À L'INTÉRIEUR d'une
 * chaîne, où `\u003C` vaut `<` : la valeur relue est identique.
 *
 * @param value - la valeur à écrire dans le code rendu.
 * @returns un littéral JavaScript, qui est aussi du JSON valide.
 */
export function toCodeLiteral(value: unknown): string {
  return JSON.stringify(value).replace(
    /[<>\u2028\u2029]/gu,
    (c) => CODE_LITERAL_ESCAPES[c] ?? c,
  );
}

function defaultLiteral(field: IEntityField): string {
  if (field.type === "int" || field.type === "float") {
    return String(Number(field.defaultValue));
  }
  if (field.type === "bool") return String(field.defaultValue === "true");
  if (field.type === "json") {
    // `tags:json=[]` veut un tableau vide, pas la chaîne « [] ». Sans ce cas, le
    // défaut passait par `JSON.stringify` et la colonne naissait avec une chaîne
    // là où le type annonce un objet — une divergence que rien ne signale, et qui
    // ne se voit qu'à la première lecture du champ.
    try {
      return toCodeLiteral(JSON.parse(String(field.defaultValue)));
    } catch {
      // Pas du JSON : la rendre comme une chaîne reste juste.
      return toCodeLiteral(field.defaultValue);
    }
  }
  return toCodeLiteral(field.defaultValue);
}

/** Type TS d'un champ — union littérale pour une énumération. */
function tsTypeOf(field: IEntityField): string {
  if (field.type === "enum" && field.values) {
    return field.values.map((value) => toCodeLiteral(value)).join(" | ");
  }
  return TS_TYPE[field.type];
}

/**
 * Type TS d'une propriété de `XRow`, nullabilité comprise.
 *
 * `unknown` absorbe déjà `null` : écrire `unknown | null` fait rougir le lint
 * de l'application générée (`no-redundant-type-constituents`), qui suit la même
 * grille que le dépôt.
 */
function rowTypeOf(tsType: string, nullable: boolean | undefined): string {
  return nullable && tsType !== "unknown" ? `${tsType} | null` : tsType;
}

/**
 * Schéma Zod d'un champ — `z.enum` pour une énumération, borné pour une taille.
 *
 * C'est ici que les tailles deviennent une garantie RÉELLE. La colonne, elle, ne
 * protège pas partout : SQLite n'applique aucune longueur, et une valeur trop
 * longue y entrerait sans un mot pour ressortir tronquée le jour d'une migration
 * vers PostgreSQL. Le schéma, lui, s'applique sur tous les transports — REST,
 * socket, ligne de commande — et dans les trois moteurs.
 */
function zodTypeOf(field: IEntityField): string {
  if (field.type === "enum" && field.values) {
    return `z.enum([${field.values.map((value) => toCodeLiteral(value)).join(", ")}])`;
  }
  if (field.type === "string") {
    return `z.string().min(1).max(${field.length ?? 255})${ZOD_NO_NUL}`;
  }
  if (field.type === "char") {
    // Longueur EXACTE : un `char(2)` qui recevrait une seule lettre serait
    // complété par des espaces côté moteur, et la comparaison suivante
    // échouerait sans raison visible.
    return field.length === undefined
      ? `z.string()${ZOD_NO_NUL}`
      : `z.string().length(${field.length})${ZOD_NO_NUL}`;
  }
  if (field.type === "decimal") {
    // Le message porte la précision : c'est la seule trace qu'en verra l'appelant
    // d'une API. Pas de commentaire en fin de ligne ici — il avalerait la virgule
    // suivante du schéma rendu.
    const hint =
      field.precision === undefined
        ? "d\u00e9cimal attendu"
        : `d\u00e9cimal attendu (${field.precision} chiffres dont ${field.scale ?? 0} apr\u00e8s la virgule)`;
    // Bornée à la précision et à l'échelle quand elles sont déclarées : un
    // chiffre de trop est REFUSÉ, jamais arrondi — chaque moteur arrondit (ou
    // déborde) à sa façon, et la valeur relue ne serait plus la même partout.
    if (field.precision === undefined) {
      return `z.string().regex(/^-?\\d+(\\.\\d+)?$/, ${toCodeLiteral(hint)})`;
    }
    const scale = field.scale ?? 0;
    const whole = Math.max(1, field.precision - scale);
    const fraction = scale > 0 ? `(\\.\\d{1,${scale}})?` : "";
    return `z.string().regex(/^-?\\d{1,${whole}}${fraction}$/, ${toCodeLiteral(hint)})`;
  }
  return ZOD_TYPE[field.type];
}

/**
 * Colonne de clé primaire, selon la stratégie retenue.
 *
 * La PROPRIÉTÉ reste `id` en toutes circonstances : le service CRUD, le controller,
 * le tri par défaut et les tests générés la nomment ainsi, et un schéma existant
 * n'a aucune raison d'imposer sa convention au code TypeScript. Seule la COLONNE
 * SQL suit le nom demandé — c'est elle qui doit épouser la table déjà en place
 * (`website_id` chez Umami, `session_id`, `user_id`… : 18 des 134 renommages).
 *
 * @param column - nom SQL de la colonne (`id` par défaut).
 */
function primaryKeyColumn(
  dialect: TEntityDialect,
  id: TEntityIdKind,
  column: string,
): { line: string; tsType: string; imports: string[] } {
  if (id === "serial") {
    const line =
      dialect === "sqlite"
        ? `id: integer("${column}").primaryKey({ autoIncrement: true }),`
        : dialect === "postgres"
          ? `id: serial("${column}").primaryKey(),`
          : `id: int("${column}").autoincrement().primaryKey(),`;
    const imports =
      dialect === "sqlite"
        ? ["integer"]
        : dialect === "postgres"
          ? ["serial"]
          : ["int"];
    return { line, tsType: "number", imports };
  }
  // uuid7 (défaut) / uuid4 : la valeur est produite côté JS — le DDL dérivé du dev
  // n'émet PAS les DEFAULT SQL, un défaut posé en base ne s'appliquerait donc pas.
  const generator =
    id === "uuid7" ? "Nodefony.generateSortableId()" : "Nodefony.generateId()";
  const col = COLUMN[dialect].uuid(column);
  return {
    line: `id: ${col}.primaryKey().$defaultFn(() => ${generator}),`,
    tsType: "string",
    imports: [
      dialect === "postgres"
        ? "uuid"
        : dialect === "mysql"
          ? "varchar"
          : "text",
    ],
  };
}

/**
 * Colonne qui PORTE une référence — le pendant exact de {@link primaryKeyColumn}.
 *
 * Une clé étrangère doit avoir le TYPE de la clé qu'elle désigne, et c'est la
 * raison d'être de cette fonction : la référence était jusqu'ici une colonne
 * texte, quelle que soit la clé visée. En PostgreSQL, comparer un `text` à un
 * `uuid` échoue — « operator does not exist: text = uuid ». La jointure que cette
 * colonne existe précisément pour servir refusait donc de s'exécuter, et le
 * `?include=` avec elle. En SQLite, moteur du développement, la même comparaison
 * passe sans broncher : la panne n'attendait que le premier vrai serveur.
 *
 * Le type suit la clé de la CIBLE ({@link refTargetsSerial}), lue sur son
 * fichier par le moteur.
 *
 * La contrainte `REFERENCES`, elle, est posée par l'appelant
 * ({@link buildEntityCodegen}) : elle dépend de la CIBLE, que cette fonction ne
 * connaît pas — elle ne décide que du TYPE de la colonne.
 *
 * @param dialect - moteur visé.
 * @param id - stratégie de clé primaire de l'entité en cours.
 * @param col - nom de la colonne.
 * @param field - la référence.
 * @returns l'expression Drizzle, son type TypeScript et l'import nécessaire.
 */
function foreignKeyColumn(
  dialect: TEntityDialect,
  id: TEntityIdKind,
  col: string,
  field: IEntityField,
): { expr: string; tsType: string; imports: string[] } {
  if (field.target === IDENTITY_ENTITY && dialect === "postgres") {
    // La clé de l'identité est un `text` PostgreSQL, pas un `uuid` : la
    // contrainte exige le MÊME type des deux côtés ({@link IDENTITY_ENTITY}).
    return { expr: `text("${col}")`, tsType: "string", imports: ["text"] };
  }
  if (refTargetsSerial(field, id)) {
    // Un entier ORDINAIRE : la table cible auto-incrémente sa clé, celle qui la
    // désigne se contente de la recopier.
    const expr = dialect === "mysql" ? `int("${col}")` : `integer("${col}")`;
    return {
      expr,
      tsType: "number",
      imports: [dialect === "mysql" ? "int" : "integer"],
    };
  }
  return {
    expr: COLUMN[dialect].uuid(col),
    tsType: "string",
    imports: [
      dialect === "postgres"
        ? "uuid"
        : dialect === "mysql"
          ? "varchar"
          : "text",
    ],
  };
}

/** Nom du constructeur Drizzle utilisé par un champ (pour la liste d'imports). */
function columnImport(
  dialect: TEntityDialect,
  type: TEntityFieldType | "ref",
): string {
  return COLUMN[dialect][type]("x").split("(")[0] ?? "";
}

/** Tout ce dont les templates ont besoin pour rendre une entité. */
export interface IEntityCodegen {
  /** Corps de la table (lignes `nom: colonne,`). */
  columns: string;
  /** Import Drizzle du dialecte (`import { text, integer } from "drizzle-orm/sqlite-core";`). */
  drizzleImport: string;
  /**
   * Imports des tables VISÉES par les relations (`import { userTable } from "./User";`).
   *
   * Chaîne vide quand l'entité n'a aucune relation, ou quand la seule relation se
   * désigne elle-même — sa table est alors déclarée dans le fichier courant.
   */
  entityImports: string;
  /** Fonction de table (`sqliteTable`). */
  tableFn: string;
  /** Propriétés de l'interface de ligne. */
  rowProps: string;
  /** Corps du schéma Zod de création. */
  zodProps: string;
  /**
   * Troisième argument de la table Drizzle — les index déclarés par `:index`.
   *
   * Chaîne vide quand aucun index n'est demandé : la table garde alors sa forme
   * à deux arguments.
   */
  tableExtras: string;
  /** `true` si la clé primaire est générée côté JS (le template importe `Nodefony`). */
  needsNodefony: boolean;
  /** Type TS de la clé primaire. */
  idType: string;
}

/**
 * Produit le code des colonnes, de l'interface de ligne et du schéma Zod.
 *
 * Les horodatages sont posés **côté JS** (`$defaultFn`/`$onUpdateFn`) et non en SQL :
 * le DDL dérivé du mode dev n'émet pas les `DEFAULT` — un défaut SQL serait donc
 * silencieusement absent des tables créées au boot.
 *
 * @param fields - champs analysés par {@link parseEntityFields}.
 * @param options - dialecte, stratégie d'identifiant, horodatages, suppression douce.
 */
export function buildEntityCodegen(
  fields: IEntityField[],
  options: {
    dialect: TEntityDialect;
    id: TEntityIdKind;
    timestamps: boolean;
    softDelete: boolean;
    /**
     * Nom de la table — sert à préfixer les noms d'index.
     *
     * Requis : en PostgreSQL comme en SQLite, un nom d'index est unique pour
     * TOUTE la base. Deux entités qui indexeraient chacune un `title` se
     * marcheraient dessus au premier boot.
     */
    table: string;
    /**
     * Index de TABLE, portant une ou plusieurs colonnes ({@link parseEntityIndexes}).
     *
     * Fusionnés avec ceux que les champs déclarent par `:index` — un même jeu de
     * colonnes n'est émis qu'une fois, quelle que soit la voie empruntée.
     */
    indexes?: IEntityIndex[];
    /**
     * Casse des noms de COLONNES SQL — les propriétés TypeScript n'en dépendent pas.
     *
     * Défaut `camel` : le comportement historique, où la colonne porte le nom de la
     * propriété. Une application existante impose presque toujours `snake`.
     */
    columnCase?: TColumnCase;
    /**
     * Nom SQL de la colonne de clé primaire (défaut `id`).
     *
     * La propriété reste `id` quoi qu'il arrive — cf {@link primaryKeyColumn}.
     */
    idName?: string;
    /**
     * Nom PascalCase de l'entité en cours — sert à reconnaître une relation qui se
     * désigne ELLE-MÊME (`parent:ref:Category` dans `Category`).
     *
     * Ce cas ne s'importe pas (la table est déclarée juste au-dessus) et exige une
     * annotation de type, faute de quoi le fichier généré ne compile pas.
     */
    entity?: string;
    /**
     * Entités visées dont le fichier est une description PORTABLE (`defineTable`).
     *
     * Leur colonne se lit sur la table du dialecte (`bookTable.table("sqlite").id`) :
     * la description n'en porte aucune, et `bookTable.id` vaudrait `undefined`.
     */
    portableTargets?: ReadonlySet<string>;
  },
): IEntityCodegen {
  const { dialect, id, timestamps, softDelete, table } = options;
  const columnCase: TColumnCase = options.columnCase ?? "camel";
  const idName = options.idName ?? "id";
  /** Nom SQL d'une propriété, dans la casse retenue. */
  const sql = (property: string): string => sqlColumn(property, columnCase);
  const imports = new Set<string>();
  const columns: string[] = [];
  const rowProps: string[] = [];
  const zodProps: string[] = [];
  /** Entités VISÉES par une relation, hors auto-référence — une ligne d'import chacune. */
  const referenced = new Set<string>();

  const pk = primaryKeyColumn(dialect, id, idName);
  pk.imports.forEach((i) => imports.add(i));
  columns.push(pk.line);
  rowProps.push(`id: ${pk.tsType};`);

  for (const field of fields) {
    // Une référence emprunte le type de la CLÉ qu'elle désigne, pas celui d'une
    // chaîne quelconque : c'est la condition pour que la jointure s'exécute.
    const column = sql(field.name);
    const fk =
      field.type === "ref"
        ? foreignKeyColumn(dialect, id, column, field)
        : undefined;
    if (fk) {
      fk.imports.forEach((i) => imports.add(i));
    } else {
      imports.add(columnImport(dialect, field.type));
    }
    // La contrainte d'intégrité, POSÉE ICI parce qu'elle a besoin de la cible.
    let references = "";
    //
    // La politique `ON DELETE` se DÉDUIT de la nullabilité, elle ne s'invente pas :
    //  - colonne qui accepte le vide → `set null`. L'enfant survit à son parent, et
    //    son orphelinage est EXPLICITE (la colonne vaut NULL), pas deviné.
    //  - colonne obligatoire → `restrict`. `set null` y est impossible : MySQL REFUSE
    //    de créer la contrainte (errno 1830), PostgreSQL et SQLite l'acceptent puis
    //    échouent au premier effacement du parent — un piège à retardement.
    // `cascade` n'est JAMAIS un défaut : c'est un effacement en chaîne, et rien dans
    // `author:ref:User` ne le demande. Il s'écrit à la main dans la table générée,
    // qui est du Drizzle ordinaire.
    if (field.type === "ref" && field.target) {
      const self = field.target === options.entity;
      const onDelete = field.nullable ? "set null" : "restrict";
      const targetTable = entityTableSymbol(field.target);
      if (self) {
        imports.add(`type ${ANY_COLUMN[dialect]}`);
      } else {
        referenced.add(field.target);
      }
      const arrow = self
        ? `(): ${ANY_COLUMN[dialect]} => ${targetTable}.id`
        : options.portableTargets?.has(field.target)
          ? `() => ${targetTable}.table("${dialect}").id`
          : `() => ${targetTable}.id`;
      references = `.references(${arrow}, { onDelete: "${onDelete}" })`;
    }
    let col =
      fk?.expr ??
      COLUMN[dialect][field.type](column, field.values, {
        length: field.length,
        precision: field.precision,
        scale: field.scale,
      });
    col += references;
    if (!field.nullable) col += ".notNull()";
    if (field.unique) col += ".unique()";
    if (field.defaultNow) {
      // Pas de `DEFAULT` SQL ici, et c'est délibéré : ces colonnes naissent AVEC
      // la table, jamais par un `ADD COLUMN` sur une table peuplée — le seul cas
      // où un défaut SQL est indispensable. C'est aussi ce que faisait l'entité
      // que le framework livrait, donc la parité du DDL reste vraie.
      col += ".$defaultFn(() => new Date())";
      if (field.refreshedOnWrite) col += ".$onUpdateFn(() => new Date())";
    }
    if (field.defaultValue !== undefined) {
      // Les DEUX, et chacun couvre ce que l'autre ne peut pas.
      //
      // `.default()` émet un `DEFAULT` **SQL**, que seule une migration porte —
      // et c'est le seul qui compte le jour où la colonne est AJOUTÉE à une
      // table déjà peuplée : un `ADD COLUMN … NOT NULL` sans défaut est refusé
      // par le serveur (« contains null values »), et une valeur posée côté
      // JavaScript n'apparaît nulle part dans cet `ALTER`.
      //
      // `$defaultFn` (côté JS) reste nécessaire en développement : le DDL
      // dérivé du code n'émet PAS les `DEFAULT`, donc sans lui une insertion
      // qui omet la colonne échouerait sur la contrainte NOT NULL.
      //
      // …SAUF pour une colonne reprise d'un contrat du framework, qui doit
      // REPRODUIRE le DDL de la fabrique qu'elle remplace — sans quoi la
      // migration suivante recrée la table et échoue (cf `defaultJsOnly`).
      col += field.defaultJsOnly
        ? `.$defaultFn(() => ${defaultLiteral(field)})`
        : `.default(${defaultLiteral(field)}).$defaultFn(() => ${defaultLiteral(field)})`;
    }
    columns.push(`${field.name}: ${col},`);

    rowProps.push(
      `${field.name}: ${rowTypeOf(fk?.tsType ?? tsTypeOf(field), field.nullable)};`,
    );

    // Le schéma suit le même type : une clé auto-incrémentée est un NOMBRE, et
    // le valider comme une chaîne rejetterait la valeur que la base rend.
    let zod = fk?.tsType === "number" ? ZOD_INT32 : zodTypeOf(field);
    if (field.nullable) zod += ".nullable().optional()";
    if (field.defaultValue !== undefined) {
      zod += `.default(${defaultLiteral(field)})`;
    }
    zodProps.push(`${field.name}: ${zod},`);

    if (field.type === "ref") {
      columns[columns.length - 1] += ` // → ${field.target}.id`;
    }
  }

  if (timestamps) {
    const dateCol = COLUMN[dialect].date;
    imports.add(columnImport(dialect, "date"));
    columns.push(
      `createdAt: ${dateCol("created_at")}.notNull().$defaultFn(() => new Date()),`,
      `updatedAt: ${dateCol("updated_at")}.notNull().$defaultFn(() => new Date()).$onUpdateFn(() => new Date()),`,
    );
    rowProps.push("createdAt: Date;", "updatedAt: Date;");
  }

  if (softDelete) {
    const dateCol = COLUMN[dialect].date;
    imports.add(columnImport(dialect, "date"));
    columns.push(`deletedAt: ${dateCol("deleted_at")},`);
    rowProps.push("deletedAt: Date | null;");
  }

  // Index de table. Ils vivent dans le TROISIÈME argument — une colonne ne peut pas
  // se déclarer indexée toute seule chez Drizzle. Deux sources se rejoignent ici :
  // le modificateur `:index` d'un champ, et les index de TABLE (`--index`,
  // `--unique`), seuls capables de porter plusieurs colonnes.
  //
  // La fusion se fait sur le NOM d'index, qui dérive des colonnes : déclarer
  // `email:string:index` et `--index "email"` ne produit qu'un index, là où deux
  // lignes identiques auraient fait échouer la création de la table au démarrage.
  const declared: IEntityIndex[] = [
    ...fields
      .filter((field) => field.indexed)
      .map((field) => ({ columns: [field.name], unique: false })),
    ...(options.indexes ?? []),
  ];
  let tableExtras = "";
  if (declared.length > 0) {
    const seen = new Set<string>();
    const lines: string[] = [];
    for (const entry of declared) {
      const suffix = entry.unique ? "key" : "idx";
      // Le nom d'index est un objet SQL : il suit la casse des COLONNES, pas celle
      // des propriétés. Les colonnes visées, elles, restent nommées côté Drizzle
      // (`t.siteId`) — c'est du TypeScript, l'ORM fait la traduction.
      const name = `${table}_${entry.columns.map(sql).join("_")}_${suffix}`;
      if (seen.has(name)) continue;
      seen.add(name);
      const fn = entry.unique ? "uniqueIndex" : "index";
      imports.add(fn);
      const cols = entry.columns.map((c) => `t.${c}`).join(", ");
      lines.push(`    ${fn}("${name}").on(${cols}),`);
    }
    tableExtras = `, (t) => [\n${lines.join("\n")}\n  ]`;
  }

  const { fn, module } = TABLE_FN[dialect];
  imports.add(fn);

  // Saut de ligne FINAL obligatoire : eta supprime le newline qui suit une
  // interpolation, donc la fermeture (`});`) remonterait sur la dernière ligne rendue.
  // Anodin tant qu'elle finit par une virgule (`…notNull(),});` reste valide) — mais
  // dès qu'un champ de RELATION est en dernier, son commentaire de fin de ligne avale
  // la fermeture : `…, // → User.id …});` ne compile pas. Vécu en appliquant un vrai
  // schéma (WordPress), invisible sur tous les exemples jusque-là.
  // Pas de saut de ligne FINAL : c'est la ligne du gabarit qui le porte
  // (`  <%= it.rowProps %>` suivi de sa propre fin de ligne). Il en était ajouté
  // un ici, et le moteur l'avalait — les deux fautes se compensaient. Depuis que
  // le moteur rend ce que le gabarit écrit, la valeur ne doit plus emporter la
  // ponctuation de son point d'insertion : sinon une ligne vide s'ouvre juste
  // avant l'accolade fermante de chaque interface et de chaque schéma générés.
  const block = (lines: string[]): string => lines.join("\n  ");
  // La variante QUI FERME sa ligne, pour le seul point d'insertion où le gabarit
  // enchaîne sur la MÊME ligne : `  <%= it.columns %>}<%= it.tableExtras %>);`.
  // Deux helpers plutôt qu'un, parce que la ponctuation appartient au point
  // d'insertion — la déduire du contenu était exactement l'erreur précédente.
  const blockLn = (lines: string[]): string => `${block(lines)}\n`;

  return {
    columns: blockLn(columns),
    drizzleImport: `import { ${[...imports].sort().join(", ")} } from "${module}";`,
    // Une ligne par entité visée, triée : l'ordre des imports ne doit pas dépendre
    // de l'ordre dans lequel les champs ont été tapés — deux générations du même
    // schéma produisent le même fichier, donc un diff vide.
    entityImports: [...referenced]
      .sort()
      .map(
        (target) =>
          `import { ${entityTableSymbol(target)} } from "./${target}";`,
      )
      .join("\n"),
    tableFn: fn,
    rowProps: block(rowProps),
    zodProps: block(zodProps),
    tableExtras,
    needsNodefony: id !== "serial",
    idType: pk.tsType,
  };
}

/**
 * Plus longue valeur d'énumération qu'admet la description portable — la
 * largeur `varchar(64)` de MySQL, figée par les migrations du framework
 * (`ENUM_MAX_LENGTH` de `@nodefony/drizzle`, confronté par test).
 */
export const PORTABLE_ENUM_MAX_LENGTH = 64;

/** Tout ce dont le gabarit a besoin pour rendre une entité PORTABLE. */
export interface IPortableEntityCodegen {
  /** Corps de `columns` de la description (lignes `nom: { kind: … },`). */
  columns: string;
  /** Liste `indexes` de la description — chaîne vide quand aucun index. */
  indexes: string;
  /**
   * Imports des descriptions VISÉES par les relations
   * (`import { userTable } from "./User";`) — hors relation vers soi.
   */
  entityImports: string;
  /** Propriétés de la ligne, sous la forme `nom: type;` — lues par la garde anti-écrasement. */
  rowProps: string;
  /** Corps du schéma Zod de création. */
  zodProps: string;
  /** `true` si la clé primaire est générée côté JS (le gabarit importe `Nodefony`). */
  needsNodefony: boolean;
  /** Type TS de la clé primaire. */
  idType: string;
}

/**
 * Produit la DESCRIPTION portable d'une entité — une spec du kit de colonnes,
 * qu'aucun moteur ne fige : le démarrage en décline la table du dialecte du
 * connecteur qui la charge, et la migration celle de sa base.
 *
 * Même grammaire de champs, mêmes règles que {@link buildEntityCodegen} — seule
 * la sortie change. Ce que la description NOMME autrement :
 * - `date` (un instant pour le générateur) devient `kind: "datetime"` : dans le
 *   kit, `date` est un jour calendaire ;
 * - une valeur par défaut tapée devient `default` — `DEFAULT` SQL dans la
 *   migration ET défaut côté JS —, sauf colonne d'un contrat du framework
 *   (`defaultJsOnly`), qui garde le seul `defaultFn` de la fabrique qu'elle
 *   reproduit ;
 * - une référence vise la DESCRIPTION de sa cible ; sa colonne prend le type de
 *   la clé visée, sans que le générateur ait à le deviner.
 *
 * @param fields - champs analysés par {@link parseEntityFields}.
 * @param options - mêmes options que {@link buildEntityCodegen} ; le dialecte
 *   n'y sert plus.
 * @returns le code de la description, de la ligne et du schéma Zod.
 * @throws EntityFieldError Quand une valeur d'énumération dépasse
 *   {@link PORTABLE_ENUM_MAX_LENGTH} caractères.
 */
export function buildPortableEntityCodegen(
  fields: IEntityField[],
  options: Parameters<typeof buildEntityCodegen>[1] & {
    /**
     * Entité d'IDENTITÉ (`User`) : sa clé est le `text` du contrat, pas la
     * stratégie `--id` — les sessions, jetons et audit du framework la visent.
     */
    identity?: boolean;
  },
): IPortableEntityCodegen {
  const { id, timestamps, softDelete, table } = options;
  const columnCase: TColumnCase = options.columnCase ?? "camel";
  const idName = options.idName ?? "id";
  const sql = (property: string): string => sqlColumn(property, columnCase);
  /** `, column: "x"` quand le nom en base diffère de la propriété. */
  const stored = (property: string, column: string): string =>
    column === property ? "" : `, column: ${toCodeLiteral(column)}`;
  const columns: string[] = [];
  const rowProps: string[] = [];
  const zodProps: string[] = [];
  const referenced = new Set<string>();

  if (options.identity) {
    columns.push(
      `id: { kind: "text", primaryKey: true, defaultFn: () => Nodefony.generateId()${stored("id", idName)} },`,
    );
  } else if (id === "serial") {
    columns.push(
      `id: { kind: "serial", primaryKey: true${stored("id", idName)} },`,
    );
  } else {
    const generator =
      id === "uuid7"
        ? "Nodefony.generateSortableId()"
        : "Nodefony.generateId()";
    columns.push(
      `id: { kind: "uuid", primaryKey: true, defaultFn: () => ${generator}${stored("id", idName)} },`,
    );
  }
  const idType = id === "serial" && !options.identity ? "number" : "string";
  rowProps.push(`id: ${idType};`);

  for (const field of fields) {
    const column = sql(field.name);
    const parts: string[] = [];
    let tsType = tsTypeOf(field);
    switch (
      field.fromContract && (field.type === "string" || field.type === "uuid")
        ? "text"
        : field.type
    ) {
      case "text":
        parts.push(`kind: "text"`);
        break;
      case "string":
        parts.push(`kind: "string"`);
        if (field.length !== undefined) parts.push(`length: ${field.length}`);
        break;
      case "char":
        parts.push(`kind: "char"`, `length: ${field.length ?? 1}`);
        break;
      case "decimal":
        parts.push(
          `kind: "decimal"`,
          `precision: ${field.precision ?? 0}`,
          `scale: ${field.scale ?? 0}`,
        );
        break;
      case "date":
        parts.push(`kind: "datetime"`);
        break;
      case "enum": {
        const values = field.values ?? [];
        const tooLong = values.find(
          (value) => value.length > PORTABLE_ENUM_MAX_LENGTH,
        );
        if (tooLong !== undefined) {
          throw new EntityFieldError(
            `champ « ${field.name} » — la valeur « ${tooLong} » dépasse ` +
              `${PORTABLE_ENUM_MAX_LENGTH} caractères, la largeur d'une énumération en base`,
          );
        }
        parts.push(
          `kind: "enum"`,
          `values: [${values.map((value) => toCodeLiteral(value)).join(", ")}]`,
        );
        break;
      }
      case "ref": {
        const self = field.target === options.entity;
        if (!self && field.target) referenced.add(field.target);
        parts.push(
          `kind: "ref"`,
          `target: ${self || !field.target ? `"self"` : `() => ${entityTableSymbol(field.target)}`}`,
        );
        tsType = refTargetsSerial(field, id) ? "number" : "string";
        break;
      }
      case "int":
      case "float":
      case "bool":
      case "json":
      case "uuid":
        parts.push(`kind: "${field.type}"`);
        break;
    }
    if (!field.nullable) parts.push("notNull: true");
    if (field.unique) parts.push("unique: true");
    if (field.type === "ref") {
      // Même règle que la table native : la politique se DÉDUIT de la
      // nullabilité (cf {@link buildEntityCodegen}).
      parts.push(`onDelete: "${field.nullable ? "set null" : "restrict"}"`);
    }
    if (field.defaultNow) {
      parts.push("defaultFn: () => new Date()");
      if (field.refreshedOnWrite) parts.push("onUpdateFn: () => new Date()");
    }
    if (field.defaultValue !== undefined) {
      parts.push(
        field.defaultJsOnly
          ? `defaultFn: () => ${defaultLiteral(field)}`
          : `default: ${defaultLiteral(field)}`,
      );
    }
    if (column !== field.name) parts.push(`column: ${toCodeLiteral(column)}`);
    columns.push(
      `${field.name}: { ${parts.join(", ")} },${field.type === "ref" ? ` // → ${field.target}.id` : ""}`,
    );
    rowProps.push(`${field.name}: ${rowTypeOf(tsType, field.nullable)};`);

    let zod =
      tsType === "number" && field.type === "ref"
        ? ZOD_INT32
        : zodTypeOf(field);
    if (field.nullable) zod += ".nullable().optional()";
    if (field.defaultValue !== undefined) {
      zod += `.default(${defaultLiteral(field)})`;
    }
    zodProps.push(`${field.name}: ${zod},`);
  }

  if (timestamps) {
    columns.push(
      `createdAt: { kind: "datetime", notNull: true, defaultFn: () => new Date(), column: "created_at" },`,
      `updatedAt: { kind: "datetime", notNull: true, defaultFn: () => new Date(), onUpdateFn: () => new Date(), column: "updated_at" },`,
    );
    rowProps.push("createdAt: Date;", "updatedAt: Date;");
  }
  if (softDelete) {
    columns.push(`deletedAt: { kind: "datetime", column: "deleted_at" },`);
    rowProps.push("deletedAt: Date | null;");
  }

  // Index : mêmes deux sources et même fusion par NOM que la table native.
  const declared: IEntityIndex[] = [
    ...fields
      .filter((field) => field.indexed)
      .map((field) => ({ columns: [field.name], unique: false })),
    ...(options.indexes ?? []),
  ];
  const seen = new Set<string>();
  const indexLines: string[] = [];
  for (const entry of declared) {
    const name = `${table}_${entry.columns.map(sql).join("_")}_${entry.unique ? "key" : "idx"}`;
    if (seen.has(name)) continue;
    seen.add(name);
    const on = entry.columns.map((c) => toCodeLiteral(c)).join(", ");
    indexLines.push(
      `    { name: ${toCodeLiteral(name)}, on: [${on}]${entry.unique ? ", unique: true" : ""} },`,
    );
  }

  const block = (lines: string[]): string => lines.join("\n    ");
  return {
    columns: block(columns),
    indexes: indexLines.length === 0 ? "" : `[\n${indexLines.join("\n")}\n  ]`,
    entityImports: [...referenced]
      .sort()
      .map(
        (target) =>
          `import { ${entityTableSymbol(target)} } from "./${target}";`,
      )
      .join("\n"),
    rowProps: rowProps.join("\n  "),
    zodProps: zodProps.join("\n  "),
    needsNodefony: id !== "serial" || options.identity === true,
    idType,
  };
}

/**
 * Forme d'un identifiant MongoDB (`ObjectId`) — 24 chiffres hexadécimaux.
 *
 * Source unique pour le schéma Zod d'une référence et pour l'échantillon qui
 * doit le satisfaire : une référence mal formée n'atteint jamais Mongoose, qui
 * la refuserait par une `CastError` — un 500 là où le client mérite un 422.
 */
export const OBJECT_ID_PATTERN = "^[0-9a-f]{24}$";

/**
 * Type Mongoose d'un champ du vocabulaire Nodefony.
 *
 * Écrit en NOM de type (`"ObjectId"`, `"Mixed"`) ou en constructeur global
 * (`String`, `Number`…) — jamais `Schema.Types.X` : l'entité générée n'importe
 * pas `mongoose`, que l'application reçoit par `@nodefony/mongoose` sans le
 * déclarer. Un décimal exact reste une CHAÎNE, comme en SQL : même contrat
 * d'API sur les deux familles, et aucune perte de précision en route.
 */
const MONGOOSE_TYPE: Record<TEntityFieldType | "ref", string> = {
  string: "String",
  text: "String",
  int: "Number",
  float: "Number",
  bool: "Boolean",
  json: '"Mixed"',
  date: "Date",
  uuid: "String",
  ref: '"ObjectId"',
  enum: "String",
  char: "String",
  decimal: "String",
};

/**
 * Type BSON de la valeur d'un champ — le filtre d'un index unique PARTIEL
 * (`partialFilterExpression: { champ: { $type } }`), qui n'indexe que les
 * valeurs réellement présentes.
 */
const BSON_TYPE: Record<TEntityFieldType | "ref", string> = {
  string: "string",
  text: "string",
  int: "number",
  float: "number",
  bool: "bool",
  json: "object",
  date: "date",
  uuid: "string",
  ref: "objectId",
  enum: "string",
  char: "string",
  decimal: "string",
};

/** Tout ce dont le gabarit d'entité DOCUMENT a besoin. */
export interface IMongooseEntityCodegen {
  /** Corps du schéma Mongoose (lignes `nom: { type: …, … },`). */
  schemaFields: string;
  /** Propriétés de l'interface de ligne. */
  rowProps: string;
  /** Corps du schéma Zod de création. */
  zodProps: string;
  /** Type TS de la clé primaire — toujours `string` (virtuel `id` d'un ObjectId). */
  idType: string;
}

/**
 * Produit le schéma Mongoose, l'interface de ligne et le schéma Zod d'une entité
 * DOCUMENT — le pendant de {@link buildEntityCodegen} pour `@nodefony/mongoose`.
 *
 * Pas un quatrième dialecte : il n'y a ni table, ni colonne, ni migration. La
 * clé est l'`_id` natif, servi au contrat `id: string` par le virtuel que
 * `MongooseOrm` active à la sérialisation — exactement comme l'entité `User`
 * que `create app` pose, sans quoi `ref:User` ne joindrait pas. Les horodatages
 * sont l'option `timestamps` du descripteur, pas des champs : le moteur les
 * fournit, les redéclarer les mettrait en concurrence avec lui.
 *
 * @param fields - champs analysés par {@link parseEntityFields}.
 * @param options - horodatages et suppression douce.
 */
export function buildMongooseEntityCodegen(
  fields: IEntityField[],
  options: { timestamps: boolean; softDelete: boolean },
): IMongooseEntityCodegen {
  const schemaFields: string[] = [];
  const rowProps: string[] = ["id: string;"];
  const zodProps: string[] = [];

  for (const field of fields) {
    const parts = [`type: ${MONGOOSE_TYPE[field.type]}`];
    if (field.type === "ref" && field.target) {
      parts.push(`ref: ${toCodeLiteral(field.target)}`);
    }
    if (field.type === "enum" && field.values) {
      parts.push(
        `enum: ${toCodeLiteral(field.values).replace(/","/g, '", "')}`,
      );
    }
    if (field.type === "string") {
      parts.push(`maxlength: ${field.length ?? 255}`);
    }
    if (field.type === "char" && field.length !== undefined) {
      parts.push(`minlength: ${field.length}`, `maxlength: ${field.length}`);
    }
    // Obligatoire sans défaut → `required`. Un défaut rend la valeur impossible
    // à manquer : l'exiger n'ajouterait qu'un refus (règle de `userEntity.ts`).
    if (!field.nullable && field.defaultValue === undefined) {
      parts.push("required: true");
    }
    if (field.defaultValue !== undefined) {
      // Un défaut STRUCTURÉ passe en fabrique : en valeur, Mongoose partagerait
      // le même objet entre tous les documents.
      parts.push(
        field.type === "json"
          ? `default: () => (${defaultLiteral(field)})`
          : `default: ${defaultLiteral(field)}`,
      );
    } else if (field.nullable) {
      // `null` explicite plutôt que rien : un document ancien et un neuf se
      // lisent pareil, et le contrat `T | null` dit vrai.
      parts.push("default: null");
    }
    if (field.unique && field.nullable) {
      // Facultatif ET unique : l'index unique de MongoDB indexe `null` comme
      // une VALEUR — deux documents sans e-mail se heurteraient (E11000, 409
      // sur une création légitime). `sparse` ne suffit pas : il n'écarte que
      // les champs ABSENTS, pas un `null` que le contrat d'entrée accepte.
      // Un index PARTIEL, restreint aux valeurs du bon type, reproduit le SQL,
      // où `UNIQUE` admet N NULL — éprouvé sur MongoDB réel, et reconnu par
      // `diffIndexes` (l'audit d'index de l'ORM ne le signale pas manquant).
      parts.push(
        `index: { unique: true, partialFilterExpression: { ${field.name}: { $type: "${BSON_TYPE[field.type]}" } } }`,
      );
    } else if (field.unique) {
      parts.push("unique: true");
    } else if (field.indexed || field.type === "ref") {
      // Une référence est la clé de jointure (`?include=`, filtre par parent) :
      // indexée d'office, comme sa colonne SQL.
      parts.push("index: true");
    }
    schemaFields.push(`${field.name}: { ${parts.join(", ")} },`);
    if (field.type === "ref") {
      schemaFields[schemaFields.length - 1] += ` // → ${field.target}.id`;
    }

    rowProps.push(
      `${field.name}: ${rowTypeOf(tsTypeOf(field), field.nullable)};`,
    );

    let zod =
      field.type === "ref"
        ? `z.string().regex(/${OBJECT_ID_PATTERN}/iu, "identifiant MongoDB attendu (24 caractères hexadécimaux)")`
        : zodTypeOf(field);
    if (field.nullable) zod += ".nullable().optional()";
    if (field.defaultValue !== undefined) {
      zod += `.default(${defaultLiteral(field)})`;
    }
    zodProps.push(`${field.name}: ${zod},`);
  }

  if (options.timestamps) {
    rowProps.push("createdAt: Date;", "updatedAt: Date;");
  }
  if (options.softDelete) {
    schemaFields.push("deletedAt: { type: Date, default: null },");
    rowProps.push("deletedAt: Date | null;");
  }

  // Même ponctuation que {@link buildEntityCodegen} : la fin de ligne appartient
  // au point d'insertion du gabarit, pas à la valeur.
  const block = (lines: string[]): string => lines.join("\n  ");
  return {
    schemaFields: block(schemaFields),
    rowProps: block(rowProps),
    zodProps: block(zodProps),
    idType: "string",
  };
}

/**
 * Noms des propriétés d'un bloc d'interface de ligne — `id`, les champs, les
 * horodatages : exactement l'ensemble des colonnes que porte la table.
 *
 * Rend `null` dès qu'une ligne n'a pas la forme `nom: type;`, et c'est tout
 * l'intérêt : l'appelant s'en sert pour savoir s'il COMPREND l'entité qu'il
 * s'apprête à remplacer. Une forme inconnue — type imbriqué écrit à la main,
 * accolade ouverte sur la ligne — doit conduire à refuser l'écrasement, jamais
 * à conclure « aucun champ perdu ».
 *
 * @param block - corps de l'interface, une propriété par ligne
 * @returns les noms, dans l'ordre, ou `null` si la forme n'est pas comprise
 */
export function parseRowFieldNames(block: string): string[] | null {
  const names: string[] = [];
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    // Lignes vides et commentaires : sautés. On ne devine rien, on ignore ce
    // qui ne déclare pas de propriété.
    if (
      line.length === 0 ||
      line.startsWith("//") ||
      line.startsWith("/*") ||
      line.startsWith("*")
    ) {
      continue;
    }
    const match = /^([A-Za-z_$][\w$]*)\??:\s*[^;{}]+;$/u.exec(line);
    if (!match) return null;
    if (match[1] !== undefined) names.push(match[1]);
  }
  return names;
}

/**
 * Corps de `export interface <Pascal>Row { … }` dans une entité déjà rendue.
 *
 * C'est le MIROIR PLAT des colonnes : le bloc Drizzle, lui, porte des appels
 * imbriqués, des options en objet et des commentaires de fin de ligne qu'aucune
 * grammaire simple ne lit sans se tromper. Un développeur qui ajoute une colonne
 * à la main ajoute la propriété ici aussi — sans elle, son code ne verrait pas
 * la colonne.
 *
 * @param source - contenu du fichier d'entité
 * @param pascal - nom de l'entité (`Post` → `PostRow`)
 * @returns le corps de l'interface, ou `null` si elle est absente ou non close
 */
export function extractRowBlock(source: string, pascal: string): string | null {
  const header = `export interface ${pascal}Row {`;
  const start = source.indexOf(header);
  if (start === -1) return null;
  const body = source.slice(start + header.length);
  const end = body.indexOf("\n}");
  if (end === -1) return null;
  return body.slice(0, end);
}

/**
 * Un fichier d'entité est-il écrit en description PORTABLE ?
 *
 * Lu sur la SOURCE, parce que deux lecteurs en dépendent sans pouvoir importer
 * le fichier : la référence d'une entité neuve (une `ref` portable vise une
 * description, jamais une table native) et la garde anti-écrasement.
 *
 * @param source - contenu du fichier d'entité.
 * @returns `true` si l'entité est déclarée par `defineTable` ou par la
 *   description portable de `User`.
 */
export function isPortableEntitySource(source: string): boolean {
  return /\bdefineTable\(|\bportableUserTable\b/u.test(source);
}

/**
 * Propriétés déclarées dans le bloc `columns` d'une description portable — le
 * pendant de {@link extractRowBlock} quand la ligne se DÉRIVE de la spec.
 *
 * Lit les clés du premier niveau de l'objet, quelle que soit sa mise en forme
 * (une colonne sur une ligne, ou dépliée par le formateur) : les accolades des
 * colonnes et les chaînes sont sautées, seules comptent les clés.
 *
 * @param source - contenu du fichier d'entité.
 * @returns les propriétés, ou `null` si le bloc est introuvable.
 */
export function extractSpecColumnNames(source: string): string[] | null {
  const start = /\bcolumns:\s*\{/u.exec(source);
  if (!start) return null;
  const names: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let expectKey = true;
  for (let i = start.index + start[0].length; i < source.length; i++) {
    const c = source[i];
    if (quote !== null) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      continue;
    }
    if (c === "/" && source[i + 1] === "/") {
      const eol = source.indexOf("\n", i);
      i = eol === -1 ? source.length : eol;
      continue;
    }
    if (c === "{" || c === "[" || c === "(") depth++;
    else if (c === "}" || c === "]" || c === ")") {
      if (depth === 0) return names;
      depth--;
    } else if (depth === 0 && c === ",") expectKey = true;
    else if (
      depth === 0 &&
      expectKey &&
      c !== undefined &&
      /[A-Za-z_$]/u.test(c)
    ) {
      const key = /^[A-Za-z_$][\w$]*/u.exec(source.slice(i));
      if (key) {
        names.push(key[0]);
        i += key[0].length - 1;
        expectKey = false;
      }
    }
  }
  return null;
}
