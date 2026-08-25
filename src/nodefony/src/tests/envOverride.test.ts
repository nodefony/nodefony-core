import assert from "node:assert";
import { writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  coerceEnvValue,
  parseNfEnvOverrides,
  applyResolvedPath,
  pathLooksSecret,
  editDistance,
  closestMatch,
  diagnoseResolveFailure,
} from "../config/envOverride";
import { defineEnv, envString } from "../config/index";
import Kernel from "../kernel/Kernel";
import Module from "../kernel/Module";
import { Nodefony } from "../Nodefony";

describe("envOverride — coerceEnvValue", () => {
  it("booléens explicites (pas de piège znv)", () => {
    assert.strictEqual(coerceEnvValue("true"), true);
    assert.strictEqual(coerceEnvValue("false"), false);
    assert.strictEqual(coerceEnvValue(" true "), true);
  });
  it("nombres entiers et décimaux", () => {
    assert.strictEqual(coerceEnvValue("300"), 300);
    assert.strictEqual(coerceEnvValue("-5"), -5);
    assert.strictEqual(coerceEnvValue("1.5"), 1.5);
  });
  it("CSV → tableau de chaînes (trim + vides retirés)", () => {
    assert.deepStrictEqual(coerceEnvValue("a, b ,c"), ["a", "b", "c"]);
  });
  it("JSON explicite tableau/objet", () => {
    assert.deepStrictEqual(coerceEnvValue("[1,2]"), [1, 2]);
    assert.deepStrictEqual(coerceEnvValue('{"x":1}'), { x: 1 });
  });
  it("JSON malformé → chaîne brute (valeur jamais perdue)", () => {
    assert.strictEqual(coerceEnvValue("[bad"), "[bad");
  });
  it("chaîne simple inchangée", () => {
    assert.strictEqual(coerceEnvValue("https://a.com"), "https://a.com");
  });
});

describe("envOverride — parseNfEnvOverrides", () => {
  it("extrait module + chemin (minuscules) + valeur coercée", () => {
    const out = parseNfEnvOverrides({
      NF__SECURITY__JWT__ACCESSTTLS: "300",
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].moduleSeg, "security");
    assert.deepStrictEqual(out[0].path, ["jwt", "accessttls"]);
    assert.strictEqual(out[0].value, 300);
  });
  it("ignore les clés hors préfixe et les NF__X sans champ", () => {
    const out = parseNfEnvOverrides({
      PATH: "/usr/bin",
      NF_LOG_DRIVER: "stdout", // catalogue (simple underscore) — pas un override
      NF__HTTP: "x", // module seul, pas de champ
      NF__HTTP__SERVERS__HTTPS__PORT: "8443",
    });
    assert.strictEqual(out.length, 1);
    assert.strictEqual(out[0].moduleSeg, "http");
    assert.deepStrictEqual(out[0].path, ["servers", "https", "port"]);
    assert.strictEqual(out[0].value, 8443);
  });
});

describe("envOverride — applyResolvedPath (résolution casse-insensible)", () => {
  it("surcharge une clé existante (camelCase) via un segment minuscule", () => {
    const target = { jwt: { accessTtlS: 900 } };
    const ok = applyResolvedPath(target, ["jwt", "accessttls"], 300);
    assert.strictEqual(ok, true);
    assert.strictEqual(target.jwt.accessTtlS, 300);
  });
  it("match exact prioritaire", () => {
    const target = { cors: { maxAgeS: 600 } };
    assert.strictEqual(
      applyResolvedPath(target, ["cors", "maxAgeS"], 60),
      true,
    );
    assert.strictEqual(target.cors.maxAgeS, 60);
  });
  it("chemin inconnu → false, cible inchangée (pas de clé fantôme)", () => {
    const target = { jwt: { accessTtlS: 900 } };
    const ok = applyResolvedPath(target, ["jwt", "nope"], 1);
    assert.strictEqual(ok, false);
    assert.deepStrictEqual(target, { jwt: { accessTtlS: 900 } });
  });
  it("refuse de traverser un non-objet", () => {
    const target = { jwt: 1 };
    assert.strictEqual(applyResolvedPath(target, ["jwt", "x"], 2), false);
  });
});

describe("envOverride — la valeur REMPLACÉE guide la conversion", () => {
  // Une variable d'environnement est TOUJOURS une chaîne ; c'est le schéma qui
  // sait ce qu'il attend. `coerceEnvValue` devine sans lui, et sa devinette
  // rendait un type FAUX qui échouait à la validation Zod : bug rouge du
  // dashboard, `NF__HTTP__TRUSTPROXY=1` → `Number(1)`, refusé par
  // `z.union([boolean, string, array])` — une variable DOCUMENTÉE cassait le
  // boot. La valeur déjà présente (le défaut du schéma) porte l'information
  // manquante, et `applyResolvedPath` est le seul endroit qui l'a sous la main.
  it("🔴 `1` sur une clé booléenne devient `true` (le bug qui cassait le boot)", () => {
    const target = { trustProxy: false };
    assert.strictEqual(
      applyResolvedPath(target, ["trustproxy"], coerceEnvValue("1"), "1"),
      true,
    );
    assert.strictEqual(target.trustProxy, true);
  });

  it("`0`, `on`, `off`, `yes`, `no` valent aussi sur une clé booléenne", () => {
    for (const [raw, attendu] of [
      ["0", false],
      ["on", true],
      ["off", false],
      ["yes", true],
      ["no", false],
      ["TRUE", true],
    ] as const) {
      const target = { enabled: !attendu };
      applyResolvedPath(target, ["enabled"], coerceEnvValue(raw), raw);
      assert.strictEqual(target.enabled, attendu, `${raw} → ${attendu}`);
    }
  });

  it("🔴 SÉCURITÉ : une CIDR sur une clé booléenne reste une chaîne, jamais `true`", () => {
    // Le piège de la conversion « vers le type existant » : `trustProxy` a pour
    // défaut `false` mais accepte AUSSI une CIDR. Convertir aveuglément vers le
    // type de la valeur remplacée transformerait `10.0.0.0/8` en `true`, soit
    // une confiance TOTALE envers les `X-Forwarded-*` — une faille ouverte par
    // le correctif d'un bug de boot. Seuls des littéraux booléens RECONNUS sont
    // convertis ; tout le reste garde la devinette.
    const target: { trustProxy: unknown } = { trustProxy: false };
    applyResolvedPath(
      target,
      ["trustproxy"],
      coerceEnvValue("10.0.0.0/8"),
      "10.0.0.0/8",
    );
    assert.strictEqual(target.trustProxy, "10.0.0.0/8");
  });

  it("🔴 une clé de type CHAÎNE ne devient pas un nombre", () => {
    // Même défaut, autre type : `headerServer` est `z.string().nullable()`, et
    // `NF__HTTP__HEADERSERVER=1` rendait `Number(1)` — refusé lui aussi.
    const target: { headerServer: unknown } = { headerServer: "nodefony" };
    applyResolvedPath(target, ["headerserver"], coerceEnvValue("1"), "1");
    assert.strictEqual(target.headerServer, "1");
  });

  it("sens négatif : les cibles NON ambiguës gardent la devinette", () => {
    // La garde ne doit mordre que là où la devinette se trompe. Un nombre reste
    // un nombre, et le CSV → tableau de l'exemple documenté
    // (`NF__SECURITY__CORS__ORIGINS=https://a.com,https://b.com`, défaut `[]`)
    // doit continuer de fonctionner — sinon on corrige un bug en en créant un.
    const nombre = { accessTtlS: 900 };
    applyResolvedPath(nombre, ["accessttls"], coerceEnvValue("300"), "300");
    assert.strictEqual(nombre.accessTtlS, 300);

    const liste: { origins: unknown } = { origins: [] };
    applyResolvedPath(
      liste,
      ["origins"],
      coerceEnvValue("https://a.com,https://b.com"),
      "https://a.com,https://b.com",
    );
    assert.deepStrictEqual(liste.origins, ["https://a.com", "https://b.com"]);
  });

  it("sens négatif : sans `raw`, le comportement est INCHANGÉ", () => {
    // Le paramètre est optionnel : tout appelant existant garde sa sémantique,
    // et la garde ne s'applique jamais par surprise.
    const target: { trustProxy: unknown } = { trustProxy: false };
    applyResolvedPath(target, ["trustproxy"], coerceEnvValue("1"));
    assert.strictEqual(target.trustProxy, 1);
  });
});

describe("envOverride — pathLooksSecret", () => {
  it("détecte les chemins sensibles", () => {
    assert.strictEqual(pathLooksSecret(["jwt", "secret"]), true);
    assert.strictEqual(pathLooksSecret(["webhooks", "encryptionKey"]), true);
    assert.strictEqual(pathLooksSecret(["jwt", "accessTtlS"]), false);
  });
});

describe("defineEnv — convention *_FILE (secret monté)", () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "nf-env-file-"));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("lit la valeur depuis le fichier pointé par <KEY>_FILE (newline final retiré)", () => {
    const f = join(dir, "secret");
    writeFileSync(f, "s3cr3t\n");
    const env = defineEnv(
      { NF_SECRET: envString({ optional: true }) },
      { NF_SECRET_FILE: f },
    );
    assert.strictEqual(env.NF_SECRET, "s3cr3t");
  });

  it("lève si KEY et KEY_FILE sont posés ensemble", () => {
    const f = join(dir, "secret2");
    writeFileSync(f, "x");
    assert.throws(
      () =>
        defineEnv(
          { NF_SECRET: envString({ optional: true }) },
          { NF_SECRET: "direct", NF_SECRET_FILE: f },
        ),
      /tous deux définis/,
    );
  });

  it("lève si le fichier est illisible", () => {
    assert.throws(
      () =>
        defineEnv(
          { NF_SECRET: envString({ optional: true }) },
          { NF_SECRET_FILE: join(dir, "absent") },
        ),
      /impossible/,
    );
  });
});

/**
 * Intégration sur un Kernel RÉEL (harness `configBoot.test.ts`) : prouve la chaîne
 * complète findModuleBySegment → applyResolvedPath sur `module.options`.
 */
describe("envOverride — intégration Kernel (NF__* au boot)", () => {
  let prev: Kernel | null;
  beforeAll(() => {
    prev = Nodefony.getKernel();
  });
  afterAll(() => {
    Nodefony.setKernel(prev as Kernel);
  });

  const makeKernel = (): Kernel =>
    new Kernel("development", null, { log: { active: false } });

  /** Module factice : seuls `name` + `options` sont lus par applyEnvConfigOverrides. */
  const fakeModule = (name: string, options: Record<string, unknown>) => ({
    name,
    options,
  });

  const applyEnv = (
    kernel: Kernel,
    modules: Record<string, unknown>,
    over: Record<string, string>,
  ): void => {
    (kernel as unknown as { modules: Record<string, unknown> }).modules =
      modules;
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(over)) saved[k] = process.env[k];
    Object.assign(process.env, over);
    try {
      (
        kernel as unknown as { applyEnvConfigOverrides(): void }
      ).applyEnvConfigOverrides();
    } finally {
      for (const k of Object.keys(over)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  };

  it("résout le module (basename) + le chemin (casse) et surcharge mod.options", () => {
    const mod = fakeModule("@nodefony/demo", {
      jwt: { accessTtlS: 900 },
      cors: { maxAgeS: 600 },
    });
    applyEnv(
      makeKernel(),
      { "@nodefony/demo": mod },
      { NF__DEMO__JWT__ACCESSTTLS: "300", NF__DEMO__CORS__MAXAGES: "60" },
    );
    assert.deepStrictEqual(mod.options, {
      jwt: { accessTtlS: 300 },
      cors: { maxAgeS: 60 },
    });
  });

  it("🔴 `NF__HTTP__TRUSTPROXY=1` pose `true` — le bug de boot, de bout en bout", () => {
    // Le test unitaire d'`applyResolvedPath` ne suffit PAS : il resterait vert
    // si le Kernel oubliait de transmettre la chaîne brute, et c'est le Kernel
    // qui fait foi au boot. On exerce donc le chemin réel, avec la vraie forme
    // de config d'`@nodefony/http` (défaut `false`, union boolean|string|array).
    const mod = fakeModule("@nodefony/http", {
      trustProxy: false,
      trustedHosts: false,
      headerServer: "nodefony",
    });
    applyEnv(
      makeKernel(),
      { "@nodefony/http": mod },
      {
        NF__HTTP__TRUSTPROXY: "1",
        NF__HTTP__TRUSTEDHOSTS: "0",
        NF__HTTP__HEADERSERVER: "1",
      },
    );
    assert.deepStrictEqual(mod.options, {
      trustProxy: true,
      trustedHosts: false,
      headerServer: "1",
    });
  });

  it("🔴 SÉCURITÉ (bout en bout) : une CIDR n'est jamais promue en `true`", () => {
    const mod = fakeModule("@nodefony/http", { trustProxy: false });
    applyEnv(
      makeKernel(),
      { "@nodefony/http": mod },
      { NF__HTTP__TRUSTPROXY: "10.0.0.0/8" },
    );
    assert.deepStrictEqual(mod.options, { trustProxy: "10.0.0.0/8" });
  });

  it("module/chemin inconnu = no-op (pas de crash, pas de clé fantôme)", () => {
    const mod = fakeModule("@nodefony/demo", { jwt: { accessTtlS: 900 } });
    applyEnv(
      makeKernel(),
      { "@nodefony/demo": mod },
      { NF__GHOST__X: "1", NF__DEMO__JWT__NOPE: "1" },
    );
    assert.deepStrictEqual(mod.options, { jwt: { accessTtlS: 900 } });
  });
});

// ─── « did you mean » : aide au debug d'un NF__* mal orthographié ──────────────

describe("envOverride — editDistance", () => {
  it("0 si identiques, n si l'une est vide", () => {
    assert.strictEqual(editDistance("abc", "abc"), 0);
    assert.strictEqual(editDistance("", "abc"), 3);
    assert.strictEqual(editDistance("abc", ""), 3);
  });
  it("compte insertions / substitutions", () => {
    assert.strictEqual(editDistance("securty", "security"), 1); // insertion
    assert.strictEqual(editDistance("kitten", "sitting"), 3);
  });
});

describe("envOverride — closestMatch", () => {
  it("propose le plus proche dans le seuil de plausibilité", () => {
    assert.strictEqual(
      closestMatch("securty", ["security", "http"]),
      "security",
    );
    assert.strictEqual(closestMatch("accesstl", ["accessTtlS"]), "accessTtlS");
  });
  it("insensible à la casse", () => {
    assert.strictEqual(closestMatch("HTTP", ["http", "framework"]), "http");
  });
  it("null si trop éloigné (pas de suggestion absurde)", () => {
    assert.strictEqual(closestMatch("zzzzzz", ["http", "security"]), null);
  });
  it("null si aucun candidat", () => {
    assert.strictEqual(closestMatch("x", []), null);
  });
});

describe("envOverride — diagnoseResolveFailure", () => {
  it("null si le chemin résout entièrement (pas un échec)", () => {
    const t = { jwt: { accessTtlS: 900 } };
    assert.strictEqual(diagnoseResolveFailure(t, ["jwt", "accessttls"]), null);
  });
  it("segment feuille inconnu → index + clés disponibles", () => {
    const t = { jwt: { accessTtlS: 900, refreshTtlS: 60 } };
    const d = diagnoseResolveFailure(t, ["jwt", "accesstl"]);
    assert.deepStrictEqual(d, {
      index: 1,
      segment: "accesstl",
      available: ["accessTtlS", "refreshTtlS"],
    });
  });
  it("segment intermédiaire inconnu → échoue au bon niveau (racine)", () => {
    const t = { jwt: { accessTtlS: 900 }, cors: {} };
    const d = diagnoseResolveFailure(t, ["jwtx", "accessttls"]);
    assert.strictEqual(d?.index, 0);
    assert.strictEqual(d?.segment, "jwtx");
    assert.deepStrictEqual(d?.available, ["jwt", "cors"]);
  });
  it("traverse un non-objet → échec signalé au segment porteur", () => {
    const t = { jwt: 1 };
    const d = diagnoseResolveFailure(t, ["jwt", "x"]);
    assert.strictEqual(d?.index, 0);
    assert.deepStrictEqual(d?.available, ["jwt"]);
  });
});

/**
 * Câblage Kernel : le WARNING d'un override `NF__*` qui ne résout pas porte bien
 * la suggestion « vouliez-vous dire X ? » (on capture `kernel.log`, indépendant du
 * niveau de log). Couvre les deux points d'échec : module + chemin.
 */
describe("envOverride — message enrichi (module/chemin proche)", () => {
  let prev: Kernel | null;
  beforeAll(() => {
    prev = Nodefony.getKernel();
  });
  afterAll(() => {
    Nodefony.setKernel(prev as Kernel);
  });

  const captureWarnings = (
    modules: Record<string, unknown>,
    over: Record<string, string>,
  ): string[] => {
    const kernel = new Kernel("development", null, { log: { active: false } });
    (kernel as unknown as { modules: Record<string, unknown> }).modules =
      modules;
    const warnings: string[] = [];
    (kernel as unknown as { log: (m: string, s?: string) => void }).log = (
      m: string,
      s?: string,
    ): void => {
      if (s === "WARNING") warnings.push(m);
    };
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(over)) saved[k] = process.env[k];
    Object.assign(process.env, over);
    try {
      (
        kernel as unknown as { applyEnvConfigOverrides(): void }
      ).applyEnvConfigOverrides();
    } finally {
      for (const k of Object.keys(over)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
    return warnings;
  };

  it("module mal tapé → « vouliez-vous dire « security » ? »", () => {
    const w = captureWarnings(
      { "@nodefony/security": { name: "@nodefony/security", options: {} } },
      { NF__SECURTY__JWT__ACCESSTTLS: "300" },
    );
    assert.strictEqual(w.length, 1);
    assert.match(w[0], /module "securty" introuvable/);
    assert.match(w[0], /vouliez-vous dire « security »/);
  });

  it("chemin mal tapé → segment fautif + clé proche + clés disponibles", () => {
    const w = captureWarnings(
      {
        "@nodefony/security": {
          name: "@nodefony/security",
          options: { jwt: { accessTtlS: 900, refreshTtlS: 60 } },
        },
      },
      { NF__SECURITY__JWT__ACCESSTL: "300" },
    );
    assert.strictEqual(w.length, 1);
    assert.match(w[0], /chemin "jwt\.accesstl" inconnu/);
    assert.match(w[0], /vouliez-vous dire « accessTtlS »/);
    assert.match(w[0], /clés: accessTtlS, refreshTtlS/);
  });
});

/**
 * Fail-closed E2E (gap Slice 3) : une valeur `NF__*` INVALIDE est-elle rejetée par
 * la validation du module à `onKernelRegister` ? Régime RÉEL vérifié au code
 * (`Kernel.isBootErrorFatal`) : la validation tourne APRÈS `applyModuleConfigOverrides`
 * (elle VOIT l'override), et l'échec est **fatal en production** (module critique →
 * le pod crashe → restart) mais **fail-soft + bruyant en développement** (WARNING +
 * BootReport, jamais un pass silencieux). On prouve les deux régimes + valeur valide.
 */
describe("envOverride — fail-closed (NF__* invalide rejeté par la validation module)", () => {
  let prev: Kernel | null;
  beforeAll(() => {
    prev = Nodefony.getKernel();
  });
  afterAll(() => {
    Nodefony.setKernel(prev as Kernel);
  });

  // onKernelRegister simule la validation Zod de defineXConfig : lève si port
  // n'est pas un nombre (ex. un override CSV/typo qui n'a pas coercé en number).
  class ValidatedModule extends Module {
    constructor(kernel: Kernel) {
      super("@nodefony/valcfg", kernel, "/tmp/valcfg", { port: 5152 });
    }
    override async onKernelRegister(): Promise<this> {
      const port = (this.options as { port: unknown }).port;
      if (typeof port !== "number") {
        throw new Error(
          `config invalide: port doit être un nombre (reçu ${typeof port})`,
        );
      }
      return this;
    }
  }

  const withEnv = async <T>(
    over: Record<string, string>,
    fn: () => Promise<T>,
  ): Promise<T> => {
    const saved: Record<string, string | undefined> = {};
    for (const k of Object.keys(over)) saved[k] = process.env[k];
    Object.assign(process.env, over);
    try {
      return await fn();
    } finally {
      for (const k of Object.keys(over)) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  };

  const makeKernel = (env: "development" | "production"): Kernel =>
    new Kernel(env, null, { log: { active: false } });

  const applyOverrides = (k: Kernel): void =>
    (
      k as unknown as { applyModuleConfigOverrides(): void }
    ).applyModuleConfigOverrides();

  it("valeur VALIDE : l'override traverse jusqu'à la validation (port coercé en nombre, 0 erreur)", async () => {
    const k = makeKernel("development");
    const mod = (await k.addModule(ValidatedModule)) as ValidatedModule;
    await withEnv({ NF__VALCFG__PORT: "8443" }, async () => {
      applyOverrides(k);
      const r = await k.fireLifecycle("onRegister", k);
      assert.strictEqual(r.errors.length, 0);
      assert.strictEqual((mod.options as { port: unknown }).port, 8443);
    });
  });

  it("prod : valeur INVALIDE → onKernelRegister lève → fireLifecycle REJETTE (fail-closed)", async () => {
    const k = makeKernel("production");
    await k.addModule(ValidatedModule);
    await withEnv({ NF__VALCFG__PORT: "abc" }, async () => {
      applyOverrides(k);
      await assert.rejects(
        () => k.fireLifecycle("onRegister", k),
        /port doit être un nombre/,
      );
    });
  });

  it("dev : valeur INVALIDE → fail-soft MAIS bruyant (erreur collectée + BootReport), jamais un pass silencieux", async () => {
    const k = makeKernel("development");
    await k.addModule(ValidatedModule);
    await withEnv({ NF__VALCFG__PORT: "abc" }, async () => {
      applyOverrides(k);
      const r = await k.fireLifecycle("onRegister", k);
      assert.strictEqual(r.errors.length, 1);
      assert.match(
        (r.errors[0].error as Error).message,
        /port doit être un nombre/,
      );
    });
    const report = k.getBootReport();
    assert.strictEqual(report.modulesSkipped.length, 1);
    assert.strictEqual(report.modulesSkipped[0].module, "@nodefony/valcfg");
  });
});
