import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { BootConfigurationError, Container, Event } from "nodefony";
import type { Module } from "nodefony";
import type { ContextType } from "@nodefony/http";
import { Firewall } from "../../nodefony/service/firewall";
import {
  parseCsp,
  mergeCspFragments,
  type CspFragment,
} from "../../nodefony/src/csp";
import { SecurityHeaders } from "../../nodefony/service/securityHeaders";
import { securityConfigSchema } from "../../nodefony/config/config";

/**
 * Red-team de la CSP par défaut (#699) — passe 1, écrite depuis la MENACE (matrice
 * publiée sur le ticket), sans lecture préalable de la logique de `csp.ts`.
 * Normes citées : corpus figé `.claude/skills/nodefony-rfc/references/csp/`.
 *
 * Un rouge ici est une faille trouvée, pas un test à ajuster.
 */

const BASE =
  "default-src 'self'; script-src 'self' 'nonce-{{nonce}}'; connect-src 'self'";

/** Directives de la sortie, par nom — ce que le navigateur retiendra. */
const directivesOf = (policy: string): Map<string, string[]> => {
  const out = new Map<string, string[]>();
  for (const raw of policy.split(";")) {
    const [name, ...sources] = raw.trim().split(/\s+/);
    // w3c-csp3.bs:515-518 — une directive en double est IGNORÉE : la première gagne.
    if (name && !out.has(name.toLowerCase())) {
      out.set(name.toLowerCase(), sources);
    }
  }
  return out;
};

/**
 * Invariant d'une fusion sûre : soit elle REFUSE le fragment, soit sa sortie ne
 * contient ni virgule (w3c-csp3.bs:471 — la virgule sépare deux politiques), ni
 * directive que personne n'a demandée, ni source ajoutée à `script-src`.
 */
const assertNoInjection = (fragments: CspFragment[]): void => {
  let out: string;
  try {
    out = mergeCspFragments(BASE, fragments);
  } catch {
    return; // refus au démarrage : verdict attendu
  }
  assert.ok(!out.includes(","), `virgule dans la politique fusionnée : ${out}`);
  const got = directivesOf(out);
  assert.deepEqual(
    got.get("script-src"),
    ["'self'", "'nonce-{{nonce}}'"],
    `script-src altéré : ${out}`,
  );
  const allowed = new Set(["default-src", "script-src", "connect-src"]);
  for (const name of got.keys()) {
    assert.ok(allowed.has(name), `directive injectée « ${name} » : ${out}`);
  }
};

describe("CSP red-team — B2 injection dans la fusion des contributions", () => {
  it("contrôle positif : une origine exacte passe, et arrive dans connect-src", () => {
    const out = mergeCspFragments(BASE, [
      { "connect-src": ["wss://rt.example.com:8443"] },
    ]);
    assert.deepEqual(directivesOf(out).get("connect-src"), [
      "'self'",
      "wss://rt.example.com:8443",
    ]);
  });

  it("une source portant `;` n'injecte pas de directive", () => {
    assertNoInjection([
      {
        "connect-src": [
          "https://a.example; frame-src *; report-uri https://evil.example",
        ],
      },
    ]);
  });

  it("une source portant `,` ne coupe pas la politique en deux", () => {
    assertNoInjection([{ "connect-src": ["https://a.example, frame-src *"] }]);
  });

  it("un NOM de directive portant `;` n'injecte pas de directive", () => {
    assertNoInjection([{ "connect-src; frame-src": ["*"] }]);
  });

  it("une source portant un saut de ligne ne passe pas dans l'en-tête", () => {
    let out: string | undefined;
    try {
      out = mergeCspFragments(BASE, [
        { "connect-src": ["https://a.example\r\nSet-Cookie: x=1"] },
      ]);
    } catch {
      return;
    }
    assert.ok(!/[\r\n]/.test(out), "CR/LF dans la politique fusionnée");
  });

  it("@Csp par route : même invariant sur cspForExtra", () => {
    const sh = new SecurityHeaders({
      enabled: true,
      csp: BASE,
      cspNonces: true,
      referrerPolicy: "no-referrer",
    });
    let out: string | undefined;
    try {
      out = sh.cspForExtra("N0nce==", {
        "img-src": ["https://cdn.example; frame-src *"],
      });
    } catch {
      return;
    }
    assert.ok(!out.includes(","), out);
    const got = directivesOf(out);
    assert.deepEqual(got.get("script-src"), ["'self'", "'nonce-N0nce=='"]);
    const allowed = new Set([
      "default-src",
      "script-src",
      "connect-src",
      "img-src",
    ]);
    for (const name of got.keys()) {
      assert.ok(allowed.has(name), `directive injectée « ${name} » : ${out}`);
    }
  });
});

/** Pare-feu réel sur la config par défaut (en-têtes actifs, nonce actif). */
const firewall = (): Firewall => {
  const container = new Container();
  // Noyau minimal : le pare-feu compile sa config sur `onBoot`.
  const kernel = new EventEmitter();
  container.set("kernel", kernel);
  const fw = new Firewall({
    container,
    notificationsCenter: new Event(),
    options: {},
  } as unknown as Module);
  kernel.emit("onBoot");
  return fw;
};

/** La CSP que le pare-feu pose sur une réponse. */
const cspOf = (fw: Firewall): string => {
  const headers: Record<string, string> = {};
  fw.applySecurityHeaders({
    cspNonce: "N0nce==",
    cspDirectives: null,
    response: {
      setHeader: (name: string, value: string) => {
        headers[name] = value;
      },
    },
  } as unknown as ContextType);
  return headers["Content-Security-Policy"] ?? "";
};

describe("CSP red-team — B2 au pare-feu : le travail est fait UNE fois", () => {
  it("un fragment refusé lève et n'empoisonne pas les enregistrements suivants", () => {
    const fw = firewall();
    assert.throws(
      () =>
        fw.registerCspOrigins("bad", {
          "connect-src": ["https://a.example; frame-src *"],
        }),
      BootConfigurationError,
    );
    fw.registerCspOrigins("realtime", { "connect-src": ["wss://old.example"] });
    // Remplacement = recomposition complète depuis TOUS les fragments rangés :
    // un fragment refusé mais rangé quand même ferait lever ici.
    fw.registerCspOrigins("realtime", { "connect-src": ["wss://rt.example"] });
    const csp = cspOf(fw);
    assert.ok(csp.includes("wss://rt.example"), csp);
    assert.ok(!csp.includes("frame-src"), csp);
  });

  it("ajout incrémental, remplacement et retrait rendent la même politique qu'une recomposition", () => {
    const fw = firewall();
    fw.registerCspOrigins("a", { "connect-src": ["wss://a.example"] });
    fw.registerCspOrigins("b", { "connect-src": ["wss://b.example"] });
    fw.registerCspOrigins("a", { "connect-src": ["wss://a2.example"] });
    let connect = directivesOf(cspOf(fw)).get("connect-src");
    assert.deepEqual(connect, [
      "'self'",
      "wss://a2.example",
      "wss://b.example",
    ]);
    fw.unregisterCspOrigins("a2-inconnu");
    fw.unregisterCspOrigins("a");
    connect = directivesOf(cspOf(fw)).get("connect-src");
    assert.deepEqual(connect, ["'self'", "wss://b.example"]);
  });

  it("@Csp : la fusion d'une route est faite une fois, puis servie du cache", () => {
    const sh = new SecurityHeaders({
      enabled: true,
      csp: BASE,
      cspNonces: true,
      referrerPolicy: "no-referrer",
    });
    // Objet NON figé, muté après le premier passage : s'il était refusionné,
    // la source invalide lèverait.
    const extra: Record<string, string[]> = {
      "img-src": ["https://cdn.example"],
    };
    const first = sh.cspForExtra("N1", extra);
    extra["img-src"] = ["https://cdn.example; frame-src *"];
    const second = sh.cspForExtra("N2", extra);
    assert.equal(second, first.replace("N1", "N2"));
  });
});

describe("CSP — une seule écriture de l'en-tête par réponse", () => {
  // Un `setHeader` de CSP coûte ~0,7 µs (valeur validée caractère par
  // caractère) : l'écrire deux fois double ce coût sur chaque réponse.
  const writes = (
    options: Record<string, unknown>,
    cspDirectives: CspFragment | null,
  ): { count: number; value: string } => {
    const container = new Container();
    const kernel = new EventEmitter();
    container.set("kernel", kernel);
    const fw = new Firewall({
      container,
      notificationsCenter: new Event(),
      options,
    } as unknown as Module);
    kernel.emit("onBoot");
    let count = 0;
    let value = "";
    fw.applySecurityHeaders({
      cspNonce: "N0nce==",
      cspDirectives,
      response: {
        setHeader: (name: string, v: string) => {
          if (name === "Content-Security-Policy") {
            count += 1;
            value = v;
          }
        },
      },
    } as unknown as ContextType);
    return { count, value };
  };
  const route: CspFragment = Object.freeze({
    "frame-src": ["https://www.youtube.com"],
  });

  for (const [label, options] of [
    ["nonce actif", {}],
    ["nonce coupé", { headers: { cspNonces: false } }],
  ] as const) {
    it(`${label}, route ordinaire : une écriture`, () => {
      assert.equal(writes(options, null).count, 1);
    });
    it(`${label}, route @Csp : une écriture, qui porte la directive de la route`, () => {
      const w = writes(options, route);
      assert.equal(w.count, 1);
      assert.ok(w.value.includes("frame-src https://www.youtube.com"), w.value);
    });
  }
});

describe("CSP red-team — B3 origine trop large déclarée par un module", () => {
  // Moindre privilège : un module déclare SON origine. Une source de schéma ou `*`
  // ouvre connect-src à tout l'internet (canal d'exfiltration après une XSS).
  // EN ATTENTE de la décision 3 de #699 (refuser, ou signaler au démarrage) :
  // `it.fails` documente le trou sans casser la suite, et VIRE AU ROUGE le jour
  // où la garde arrive — ce qui oblige à retirer le marqueur.
  for (const source of ["*", "wss:", "https:", "ws:", "http:"]) {
    it.fails(`« ${source} » dans connect-src est refusé`, () => {
      assert.throws(
        () => mergeCspFragments(BASE, [{ "connect-src": [source] }]),
        BootConfigurationError,
        `« ${source} » accepté sans un mot`,
      );
    });
  }
});

describe("CSP red-team — B4 politique par défaut, script-src", () => {
  const csp = securityConfigSchema.parse({}).headers.csp;
  const script = directivesOf(csp).get("script-src") ?? [];

  it("le défaut ne contient ni 'unsafe-eval' ni 'unsafe-inline' dans script-src", () => {
    assert.ok(!script.includes("'unsafe-eval'"), csp);
    assert.ok(!script.includes("'unsafe-inline'"), csp);
  });

  it("le défaut porte un nonce dans script-src", () => {
    assert.ok(
      script.some((s) => s.startsWith("'nonce-")),
      csp,
    );
  });

  it("le défaut ne contient aucune virgule (une seule politique)", () => {
    assert.ok(!csp.includes(","), csp);
  });

  it("parseCsp relit le défaut sans perte de directive", () => {
    assert.equal(parseCsp(csp).length, directivesOf(csp).size);
  });
});
