/// <reference types="node" />
import { expect } from "chai";
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
