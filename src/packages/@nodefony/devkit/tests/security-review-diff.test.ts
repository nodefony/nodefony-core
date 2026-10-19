import { describe, it, expect, afterAll, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Ce que ces tests prouvent : le script de relecture du skill
 * `nodefony-security-review` nomme CHAQUE faute qu'il annonce, sur la ligne qui
 * la porte, et RIEN sur la forme saine voisine — y compris le croisement des
 * routes nouvelles avec les zones du pare-feu, et le choix du diff relu.
 *
 * Chaque règle a son cas fautif ET son cas sain : une règle qui ne mordrait
 * jamais passerait le second, une règle trop large échouerait au second. Les
 * zones sont lues dans un `security.ts` fabriqué dans la forme du gabarit
 * généré — commentaires d'exemple compris, qu'il ne faut PAS prendre pour des
 * zones.
 *
 * Ce que ce test ne prouve PAS : la pertinence sur un diff réel d'application ;
 * elle est relevée à la main, sur une application générée.
 */
const SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "nodefony-security-review",
  "scripts",
  "review-diff.mjs",
);

interface IConstat {
  rule: string;
  level: string;
  file: string;
  line: number;
  why: string;
  excerpt: string;
}

interface IFichierDiff {
  added: { line: number; text: string }[];
  isNew: boolean;
}

interface IZone {
  name: string;
  pattern: string;
  authenticators: string[];
  open: boolean;
}

interface IScript {
  parseDiff(diff: string): Map<string, IFichierDiff>;
  readZones(src: string): IZone[];
  appZones(root: string): IZone[];
  zoneFor(zones: IZone[], urlPath: string): IZone | null;
  review(
    files: Map<string, IFichierDiff>,
    opts: { root: string; readDisk?: boolean },
  ): {
    findings: IConstat[];
    reviewed: string[];
    skippedTests: string[];
    zonesRead: number;
  };
  main(argv: string[]): number;
}

const charger = async (): Promise<IScript> =>
  (await import(pathToFileURL(SCRIPT).href)) as IScript;

/**
 * Les zones d'une application générée, dans la forme du gabarit — avec, en
 * commentaire, une zone `^/admin` qui N'EXISTE PAS : le script ne doit pas la lire.
 */
const SECURITY_TS = `import { defineSecurityConfig } from "@nodefony/security";

/**
 * Exemple : protéger tout l'espace
 *   admin: { pattern: "^/admin", authenticators: ["session"] },
 */
export default (ctx) =>
  defineSecurityConfig({
    // ancien: { pattern: "^/legacy", authenticators: ["session"] },
    areas: {
      main: {
        pattern: "^/api",
        authenticators: ["session", "anonymous"], // l'anonyme passe
      },
      secure: {
        pattern: "^/api/secure",
        authenticators: ["session"],
        roles: ["ROLE_USER"],
      },
      partner: {
        pattern: "^/api/partner",
        authenticators: ["jwt", "external-jwt"],
      },
      compte: {
        pattern: "^/compte(/|$)",
        authenticators: ["session"],
        entryPoint: "/login",
      },
    },
    csrf: { secret: ctx.env.NF_CSRF_SECRET },
  });
`;

const dossiers: string[] = [];
const projet = (fichiers: Record<string, string>): string => {
  const racine = mkdtempSync(path.join(os.tmpdir(), "nf-security-review-"));
  dossiers.push(racine);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const f = path.join(racine, ...nom.split("/"));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, contenu);
  }
  return racine;
};

afterAll(() => {
  for (const d of dossiers) rmSync(d, { recursive: true, force: true });
});

/** Le patch d'un fichier NEUF, dans la forme exacte de `git diff`. */
const nouveau = (file: string, lines: string[]): string =>
  [
    `diff --git a/${file} b/${file}`,
    "new file mode 100644",
    "index 0000000..1111111",
    "--- /dev/null",
    `+++ b/${file}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((l) => `+${l}`),
  ].join("\n");

/** Une application jouet : ses zones, et rien d'autre. */
const app = (): string =>
  projet({ "nodefony/config/security.ts": SECURITY_TS });

/** Les règles levées par un fichier neuf, relu sans disque. */
const regles = async (
  file: string,
  lines: string[],
  root = app(),
): Promise<string[]> => {
  const s = await charger();
  const { findings } = s.review(s.parseDiff(nouveau(file, lines)), {
    root,
    readDisk: false,
  });
  return findings.map((f) => f.rule);
};

const SERVICE = "nodefony/service/Demo.ts";

/**
 * Une règle par ligne : [règle, ligne fautive, ligne saine voisine].
 *
 * La ligne saine est choisie pour être la plus PROCHE possible de la fautive —
 * c'est elle qui prouve que la règle ne mord pas sur le geste juste.
 */
const PAR_LIGNE: [string, string[], string[]][] = [
  [
    "sql-interpolated",
    [
      "const rows = await db.execute(sql.raw(`SELECT * FROM users WHERE name = '${name}'`));",
    ],
    [
      "const rows = await db.execute(sql`SELECT * FROM users WHERE name = ${name}`);",
    ],
  ],
  [
    "sql-interpolated",
    ['const q = "SELECT * FROM users WHERE id = " + id;'],
    ['const q = "SELECT * FROM users WHERE id = 1";'],
  ],
  [
    "sql-interpolated",
    [
      "const rows = await db.all(`",
      "  SELECT * FROM users",
      "  WHERE name = '${name}'`);",
    ],
    [
      "const rows = await db.all(sql`",
      "  SELECT * FROM users",
      "  WHERE name = ${name}`);",
    ],
  ],
  [
    "sql-interpolated",
    ["const now = sql.raw(column);"],
    ['const now = sql.raw("CURRENT_TIMESTAMP");'],
  ],
  [
    "code-exec",
    ["exec(`convert ${file} out.png`);"],
    ['execFile("convert", [file, "out.png"]);'],
  ],
  ["code-exec", ["const r = eval(code);"], ['const r = "eval(code)";']],
  [
    "secret-hardcoded",
    ['const apiKey = "sk9f8a7d6s5a4";'],
    ["const apiKey = ctx.env.PARTNER_KEY;"],
  ],
  [
    "secret-hardcoded",
    ['  password: "Sup3rSecret42",'],
    ['  passwordField: "password",'],
  ],
  [
    "secret-hardcoded",
    ['const pem = "-----BEGIN RSA PRIVATE KEY-----";'],
    ['const pem = "-----BEGIN PUBLIC KEY-----";'],
  ],
  [
    "secret-logged",
    ["this.log(`connexion de ${user.identifier} avec ${body.password}`);"],
    ["this.log(`jeton renouvelé pour ${user.identifier}`);"],
  ],
  [
    "env-outside-envts",
    ["const key = process.env.PARTNER_KEY;"],
    ["const key = this.config.partnerKey;"],
  ],
  [
    "raw-identity",
    ["const user = RequestContext.getUser();"],
    ["const user = RequestContext.getAuthenticatedUser();"],
  ],
  ["firewall-opening", ["  @Anonymous()"], ['  @IsGranted("ROLE_ADMIN")']],
  [
    "firewall-opening",
    ['  authenticators: ["session", "anonymous"],'],
    ['  authenticators: ["session"],'],
  ],
  ["csrf-off", ["  @CsrfExempt()"], ["  @CsrfProtect()"]],
  [
    "csrf-off",
    ["  csrf: { enabled: false },"],
    ['  csrf: { trustedOrigins: ["https://partner.example"] },'],
  ],
  [
    "guard-off",
    ["  rateLimit: { enabled: false },"],
    ["  rateLimit: { max: 20 },"],
  ],
  [
    "guard-off",
    ["  allowInsecureCredentials: true,"],
    ["  allowInsecureCredentials: false,"],
  ],
  [
    "open-redirect",
    ["return this.redirect(this.query.from);"],
    ["return this.redirect(safeRedirectPath(this.query.from));"],
  ],
  [
    "path-from-input",
    ["const file = path.join(root, this.query.name);"],
    ['const file = path.join(root, "public", "logo.png");'],
  ],
  [
    "mcp-tool-exposed",
    ["  getMcpTools(): IMcpTool[] {"],
    ["  getRoutes(): IRoute[] {"],
  ],
  [
    "mcp-opened",
    ["  mcp: { allowRemote: true },"],
    ["  mcp: { allowRemote: false },"],
  ],
  [
    "mcp-opened",
    ['  mcp: { allowedOrigins: ["*"] },'],
    ['  mcp: { allowedOrigins: ["https://studio.example"] },'],
  ],
];

describe("skill nodefony-security-review — une règle, une faute, et la forme saine", () => {
  it.each(PAR_LIGNE)("%s : la faute est nommée", async (regle, fautif) => {
    expect(await regles(SERVICE, fautif)).toEqual([regle]);
  });

  it.each(PAR_LIGNE)(
    "%s : la forme saine voisine ne lève rien",
    async (_regle, _fautif, sain) => {
      expect(await regles(SERVICE, sain)).toEqual([]);
    },
  );

  it("situe la faute sur SA ligne, avec la raison et le geste", async () => {
    const s = await charger();
    const { findings } = s.review(
      s.parseDiff(
        nouveau(SERVICE, [
          'import { sql } from "drizzle-orm";',
          "",
          "export const find = (db, name) =>",
          "  db.execute(sql.raw(`SELECT * FROM users WHERE name = '${name}'`));",
        ]),
      ),
      { root: app(), readDisk: false },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: "sql-interpolated",
      level: "FAUTE",
      file: SERVICE,
      line: 4,
    });
  });

  it("ne RECOPIE pas le secret qu'il signale : l'extrait le masque", async () => {
    const s = await charger();
    const { findings } = s.review(
      s.parseDiff(nouveau(SERVICE, ['const apiKey = "sk9f8a7d6s5a4";'])),
      { root: app(), readDisk: false },
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.excerpt).toBe('const apiKey = "sk9f…";');
  });

  it("un `process.env` lu DANS env.ts est à sa place", async () => {
    expect(
      await regles("env.ts", ["export const key = process.env.APP_KEY;"]),
    ).toEqual([]);
  });

  it("un .env versionné est une faute ; la notice .env.example ne l'est pas", async () => {
    expect(await regles(".env", ["NF_CSRF_SECRET=abc"])).toEqual([
      "env-file-versioned",
    ]);
    expect(await regles(".env.example", ["NF_CSRF_SECRET="])).toEqual([]);
  });

  it("ne relit pas les tests : leurs secrets en dur sont des fixtures", async () => {
    const s = await charger();
    const r = s.review(
      s.parseDiff(
        nouveau("tests/login.test.ts", ['const password = "Sup3rSecret42";']),
      ),
      { root: app(), readDisk: false },
    );
    expect(r.findings).toEqual([]);
    expect(r.skippedTests).toEqual(["tests/login.test.ts"]);
  });

  // Les cas suivants viennent d'un passage sur un diff RÉEL : chacun y levait
  // un point sur un texte qui n'était pas un geste.
  it.each([
    ["commentaire de ligne", ["  // la CSP par défaut porte 'unsafe-inline'"]],
    ["ligne de documentation", ["   * `@Anonymous` rend l'action publique"]],
    ["ouverture de bloc", ["  /* security: false le temps du test */"]],
    [
      "commentaire en fin de ligne",
      ["const a = 1; // csrf: { enabled: false }"],
    ],
    [
      "sql.raw() cité dans un message",
      ['  fix: "jamais sql.raw() sur une donnée reçue",'],
    ],
  ])("%s : une PROSE qui parle d'un geste n'en est pas un", async (_q, l) => {
    expect(await regles(SERVICE, l)).toEqual([]);
  });

  it("un `//` dans une chaîne n'ouvre pas de commentaire : le geste qui suit compte", async () => {
    expect(
      await regles(SERVICE, [
        'const u = "https://x.example"; const v = RequestContext.getUser();',
      ]),
    ).toEqual(["raw-identity"]);
  });

  it("un auto-contrôle (*.selftest.mjs) est un test", async () => {
    const s = await charger();
    const r = s.review(
      s.parseDiff(
        nouveau("lib/juge.selftest.mjs", [
          'const SECRET = "JBSWY3DPEHPK3PXP";',
        ]),
      ),
      { root: app(), readDisk: false },
    );
    expect(r.findings).toEqual([]);
    expect(r.skippedTests).toEqual(["lib/juge.selftest.mjs"]);
  });

  it("un dossier caché (.claude/, .github/) n'est pas le code de l'application", async () => {
    const s = await charger();
    const r = s.review(
      s.parseDiff(
        nouveau(".claude/skills/x/run.mjs", [
          'const password = "Sup3rSecret42";',
        ]),
      ),
      { root: app(), readDisk: false },
    );
    expect(r.findings).toEqual([]);
    expect(r.reviewed).toEqual([]);
  });

  it("un script autonome (scripts/) lit son environnement lui-même", async () => {
    expect(
      await regles("scripts/report.ts", [
        "const url = process.env.REPORT_URL;",
      ]),
    ).toEqual([]);
  });
});

/** Un controller neuf, préfixe et corps donnés. */
const controller = (
  prefix: string,
  body: string[],
  classDeco: string[] = [],
) => [
  'import { controller, route, Controller } from "@nodefony/framework";',
  "",
  ...classDeco,
  `@controller("${prefix}")`,
  "class ReportController extends Controller {",
  "  constructor(context) {",
  '    super("report", context);',
  "  }",
  "",
  ...body,
  "}",
  "",
  "export default ReportController;",
];

const GET = [
  "  /** Les rapports internes. */",
  '  @route("report-list", { path: "/", method: "GET" })',
  "  list() {",
  "    return this.renderJson([]);",
  "  }",
];

const POST = (extra: string[] = []) => [
  ...extra,
  '  @route("report-create", { path: "/", method: "POST" })',
  "  create() {",
  "    return this.renderJson({ ok: true });",
  "  }",
];

const CTRL = "nodefony/controllers/ReportController.ts";

describe("skill nodefony-security-review — routes nouvelles croisées avec les zones", () => {
  it("lit les zones déclarées, et ignore celles écrites en commentaire", async () => {
    const s = await charger();
    const zones = s.readZones(SECURITY_TS);
    expect(zones.map((z) => z.name)).toEqual([
      "main",
      "secure",
      "partner",
      "compte",
    ]);
    expect(zones.find((z) => z.name === "main")?.open).toBe(true);
    expect(zones.find((z) => z.name === "secure")?.open).toBe(false);
  });

  it("retient la zone au motif le plus LONG, comme le pare-feu", async () => {
    const s = await charger();
    const zones = s.appZones(app());
    expect(s.zoneFor(zones, "/api/secure/x")?.name).toBe("secure");
    expect(s.zoneFor(zones, "/api/report")?.name).toBe("main");
    expect(s.zoneFor(zones, "/compte")?.name).toBe("compte");
    expect(s.zoneFor(zones, "/comptes")).toBeNull();
  });

  it("route sous une zone qui laisse passer l'anonyme, sans garde → nommée, zone citée", async () => {
    const s = await charger();
    const { findings } = s.review(
      s.parseDiff(nouveau(CTRL, controller("/api/report", GET))),
      { root: app(), readDisk: false },
    );
    expect(findings.map((f) => f.rule)).toEqual(["route-open"]);
    // La ligne du décorateur `@route` : c'est elle qui nomme la route.
    expect(findings[0]?.line).toBe(10);
    expect(findings[0]?.why).toContain("« main »");
  });

  it("la même route gardée par @IsGranted — sur l'action ou sur la classe — ne lève rien", async () => {
    const surAction = [
      GET[0] ?? "",
      '  @IsGranted("ROLE_ADMIN")',
      ...GET.slice(1),
    ];
    expect(await regles(CTRL, controller("/api/report", surAction))).toEqual(
      [],
    );
    expect(
      await regles(
        CTRL,
        controller("/api/report", GET, ['@IsGranted("ROLE_ADMIN")']),
      ),
    ).toEqual([]);
  });

  it("un @IsGranted écrit en COMMENTAIRE ne garde rien", async () => {
    const promis = [
      GET[0] ?? "",
      '  // @IsGranted("ROLE_ADMIN") — à ajouter',
      ...GET.slice(1),
    ];
    expect(await regles(CTRL, controller("/api/report", promis))).toEqual([
      "route-open",
    ]);
  });

  it("route sous une zone qui exige une session → rien", async () => {
    expect(await regles(CTRL, controller("/api/secure/report", GET))).toEqual(
      [],
    );
  });

  it("route hors de toute zone → nommée, y compris quand une zone n'existe qu'en COMMENTAIRE", async () => {
    const s = await charger();
    const { findings } = s.review(
      s.parseDiff(nouveau(CTRL, controller("/admin/report", GET))),
      { root: app(), readDisk: false },
    );
    expect(findings.map((f) => f.rule)).toEqual(["route-open"]);
    expect(findings[0]?.why).toContain("aucune zone ne couvre /admin/report");
  });

  it("application sans aucune zone → chaque route est dite publique", async () => {
    const s = await charger();
    const { findings } = s.review(
      s.parseDiff(nouveau(CTRL, controller("/api/report", GET))),
      { root: projet({ "package.json": "{}" }), readDisk: false },
    );
    expect(findings.map((f) => f.rule)).toEqual(["route-open"]);
    expect(findings[0]?.why).toContain("aucune zone de pare-feu lue");
  });

  it("mutation sous une zone à session sans @CsrfProtect → faute", async () => {
    expect(
      await regles(CTRL, controller("/api/secure/report", POST())),
    ).toEqual(["mutation-without-csrf"]);
  });

  it("@CsrfProtect sur l'action ou sur la classe → rien", async () => {
    expect(
      await regles(
        CTRL,
        controller("/api/secure/report", POST(["  @CsrfProtect()"])),
      ),
    ).toEqual([]);
    expect(
      await regles(
        CTRL,
        controller("/api/secure/report", POST(), ["@CsrfProtect()"]),
      ),
    ).toEqual([]);
  });

  it("mutation sous une zone à JETON (aucun cookie) → pas de CSRF à exiger", async () => {
    expect(
      await regles(CTRL, controller("/api/partner/report", POST())),
    ).toEqual([]);
  });

  it("les décorateurs de verbe (@Post) sont lus comme @route", async () => {
    const verbe = [
      '  @Post("/archive")',
      "  archive() {",
      "    return this.renderJson({ ok: true });",
      "  }",
    ];
    expect(await regles(CTRL, controller("/api/secure/report", verbe))).toEqual(
      ["mutation-without-csrf"],
    );
  });

  it("dans un fichier MODIFIÉ, seules les actions touchées par le diff sont relues", async () => {
    const s = await charger();
    const lignes = controller("/api/report", [
      ...GET,
      "",
      '  @route("report-export", { path: "/export", method: "GET" })',
      "  exportAll() {",
      "    return this.renderJson([]);",
      "  }",
    ]);
    const root = projet({
      "nodefony/config/security.ts": SECURITY_TS,
      [CTRL]: lignes.join("\n"),
    });
    const at = lignes.findIndex((l) => l.includes("report-export")) + 1;
    const patch = [
      `diff --git a/${CTRL} b/${CTRL}`,
      "index 1111111..2222222 100644",
      `--- a/${CTRL}`,
      `+++ b/${CTRL}`,
      `@@ -${at},0 +${at},1 @@`,
      `+${lignes[at - 1]}`,
    ].join("\n");
    const { findings } = s.review(s.parseDiff(patch), { root });
    expect(findings.map((f) => [f.rule, f.line])).toEqual([["route-open", at]]);
  });
});

describe("skill nodefony-security-review — lecture du diff", () => {
  it("numérote les lignes ajoutées à travers plusieurs blocs, et ignore un fichier supprimé", async () => {
    const s = await charger();
    const files = s.parseDiff(
      [
        "diff --git a/a.ts b/a.ts",
        "index 1..2 100644",
        "--- a/a.ts",
        "+++ b/a.ts",
        "@@ -3,0 +4,2 @@",
        "+un",
        "+deux",
        "@@ -10 +12 @@",
        "-ancien",
        "+nouveau",
        "diff --git a/b.ts b/b.ts",
        "deleted file mode 100644",
        "--- a/b.ts",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-parti",
      ].join("\n"),
    );
    expect([...files.keys()]).toEqual(["a.ts"]);
    expect(files.get("a.ts")?.added).toEqual([
      { line: 4, text: "un" },
      { line: 5, text: "deux" },
      { line: 12, text: "nouveau" },
    ]);
    expect(files.get("a.ts")?.isNew).toBe(false);
  });
});

/** Lance git dans un dépôt de test, identité et signature neutralisées. */
const git = (racine: string, ...args: string[]) => {
  const r = spawnSync(
    "git",
    [
      "-c",
      "user.name=banc",
      "-c",
      "user.email=banc@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd: racine, encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} : ${r.stderr}`);
};

/** Un dépôt git jetable, un premier commit posé. */
const depot = (fichiers: Record<string, string>): string => {
  const racine = projet(fichiers);
  git(racine, "init", "-q");
  git(racine, "add", "-A");
  git(racine, "commit", "-q", "-m", "départ");
  return racine;
};

/** Ajoute des fichiers au dépôt, en un commit. */
const commiter = (racine: string, fichiers: Record<string, string>) => {
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const f = path.join(racine, ...nom.split("/"));
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, contenu);
  }
  git(racine, "add", "-A");
  git(racine, "commit", "-q", "-m", "suite");
};

// Ces tests créent de VRAIS dépôts et lancent git plusieurs fois chacun : sous
// la charge d'une suite complète (ou d'un exécuteur Windows lent), ils passent
// les 5 s par défaut sans rien avoir de faux — et même 30 s, vu en passe
// complète (4 s isolés). Le plafond garde contre un blocage, il ne mesure pas
// la machine.
describe(
  "skill nodefony-security-review — la commande",
  { timeout: 120_000 },
  () => {
    const sortie: string[] = [];
    afterEach(() => {
      vi.restoreAllMocks();
      sortie.length = 0;
    });
    const capturer = () => {
      vi.spyOn(process.stdout, "write").mockImplementation((c) => {
        sortie.push(String(c));
        return true;
      });
      vi.spyOn(process.stderr, "write").mockImplementation((c) => {
        sortie.push(String(c));
        return true;
      });
    };
    const SAIN = 'export const hello = () => "bonjour";\n';

    it("relit le travail en cours, fichiers non suivis compris → 1, fichier:ligne nommé", async () => {
      const s = await charger();
      const root = depot({
        "nodefony/config/security.ts": SECURITY_TS,
        "nodefony/service/Hello.ts": SAIN,
      });
      writeFileSync(
        path.join(root, "nodefony", "service", "Users.ts"),
        "export const find = (db, name) =>\n  db.execute(sql.raw(`SELECT * FROM users WHERE name = '${name}'`));\n" +
          'export const API_KEY = "sk9f8a7d6s5a4";\n',
      );
      capturer();
      expect(s.main(["--root", root])).toBe(1);
      const texte = sortie.join("");
      expect(texte).toContain("le travail en cours");
      expect(texte).toContain("nodefony/service/Users.ts:2");
      expect(texte).toContain("[sql-interpolated]");
      expect(texte).toContain("nodefony/service/Users.ts:3");
      // Le secret est signalé, jamais RECOPIÉ dans la sortie.
      expect(texte).not.toContain("sk9f8a7d6s5a4");
      expect(texte).toContain("npx nodefony doctor");
    });

    it("rien en cours → relit le DERNIER COMMIT, et le dit", async () => {
      const s = await charger();
      // La configuration au premier commit, le controller au second : le dernier
      // commit ne porte QUE la route.
      const root = depot({ "nodefony/config/security.ts": SECURITY_TS });
      commiter(root, { [CTRL]: controller("/api/report", GET).join("\n") });
      capturer();
      expect(s.main(["--root", root, "--json"])).toBe(1);
      const r = JSON.parse(sortie.join("")) as {
        source: string;
        findings: IConstat[];
      };
      expect(r.source).toContain("DERNIER COMMIT");
      expect(r.findings.map((f) => f.rule)).toEqual(["route-open"]);
    });

    it("un diff sain → 0, « rien à signaler », et ce que le script ne voit pas", async () => {
      const s = await charger();
      const root = depot({ "nodefony/service/Hello.ts": SAIN });
      writeFileSync(path.join(root, "nodefony", "service", "Bye.ts"), SAIN);
      capturer();
      expect(s.main(["--root", root])).toBe(0);
      const texte = sortie.join("");
      expect(texte).toContain("Rien à signaler");
      expect(texte).toContain("npm audit");
    });

    it("--staged ne relit que l'index", async () => {
      const s = await charger();
      const root = depot({ "nodefony/service/Hello.ts": SAIN });
      writeFileSync(
        path.join(root, "nodefony", "service", "Hello.ts"),
        `${SAIN}const u = RequestContext.getUser();\n`,
      );
      capturer();
      expect(s.main(["--root", root, "--staged"])).toBe(0);
    });

    it("hors d'un dépôt git → 66 ; patch absent → 66", async () => {
      const s = await charger();
      capturer();
      expect(s.main(["--root", projet({ "a.ts": SAIN })])).toBe(66);
      expect(s.main(["--root", app(), "--diff", "absent.patch"])).toBe(66);
    });

    it("option inconnue, valeur manquante ou options contradictoires → 64", async () => {
      const s = await charger();
      capturer();
      expect(s.main(["--strict"])).toBe(64);
      expect(s.main(["--base"])).toBe(64);
      expect(s.main(["--staged", "--base", "main"])).toBe(64);
    });
  },
);
