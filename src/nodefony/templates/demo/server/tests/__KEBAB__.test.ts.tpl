import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { rename } from "node:fs/promises";
import { deflateRawSync, gzipSync } from "node:zlib";
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
  isUploadedFile,
} from "../nodefony/service/ChatService";
import {
  INFLATE_LIMIT,
  PREVIEW_ENTRIES,
  countLines,
  decodeText,
  describeFile,
  inflateHead,
  sniffImage,
} from "../frontend/src/kit/preview";
import {
  codeMark,
  continueList,
  linkMark,
  parseInline,
  parseMarkdown,
  prefixLines,
  toggleMark,
} from "../frontend/src/kit/markdown";
import {
  LARGE_PASTE_CHARS,
  LARGE_PASTE_LINES,
  attachmentProblem,
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
import { FIRST_LESSON } from "../frontend/src/first/firstTabs";
import {
  formatBody,
  pickHeaders,
  PROBE_BODY_LIMIT,
} from "../frontend/src/kit/probe";
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

  /** Un zip minimal : en-têtes locaux, index central, fin d'index. */
  const zip = (files: Record<string, string>, deflate = true): Buffer => {
    const locals: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, content] of Object.entries(files)) {
      const raw = Buffer.from(content);
      const data = deflate ? deflateRawSync(raw) : raw;
      const label = Buffer.from(name);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(deflate ? 8 : 0, 8);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
      local.writeUInt16LE(label.length, 26);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(deflate ? 8 : 0, 10);
      entry.writeUInt32LE(data.length, 20);
      entry.writeUInt32LE(raw.length, 24);
      entry.writeUInt16LE(label.length, 28);
      entry.writeUInt32LE(offset, 42);
      locals.push(local, label, data);
      central.push(entry, label);
      offset += 30 + label.length + data.length;
    }
    const index = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(Object.keys(files).length, 8);
    end.writeUInt16LE(Object.keys(files).length, 10);
    end.writeUInt32LE(index.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, index, end]);
  };

  /** Une archive tar (ustar) : un en-tête de 512 octets par entrée. */
  const tar = (files: Record<string, string>): Buffer => {
    const blocks: Buffer[] = [];
    for (const [name, content] of Object.entries(files)) {
      const header = Buffer.alloc(512);
      header.write(name, 0);
      header.write(content.length.toString(8).padStart(11, "0"), 124);
      header.write(name.endsWith("/") ? "5" : "0", 156);
      header.write("ustar\u000000", 257);
      const body = Buffer.alloc(Math.ceil(content.length / 512) * 512);
      body.write(content);
      blocks.push(header, body);
    }
    blocks.push(Buffer.alloc(1024));
    return Buffer.concat(blocks);
  };

  it("🔴 un zip annonce son INDEX : 20 entrées au plus, sur le total", async () => {
    const files: Record<string, string> = {};
    for (let i = 1; i <= 25; i += 1) files[`src/f${i}.txt`] = "x".repeat(i);
    const [piece] = await store().saveAttachments([
      upload("code.zip", zip(files)),
    ]);
    expect(piece).toMatchObject({ kind: "archive", format: "zip", total: 25 });
    expect(piece?.entries).toHaveLength(PREVIEW_ENTRIES);
    expect(piece?.entries?.[2]).toEqual({ name: "src/f3.txt", size: 3 });
  });

  it("un tar et un tar.gz se listent ; un dossier est une entrée de taille 0", async () => {
    const archive = tar({
      "app/": "",
      "app/a.txt": "abc",
      "app/b.txt": "x".repeat(700),
    });
    const [plain, packed] = await store().saveAttachments([
      upload("a.tar", archive),
      upload("a.tar.gz", gzipSync(archive)),
    ]);
    const entries = [
      { name: "app/", size: 0 },
      { name: "app/a.txt", size: 3 },
      { name: "app/b.txt", size: 700 },
    ];
    expect(plain).toMatchObject({
      kind: "archive",
      format: "tar",
      total: 3,
      entries,
    });
    expect(packed).toMatchObject({
      kind: "archive",
      format: "tar.gz",
      total: 3,
      entries,
    });
  });

  it("🔴 une bombe est COUPÉE : la décompression s'arrête au premier mégaoctet", async () => {
    const bomb = deflateRawSync(Buffer.alloc(8 * INFLATE_LIMIT));
    expect(bomb.length).toBeLessThan(16_384);
    const out = await inflateHead(bomb, "raw", INFLATE_LIMIT);
    expect(out).toMatchObject({ truncated: true });
    expect(out.bytes.length).toBe(INFLATE_LIMIT);
    const [piece] = await store().saveAttachments([
      upload(
        "bombe.tar.gz",
        gzipSync(tar({ "zero.bin": "\u0000".repeat(3 * INFLATE_LIMIT) })),
      ),
    ]);
    expect(piece).toMatchObject({ kind: "archive", truncated: true, total: 1 });
  });

  it("un Word et un ODT montrent leurs premiers paragraphes, entités décodées", async () => {
    const docx = zip({
      "[Content_Types].xml": "<Types/>",
      "word/document.xml":
        '<w:document><w:body><w:p><w:r><w:t>Bonjour </w:t></w:r><w:r><w:t xml:space="preserve">&amp; bienvenue</w:t></w:r></w:p><w:p></w:p><w:p><w:r><w:tab/><w:t>Deuxième</w:t></w:r></w:p></w:body></w:document>',
    });
    const odt = zip(
      {
        mimetype: "application/vnd.oasis.opendocument.text",
        "content.xml":
          '<office:document-content><office:body><office:text><text:h text:outline-level="1">Titre</text:h><text:p>Un<text:s/>texte &lt;ici&gt;</text:p></office:text></office:body></office:document-content>',
      },
      false,
    );
    const [word, odf] = await store().saveAttachments([
      upload("lettre.docx", docx),
      upload("note.odt", odt),
    ]);
    expect(word).toMatchObject({
      kind: "document",
      format: "docx",
      paragraphs: ["Bonjour & bienvenue", "Deuxième"],
    });
    expect(odf).toMatchObject({
      kind: "document",
      format: "odt",
      paragraphs: ["Titre", "Un texte <ici>"],
    });
  });

  it("un Excel et un ODS montrent le coin de la première feuille", async () => {
    const xlsx = zip({
      "xl/workbook.xml": "<workbook/>",
      "xl/sharedStrings.xml":
        "<sst><si><t>Nom</t></si><si><t>Ville</t></si><si><r><t>Ly</t></r><r><t>on</t></r></si></sst>",
      "xl/worksheets/sheet1.xml":
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>Alice</t></is></c><c r="B2"><v>42</v></c><c r="C2" t="s"><v>2</v></c><c r="H2"><v>9</v></c></row></sheetData></worksheet>',
    });
    const ods = zip({
      mimetype: "application/vnd.oasis.opendocument.spreadsheet",
      "content.xml":
        '<office:spreadsheet><table:table table:name="F1"><table:table-row><table:table-cell><text:p>a</text:p></table:table-cell><table:table-cell table:number-columns-repeated="2"/><table:table-cell><text:p>d</text:p></table:table-cell></table:table-row><table:table-row table:number-rows-repeated="1048575"><table:table-cell table:number-columns-repeated="16384"/></table:table-row></table:table><table:table table:name="F2"><table:table-row><table:table-cell><text:p>autre</text:p></table:table-cell></table:table-row></table:table></office:spreadsheet>',
    });
    const [excel, calc] = await store().saveAttachments([
      upload("t.xlsx", xlsx),
      upload("t.ods", ods),
    ]);
    expect(excel).toMatchObject({
      kind: "sheet",
      format: "xlsx",
      rows: [
        ["Nom", "", "Ville"],
        ["Alice", "42", "Lyon"],
      ],
    });
    expect(calc).toMatchObject({
      kind: "sheet",
      format: "ods",
      rows: [["a", "", "", "d"]],
    });
  });

  it("un PDF s'affiche, d'après %PDF- ; un zip illisible reste un fichier", async () => {
    const chat = store();
    const [pdf, broken] = await chat.saveAttachments([
      upload("doc.bin", new TextEncoder().encode("%PDF-1.7\n%âãÏÓ\n")),
      upload("casse.zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0])),
    ]);
    expect(pdf?.kind).toBe("pdf");
    expect(chat.attachment(pdf?.id ?? "")?.mime).toBe("application/pdf");
    expect(broken?.kind).toBe("file");
  });

  it("🔴 le navigateur annonce le MÊME aperçu que le serveur (`describeFile`, isomorphe)", async () => {
    const samples: [string, Uint8Array][] = [
      ["a.png", PNG],
      ["notes.txt", new TextEncoder().encode("un\ndeux\ntrois\nquatre\n")],
      ["code.zip", zip({ "a.txt": "abc", "b/c.txt": "de" })],
      ["code.tar.gz", gzipSync(tar({ "x.txt": "hello" }))],
      ["b.bin", new Uint8Array([1, 0, 2, 3])],
    ];
    const pieces = await store().saveAttachments(
      samples.map(([name, bytes]) => upload(name, bytes)),
    );
    for (const [i, [, bytes]] of samples.entries()) {
      const {
        id: _id,
        name: _name,
        size: _size,
        ...server
      } = pieces[i] ?? {
        id: "",
        name: "",
        size: 0,
        kind: "file",
      };
      expect((await describeFile(bytes)).fields).toEqual(server);
    }
    // Le même fichier tourne dans le navigateur : aucune API propre à Node.
    const source = readFileSync(
      path.join(
        path.dirname(path.dirname(fileURLToPath(import.meta.url))),
        "frontend/src/kit/preview.ts",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/["']node:|\bBuffer\b|\brequire\(/);
  });
});

describe("demo — le Markdown du salon, le même pour tous", () => {
  it("gras, italique, code, lien ; un marqueur orphelin et snake_case restent du texte", () => {
    expect(
      parseInline("**gras** et _it_ puis `a*b` [doc](https://x.dev/a)"),
    ).toEqual([
      { type: "strong", children: ["gras"] },
      " et ",
      { type: "em", children: ["it"] },
      " puis ",
      { type: "code", value: "a*b" },
      " ",
      { type: "link", href: "https://x.dev/a", children: ["doc"] },
    ]);
    expect(parseInline("ma_variable_longue * 2 **seul")).toEqual([
      "ma_variable_longue * 2 **seul",
    ]);
    expect(parseInline("voir https://nodefony.net/doc.")).toEqual([
      "voir ",
      {
        type: "link",
        href: "https://nodefony.net/doc",
        children: ["https://nodefony.net/doc"],
      },
      ".",
    ]);
  });

  it("🔴 un lien javascript: reste du TEXTE", () => {
    expect(parseInline("[clic](javascript:alert(1))")).toEqual([
      "[clic](javascript:alert(1))",
    ]);
  });

  it("blocs : code, liste, citation, paragraphe à plusieurs lignes", () => {
    expect(
      parseMarkdown(
        "a\nb\n\n```\nx **y**\n```\n- un\n- deux\n1. premier\n> cité",
      ),
    ).toEqual([
      { type: "p", children: ["a", { type: "br" }, "b"] },
      { type: "pre", value: "x **y**" },
      { type: "ul", items: [["un"], ["deux"]] },
      { type: "ol", items: [["premier"]] },
      { type: "quote", children: ["cité"] },
    ]);
  });

  it("les boutons posent ou ôtent le marqueur, la sélection suit", () => {
    const bold = toggleMark("un mot ici", 3, 6, "**");
    expect(bold).toEqual({ value: "un **mot** ici", start: 5, end: 8 });
    expect(toggleMark(bold.value, bold.start, bold.end, "**")).toEqual({
      value: "un mot ici",
      start: 3,
      end: 6,
    });
    expect(codeMark("a\nb", 0, 3).value).toBe("```\na\nb\n```");
    expect(linkMark("voir doc", 5, 8)).toEqual({
      value: "voir [doc](https://)",
      start: 11,
      end: 19,
    });
  });

  it("listes et citation : posées sur chaque ligne touchée, ôtées au second clic", () => {
    const list = prefixLines("titre\nun\ndeux", 7, 12, "1. ");
    expect(list).toEqual({ value: "titre\n1. un\n2. deux", start: 6, end: 19 });
    expect(prefixLines(list.value, list.start, list.end, "1. ").value).toBe(
      "titre\nun\ndeux",
    );
    expect(prefixLines("cité", 0, 0, "> ").value).toBe("> cité");
  });

  it("🔴 Entrée dans une liste ouvre l'élément suivant ; sur un élément vide, en sort", () => {
    expect(continueList("- un", 4)).toEqual({
      value: "- un\n- ",
      start: 7,
      end: 7,
    });
    expect(continueList("  9) neuf", 9)).toEqual({
      value: "  9) neuf\n  10) ",
      start: 16,
      end: 16,
    });
    expect(continueList("- un\n- ", 7)).toEqual({
      value: "- un\n",
      start: 5,
      end: 5,
    });
    expect(continueList("pas une liste", 13)).toBeNull();
  });
});

/** Toutes les pages d'apprentissage : une démo neuve s'ajoute ICI. */
const LESSONS: readonly { page: string; lesson: ILesson }[] = [
  { page: "chat", lesson: CHAT_LESSON },
  { page: "partner", lesson: PARTNER_LESSON },
  { page: "first-steps", lesson: FIRST_LESSON },
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

describe("demo — Premiers pas : la sonde et le contrôleur cité", () => {
  it("chaque région du contrôleur est citée par la leçon : aucun geste oublié", () => {
    const file = "nodefony/controllers/FirstStepsController.ts" as const;
    const declared = [
      ...LESSON_SOURCES[file].matchAll(/^\s*\/\/ #region (\S+)\s*$/gm),
    ].map((match) => match[1]);
    const cited = FIRST_LESSON.tabs.flatMap((tab) =>
      tabExcerpts(tab)
        .filter((excerpt) => excerpt.file === file)
        .map((excerpt) => excerpt.region),
    );
    expect(declared.length).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual([...new Set(cited)].sort());
  });

  it("un corps JSON est remis en forme ; un JSON faux reste tel quel", () => {
    expect(formatBody('{"a":1}', "application/json")).toBe('{\n  "a": 1\n}');
    expect(formatBody("{pas du json", "application/json")).toBe("{pas du json");
    expect(formatBody('{"a":1}', "text/plain")).toBe('{"a":1}');
  });

  it("un corps trop long est coupé, en disant combien manque", () => {
    const shown = formatBody("x".repeat(PROBE_BODY_LIMIT + 7), "text/plain");
    expect(shown.startsWith("x".repeat(PROBE_BODY_LIMIT))).toBe(true);
    expect(shown).toContain("7 caractères de plus");
  });

  it("seuls les en-têtes qui apprennent quelque chose sont gardés, dans l'ordre", () => {
    const headers = new Headers({
      etag: '"abc"',
      "content-type": "text/plain",
      "set-cookie": "s=1",
      date: "Sun, 08 Nov 2026 10:00:00 GMT",
    });
    expect(pickHeaders(headers)).toEqual([
      ["content-type", "text/plain"],
      ["etag", '"abc"'],
    ]);
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
