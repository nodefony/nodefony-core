// Éprouve l'extracteur de phrases normatives : grammaires IETF et markdown/Bikeshed,
// casse BCP 14, sélection de sections, et l'exhaustivité sur le corpus réel.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectFormat, extractNormative } from "./normative.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "normative.mjs");
const CORPUS = path.join(
  HERE,
  "..",
  "..",
  "nodefony-framework-dev",
  "references",
  "rfc",
);
const rfc = (n) => path.join(CORPUS, "ietf", `rfc${n}.txt`);

/** Une ligne porteuse d'un mot BCP 14 doit se retrouver dans un paragraphe rendu. */
function lostLines(file) {
  const text = readFileSync(file, "utf8");
  const { paragraphs } = extractNormative(text);
  const all = paragraphs.map((p) => p.text).join("\n");
  return (
    text
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) =>
        /\b(MUST|SHALL|SHOULD|REQUIRED|RECOMMENDED|MAY|OPTIONAL)\b/.test(l),
      )
      // Les titres de la table des matières et des sections ne sont pas des obligations.
      .filter((l) => !/^(\d+\.)+ /.test(l) && !/\.\.\.\.\s*\d+$/.test(l))
      .filter((l) => !all.includes(l))
  );
}

describe("normative — grammaire IETF", () => {
  it("rend chaque paragraphe porteur d'un mot BCP 14, avec sa section", () => {
    const text = [
      "1.  Introduction",
      "",
      "   Pure prose without obligation.",
      "",
      "2.  Rules",
      "",
      "2.1.  Sending",
      "",
      "   A sender MUST NOT generate",
      "   empty lists.",
      "",
      "   A recipient must not be confused by lowercase words.",
    ].join("\n");
    const { paragraphs, format } = extractNormative(text, { format: "ietf" });
    expect(format).toBe("ietf");
    expect(paragraphs).toEqual([
      {
        n: 1,
        section: "2.1",
        title: "Sending",
        text: "A sender MUST NOT generate empty lists.",
      },
    ]);
  });

  it("recolle un paragraphe coupé par un saut de page, et un mot coupé en fin de ligne", () => {
    const text = [
      "3.  Cookies",
      "",
      "   The user agent MUST keep the end-to-",
      "   end order and the cookie",
      "",
      "",
      "Barth                        Standards Track                    [Page 5]",
      "\f",
      "RFC 6265             HTTP State Management Mechanism          April 2011",
      "",
      "",
      "   store intact.",
    ].join("\n");
    const { paragraphs } = extractNormative(text);
    expect(paragraphs.map((p) => p.text)).toEqual([
      "The user agent MUST keep the end-to-end order and the cookie store intact.",
    ]);
  });

  it("rattache sa liste à une obligation qui finit par deux-points", () => {
    const text = [
      "10.1.1.  Expect",
      "",
      "   An origin server MUST send either:",
      "",
      "   *  an immediate response with a final status code, or",
      "",
      "   *  an immediate 100 (Continue) response.",
      "",
      "   Requirements for clients:",
      "",
      "   *  A client MUST NOT generate a 100-continue expectation.",
    ].join("\n");
    expect(extractNormative(text).paragraphs.map((p) => p.text)).toEqual([
      "An origin server MUST send either: * an immediate response with a final status code, or * an immediate 100 (Continue) response.",
      "* A client MUST NOT generate a 100-continue expectation.",
    ]);
  });

  it("lit les annexes et filtre une section avec ses sous-sections", () => {
    const text = [
      "13.1.5.  If-Range",
      "",
      "   A server MUST ignore it.",
      "",
      "13.2.  Evaluation",
      "",
      "   A server SHOULD evaluate.",
      "",
      "Appendix A.  Collected ABNF",
      "",
      "A.1.  Notes",
      "",
      "   Implementations MAY differ.",
    ].join("\n");
    const pick = (sections) =>
      extractNormative(text, { format: "ietf", sections }).paragraphs.map(
        (p) => p.section,
      );
    expect(pick(["13.1"])).toEqual(["13.1.5"]);
    expect(pick(["13"])).toEqual(["13.1.5", "13.2"]);
    expect(pick(["A"])).toEqual(["A.1"]);
    expect(extractNormative(text, { sections: ["14"] }).unmatched).toEqual([
      "14",
    ]);
  });

  it("ne perd AUCUNE ligne normative de la RFC 9110 (sans sauts de page)", () => {
    expect(lostLines(rfc(9110))).toEqual([]);
  });

  it("ne perd AUCUNE ligne normative de la RFC 6265 (avec sauts de page)", () => {
    expect(lostLines(rfc(6265))).toEqual([]);
  });

  it("rend les quatre obligations d'If-Range (RFC 9110 §13.1.5)", () => {
    const { paragraphs } = extractNormative(readFileSync(rfc(9110), "utf8"), {
      sections: ["13.1.5"],
    });
    expect(paragraphs).toHaveLength(4);
    expect(paragraphs[0].text).toMatch(
      /^A client MUST NOT generate an If-Range/,
    );
  });
});

describe("normative — grammaire markdown / Bikeshed", () => {
  it("lit les mots d'obligation en minuscules, hors code et hors identifiant", () => {
    const text = [
      "# 1 Parsing",
      "",
      "Streams must be decoded as UTF-8.",
      "",
      "```",
      "const x = 'you must ignore this code';",
      "```",
      "",
      '<pre class="idl">',
      "interface Foo { /* must not count */ };",
      "</pre>",
      "",
      "1. If [[#should-directive-execute]] returns No, return Allowed.",
      "2. The user agent may retry.",
    ].join("\n");
    const { paragraphs, format, case: keyCase } = extractNormative(text);
    expect(format).toBe("markdown");
    expect(keyCase).toBe("any");
    expect(paragraphs.map((p) => p.text)).toEqual([
      "Streams must be decoded as UTF-8.",
      "2. The user agent may retry.",
    ]);
  });

  it("écarte les sections non normatives et les notes, et les COMPTE", () => {
    const text = [
      '<h2 id="intro">Introduction</h2>',
      "<em>This section is non-normative.</em>",
      "",
      "Authors should read this.",
      "",
      '<h2 id="rules">Rules</h2>',
      "",
      "A user agent must block it.",
      "",
      '<p class="note">Note: a page may opt out.</p>',
    ].join("\n");
    const strict = extractNormative(text);
    expect(strict.paragraphs.map((p) => [p.section, p.text])).toEqual([
      ["rules", "A user agent must block it."],
    ]);
    expect(strict.skipped).toBe(2);
    expect(extractNormative(text, { all: true }).paragraphs).toHaveLength(3);
  });

  it("sélectionne par numéro, par id ou par fragment de titre", () => {
    const text = [
      "### 9.2 Server-sent events",
      "#### 9.2.6 Interpreting an event stream",
      "Lines must be processed in order.",
      "## 6 Directives",
      '<h4 id="directive-object-src">`object-src`</h4>',
      "Plugin content MUST be blocked.",
    ].join("\n");
    const sections = (sel) =>
      extractNormative(text, { sections: [sel] }).paragraphs.map(
        (p) => p.section,
      );
    expect(sections("9.2.6")).toEqual(["9.2.6"]);
    expect(sections("9.2")).toEqual(["9.2.6"]);
    expect(sections("directive-object-src")).toEqual(["directive-object-src"]);
    expect(sections("interpreting")).toEqual(["9.2.6"]);
  });

  it("lit une spec WHATWG du corpus (SSE §9.2.6) en minuscules", () => {
    const text = readFileSync(
      path.join(CORPUS, "specs", "whatwg-sse.md"),
      "utf8",
    );
    expect(detectFormat(text)).toBe("markdown");
    const { paragraphs } = extractNormative(text, { sections: ["9.2.6"] });
    expect(paragraphs.map((p) => p.text)).toContain(
      "Streams must be decoded using the UTF-8 decode algorithm.",
    );
  });
});

// Les processus partent ensemble : un seul démarrage à attendre, pas quatre.
const run = (args) =>
  new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], (error, stdout, stderr) =>
      resolve({ status: error === null ? 0 : error.code, stdout, stderr }),
    );
  });

describe("normative — ligne de commande", () => {
  it("rend les paragraphes numérotés, et refuse une section introuvable ou un usage faux", async () => {
    const [ok, missing, bogus, badCase] = await Promise.all([
      run([rfc(9110), "--section", "13.1.5"]),
      run([rfc(9110), "--section", "99.9"]),
      run(["--bogus"]),
      run([rfc(9110), "--case", "lower"]),
    ]);
    expect(ok.status).toBe(0);
    expect(ok.stdout.split("\n")[0]).toMatch(
      /^\[1\] §13\.1\.5 — A client MUST NOT/,
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("99.9");
    expect(bogus.status).toBe(2);
    expect(badCase.status).toBe(2);
  });
});
