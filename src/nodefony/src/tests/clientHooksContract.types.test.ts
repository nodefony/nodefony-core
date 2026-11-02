/**
 * Tests d'INFÉRENCE TYPES — les liaisons de vue lisent le contrat dans la
 * SOCKET qu'on leur passe (`NodefonySocket.fromContract<C>()`), sans générique
 * écrit à la main ni carte recopiée (#709, ADR-0022 §4 D3).
 *
 * Trois propriétés par liaison : un canal hors contrat est REFUSÉ, la charge
 * est DÉDUITE (lue par `Jsonify` : une `Date` arrive en `string`), et la forme
 * historique sans socket reste acceptée telle quelle.
 *
 * `_typeOnly*()` ne sont jamais appelés : le test est la compilation.
 */

import { describe, it } from "vitest";
import { NodefonySocket } from "../client/realtime/NodefonySocket";
import {
  expectType,
  type IRealtimeContract,
} from "../realtime/RealtimeEventMap";
import * as react from "../client/react/index";
import * as vue from "../client/vue/index";
import * as svelte from "../client/svelte/index";
import * as angular from "../client/angular/index";
import {
  observeAdaptiveChannel,
  observeChannel,
  observeChannelData,
} from "../client/realtime/observe";
import { PLATFORM_CHANNELS } from "../realtime/platformChannels";
import type {
  IPlatformRealtimeContract,
  PlatformServerToClient,
} from "../realtime/platformContract";
import type { RealtimeHealthReport } from "../realtime/platformHealth";

interface ChatMessage {
  from: string;
  text: string;
  at: Date;
}

interface ChatContract extends IRealtimeContract {
  serverToClient: {
    "chat:room": ChatMessage;
    "chat:presence": { present: string[] };
  };
}

/** Ce que le client reçoit d'un `ChatMessage` : la `Date` a traversé le fil. */
interface ReceivedMessage {
  from: string;
  text: string;
  at: string;
}

const chat = NodefonySocket.fromContract<ChatContract>({ url: "/chat" });

function _typeOnlyReact(): void {
  // ── la charge est DÉDUITE du contrat ──────────────────────────────────────
  const presence = react.useNodefonyChannelData(chat, "chat:presence", {
    present: [],
  });
  expectType<{ present: string[] } | null>(presence);

  react.useNodefonyChannel(chat, "chat:room", (m) => {
    expectType<ReceivedMessage>(m);
  });
  react.useNodefonyChannel(chat, "chat:room", () => {}, [presence]);

  // ── un canal hors contrat est REFUSÉ ──────────────────────────────────────
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  react.useNodefonyChannelData(chat, "chat:prezence");
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  react.useNodefonyChannel(chat, "chat:prezence", () => {});
  // @ts-expect-error — la valeur initiale doit avoir la forme du contrat
  react.useNodefonyChannelData(chat, "chat:presence", { present: 3 });

  // ── cadence adaptative : mêmes règles ────────────────────────────────────
  const adaptive = react.useNodefonyAdaptiveChannelData(
    chat,
    "chat:presence",
    1000,
  );
  expectType<{ present: string[] } | null>(adaptive.data);
  expectType<number>(adaptive.intervalMs);
  expectType<number>(
    react.useNodefonyAdaptiveChannel(
      chat,
      "chat:room",
      (m) => {
        expectType<ReceivedMessage>(m);
      },
      1000,
      { enabled: true },
      [presence],
    ),
  );
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  react.useNodefonyAdaptiveChannelData(chat, "chat:prezence", 1000);
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  react.useNodefonyAdaptiveChannel(chat, "chat:prezence", () => {}, 1000);
  expectType<{ n: number } | null>(
    react.useNodefonyAdaptiveChannelData<{ n: number }>("live:state", 500).data,
  );
  react.useNodefonyAdaptiveChannel(
    "live:state",
    (payload) => {
      expectType<unknown>(payload);
    },
    500,
  );

  // ── la forme historique (socket du Provider) reste acceptée ──────────────
  expectType<{ n: number } | null>(
    react.useNodefonyChannelData<{ n: number }>("live:events"),
  );
  expectType<unknown>(react.useNodefonyChannelData("live:events"));
  react.useNodefonyChannel("live:events", (payload) => {
    expectType<unknown>(payload);
  });
}

function _typeOnlyVue(): void {
  const presence = vue.useNodefonyChannelData(chat, "chat:presence");
  expectType<{ present: string[] } | null>(presence.value);
  vue.useNodefonyChannel(
    chat,
    () => "chat:room",
    (m) => {
      expectType<ReceivedMessage>(m);
    },
  );

  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  vue.useNodefonyChannelData(chat, "chat:prezence");
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  vue.useNodefonyChannel(chat, "chat:prezence", () => {});

  const adaptive = vue.useNodefonyAdaptiveChannelData(
    chat,
    () => "chat:presence",
    1000,
  );
  expectType<{ present: string[] } | null>(adaptive.data.value);
  vue.useNodefonyAdaptiveChannel(
    chat,
    "chat:room",
    (m) => {
      expectType<ReceivedMessage>(m);
    },
    1000,
  );
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  vue.useNodefonyAdaptiveChannelData(chat, "chat:prezence", 1000);
  expectType<{ n: number } | null>(
    vue.useNodefonyAdaptiveChannelData<{ n: number }>("live:state", 500).data
      .value,
  );

  expectType<{ n: number } | null>(
    vue.useNodefonyChannelData<{ n: number }>("live:events").value,
  );
  vue.useNodefonyChannel("live:events", (payload) => {
    expectType<unknown>(payload);
  });
}

function _typeOnlySvelte(): void {
  const presence = svelte.nodefonyChannelData(chat, "chat:presence");
  expectType<{ present: string[] } | null>(presence.current);
  svelte.nodefonyChannel(chat, "chat:room", (m) => {
    expectType<ReceivedMessage>(m);
  });

  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  svelte.nodefonyChannelData(chat, "chat:prezence");
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  svelte.nodefonyChannel(chat, "chat:prezence", () => {});

  svelte.nodefonyChannel("live:events", (payload) => {
    expectType<unknown>(payload);
  });

  const adaptive = svelte.nodefonyAdaptiveChannelData(
    chat,
    "chat:presence",
    1000,
  );
  expectType<{ present: string[] } | null>(adaptive.data.current);
  svelte.nodefonyAdaptiveChannel(
    chat,
    "chat:room",
    (m) => {
      expectType<ReceivedMessage>(m);
    },
    1000,
    { onRate: (ms) => expectType<number>(ms) },
  );
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  svelte.nodefonyAdaptiveChannelData(chat, "chat:prezence", 1000);
  svelte.nodefonyAdaptiveChannel(
    "live:state",
    (payload) => {
      expectType<unknown>(payload);
    },
    500,
  );
}

function _typeOnlyAngular(): void {
  const presence = angular.injectNodefonyChannelData(chat, "chat:presence");
  expectType<{ present: string[] } | null>(presence());
  angular.injectNodefonyChannel(chat, "chat:room", (m) => {
    expectType<ReceivedMessage>(m);
  });

  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  angular.injectNodefonyChannelData(chat, "chat:prezence");
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  angular.injectNodefonyChannel(chat, "chat:prezence", () => {});

  angular.injectNodefonyChannel("live:events", (payload) => {
    expectType<unknown>(payload);
  });

  const adaptive = angular.injectNodefonyAdaptiveChannelData(
    chat,
    "chat:presence",
    1000,
  );
  expectType<{ present: string[] } | null>(adaptive.data());
  angular.injectNodefonyAdaptiveChannel(
    chat,
    "chat:room",
    (m) => {
      expectType<ReceivedMessage>(m);
    },
    1000,
  );
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  angular.injectNodefonyAdaptiveChannelData(chat, "chat:prezence", 1000);
  expectType<{ n: number } | null>(
    angular
      .injectNodefonyAdaptiveChannelData<{ n: number }>("live:state", 500)
      .data(),
  );
}

function _typeOnlySocle(): void {
  observeChannel(chat, "chat:room", (m) => {
    expectType<ReceivedMessage>(m);
  });
  observeChannelData(chat, "chat:presence", (v) => {
    expectType<{ present: string[] } | null>(v);
  });
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  observeChannel(chat, "chat:prezence", () => {});
  observeAdaptiveChannel(
    chat,
    "chat:presence",
    (v) => {
      expectType<{ present: string[] }>(v);
    },
    1000,
  );
  // @ts-expect-error — "chat:prezence" n'est pas un canal du contrat
  observeAdaptiveChannel(chat, "chat:prezence", () => {}, 1000);

  // Socket non paramétrée : tout nom est accepté, la charge reste `unknown`.
  const raw = new NodefonySocket({ url: "/live" });
  observeChannelData(raw, "live:events", (v) => {
    expectType<unknown>(v);
  });
}

/**
 * Une socket typée est un SOUS-TYPE de la socket nue : elle entre par toutes les
 * portes qui attendent une socket — Provider, plugin, configuration, fournisseur
 * — et la page n'ouvre qu'une connexion par adresse.
 */
function _typeOnlySubtype(): void {
  const bare: NodefonySocket = chat;
  void bare;
  const props: react.NodefonyProviderProps = { client: chat };
  void props;
  const vueOptions: vue.NodefonyVueOptions = { client: chat };
  void vueOptions;
  svelte.configureNodefony({ client: chat });
  angular.provideNodefony({ client: chat });
}

/**
 * La socket PARTAGÉE de la page, vue par un contrat (`shared: true`) : même type
 * qu'une socket neuve, donc mêmes portes et mêmes déductions.
 */
function _typeOnlyShared(): void {
  const page = NodefonySocket.fromContract<ChatContract>({
    url: "/chat",
    shared: true,
  });
  expectType<typeof chat>(page);
  react.useNodefonyChannel(page, "chat:room", (m) => {
    expectType<ReceivedMessage>(m);
  });
}

/**
 * Le contrat de plateforme : une application qui l'étend lit `nodefony:socket`
 * sous sa forme publiée, sans miroir — et garde ses propres canaux.
 */
interface MonitorContract extends IPlatformRealtimeContract {
  serverToClient: PlatformServerToClient & { "monitor:jobs": { id: string } };
}

function _typeOnlyPlatform(): void {
  const monitor = NodefonySocket.fromContract<MonitorContract>({
    url: "/monitor",
    shared: true,
  });
  const health = react.useNodefonyChannelData(
    monitor,
    PLATFORM_CHANNELS.socket,
  );
  if (health && "cluster" in health) {
    expectType<number>(health.instanceCount);
  } else if (health) {
    expectType<string>(health.instanceId);
    expectType<number | undefined>(health.process?.heapLimit);
  }
  const live = react.useNodefonyAdaptiveChannelData(
    monitor,
    PLATFORM_CHANNELS.socket,
    1000,
  );
  expectType<RealtimeHealthReport | null>(live.data);
  react.useNodefonyChannel(monitor, "monitor:jobs", (j) => {
    expectType<{ id: string }>(j);
  });
  // @ts-expect-error — un canal de plateforme sans forme publiée n'est pas déclaré
  react.useNodefonyChannelData(monitor, PLATFORM_CHANNELS.syslog);
}

describe("liaisons de vue — lecture typée par le contrat (compile-only)", () => {
  it("compile quand les hooks lisent la socket du contrat", () => {
    void _typeOnlyReact;
    void _typeOnlyVue;
    void _typeOnlySvelte;
    void _typeOnlyAngular;
    void _typeOnlySocle;
    void _typeOnlySubtype;
    void _typeOnlyShared;
    void _typeOnlyPlatform;
  });
});
