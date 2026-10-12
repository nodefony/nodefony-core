import { describe, it, expect, afterAll, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Ce que ces tests prouvent : le script d'extraction du skill de dépannage rend
 * les erreurs d'un journal — et RIEN d'autre — quelle que soit la forme écrite
 * par le framework (texte coloré, JSON par ligne, plantage brut de Node).
 *
 * Les journaux sont fabriqués à la main, dans la forme exacte que le framework
 * écrit (`HH:MM:SS.mmm SÉVÉRITÉ MSGID : message`, et les champs du JSON). Un
 * format qui changerait côté framework laisserait ce test vert : la preuve sur
 * un journal réel est faite à la main, sur une application générée.
 */
const SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "nodefony-troubleshoot",
  "scripts",
  "log-errors.mjs",
);

interface IEvenement {
  severity: string;
  msgid: string;
  message: string;
  detail: string[];
  count: number;
  hint: string | null;
}

interface IScript {
  extractEvents(text: string, source: string): IEvenement[];
  summarize(events: IEvenement[], o?: { warnings?: boolean }): IEvenement[];
  main(argv: string[]): number;
}

const charger = async (): Promise<IScript> =>
  (await import(pathToFileURL(SCRIPT).href)) as IScript;

const ESC = "\u001b";
const coloree = (s: string): string => `${ESC}[31m${s}${ESC}[0m`;

/** Un journal de développement ordinaire : du bruit, puis une vraie panne. */
const TEXTE = [
  "20:03:10.001 INFO    KERNEL             : EVENT KERNEL onBoot",
  "20:03:10.002 DEBUG   KERNEL             : SERVICE ADD router",
  coloree(
    "20:03:11.500 ERROR   KERNEL             : SyntaxError: The requested module 'nodefony' does not provide an export named 'Foo'",
  ),
  "    at ModuleJob._instantiate (node:internal/modules/esm/module_job:180:21)",
  "    at async ModuleJob.run (node:internal/modules/esm/module_job:263:5)",
  "20:03:11.600 WARNING oauth2             : oauth2 provider « keycloak » indisponible",
  "20:03:12.000 ERROR   drizzle            : no such table: User",
  "20:03:13.000 ERROR   drizzle            : no such table: User",
  "20:03:14.000 INFO    HTTP               : GET /api/x 200",
].join("\n");

/** Le même événement que la ligne 20:03:12.000, lu dans le JSON du même processus. */
const JSONL = [
  JSON.stringify({
    payload: "no such table: User",
    severity: 3,
    timeStamp: new Date(2026, 9, 12, 20, 3, 12, 0).getTime(),
    severityName: "ERROR",
    msgid: "drizzle",
  }),
  JSON.stringify({
    payload: "listening",
    severity: 6,
    timeStamp: 0,
    severityName: "INFO",
    msgid: "HTTP",
  }),
  '{"payload":"tronqu', // écriture en cours : ni erreur, ni plantage
].join("\n");

/** Ce que Node écrit lui-même quand l'application ne charge même pas. */
const PLANTAGE = [
  "file:///app/dist/index.js:3",
  "import { Foo } from 'nodefony';",
  "         ^^^",
  "SyntaxError: The requested module 'nodefony' does not provide an export named 'Foo'",
  "    at ModuleJob._instantiate (node:internal/modules/esm/module_job:180:21)",
  "",
  "Node.js v26.10.0",
].join("\n");

const dossiers: string[] = [];
const projet = (fichiers: Record<string, string>): string => {
  const racine = mkdtempSync(path.join(os.tmpdir(), "nf-troubleshoot-"));
  dossiers.push(racine);
  for (const [nom, contenu] of Object.entries(fichiers)) {
    const f = path.join(racine, nom);
    mkdirSync(path.dirname(f), { recursive: true });
    writeFileSync(f, contenu);
  }
  return racine;
};

afterAll(() => {
  for (const d of dossiers) rmSync(d, { recursive: true, force: true });
});

describe("skill nodefony-troubleshoot — extraction des erreurs du journal", () => {
  it("garde les erreurs, recolle la pile, retire les couleurs et le bruit", async () => {
    const s = await charger();
    const erreurs = s.summarize(s.extractEvents(TEXTE, "dev.log"));
    expect(erreurs.map((e) => e.msgid)).toEqual(["KERNEL", "drizzle"]);
    const [exportManquant] = erreurs;
    expect(exportManquant?.message).toContain(
      "does not provide an export named",
    );
    expect(exportManquant?.message).not.toContain(ESC);
    expect(exportManquant?.detail).toHaveLength(2);
  });

  it("compte une répétition au lieu de la rendre deux fois", async () => {
    const s = await charger();
    const table = s
      .summarize(s.extractEvents(TEXTE, "dev.log"))
      .find((e) => e.msgid === "drizzle");
    expect(table?.count).toBe(2);
  });

  it("ne compte qu'une fois un événement lu dans ses DEUX formes (texte et JSON)", async () => {
    const s = await charger();
    const evenements = [
      ...s.extractEvents(TEXTE, "dev.log"),
      ...s.extractEvents(JSONL, "nodefony-1.jsonl"),
    ];
    const table = s.summarize(evenements).find((e) => e.msgid === "drizzle");
    expect(table?.count).toBe(2);
  });

  it("n'inclut les avertissements que sur demande", async () => {
    const s = await charger();
    const ev = s.extractEvents(TEXTE, "dev.log");
    expect(s.summarize(ev).some((e) => e.severity === "WARNING")).toBe(false);
    expect(
      s.summarize(ev, { warnings: true }).some((e) => e.severity === "WARNING"),
    ).toBe(true);
  });

  it("reconnaît le plantage brut de Node, hors du format du journal", async () => {
    const s = await charger();
    const [plantage, ...reste] = s.summarize(
      s.extractEvents(PLANTAGE, "crash.log"),
    );
    expect(reste).toHaveLength(0);
    expect(plantage?.msgid).toBe("node");
    expect(plantage?.detail).toHaveLength(1);
  });

  it("nomme le premier geste quand la cause est établie", async () => {
    const s = await charger();
    const erreurs = s.summarize(s.extractEvents(TEXTE, "dev.log"));
    expect(erreurs[0]?.hint).toContain("npm run build");
    expect(erreurs[1]?.hint).toContain("nodefony-migrate-schema");
  });

  it("sort en 1 sur un journal en erreur, 0 sur un journal sain", async () => {
    const s = await charger();
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const enPanne = projet({ "logs/nodefony-detached.log": TEXTE });
    const sain = projet({
      "logs/nodefony-detached.log": "20:03:10.001 INFO    KERNEL : ok\n",
    });
    expect(s.main(["--root", enPanne])).toBe(1);
    expect(s.main(["--root", sain])).toBe(0);
    vi.restoreAllMocks();
  });

  it("dit où trouver le journal quand il n'y en a aucun (66), refuse un drapeau inconnu (64)", async () => {
    const s = await charger();
    const ecrit: string[] = [];
    vi.spyOn(process.stderr, "write").mockImplementation((t) => {
      ecrit.push(String(t));
      return true;
    });
    expect(s.main(["--root", projet({})])).toBe(66);
    expect(ecrit.join("")).toContain("--detach");
    expect(s.main(["--derniers", "3"])).toBe(64);
    vi.restoreAllMocks();
  });
});
