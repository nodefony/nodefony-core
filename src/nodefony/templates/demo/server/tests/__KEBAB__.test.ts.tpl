import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach, afterAll } from "vitest";
import type { IUploadedFile } from "@nodefony/http";
import { getScaffoldSpec, readSymbolsGraph } from "nodefony";
import { defineSecurityConfig } from "@nodefony/security";
import {
  defineDemoConfig,
  demoConfigJsonSchema,
} from "../nodefony/config/defineModuleConfig";
import { demoSecurity, PARTNER_AREA } from "../nodefony/config/security";
import DemoModule from "../index";
import DemoPulseService, {
  PULSE_MIN_INTERVAL_MS,
} from "../nodefony/service/DemoPulseService";
import type { IDemoPulse } from "../frontend/src/pulse";
import ChatService, {
  CHAT_ATTACHMENT_LIMIT,
  CHAT_HISTORY_LIMIT,
  decodeText,
  isUploadedFile,
  sniffImage,
} from "../nodefony/service/ChatService";
import {
  LARGE_PASTE_CHARS,
  LARGE_PASTE_LINES,
  attachmentProblem,
  countLines,
  insertAt,
  isLargePaste,
} from "../frontend/src/chat/attachments";
import {
  ATTACHMENT_MAX_BYTES,
  ATTACHMENT_MAX_COUNT,
} from "../frontend/src/chat/chatContract";
import {
  LESSON_LAYERS,
  extractRegion,
  tabExcerpts,
  type ILesson,
} from "../frontend/src/lesson/lesson";
import { highlight } from "../frontend/src/highlight";
import {
  constantNames,
  resolveConstants,
} from "../frontend/src/lesson/lessonConstants";
import { LESSON_SOURCES } from "../frontend/src/lesson/lessonSources";
import { CHAT_LESSON } from "../frontend/src/chat/chatTabs";
import { PARTNER_LESSON } from "../frontend/src/partner/partnerTabs";
import {
  decodeClaims,
  tamperSignature,
} from "../frontend/src/partner/partnerApi";
import { DEMOS } from "../demos";
import { PARTNER_CALL_COMMAND } from "../nodefony/command/PartnerCallCommand";

/**
 * Ce que ce test prouve, sans serveur :
 *  1. le module s'IMPORTE sans kernel — donc il reste testable hors serveur ;
 *  2. sa config refuse ce qu'elle ne connaît pas, et publie le nom court du
 *     secret machine ;
 *  3. la zone qu'il apporte à `@nodefony/security` est VALIDE pour lui, et sa
 *     ressource suit l'adresse publique de l'application ;
 *  4. le pouls de l'accueil publie au plus une fois par seconde, et se tait
 *     quand personne n'écoute ;
 *  5. chaque page d'apprentissage suit le modèle commun : onglets dans
 *     l'ordre des couches, chaque extrait cité existe et n'est pas vide,
 *     chaque décorateur employé est expliqué, chaque constante a sa valeur ;
 *  6. chaque RENVOI de l'index des démos (`demos.ts`) mène quelque part :
 *     fichier, page de doc, type exporté, commande, skill — c'est l'index que
 *     lit un agent avant d'ouvrir un fichier, un renvoi mort l'égare.
 */
describe("demo", () => {
  it("s'importe sans kernel", () => {
    expect(DemoModule).toBeTypeOf("function");
  });

  it("le secret machine est absent par défaut, et se règle par NF_KEYCLOAK_MACHINE_SECRET", () => {
    expect(defineDemoConfig({}).machineSecret).toBeUndefined();
    const schema = JSON.stringify(demoConfigJsonSchema());
    expect(schema).toContain('"env":"NF_KEYCLOAK_MACHINE_SECRET"');
    expect(schema).toContain('"secret":true');
  });

  it("refuse une clé INCONNUE plutôt que de l'ignorer", () => {
    expect(() => defineDemoConfig({ machineSecert: "faute" })).toThrow(
      /machineSecert/u,
    );
  });

  it("sa zone est acceptée par security, et sa ressource suit jwt.issuer", () => {
    const config = defineSecurityConfig({
      jwt: { issuer: "https://exemple.test" },
      ...demoSecurity,
    });
    expect(config.areas[PARTNER_AREA]?.resource).toBe(
      "https://exemple.test/demo/api/partner",
    );
  });
});

describe("demo — l'historique du chat", () => {
  it("reste borné : au-delà de la limite, les plus anciens sortent", () => {
    const chat = new ChatService();
    for (let i = 0; i <= CHAT_HISTORY_LIMIT; i += 1) {
      chat.add({ author: "a", text: String(i), sentAt: i });
    }
    const all = chat.recent(CHAT_HISTORY_LIMIT * 2);
    expect(all).toHaveLength(CHAT_HISTORY_LIMIT);
    expect(all[0]?.text).toBe("1");
  });

  it("rattrape une coupure : seulement les messages postérieurs à since", () => {
    const chat = new ChatService();
    for (let i = 1; i <= 5; i += 1)
      chat.add({ author: "a", text: String(i), sentAt: i });
    expect(chat.recent(50, 3).map((m) => m.text)).toEqual(["4", "5"]);
    expect(chat.recent(2).map((m) => m.text)).toEqual(["4", "5"]);
  });
});

describe("demo — les règles des pièces jointes (page ET serveur)", () => {
  it("un grand collage devient une pièce : trop de caractères OU trop de lignes", () => {
    expect(isLargePaste("x".repeat(LARGE_PASTE_CHARS))).toBe(false);
    expect(isLargePaste("x".repeat(LARGE_PASTE_CHARS + 1))).toBe(true);
    expect(isLargePaste("a\n".repeat(LARGE_PASTE_LINES))).toBe(false);
    expect(isLargePaste("a\n".repeat(LARGE_PASTE_LINES + 1))).toBe(true);
    expect(countLines("")).toBe(0);
    expect(countLines("un\ndeux\n")).toBe(2);
  });

  it("refuse le vide, le trop-plein et la pièce trop grosse ou vide", () => {
    const one = { name: "a.txt", size: 10 };
    expect(attachmentProblem("", [])).toBe("message vide");
    expect(attachmentProblem("salut", [])).toBeNull();
    expect(attachmentProblem("", [one])).toBeNull();
    expect(
      attachmentProblem(
        "",
        Array.from({ length: ATTACHMENT_MAX_COUNT + 1 }, () => one),
      ),
    ).toMatch(/au plus/u);
    expect(
      attachmentProblem("", [
        { name: "g.bin", size: ATTACHMENT_MAX_BYTES + 1 },
      ]),
    ).toMatch(/dépasse/u);
    expect(attachmentProblem("", [{ name: "v.txt", size: 0 }])).toMatch(
      /vide/u,
    );
  });

  it("une émoticône s'insère à la place de la sélection, curseur après elle", () => {
    expect(insertAt("bonjour", 3, 7, "🙂")).toEqual({
      value: "bon🙂",
      caret: 5,
    });
  });
});

describe("demo — les pièces du salon, classées d'après leurs OCTETS", () => {
  const work = mkdtempSync(path.join(os.tmpdir(), "nf-demo-chat-"));
  afterAll(() => rmSync(work, { recursive: true, force: true }));
  let seq = 0;

  /** Un fichier reçu, tel que le sous-système d'upload le rend. */
  const upload = (filename: string, bytes: Uint8Array): IUploadedFile => {
    seq += 1;
    let at = path.join(work, `incoming-${seq}`);
    writeFileSync(at, bytes);
    const file: IUploadedFile = {
      filename,
      size: bytes.length,
      prettySize: `${bytes.length} o`,
      mimeType: "image/png", // ce que le navigateur DÉCLARE : jamais cru
      hash: null,
      hashAlgorithm: false,
      lastModifiedDate: null,
      move: () => file,
      moveAsync: async (target) => {
        await rename(at, target);
        at = target;
        return file;
      },
      getMimeType: () => file.mimeType,
      getSize: () => file.size,
      getPrettySize: () => file.prettySize,
    };
    return file;
  };
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const store = () => new ChatService(undefined, path.join(work, `s${seq}`));

  it("🔴 une page HTML déclarée image/png n'est PAS une image : texte, téléchargée", async () => {
    const chat = store();
    const [piece] = await chat.saveAttachments([
      upload("photo.png", new TextEncoder().encode("<script>x</script>\n")),
    ]);
    expect(piece?.kind).toBe("text");
    expect(chat.attachment(piece?.id ?? "")?.mime).toBe(
      "text/plain; charset=utf-8",
    );
  });

  it("une vraie image est reconnue à sa signature ; un binaire reste un fichier", async () => {
    expect(sniffImage(PNG)).toBe("image/png");
    expect(sniffImage(new Uint8Array([0x3c, 0x73, 0x76, 0x67]))).toBeNull();
    expect(decodeText(new Uint8Array([0x61, 0x00, 0x62]))).toBeNull();
    expect(decodeText(new Uint8Array([0xff, 0xfe]))).toBeNull();
    const chat = store();
    const [image, binary] = await chat.saveAttachments([
      upload("a.png", PNG),
      upload("b.bin", new Uint8Array([1, 0, 2, 3])),
    ]);
    expect(image?.kind).toBe("image");
    expect(binary?.kind).toBe("file");
    expect(chat.attachment(binary?.id ?? "")?.mime).toBe(
      "application/octet-stream",
    );
  });

  it("un texte annonce ses lignes et ses trois premières", async () => {
    const chat = store();
    const [piece] = await chat.saveAttachments([
      upload("collé.txt", new TextEncoder().encode("1\n2\n3\n4\n5\n")),
    ]);
    expect(piece).toMatchObject({ kind: "text", lines: 5, preview: "1\n2\n3" });
  });

  it("le stock est BORNÉ : la plus ancienne sort, fichier effacé, annonce marquée", async () => {
    const chat = store();
    const [first] = await chat.saveAttachments([upload("0.png", PNG)]);
    for (let i = 1; i <= CHAT_ATTACHMENT_LIMIT; i += 1)
      await chat.saveAttachments([upload(`${i}.png`, PNG)]);
    expect(chat.attachment(first?.id ?? "")).toBeUndefined();
    expect(first?.expired).toBe(true);
    const dir = path.dirname(
      chat.attachment(
        (await chat.saveAttachments([upload("z.png", PNG)]))[0]?.id ?? "",
      )?.file ?? "",
    );
    expect(readdirSync(dir)).toHaveLength(CHAT_ATTACHMENT_LIMIT);
  });

  it("un envoi refusé ne laisse rien sur le disque", async () => {
    const chat = new ChatService(undefined, path.join(work, "refus"));
    await chat.discard([upload("x.bin", new Uint8Array([1, 2]))]);
    expect(readdirSync(path.join(work, "refus"))).toEqual([]);
    expect(isUploadedFile({ filename: "x" })).toBe(false);
    expect(isUploadedFile(upload("y", PNG))).toBe(true);
  });
});

/** Toutes les pages d'apprentissage : une démo neuve s'ajoute ICI. */
const LESSONS: readonly { page: string; lesson: ILesson }[] = [
  { page: "chat", lesson: CHAT_LESSON },
  { page: "partner", lesson: PARTNER_LESSON },
];

/** Chaque extrait cité, avec sa page et sa couche. */
const CITED = LESSONS.flatMap(({ page, lesson }) =>
  lesson.tabs.flatMap((tab) =>
    tabExcerpts(tab).map((excerpt) => ({
      page,
      layer: tab.layer,
      file: excerpt.file,
      region: excerpt.region,
    })),
  ),
);

describe("demo — les pages d'apprentissage suivent le modèle commun", () => {
  it.each(LESSONS)(
    "$page : onglets dans l'ordre des couches, sans doublon, aucun vide",
    ({ lesson }) => {
      const order = LESSON_LAYERS.map((layer) => layer.id);
      const ranks = lesson.tabs.map((tab) => order.indexOf(tab.layer));
      expect(ranks).toEqual([...new Set(ranks)].sort((x, y) => x - y));
      for (const tab of lesson.tabs) {
        expect(tab.blocks.length, tab.layer).toBeGreaterThan(0);
      }
    },
  );

  it.each(CITED)(
    "$page / $layer : la région $region existe dans $file, et n'est pas vide",
    ({ file, region }) => {
      // Le texte que la PAGE affiche (lu par Vite), pas une relecture à part.
      const code = extractRegion(LESSON_SOURCES[file], region);
      expect(code, `// #region ${region} absente de ${file}`).not.toBeNull();
      expect(code?.trim()).not.toBe("");
    },
  );

  it.each(CITED)(
    "$page / $layer : chaque constante de $region a sa valeur",
    ({ file, region }) => {
      const code = extractRegion(LESSON_SOURCES[file], region) ?? "";
      const resolved = resolveConstants(code, LESSON_SOURCES).map(
        (constant) => constant.name,
      );
      expect(resolved).toEqual(constantNames(code));
    },
  );

  /** Les décorateurs d'un source, hors commentaires et TSDoc qui en citent. */
  const decoratorsIn = (source: string): string[] =>
    [
      ...source
        .split("\n")
        .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
        .join("\n")
        .matchAll(/@([A-Za-z]\w*)\(/g),
    ].map((match) => match[1] ?? "");

  it.each(LESSONS)(
    "$page : la liste des décorateurs est COMPLÈTE",
    ({ lesson }) => {
      const used = new Set(
        lesson.decoratedFiles.flatMap((file) =>
          decoratorsIn(LESSON_SOURCES[file]),
        ),
      );
      expect([...used].sort()).toEqual(
        lesson.decorators.map((decorator) => decorator.name).sort(),
      );
    },
  );

  const placed = LESSONS.flatMap(({ page, lesson }) =>
    lesson.decorators.map((decorator) => ({
      page,
      lesson,
      name: decorator.name,
      file: decorator.file,
      region: decorator.region,
    })),
  );

  it.each(placed)(
    "$page : @$name est dans la région $region, citée par un onglet",
    ({ lesson, name, file, region }) => {
      expect(extractRegion(LESSON_SOURCES[file], region)).toContain(
        `@${name}(`,
      );
      const cited = lesson.tabs.some((tab) =>
        tabExcerpts(tab).some(
          (excerpt) => excerpt.file === file && excerpt.region === region,
        ),
      );
      expect(cited).toBe(true);
    },
  );

  it("désindente la région, et rend null si elle manque ou reste ouverte", () => {
    const source =
      "a\n  // #region x\n    un()\n      deux()\n  // #endregion\n";
    expect(extractRegion(source, "x")).toBe("un()\n  deux()");
    expect(extractRegion(source, "y")).toBeNull();
    expect(extractRegion("// #region x\nun()\n", "x")).toBeNull();
  });

  it("la coloration est sans perte, et distingue décorateurs, mots-clés et chaînes", () => {
    const source = '@route("x", { a: 1 }) // note\nconst it: Type = `t`;';
    const tokens = highlight(source);
    expect(tokens.map((token) => token.text).join("")).toBe(source);
    const kinds = Object.fromEntries(
      tokens.map((token) => [token.text, token.kind]),
    );
    expect(kinds).toMatchObject({
      "@route": "decorator",
      '"x"': "string",
      "1": "number",
      "// note": "comment",
      const: "keyword",
      Type: "type",
      "`t`": "string",
    });
    for (const text of Object.values(LESSON_SOURCES)) {
      expect(
        highlight(text)
          .map((token) => token.text)
          .join(""),
      ).toBe(text);
    }
  });

  it("résout un gabarit à travers les autres constantes, ignore chaînes et commentaires", () => {
    const sources = {
      "a.ts": 'export const BASE_PATH = "/demo/api";\nconst LIMIT_N = 50;',
      "b.ts": "const FULL_PATH = `${BASE_PATH}/whoami`;",
    };
    const code = 'call(FULL_PATH, LIMIT_N); // NOT_THIS\nlog("NOR_THIS");';
    expect(resolveConstants(code, sources)).toEqual([
      { name: "FULL_PATH", value: '"/demo/api/whoami"', file: "b.ts" },
      { name: "LIMIT_N", value: "50", file: "a.ts" },
    ]);
    expect(resolveConstants("use(MISSING_ONE)", sources)).toEqual([]);
  });
});

describe("demo — le jeton montré par la page partenaire", () => {
  // Un JWT fabriqué pour le test : en-tête, charge, signature.
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${encode({ alg: "ES256" })}.${encode({ sub: "admin", exp: 10, aud: "https://x.test/demo/api/partner" })}.c2lnbmF0dXJlLWRlLXRlc3QtYXNzZXotbG9uZ3Vl`;

  it("décode les revendications pour l'affichage, et rend null sur un jeton malformé", () => {
    expect(decodeClaims(token)).toEqual({
      sub: "admin",
      exp: 10,
      aud: "https://x.test/demo/api/partner",
    });
    expect(decodeClaims("deux.parties")).toBeNull();
    expect(decodeClaims("a.bm9uLWpzb24.c")).toBeNull();
  });

  it("l'altération change la SIGNATURE, et elle seule", () => {
    const tampered = tamperSignature(token);
    const [head, body, signature] = tampered.split(".");
    const [origHead, origBody, origSignature] = token.split(".");
    expect(head).toBe(origHead);
    expect(body).toBe(origBody);
    expect(signature).not.toBe(origSignature);
    expect(signature?.length).toBe(origSignature?.length);
  });
});

describe("demo — les renvois de l'index des démos", () => {
  const moduleDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

  /** Un chemin sous `node_modules`, résolu comme Node le fait : en remontant. */
  const inNodeModules = (relative: string): string | null => {
    let dir = moduleDir;
    for (;;) {
      const candidate = path.join(dir, "node_modules", ...relative.split("/"));
      if (existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  };

  const ready = DEMOS.filter((demo) => demo.status === "ready");
  const files = ready.flatMap((demo) =>
    demo.files.map((file) => ({ id: demo.id, file })),
  );
  const docs = ready.flatMap((demo) =>
    "doc" in demo ? [{ id: demo.id, doc: demo.doc }] : [],
  );
  const skills = ready.flatMap((demo) =>
    "skill" in demo ? [{ id: demo.id, skill: demo.skill }] : [],
  );
  const commands = ready.flatMap((demo) =>
    "command" in demo ? [{ id: demo.id, command: demo.command }] : [],
  );
  const types = ready.flatMap((demo) =>
    demo.types.map((type) => ({ id: demo.id, type })),
  );

  it("une démo prête cite au moins un fichier et une page de doc", () => {
    for (const demo of ready) {
      expect(demo.files.length, demo.id).toBeGreaterThan(0);
      expect("doc" in demo, demo.id).toBe(true);
    }
  });

  it.each(files)("$id : le fichier $file existe dans le module", ({ file }) => {
    expect(existsSync(path.join(moduleDir, ...file.split("/")))).toBe(true);
  });

  it.each(docs)("$id : la page $doc est installée", ({ doc }) => {
    expect(
      inNodeModules(doc),
      `node_modules/${doc} introuvable`,
    ).not.toBeNull();
  });

  it.each(skills)("$id : le skill $skill est livré", ({ skill }) => {
    const file = `@nodefony/devkit/skills/${skill}/SKILL.md`;
    expect(
      inNodeModules(file),
      `node_modules/${file} introuvable`,
    ).not.toBeNull();
  });

  it.each(types)(
    "$id : le type $type est exporté par son paquet",
    ({ type }) => {
      // Forme imposée : `Nom (paquet)` — `nodefony/client` est porté par le cœur.
      const match = /^(\w+) \(([^)]+)\)$/.exec(type);
      expect(
        match,
        `« ${type} » : forme attendue \`Nom (paquet)\``,
      ).not.toBeNull();
      const [, name = "", pkg = ""] = match ?? [];
      const owner =
        pkg === "nodefony" || pkg.startsWith("nodefony/")
          ? "@nodefony/core"
          : pkg;
      const graph = readSymbolsGraph(moduleDir);
      expect(
        graph,
        "graphe symbolique du framework introuvable",
      ).not.toBeNull();
      const entry = graph?.symbols[`${owner}:${name}`] ?? graph?.symbols[name];
      expect(entry?.module).toBe(owner);
      expect(entry?.exported).toBe(true);
    },
  );

  it.each(commands)("$id : la commande « $command » existe", ({ command }) => {
    const [npx, bin, verb = "", ...rest] = command.split(" ");
    expect(`${npx} ${bin}`).toBe("npx nodefony");
    if (verb === "create") {
      // Un générateur : son type existe, et chaque valeur de drapeau est un
      // choix qu'il propose.
      const spec = getScaffoldSpec(rest[0]).at(0);
      expect(spec, `create ${rest[0]} : générateur inconnu`).toBeDefined();
      for (let i = 1; i < rest.length; i += 1) {
        const value = rest[i + 1];
        if (!rest[i]?.startsWith("--") || value === undefined) continue;
        expect(
          spec?.questions.some((q) =>
            q.choices?.some((c) => c.value === value),
          ),
          `${rest[i]} ${value} : choix inconnu de create ${rest[0]}`,
        ).toBe(true);
      }
      return;
    }
    // Une commande du module : son nom est celui qu'elle déclare.
    expect([PARTNER_CALL_COMMAND]).toContain(verb);
  });
});

describe("demo — le pouls de l'accueil (demo:pulse)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesce une rafale en UNE trame, puis au plus une par seconde", () => {
    vi.useFakeTimers();
    const pulse = new DemoPulseService();
    const sent: IDemoPulse[] = [];
    pulse.attach((value) => sent.push(value));
    for (let i = 0; i < 100; i += 1) pulse.recordPartnerCall();
    vi.advanceTimersByTime(0);
    expect(sent).toEqual([{ partner: { calls: 100 }, chat: { messages: 0 } }]);
    pulse.recordPartnerCall();
    vi.advanceTimersByTime(PULSE_MIN_INTERVAL_MS - 1);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sent.at(-1)?.partner.calls).toBe(101);
  });

  it("se tait sans abonné, et compte quand même", () => {
    vi.useFakeTimers();
    const pulse = new DemoPulseService();
    const sent: IDemoPulse[] = [];
    const detach = pulse.attach((value) => sent.push(value));
    pulse.recordPartnerCall();
    detach();
    vi.advanceTimersByTime(PULSE_MIN_INTERVAL_MS * 3);
    expect(sent).toEqual([]);
    expect(pulse.snapshot().partner.calls).toBe(1);
  });
});
