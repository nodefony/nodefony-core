import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi, afterEach } from "vitest";
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
  CHAT_HISTORY_LIMIT,
} from "../nodefony/service/ChatService";
import {
  CHAT_LESSON_STEPS,
  extractRegion,
} from "../frontend/src/chat/lessonSteps";
import { LESSON_SOURCES } from "../frontend/src/chat/lessonSources";
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
 *  5. chaque extrait de code que cite la page du chat existe dans le fichier
 *     qu'elle nomme, et n'est pas vide ;
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

describe("demo — le code cité par la page du chat", () => {
  const cited = CHAT_LESSON_STEPS.flatMap((step) =>
    step.excerpts.map((excerpt) => ({ step: step.step, ...excerpt })),
  );

  it.each(cited)(
    "étape $step : la région $region existe dans $file, et n'est pas vide",
    ({ file, region }) => {
      // Le texte que la PAGE affiche (lu par Vite), pas une relecture à part.
      const code = extractRegion(LESSON_SOURCES[file], region);
      expect(code, `// #region ${region} absente de ${file}`).not.toBeNull();
      expect(code?.trim()).not.toBe("");
    },
  );

  it("désindente la région, et rend null si elle manque ou reste ouverte", () => {
    const source =
      "a\n  // #region x\n    un()\n      deux()\n  // #endregion\n";
    expect(extractRegion(source, "x")).toBe("un()\n  deux()");
    expect(extractRegion(source, "y")).toBeNull();
    expect(extractRegion("// #region x\nun()\n", "x")).toBeNull();
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
