/// <reference types="node" />
import { expect } from "vitest";
import { describe, it } from "vitest";
import {
  splitTarget,
  isCanonicalAuthority,
} from "../../src/context/http/urlFastPath.js";

/**
 * PREUVE du fast-path F-B : la découpe n'est admise que si elle est
 * l'IDENTITÉ du parse WHATWG. Trois familles :
 *
 * 1. ÉQUIVALENCE EXHAUSTIVE par caractère (0x00-0x7F + témoins Unicode) :
 *    tout target/host ACCEPTÉ doit donner pathname/search/href STRICTEMENT
 *    identiques au vrai `new URL` — c'est ce qui verrouille les tables.
 * 2. REFUS DE SÉCURITÉ : les motifs que WHATWG TRANSFORME (dot-segments,
 *    percent, backslash, IPv4-like, casse du host…) doivent être refusés —
 *    et le test prouve que la transformation existe (le refus est justifié).
 * 3. ACCEPTATION NOMINALE : les targets/hosts du trafic réel DOIVENT être
 *    acceptés — sinon le fast-path est mort et personne ne le voit.
 */

const BASE_HOST = "h";

function urlOf(target: string): URL {
  return new URL(`http://${BASE_HOST}${target}`);
}

describe("urlFastPath — splitTarget", () => {
  it("équivalence WHATWG exhaustive par caractère (path)", () => {
    let accepted = 0;
    for (let c = 0; c <= 0x7f; c++) {
      const ch = String.fromCharCode(c);
      const target = `/a${ch}b`;
      const split = splitTarget(target);
      if (split === null) {
        continue;
      }
      accepted++;
      const u = urlOf(target);
      expect(u.pathname, `pathname pour 0x${c.toString(16)}`).to.equal(
        split.pathname,
      );
      expect(u.search, `search pour 0x${c.toString(16)}`).to.equal(
        split.search,
      );
      expect(u.href, `href pour 0x${c.toString(16)}`).to.equal(
        `http://${BASE_HOST}${target}`,
      );
    }
    // Garde anti-« tout refuser » : l'essentiel des pchars doit passer.
    expect(accepted).to.be.greaterThan(60);
  });

  it("équivalence WHATWG exhaustive par caractère (search)", () => {
    let accepted = 0;
    for (let c = 0; c <= 0x7f; c++) {
      const ch = String.fromCharCode(c);
      const target = `/p?a${ch}b`;
      const split = splitTarget(target);
      if (split === null) {
        continue;
      }
      accepted++;
      const u = urlOf(target);
      expect(u.pathname, `pathname pour 0x${c.toString(16)}`).to.equal(
        split.pathname,
      );
      expect(u.search, `search pour 0x${c.toString(16)}`).to.equal(
        split.search,
      );
      expect(u.href, `href pour 0x${c.toString(16)}`).to.equal(
        `http://${BASE_HOST}${target}`,
      );
    }
    expect(accepted).to.be.greaterThan(70);
  });

  it("témoins non-ASCII : toujours refusés (WHATWG percent-encode)", () => {
    for (const t of ["/café", "/a?x=é", "/日本", "/a b"]) {
      expect(splitTarget(t), t).to.equal(null);
    }
  });

  it("refus de SÉCURITÉ : tout motif que WHATWG transforme", () => {
    // [target, pourquoi] — chaque refus est JUSTIFIÉ : le parse WHATWG rend
    // un pathname DIFFÉRENT du brut (une découpe l'aurait exposé au routing).
    const dangerous: string[] = [
      "/a/../b",
      "/a/./b",
      "/..",
      "/.",
      "/a/..",
      "/a/.",
      "/%2e%2e/b",
      "/a/%2E%2E/b",
      "/a%2Fb/../c",
      "/a\\..\\b",
      "/a\\b",
      "/a b",
      "/a%20b/../c",
    ];
    for (const t of dangerous) {
      expect(splitTarget(t), `doit refuser ${JSON.stringify(t)}`).to.equal(
        null,
      );
      // La justification : brute ≠ normalisée (ou le motif est un dot/percent
      // que WHATWG résout). Tolère les cas où new URL garde la forme mais où
      // le refus reste conservateur (aucun ici ne doit matcher à l'identique).
      const u = urlOf(t);
      expect(
        u.pathname + u.search,
        `WHATWG doit transformer ${JSON.stringify(t)}`,
      ).to.not.equal(t);
    }
  });

  it("refus structurels (conservateurs ou hors origin-form)", () => {
    for (const t of [
      "",
      "*",
      "http://evil/",
      "//",
      "//x",
      "/a//b",
      "/a#f",
      "/#",
      "/.well-known/x", // faux positif assumé (bail-out = chemin d'avant)
      "/...",
      undefined,
      null,
      42,
    ]) {
      expect(splitTarget(t), String(t)).to.equal(null);
    }
  });

  it("acceptation NOMINALE : le trafic réel passe par la découpe", () => {
    const nominal: Array<[string, string, string]> = [
      ["/", "/", ""],
      ["/nodefony/kernel/bench", "/nodefony/kernel/bench", ""],
      ["/api/users/123", "/api/users/123", ""],
      ["/a-b_c.json", "/a-b_c.json", ""],
      ["/x?a=1&b=2", "/x", "?a=1&b=2"],
      ["/x?q=%C3%A9", "/x", "?q=%C3%A9"],
      ["/x?arr[]=1&arr[]=2", "/x", "?arr[]=1&arr[]=2"],
      ["/x?", "/x", ""], // query vide : URL.search === "" aussi
      ["/x?b?c", "/x", "?b?c"],
      ["/x?next=/after&x=~y", "/x", "?next=/after&x=~y"],
      ["/deep/1/2/3/4/", "/deep/1/2/3/4/", ""],
      ["/a.b/c", "/a.b/c", ""],
      ["/v1.2/x", "/v1.2/x", ""],
      ["/@scope/pkg", "/@scope/pkg", ""],
      ["/x?redirect=https://ok.io/cb", "/x", "?redirect=https://ok.io/cb"],
    ];
    for (const [t, pathname, search] of nominal) {
      const split = splitTarget(t);
      expect(split, `doit accepter ${t}`).to.not.equal(null);
      expect(split?.pathname).to.equal(pathname);
      expect(split?.search).to.equal(search);
      // Et l'équivalence WHATWG tient aussi sur ces cas.
      const u = urlOf(t);
      expect(u.pathname).to.equal(pathname);
      expect(u.search).to.equal(search);
    }
  });
});

describe("urlFastPath — isCanonicalAuthority", () => {
  it("équivalence WHATWG exhaustive par caractère (host)", () => {
    let accepted = 0;
    for (let c = 0x21; c <= 0x7f; c++) {
      const ch = String.fromCharCode(c);
      const host = `ho${ch}st.com`;
      if (!isCanonicalAuthority(host, "http")) {
        continue;
      }
      accepted++;
      // Accepté ⇒ new URL ne throw PAS et rend l'autorité TELLE QUELLE.
      const u = new URL(`http://${host}/`);
      expect(u.host, `host pour 0x${c.toString(16)}`).to.equal(host);
      expect(u.href).to.equal(`http://${host}/`);
    }
    expect(accepted).to.be.greaterThan(20);
  });

  it("acceptés nominaux — et WHATWG les garde à l'identique", () => {
    const cases: Array<[string, string]> = [
      ["localhost", "http"],
      ["localhost:5151", "http"],
      ["127.0.0.1", "http"],
      ["127.0.0.1:5151", "http"],
      ["example.com", "https"],
      ["web-1.example.io", "https"],
      ["my_host", "http"],
      ["example.com:8443", "https"],
      ["example.com:81", "http"],
      ["example.com:80", "https"], // 80 n'est le défaut QUE de http
      ["example.com:443", "http"],
      ["xn--caf-dma.fr", "http"],
    ];
    for (const [host, scheme] of cases) {
      expect(
        isCanonicalAuthority(host, scheme),
        `doit accepter ${host} (${scheme})`,
      ).to.equal(true);
      const u = new URL(`${scheme}://${host}/`);
      expect(u.host, host).to.equal(host);
    }
  });

  it("refusés — casse, IPv4-like, IPv6, ports par défaut, labels vides", () => {
    const cases: Array<[string, string]> = [
      ["EXAMPLE.com", "http"],
      ["Example.com:5151", "http"],
      ["example.com:443", "https"], // WHATWG élide le port par défaut
      ["example.com:80", "http"],
      ["example.com:0443", "https"], // zéro de tête → 443 → élidé
      ["example.com:", "http"],
      ["host:12:34", "http"],
      ["127.1", "http"], // WHATWG → 127.0.0.1
      ["0x7f.0.0.1", "http"], // forme hex
      ["2130706433", "http"], // entier 32 bits
      ["1.2.3.4.5", "http"], // new URL THROW
      ["256.1.1.1", "http"], // new URL THROW
      ["010.0.0.1", "http"], // forme octale
      ["[::1]", "http"],
      ["[::1]:5151", "http"],
      ["a..b", "http"],
      [".a", "http"],
      ["a.", "http"],
      ["", "http"],
      ["café.fr", "http"], // punycode
      ["h%6fst", "http"], // percent-encoding
    ];
    for (const [host, scheme] of cases) {
      expect(
        isCanonicalAuthority(host, scheme),
        `doit refuser ${JSON.stringify(host)} (${scheme})`,
      ).to.equal(false);
    }
  });

  it("refus JUSTIFIÉS : WHATWG transforme bien ces autorités", () => {
    // Le sous-ensemble « transformé sans throw » — la preuve que le refus
    // protège le matching (host normalisé ≠ host brut).
    const transformed: Array<[string, string]> = [
      ["EXAMPLE.com", "example.com"],
      ["example.com:443", "example.com"], // https
      ["127.1", "127.0.0.1"],
      ["0x7f.0.0.1", "127.0.0.1"],
      ["2130706433", "127.0.0.1"],
      ["010.0.0.1", "8.0.0.1"], // octal
      ["café.fr", "xn--caf-dma.fr"],
    ];
    for (const [host, normalized] of transformed) {
      const scheme = host.includes(":443") ? "https" : "http";
      const u = new URL(`${scheme}://${host}/`);
      expect(u.host, host).to.equal(normalized);
    }
  });
});

// #508 — le décompte des labels ne passe plus par `split(".")`. L'oracle est
// l'implémentation d'AVANT, recopiée telle quelle : sur un corpus combinatoire
// (labels numériques, zéros de tête, hex, vides, ports) et un fuzz déterministe,
// le verdict doit être IDENTIQUE — la moindre divergence ouvre ou ferme le
// fast-path sur une autorité que WHATWG transformerait.
describe("urlFastPath — isCanonicalAuthority, équivalence avec la version à split (#508)", () => {
  const ORACLE_HOST_SAFE = new Uint8Array(128);
  for (let c = 0; c < 128; c++) {
    if (/[a-z0-9\-._]/.test(String.fromCharCode(c))) ORACLE_HOST_SAFE[c] = 1;
  }
  const oracleIsDigits = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x30 || c > 0x39) return false;
    }
    return true;
  };
  function oracle(host: unknown, scheme: string): boolean {
    if (typeof host !== "string" || host.length === 0) return false;
    let colon = -1;
    for (let i = 0; i < host.length; i++) {
      const c = host.charCodeAt(i);
      if (c === 0x3a) {
        if (colon !== -1) return false;
        colon = i;
        continue;
      }
      if (
        c >= 128 ||
        (colon === -1 ? ORACLE_HOST_SAFE[c] === 0 : c < 0x30 || c > 0x39)
      ) {
        return false;
      }
    }
    const name = colon === -1 ? host : host.slice(0, colon);
    if (name.length === 0) return false;
    if (colon !== -1) {
      const port = host.slice(colon + 1);
      if (port.length === 0 || port.charCodeAt(0) === 0x30) return false;
      if (
        (scheme === "https" && port === "443") ||
        (scheme === "http" && port === "80")
      ) {
        return false;
      }
    }
    const labels = name.split(".");
    for (const label of labels) if (label.length === 0) return false;
    const last = labels.at(-1) ?? "";
    if (oracleIsDigits(last)) {
      if (labels.length !== 4) return false;
      for (const label of labels) {
        if (!oracleIsDigits(label) || label.length > 3) return false;
        if (label.length > 1 && label.charCodeAt(0) === 0x30) return false;
        if (Number(label) > 255) return false;
      }
    }
    return true;
  }

  it("corpus combinatoire : 1 à 5 labels, avec et sans port", () => {
    const parts = [
      "",
      "0",
      "00",
      "1",
      "01",
      "9",
      "10",
      "99",
      "100",
      "255",
      "256",
      "999",
      "1000",
      "a",
      "0x7f",
      "1a",
      "a-b",
      "_",
    ];
    const ports = ["", ":5151", ":80", ":443", ":0", ":"];
    let checked = 0;
    const diverging: string[] = [];
    const check = (prefix: string): void => {
      for (const port of ports) {
        const host = prefix + port;
        for (const scheme of ["http", "https"]) {
          if (isCanonicalAuthority(host, scheme) !== oracle(host, scheme)) {
            diverging.push(`${JSON.stringify(host)} (${scheme})`);
          }
          checked++;
        }
      }
    };
    const walk = (prefix: string, depth: number): void => {
      if (depth > 0) check(prefix);
      // 4 labels au plus sur l'alphabet complet (~41 000 autorités) : le
      // 5ᵉ label sur ce même arbre passait 3 millions de verdicts et 6 s sur
      // les runners de CI. Les 5 labels ont leur propre couche, plus bas.
      if (depth === 4) return;
      // au-delà de 3 labels, on restreint l'alphabet pour borner le corpus
      const alphabet = depth >= 3 ? SMALL : parts;
      for (const p of alphabet)
        walk(depth === 0 ? p : `${prefix}.${p}`, depth + 1);
    };
    const SMALL = ["", "1", "01", "255", "256", "a"];
    walk("", 0);
    // 5 labels, alphabet réduit à chaque rang (6⁵ = 7 776 autorités) : seule
    // couche différentielle où `1.2.3.4.5` et ses voisins sont confrontés à
    // l'oracle — le compte de labels d'une adresse numérique ne se juge qu'ici.
    const five = (prefix: string, depth: number): void => {
      if (depth === 5) {
        check(prefix);
        return;
      }
      for (const p of SMALL)
        five(depth === 0 ? p : `${prefix}.${p}`, depth + 1);
    };
    five("", 0);
    expect(diverging.slice(0, 20)).to.deep.equal([]);
    expect(checked).to.be.greaterThan(100_000);
  });

  it("fuzz déterministe : 50 000 autorités tirées dans « 0-9 . a x : - »", () => {
    let seed = 0x508b5;
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const alphabet = "0123456789..ax:-";
    const diverging: string[] = [];
    for (let n = 0; n < 50_000; n++) {
      const len = rand() % 16;
      let host = "";
      for (let i = 0; i < len; i++) host += alphabet[rand() % alphabet.length];
      for (const scheme of ["http", "https"]) {
        if (isCanonicalAuthority(host, scheme) !== oracle(host, scheme)) {
          diverging.push(`${JSON.stringify(host)} (${scheme})`);
        }
      }
    }
    expect(diverging.slice(0, 20)).to.deep.equal([]);
  });
});
