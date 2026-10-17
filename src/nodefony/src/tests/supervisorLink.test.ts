import assert from "node:assert/strict";
import { afterEach, beforeAll, afterAll, describe, it, vi } from "vitest";
import Kernel from "../kernel/Kernel";
import { Nodefony } from "../Nodefony";
import BootReporter from "../service/dev/BootReporter";
import {
  DEV_CHANNEL,
  DEV_CHILD_ENV,
  isDevChannelMessage,
  type DevChannelMessage,
  type IDevChannelEndpoint,
} from "../service/dev/devChannel";
import { CLEAR_SCREEN } from "../service/dev/outputMode";
import { isTerminal } from "../runtime/isTerminal";
import { SupervisorLink, type ISupervisorHost } from "../kernel/supervisorLink";
import { withFakeIpc, withoutIpc } from "./support/fakeIpc";

/**
 * Caractérisation de la famille « terminal & superviseur » du noyau (#488) :
 * le verdict terminal (`isTTY`), le rendu de démarrage (`startupOutputMode`),
 * la bannière de développement (`devHeader` / `printDevHeader`), les trois
 * drapeaux de propriété de l'écran écrits par le `BootReporter`, et les
 * émissions typées vers le superviseur. Les blocs « Kernel — … » ont été écrits
 * et vus verts sur le code d'ORIGINE, avant tout déplacement — SAUF le bloc
 * « émissions », qui caractérise le NOUVEAU contrat : sur l'origine, le
 * `BootReporter` exigeait une option `supervised` que ce bloc ne passe pas. Les
 * autres ne passent que par l'API publique du Kernel, donc ils tiennent quel
 * que soit l'endroit où vit l'implémentation.
 *
 * Les variables d'environnement se posent ici par leur NOM en variable
 * (`process.env[DEV_CHILD_ENV]`), jamais en clair : le relevé `.ai/ENV.md`
 * ancre le premier `process.env.NF_X` qu'il voit, et ce doit rester le produit.
 */

// `initCluster` écrit sur la sortie standard ; on ne veut rien à l'écran.
let origConsoleLog: typeof console.log;
beforeAll(() => {
  origConsoleLog = console.log;
  console.log = () => {};
});
afterAll(() => {
  console.log = origConsoleLog;
});

/** Le rendu demandé — le nom en variable, pour la raison dite en tête. */
const OUTPUT_ENV = "NF_OUTPUT";

/** Variables d'environnement que ces tests posent — restaurées après chacun. */
const ENV_KEYS = ["NF_NO_TTY", OUTPUT_ENV, "APP_ENV", "NF_ENV", DEV_CHILD_ENV];
const saved: Record<string, string | undefined> = {};
for (const key of ENV_KEYS) saved[key] = process.env[key];
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  vi.restoreAllMocks();
});

function mkKernel(env: "development" | "production" = "development"): Kernel {
  return new Kernel(env, null, { log: { active: false } });
}

describe("Kernel — isTTY (verdict terminal, posé une fois)", () => {
  it("NF_NO_TTY posé → false, quoi que dise la sortie", () => {
    process.env.NF_NO_TTY = "1";
    assert.strictEqual(mkKernel().isTTY, false);
  });

  it("sans NF_NO_TTY → le verdict d'isTerminal(process.stdout)", () => {
    delete process.env.NF_NO_TTY;
    assert.strictEqual(mkKernel().isTTY, isTerminal(process.stdout));
  });
});

describe("Kernel — startupOutputMode (lu à l'appel)", () => {
  it("NF_OUTPUT prime : json / plain", () => {
    const k = mkKernel();
    process.env[OUTPUT_ENV] = "json";
    assert.strictEqual(k.startupOutputMode(), "json");
    process.env[OUTPUT_ENV] = "plain";
    assert.strictEqual(k.startupOutputMode(), "plain");
  });

  it("sans NF_OUTPUT : human si isTTY, plain sinon — isTTY est lu à CHAQUE appel", () => {
    delete process.env[OUTPUT_ENV];
    const k = mkKernel();
    k.isTTY = true;
    assert.strictEqual(k.startupOutputMode(), "human");
    k.isTTY = false;
    assert.strictEqual(k.startupOutputMode(), "plain");
  });

  it("valeur inconnue → human (c'est la commande qui la refuse, pas le splash)", () => {
    process.env[OUTPUT_ENV] = "pastel";
    const k = mkKernel();
    k.isTTY = false;
    assert.strictEqual(k.startupOutputMode(), "human");
  });
});

describe("Kernel — devHeader / printDevHeader", () => {
  it("porte le projet, l'environnement, Node, le pid, le rôle cluster et le volet tty", () => {
    delete process.env.APP_ENV;
    delete process.env.NF_ENV;
    const k = mkKernel();
    k.projectName = "ARDOISE";
    k.isTTY = true;
    const header = k.devHeader();
    assert.ok(header.includes("ARDOISE"), "nom du projet");
    assert.ok(header.includes("development"), "environnement");
    assert.ok(header.includes(process.version), "version de Node");
    assert.ok(header.includes(`pid ${process.pid}`), "pid");
    assert.ok(header.includes(k.typeCluster), "rôle cluster");
    assert.ok(header.includes("tty"), "volet tty");
    assert.ok(!header.includes("sans tty"));
    if (Nodefony.version) {
      assert.ok(header.includes(Nodefony.version), "version du framework");
    }
  });

  it("isTTY est lu à l'appel : « sans tty » quand il tombe", () => {
    const k = mkKernel();
    k.isTTY = false;
    assert.ok(k.devHeader().includes("sans tty"));
  });

  it("l'axe de déploiement n'est affiché que s'il DIFFÈRE du mode runtime", () => {
    const k = mkKernel();
    process.env.APP_ENV = "development";
    delete process.env.NF_ENV;
    assert.ok(!k.devHeader().includes("development · development"));
    process.env.APP_ENV = "staging";
    assert.ok(k.devHeader().includes("development · staging"));
    delete process.env.APP_ENV;
    process.env.NF_ENV = "preprod";
    assert.ok(k.devHeader().includes("development · preprod"));
  });

  it("printDevHeader écrit exactement devHeader() sur la sortie standard", () => {
    const k = mkKernel();
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
    k.printDevHeader();
    assert.strictEqual(write.mock.calls.length, 1);
    assert.strictEqual(write.mock.calls[0]![0], k.devHeader());
  });

  it("frameworkVersion() est la version du paquet nodefony", () => {
    assert.strictEqual(mkKernel().frameworkVersion(), Nodefony.version);
  });
});

describe("Kernel — drapeaux de propriété de l'écran (écrits par BootReporter)", () => {
  it("valent false à la construction", () => {
    const k = mkKernel();
    assert.strictEqual(k.suppressBootBanners, false);
    assert.strictEqual(k.reporterOwnsHeader, false);
    assert.strictEqual(k.devHeaderDeferred, false);
  });

  it("se lisent et s'écrivent comme des champs, indépendamment l'un de l'autre", () => {
    const k = mkKernel();
    k.suppressBootBanners = true;
    assert.strictEqual(k.suppressBootBanners, true);
    assert.strictEqual(k.reporterOwnsHeader, false);
    k.devHeaderDeferred = true;
    k.devHeaderDeferred = false;
    assert.strictEqual(k.devHeaderDeferred, false);
    k.reporterOwnsHeader = true;
    assert.strictEqual(k.reporterOwnsHeader, true);
    assert.strictEqual(k.suppressBootBanners, true);
  });
});

/** Un BootReporter en rendu `plain`, hors terminal : rien d'animé, journal intact. */
function mkReporter(k: Kernel): BootReporter {
  return new BootReporter(k, {
    debug: false,
    tty: false,
    mode: "plain",
    reload: false,
    inspector: null,
  });
}

describe("Kernel — émissions vers le superviseur (NF_DEV_CHILD)", () => {
  it("enfant supervisé : attach() annonce l'étape, message du canal nf-dev, type boot-step", () => {
    process.env[DEV_CHILD_ENV] = "1";
    const k = mkKernel();
    const sent = withFakeIpc((log) => {
      mkReporter(k).attach();
      return log;
    });
    assert.strictEqual(sent.length, 1, "un seul envoi au attach()");
    const [message] = sent[0]!;
    assert.ok(
      isDevChannelMessage(message),
      "message reconnu par le garde du canal",
    );
    assert.strictEqual(message.channel, DEV_CHANNEL);
    assert.strictEqual(message.type, "boot-step");
  });

  it("sans NF_DEV_CHILD : rien ne part, même avec un canal IPC présent", () => {
    delete process.env[DEV_CHILD_ENV];
    const k = mkKernel();
    const sent = withFakeIpc((log) => {
      mkReporter(k).attach();
      return log;
    });
    assert.deepStrictEqual(sent, []);
  });

  it("enfant supervisé sans canal : rien ne part, rien ne casse", () => {
    process.env[DEV_CHILD_ENV] = "1";
    const k = mkKernel();
    withoutIpc(() => {
      assert.doesNotThrow(() => mkReporter(k).attach());
    });
  });
});

// ─── La classe extraite, devant un hôte et un canal fictifs ─────────────────

/** Hôte fictif : chaque valeur est MUTABLE, pour prouver la lecture à l'appel. */
function mkHost(over: Partial<ISupervisorHost> = {}): ISupervisorHost {
  return {
    environment: "development",
    isTTY: true,
    projectName: "ARDOISE",
    typeCluster: "master",
    cli: {},
    ...over,
  };
}

/** Canal fictif : compte les écouteurs posés, les envois, les relâchements. */
function mkEndpoint(withChannel = true): {
  endpoint: IDevChannelEndpoint;
  listeners: Set<(message: unknown) => void>;
  sent: DevChannelMessage[];
  unrefs: () => number;
} {
  const listeners = new Set<(message: unknown) => void>();
  const sent: DevChannelMessage[] = [];
  let unrefs = 0;
  const base = {
    on: (_event: "message", listener: (message: unknown) => void): void => {
      listeners.add(listener);
    },
    removeListener: (
      _event: "message",
      listener: (message: unknown) => void,
    ): void => {
      listeners.delete(listener);
    },
  };
  const endpoint: IDevChannelEndpoint = withChannel
    ? {
        ...base,
        connected: true,
        send: (message: DevChannelMessage): boolean => {
          sent.push(message);
          return true;
        },
        channel: {
          unref: (): void => {
            unrefs += 1;
          },
        },
      }
    : base;
  return { endpoint, listeners, sent, unrefs: () => unrefs };
}

/**
 * Construit un lien en imposant, le temps de la construction, l'identité du
 * processus : `supervised` se lit sur le VRAI `process.env`, une fois.
 */
function mkLink(opts: {
  supervised: boolean;
  host?: ISupervisorHost;
  env?: Record<string, string | undefined>;
  endpoint?: IDevChannelEndpoint;
}): SupervisorLink {
  const before = process.env[DEV_CHILD_ENV];
  if (opts.supervised) process.env[DEV_CHILD_ENV] = "1";
  else delete process.env[DEV_CHILD_ENV];
  try {
    return new SupervisorLink(
      opts.host ?? mkHost(),
      opts.env ?? {},
      opts.endpoint,
    );
  } finally {
    if (before === undefined) delete process.env[DEV_CHILD_ENV];
    else process.env[DEV_CHILD_ENV] = before;
  }
}

const BOOT_STEP: DevChannelMessage = {
  channel: DEV_CHANNEL,
  type: "boot-step",
  step: "Modules",
  done: 1,
  total: 5,
};

describe("SupervisorLink — le verdict `supervised`", () => {
  it("se constate UNE fois, à la construction, sur le vrai process.env", () => {
    assert.strictEqual(DEV_CHILD_ENV, "NF_DEV_CHILD");
    const link = mkLink({ supervised: false });
    assert.strictEqual(link.supervised, false);
    process.env[DEV_CHILD_ENV] = "1";
    assert.strictEqual(link.supervised, false, "figé à la construction");
    assert.strictEqual(new SupervisorLink(mkHost()).supervised, true);
    process.env[DEV_CHILD_ENV] = "0";
    assert.strictEqual(new SupervisorLink(mkHost()).supervised, false);
  });

  it("l'env injecté ne porte PAS le verdict : il ne sert qu'au rendu", () => {
    const link = mkLink({ supervised: false, env: { [DEV_CHILD_ENV]: "1" } });
    assert.strictEqual(link.supervised, false);
  });

  it("les trois drapeaux de l'écran naissent à false", () => {
    const link = mkLink({ supervised: false });
    assert.strictEqual(link.suppressBootBanners, false);
    assert.strictEqual(link.reporterOwnsHeader, false);
    assert.strictEqual(link.devHeaderDeferred, false);
  });
});

describe("SupervisorLink — sans superviseur : 0 listener, 0 envoi", () => {
  it("canal présent mais pas de superviseur : send rend false sans envoyer, listen ne pose rien", () => {
    const { endpoint, listeners, sent, unrefs } = mkEndpoint(true);
    const link = mkLink({ supervised: false, endpoint });
    assert.strictEqual(link.send(BOOT_STEP), false);
    assert.strictEqual(sent.length, 0, "aucun envoi");
    const off = link.listen(() => {
      assert.fail("aucun message ne doit arriver");
    });
    assert.strictEqual(listeners.size, 0, "aucun écouteur posé");
    assert.strictEqual(unrefs(), 0, "le canal n'est pas touché");
    assert.doesNotThrow(off);
    assert.strictEqual(
      off,
      link.listen(() => {}),
      "désinscription partagée, 0 alloc",
    );
  });

  it("sur le VRAI processus : listenerCount('message') inchangé et process.send jamais appelé", () => {
    const before = process.listenerCount("message");
    const link = mkLink({ supervised: false });
    withFakeIpc((sent) => {
      assert.strictEqual(link.send(BOOT_STEP), false);
      const off = link.listen(() => {});
      assert.strictEqual(process.listenerCount("message"), before);
      off();
      assert.strictEqual(sent.length, 0, "process.send jamais appelé");
    });
    assert.strictEqual(process.listenerCount("message"), before);
  });

  it("supervisé mais sans canal (lancé à la main avec NF_DEV_CHILD=1) : rien ne part, rien ne casse", () => {
    const { endpoint, listeners, sent } = mkEndpoint(false);
    const link = mkLink({ supervised: true, endpoint });
    assert.strictEqual(link.supervised, true);
    assert.strictEqual(link.send(BOOT_STEP), false);
    assert.strictEqual(sent.length, 0);
    assert.doesNotThrow(link.listen(() => {}));
    assert.strictEqual(listeners.size, 0);
  });
});

describe("SupervisorLink — supervisé : la couture unique", () => {
  it("send fait partir le message tel quel par le canal", () => {
    const { endpoint, sent } = mkEndpoint(true);
    const link = mkLink({ supervised: true, endpoint });
    assert.strictEqual(link.send(BOOT_STEP), true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0], BOOT_STEP, "le même objet, pas une copie");
  });

  it("listen pose UN écouteur, ne livre que les messages du canal, se retire, relâche le canal", () => {
    const { endpoint, listeners, unrefs } = mkEndpoint(true);
    const link = mkLink({ supervised: true, endpoint });
    const received: DevChannelMessage[] = [];
    const off = link.listen((message) => {
      received.push(message);
    });
    assert.strictEqual(listeners.size, 1);
    assert.strictEqual(
      unrefs(),
      1,
      "le canal ne garde pas le processus en vie",
    );
    const deliver = (message: unknown): void => {
      for (const listener of listeners) listener(message);
    };
    const resize = {
      channel: DEV_CHANNEL,
      type: "resize",
      columns: 91,
      rows: 27,
    };
    deliver(resize);
    deliver({ type: "process:msg", data: 1 }); // enveloppe cluster : pas du canal
    deliver({ kind: CLUSTER_RT_KIND_LIKE, payload: "x" }); // message de cluster
    deliver({ channel: DEV_CHANNEL, type: "inconnu" }); // type hors union
    assert.deepStrictEqual(received, [resize]);
    off();
    assert.strictEqual(listeners.size, 0, "désinscrit");
    deliver(resize);
    assert.strictEqual(received.length, 1, "plus rien ne passe");
  });
});

/** Le `kind` d'une publication realtime, tel que le cluster l'écrit — hors canal nf-dev. */
const CLUSTER_RT_KIND_LIKE = "nf:rt";

describe("SupervisorLink — rendu, bannière et écran de démarrage", () => {
  it("startupOutputMode lit l'env injecté et le isTTY de l'hôte À L'APPEL", () => {
    const host = mkHost({ isTTY: true });
    const env: Record<string, string | undefined> = {};
    const link = mkLink({ supervised: false, host, env });
    assert.strictEqual(link.startupOutputMode(), "human");
    (host as { isTTY: boolean }).isTTY = false;
    assert.strictEqual(link.startupOutputMode(), "plain");
    env[OUTPUT_ENV] = "json";
    assert.strictEqual(link.startupOutputMode(), "json");
    env[OUTPUT_ENV] = "pastel";
    assert.strictEqual(
      link.startupOutputMode(),
      "human",
      "valeur inconnue → human",
    );
  });

  it("devHeader lit projet, environnement, rôle et tty sur l'hôte à l'appel, l'axe de déploiement dans l'env", () => {
    const host = mkHost({
      projectName: "ARDOISE",
      typeCluster: "worker",
      isTTY: false,
    });
    const env: Record<string, string | undefined> = { APP_ENV: "staging" };
    const link = mkLink({ supervised: false, host, env });
    let header = link.devHeader();
    assert.ok(header.includes("ARDOISE"));
    assert.ok(header.includes("development · staging"));
    assert.ok(header.includes("worker"));
    assert.ok(header.includes("sans tty"));
    (host as { isTTY: boolean }).isTTY = true;
    (host as { projectName: string }).projectName = "CRAIE";
    delete env.APP_ENV;
    header = link.devHeader();
    assert.ok(header.includes("CRAIE"));
    assert.ok(!header.includes("sans tty"));
    assert.ok(!header.includes("· staging"));
    assert.strictEqual(link.frameworkVersion(), Nodefony.version);
  });

  /** L'écran : ce qui a été écrit sur la sortie standard, et les deux drapeaux. */
  function screen(link: SupervisorLink): {
    writes: string[];
    deferred: boolean;
    owned: boolean;
  } {
    const writes: string[] = [];
    const write = vi
      .spyOn(process.stdout, "write")
      .mockImplementation((chunk: unknown) => {
        writes.push(String(chunk));
        return true;
      });
    link.prepareDevScreen();
    write.mockRestore();
    return {
      writes,
      deferred: link.devHeaderDeferred,
      owned: link.reporterOwnsHeader,
    };
  }

  it("enfant supervisé, dev, CLI, terminal, premier démarrage → page propre, bandeau DIFFÉRÉ, en-tête au reporter", () => {
    const link = mkLink({ supervised: true, host: mkHost({ isTTY: true }) });
    const s = screen(link);
    assert.deepStrictEqual(s.writes, [CLEAR_SCREEN]);
    assert.strictEqual(s.deferred, true);
    assert.strictEqual(s.owned, true);
  });

  it("rendu human forcé hors terminal → bandeau imprimé TOUT DE SUITE, rien de différé", () => {
    const link = mkLink({
      supervised: true,
      host: mkHost({ isTTY: false }),
      env: { [OUTPUT_ENV]: "human" },
    });
    const s = screen(link);
    assert.deepStrictEqual(s.writes, [link.devHeader()]);
    assert.strictEqual(s.deferred, false);
    assert.strictEqual(s.owned, true);
  });

  it("rechargement (NF_DEV_RELOAD) → ni page ni bandeau ; l'en-tête reste au reporter", () => {
    const link = mkLink({
      supervised: true,
      host: mkHost({ isTTY: true }),
      env: { NF_DEV_RELOAD: "2" },
    });
    const s = screen(link);
    assert.deepStrictEqual(s.writes, []);
    assert.strictEqual(s.deferred, false);
    assert.strictEqual(s.owned, true);
  });

  it("rendu machine (json / plain) → rien à l'écran ; l'en-tête reste au reporter", () => {
    for (const mode of ["json", "plain"]) {
      const link = mkLink({
        supervised: true,
        host: mkHost({ isTTY: true }),
        env: { [OUTPUT_ENV]: mode },
      });
      const s = screen(link);
      assert.deepStrictEqual(s.writes, [], mode);
      assert.strictEqual(s.deferred, false, mode);
      assert.strictEqual(s.owned, true, mode);
    }
  });

  it("pas supervisé (parent, --no-watch, production directe) → rien, et l'en-tête n'est PAS au reporter", () => {
    const s = screen(
      mkLink({ supervised: false, host: mkHost({ isTTY: true }) }),
    );
    assert.deepStrictEqual(s.writes, []);
    assert.strictEqual(s.deferred, false);
    assert.strictEqual(s.owned, false);
  });

  it("production → rien, même supervisé", () => {
    const s = screen(
      mkLink({ supervised: true, host: mkHost({ environment: "production" }) }),
    );
    assert.deepStrictEqual(s.writes, []);
    assert.strictEqual(s.owned, false);
  });

  it("sans CLI → ni page, ni bandeau, ni en-tête au reporter", () => {
    const s = screen(mkLink({ supervised: true, host: mkHost({ cli: null }) }));
    assert.deepStrictEqual(s.writes, []);
    assert.strictEqual(s.deferred, false);
    assert.strictEqual(s.owned, false);
  });
});
