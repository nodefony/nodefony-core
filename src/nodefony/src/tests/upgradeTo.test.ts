/**
 * `nodefony upgrade --to` (#873) : monter tous les paquets du framework d'un
 * geste, surcharges comprises, et l'outillage du gabarit avec eux.
 *
 * Le registre et l'installation sont INJECTÉS : aucun réseau, aucun `npm
 * install` — le test porte sur ce que la commande écrit et sur ce qu'elle
 * demande au système.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { isPlainObject } from "../runtime/isPlainObject";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { version } from "../../package.json";
import type { PackageManagerName } from "../Cli";
import {
  resolveUpgradeTarget,
  runUpgradeCommand,
  type IUpgradeIo,
} from "../cli/upgrade";
import {
  frameworkRangeChanges,
  packageOfKey,
  toolingRangeChanges,
} from "../cli/upgradeRanges";
import { SCAFFOLD_VERSIONS } from "../cli/scaffold/versions";

const jetables: string[] = [];
afterAll(() => {
  for (const d of jetables) rmSync(d, { recursive: true, force: true });
});

/** Le manifeste vécu : montée de la beta.6, surcharge écrite en dur. */
function manifesteBeta6(): Record<string, unknown> {
  return {
    name: "demo",
    dependencies: {
      nodefony: "^10.0.0-beta.6",
      "@nodefony/http": "^10.0.0-beta.6",
      "@nodefony/local": "workspace:*",
      lodash: "^4.17.0",
    },
    devDependencies: {
      "@nodefony/devkit": "^10.0.0-beta.6",
      vitest: "^4.0.0",
      typescript: "^5.9.0",
    },
    overrides: {
      "@nodefony/mongoose": "^10.0.0-beta.6",
      deepmerge: "$deepmerge",
      "@esbuild-kit/core-utils": { esbuild: "^0.28.2" },
      "@nodefony/user": { ".": "^10.0.0-beta.6" },
    },
    resolutions: { "**/@nodefony/redis": "10.0.0-beta.6" },
    pnpm: { overrides: { "@nodefony/ai": "*" } },
  };
}

describe("packageOfKey — le paquet visé par une clé de surcharge", () => {
  it.each([
    ["@nodefony/http", "@nodefony/http"],
    ["**/@nodefony/http", "@nodefony/http"],
    ["parent/@nodefony/http", "@nodefony/http"],
    ["@nodefony/http@^10", "@nodefony/http"],
    ["nodefony@^10", "nodefony"],
    ["@autre/nodefony", "@autre/nodefony"],
    ["nodefony-plugin", "nodefony-plugin"],
  ])("%s → %s", (cle, paquet) => {
    expect(packageOfKey(cle)).toBe(paquet);
  });
});

describe("frameworkRangeChanges — toutes les plages du framework à la même version", () => {
  it("réécrit dépendances, dépendances de dev et surcharges ; laisse le reste", () => {
    const data = manifesteBeta6();
    const changes = frameworkRangeChanges(data, "10.0.2", true);
    expect(changes.map((c) => `${c.field} ${c.name}`)).toEqual([
      "dependencies nodefony",
      "dependencies @nodefony/http",
      "devDependencies @nodefony/devkit",
      "overrides @nodefony/mongoose",
      "overrides @nodefony/user > .",
      "resolutions **/@nodefony/redis",
    ]);
    expect(data).toEqual({
      name: "demo",
      dependencies: {
        nodefony: "^10.0.2",
        "@nodefony/http": "^10.0.2",
        "@nodefony/local": "workspace:*",
        lodash: "^4.17.0",
      },
      // devkit reste une dépendance de DÉVELOPPEMENT.
      devDependencies: {
        "@nodefony/devkit": "^10.0.2",
        vitest: "^4.0.0",
        typescript: "^5.9.0",
      },
      overrides: {
        "@nodefony/mongoose": "^10.0.2",
        deepmerge: "$deepmerge",
        "@esbuild-kit/core-utils": { esbuild: "^0.28.2" },
        "@nodefony/user": { ".": "^10.0.2" },
      },
      // Une version épinglée le reste.
      resolutions: { "**/@nodefony/redis": "10.0.2" },
      // `*` est un choix, pas un retard.
      pnpm: { overrides: { "@nodefony/ai": "*" } },
    });
  });

  it("sans `apply`, juge sans écrire", () => {
    const data = manifesteBeta6();
    const avant = JSON.stringify(data);
    expect(frameworkRangeChanges(data, "10.0.2", false)).toHaveLength(6);
    expect(JSON.stringify(data)).toBe(avant);
  });

  it("une plage dont le plancher est la version visée est à jour, quelle que soit sa forme", () => {
    const data = {
      dependencies: { nodefony: "~10.0.2", "@nodefony/http": "10.0.2" },
    };
    expect(frameworkRangeChanges(data, "10.0.2", true)).toEqual([]);
  });
});

describe("toolingRangeChanges — l'outillage du gabarit monte avec le framework", () => {
  const planchers = {
    vitest: "^5.1.1",
    "better-sqlite3": "13.2.0",
    oxlint: "^1.94.0",
    prettier: "^3.10.1",
    typescript: "^6.0.3",
  };

  it("relève sous le plancher, réécrit l'épinglé, garde le plus haut, ne touche ni typescript ni le métier, n'ajoute rien", () => {
    const data = {
      dependencies: { "better-sqlite3": "13.0.3", lodash: "^4.17.0" },
      devDependencies: {
        vitest: "^4.1.0",
        oxlint: "^2.0.0",
        typescript: "^5.9.0",
      },
    };
    const changes = toolingRangeChanges(data, planchers, true);
    expect(changes).toEqual([
      {
        field: "dependencies",
        name: "better-sqlite3",
        from: "13.0.3",
        to: "13.2.0",
      },
      {
        field: "devDependencies",
        name: "vitest",
        from: "^4.1.0",
        to: "^5.1.1",
      },
    ]);
    expect(data).toEqual({
      dependencies: { "better-sqlite3": "13.2.0", lodash: "^4.17.0" },
      devDependencies: {
        vitest: "^5.1.1",
        oxlint: "^2.0.0",
        typescript: "^5.9.0",
      },
    });
  });

  it("le catalogue réel du gabarit se lit sans erreur", () => {
    const data = { devDependencies: { vitest: "^0.1.0" } };
    expect(toolingRangeChanges(data, SCAFFOLD_VERSIONS, false)).toHaveLength(1);
  });
});

describe("resolveUpgradeTarget — la version visée par --to", () => {
  const tags = { latest: "10.0.3", beta: "10.1.0-beta.1", vieux: "7.0.2" };
  const registre = (): Promise<Record<string, unknown> | null> =>
    Promise.resolve(tags);
  const horsLigne = (): Promise<Record<string, unknown> | null> =>
    Promise.resolve(null);

  it("une version exacte se prend telle quelle, sans registre", async () => {
    expect(await resolveUpgradeTarget("10.0.3", "10.0.2", horsLigne)).toEqual({
      version: "10.0.3",
    });
  });
  it("un canal se résout auprès du registre", async () => {
    expect(await resolveUpgradeTarget("beta", "10.0.2", registre)).toEqual({
      version: "10.1.0-beta.1",
    });
  });
  it("hors ligne, un canal ne se devine pas", async () => {
    const r = await resolveUpgradeTarget("latest", "10.0.2", horsLigne);
    expect(r).toMatchObject({ usage: false });
    expect("error" in r && r.error).toMatch(/registre injoignable/u);
  });
  it("un canal inconnu nomme ceux qui existent", async () => {
    const r = await resolveUpgradeTarget("rc", "10.0.2", registre);
    expect("error" in r && r.error).toMatch(/latest, beta, vieux/u);
  });
  it("une valeur qui n'est ni version ni canal est une faute de syntaxe", async () => {
    expect(await resolveUpgradeTarget("10", "10.0.2", registre)).toMatchObject({
      usage: true,
    });
  });
  it("🔴 refuse de descendre de majeure — jamais vers la 7", async () => {
    const r = await resolveUpgradeTarget("vieux", "10.0.2", registre);
    expect("error" in r && r.error).toMatch(/descend sous la majeure/u);
  });
});

describe("runUpgradeCommand --to / --check — la commande, système injecté", () => {
  let sortie = "";
  let erreurs = "";

  /** Une application montée de la beta.6, et un système qui consigne ce qu'on lui demande. */
  function decor(tags: Record<string, string> = { latest: "99.0.0" }): {
    racine: string;
    io: IUpgradeIo;
    installs: PackageManagerName[];
    relances: (readonly string[])[];
    manifeste: () => Record<string, unknown>;
  } {
    const racine = mkdtempSync(path.join(tmpdir(), "nf-upgrade-to-"));
    jetables.push(racine);
    writeFileSync(path.join(racine, "nodefony.config.ts"), "export {};\n");
    writeFileSync(
      path.join(racine, "package.json"),
      `${JSON.stringify(manifesteBeta6(), null, 2)}\n`,
    );
    const installs: PackageManagerName[] = [];
    const relances: (readonly string[])[] = [];
    const fetchImpl: typeof fetch = async () =>
      new Response(JSON.stringify({ "dist-tags": tags }), { status: 200 });
    return {
      racine,
      installs,
      relances,
      io: {
        env: {},
        fetchImpl,
        install: (_root, manager) => {
          installs.push(manager);
          return true;
        },
        handOff: (_root, _manager, args) => {
          relances.push(args);
          return 7;
        },
      },
      manifeste: () =>
        JSON.parse(readFileSync(path.join(racine, "package.json"), "utf8")),
    };
  }
  const argv = (racine: string, ...args: string[]): string[] => [
    "node",
    "nodefony",
    "upgrade",
    "--cwd",
    racine,
    ...args,
  ];

  afterEach(() => {
    vi.restoreAllMocks();
    sortie = "";
    erreurs = "";
  });
  const capturer = (): void => {
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      sortie += String(chunk);
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      erreurs += String(chunk);
      return true;
    });
  };

  it("--to la version installée : réécrit, installe UNE fois, rejoue ici sans relance", async () => {
    const d = decor();
    capturer();
    const code = await runUpgradeCommand(argv(d.racine, "--to", version), d.io);
    expect(code, erreurs).toBe(0);
    expect(d.installs).toEqual(["npm"]);
    expect(d.relances).toEqual([]);
    const m = d.manifeste();
    expect(m.dependencies).toMatchObject({ nodefony: `^${version}` });
    expect(m.devDependencies).toMatchObject({
      "@nodefony/devkit": `^${version}`,
      vitest: SCAFFOLD_VERSIONS.vitest,
      typescript: "^5.9.0",
    });
    expect(m.overrides).toMatchObject({ "@nodefony/mongoose": `^${version}` });
    expect(sortie).toMatch(/framework\s+6 plage\(s\) alignée\(s\)/u);
  });

  it("--to une AUTRE version : installe, puis passe la main au nodefony installé", async () => {
    const d = decor();
    // #874 : `allowScripts` complété AVANT l'installation — c'est elle qui
    // avertirait, et la passe relancée vient après.
    let vuALInstallation: unknown = null;
    capturer();
    const code = await runUpgradeCommand(argv(d.racine, "--to", "99.0.0"), {
      ...d.io,
      install: (root, manager, quiet) => {
        vuALInstallation = d.manifeste().allowScripts;
        return d.io.install(root, manager, quiet);
      },
    });
    expect(code).toBe(7);
    expect(vuALInstallation).toEqual({ esbuild: false, fsevents: false });
    expect(d.installs).toEqual(["npm"]);
    expect(d.relances).toEqual([
      ["upgrade", "--to", "99.0.0", "--after-install"],
    ]);
    expect(d.manifeste().dependencies).toMatchObject({ nodefony: "^99.0.0" });
  });

  it("--to un canal : résolu par le registre, et le gestionnaire de l'app est celui de son verrou", async () => {
    const d = decor({ latest: "99.0.0" });
    writeFileSync(path.join(d.racine, "pnpm-lock.yaml"), "");
    capturer();
    await runUpgradeCommand(argv(d.racine, "--to", "latest"), d.io);
    expect(d.installs).toEqual(["pnpm"]);
    expect(d.relances[0]).toEqual([
      "upgrade",
      "--to",
      "99.0.0",
      "--after-install",
    ]);
  });

  it("passe d'après installation sur une version qui n'est pas la cible : refus, rien d'installé", async () => {
    const d = decor();
    capturer();
    const code = await runUpgradeCommand(
      argv(d.racine, "--to", "99.0.0", "--after-install"),
      d.io,
    );
    expect(code).toBe(1);
    expect(d.installs).toEqual([]);
    expect(erreurs).toMatch(/n'a pas posé nodefony 99\.0\.0/u);
  });

  it("canal hors ligne : rien n'est écrit", async () => {
    const d = decor();
    const avant = readFileSync(path.join(d.racine, "package.json"), "utf8");
    capturer();
    const code = await runUpgradeCommand(argv(d.racine, "--to", "beta"), {
      ...d.io,
      fetchImpl: () => Promise.reject(new Error("hors ligne")),
    });
    expect(code).toBe(1);
    expect(readFileSync(path.join(d.racine, "package.json"), "utf8")).toBe(
      avant,
    );
    expect(d.installs).toEqual([]);
  });

  it("--check : nomme chaque plage en retard avec son champ, l'outillage sous le plancher, la version publiée — sans rien écrire", async () => {
    const d = decor();
    const avant = readFileSync(path.join(d.racine, "package.json"), "utf8");
    capturer();
    const code = await runUpgradeCommand(argv(d.racine, "--check"), d.io);
    expect(code).toBe(1);
    expect(readFileSync(path.join(d.racine, "package.json"), "utf8")).toBe(
      avant,
    );
    expect(d.installs).toEqual([]);
    expect(sortie).toMatch(
      /overrides @nodefony\/mongoose : \^10\.0\.0-beta\.6 → \^/u,
    );
    expect(sortie).toMatch(/devDependencies vitest : \^4\.0\.0 →/u);
    expect(sortie).toMatch(/nodefony upgrade --to 99\.0\.0/u);
  });

  it("--check en intégration continue : la version publiée n'est pas demandée au registre", async () => {
    const d = decor();
    let appels = 0;
    capturer();
    await runUpgradeCommand(argv(d.racine, "--check"), {
      ...d.io,
      env: { CI: "true" },
      fetchImpl: async () => {
        appels += 1;
        return new Response("{}", { status: 200 });
      },
    });
    expect(appels).toBe(0);
    expect(sortie).not.toMatch(/est publiée/u);
  });

  it("--help annonce la version publiée plus récente", async () => {
    const d = decor();
    capturer();
    const code = await runUpgradeCommand(
      ["node", "nodefony", "upgrade", "--help"],
      d.io,
    );
    expect(code).toBe(0);
    expect(sortie).toMatch(/nodefony upgrade --to 99\.0\.0/u);
  });

  // #874 : sans --to, la seule écriture au manifeste est `allowScripts`.
  it("sans --to, aucune plage ne bouge et rien ne s'installe — seul allowScripts se complète", async () => {
    const d = decor();
    const lire = (): Record<string, unknown> => {
      const v: unknown = JSON.parse(
        readFileSync(path.join(d.racine, "package.json"), "utf8"),
      );
      if (!isPlainObject(v)) throw new Error("package.json : pas un objet");
      return v;
    };
    const avant = lire();
    capturer();
    const code = await runUpgradeCommand(argv(d.racine), d.io);
    expect(code).toBe(0);
    expect(lire()).toEqual({
      ...avant,
      allowScripts: { esbuild: false, fsevents: false },
    });
    expect(d.installs).toEqual([]);
    expect(d.relances).toEqual([]);
  });
});
