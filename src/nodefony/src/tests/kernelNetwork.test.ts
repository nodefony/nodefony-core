import assert from "node:assert/strict";
import os from "node:os";
import { afterEach, describe, it, vi } from "vitest";
import Kernel from "../kernel/Kernel";
import type {
  FilterInterface,
  NetworkInterface,
  TypeKernelOptions,
} from "../kernel/Kernel";
import { KernelNetwork } from "../kernel/kernelNetwork";
import type {
  KernelNetworkResult,
  NetworkInterfacesReader,
} from "../kernel/kernelNetwork";
import type { IKernel } from "../types/IKernel";
import type { KernelNetworkResult as PublishedNetworkResult } from "../index";

/**
 * Le résultat de `getNetwork()` a UNE définition (`kernel/kernelNetwork.ts`) :
 * le contrat `IKernel`, le Kernel et le barrel publié la désignent tous. Une
 * copie redéclarée ailleurs ferait rougir le typecheck du cœur ici.
 */
type Same<A, B> =
  // Idiome d'égalité STRICTE de types : `T` n'y sert qu'une fois PAR CONSTRUCTION
  // — c'est le report de son évaluation qui distingue `A` de `B` au lieu de
  // comparer leur seule assignabilité. La règle ne voit pas cette intention.
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
const _kernelNetworkIsCanonical: Same<
  ReturnType<Kernel["getNetwork"]>,
  KernelNetworkResult
> = true;
const _contractNetworkIsCanonical: Same<
  ReturnType<IKernel["getNetwork"]>,
  KernelNetworkResult
> = true;
const _publishedNetworkIsCanonical: Same<
  PublishedNetworkResult,
  KernelNetworkResult
> = true;
void _kernelNetworkIsCanonical;
void _contractNetworkIsCanonical;
void _publishedNetworkIsCanonical;

/**
 * Caractérisation de la famille RÉSEAU du noyau (#488) : l'instantané des
 * interfaces, ses filtres, et ce que `setDomain` en tire. Chaque test pose une
 * MACHINE FICTIVE (le champ `interfaces` est public et s'écrit) pour que le
 * contrat ne dépende pas de la carte réseau du poste qui lance la suite.
 */

function ipv4(address: string, internal: boolean): os.NetworkInterfaceInfoIPv4 {
  return {
    address,
    netmask: "255.255.255.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/24`,
  };
}

function ipv6(address: string, internal: boolean): os.NetworkInterfaceInfoIPv6 {
  return {
    address,
    netmask: "ffff:ffff:ffff:ffff::",
    family: "IPv6",
    mac: "00:00:00:00:00:00",
    internal,
    cidr: `${address}/64`,
    scopeid: 0,
  };
}

/** Machine fictive : l'ORDRE d'insertion (lo0, en0, utun0) compte pour « première ». */
function machine(): NetworkInterface {
  return {
    lo0: [ipv4("127.0.0.1", true), ipv6("::1", true)],
    en0: [ipv4("192.168.1.10", false), ipv6("fe80::1", false)],
    utun0: [ipv4("10.0.0.5", false)],
  };
}

function kernelOn(
  interfaces: NetworkInterface,
  options: TypeKernelOptions = {},
): Kernel {
  const k = new Kernel("development", null, options);
  k.interfaces = interfaces;
  return k;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Kernel — réseau : l'instantané des interfaces", () => {
  it("est relevé UNE fois, à la construction, par os.networkInterfaces()", () => {
    const spy = vi.spyOn(os, "networkInterfaces");
    const k = new Kernel("development", null, {});
    assert.equal(spy.mock.calls.length, 1);
    for (const list of Object.values(k.interfaces)) {
      assert.ok(Array.isArray(list));
    }
  });

  it("getNetworkInterfaces() relit l'OS à CHAQUE appel et rend un objet neuf", () => {
    const k = new Kernel("development", null, {});
    const spy = vi.spyOn(os, "networkInterfaces");
    const first = k.getNetworkInterfaces();
    const second = k.getNetworkInterfaces();
    assert.equal(spy.mock.calls.length, 2);
    assert.notEqual(first, second);
    assert.deepEqual(first, second);
  });

  it("getNetworkInterfaces() écarte les entrées sans adresse (NodeJS.Dict)", () => {
    vi.spyOn(os, "networkInterfaces").mockReturnValue({
      en0: [ipv4("192.168.1.10", false)],
      ghost: undefined,
    });
    const k = new Kernel("development", null, {});
    assert.deepEqual(Object.keys(k.interfaces), ["en0"]);
    assert.deepEqual(Object.keys(k.getNetworkInterfaces()), ["en0"]);
    assert.deepEqual(k.interfaces.en0, [ipv4("192.168.1.10", false)]);
  });

  it("`interfaces` se lit et s'écrit comme un champ : une machine injectée remplace le relevé", () => {
    const injected = machine();
    const k = kernelOn(injected);
    assert.equal(k.interfaces, injected);
    assert.equal(k.interfacesFilter(), injected);
    assert.equal(k.getNetwork().interfaces, injected);
  });
});

describe("Kernel — réseau : interfacesFilter", () => {
  it("sans filtre → l'instantané LUI-MÊME (même référence, aucune copie)", () => {
    const k = kernelOn(machine());
    assert.equal(k.interfacesFilter(), k.interfaces);
    assert.equal(k.interfacesFilter(undefined), k.interfaces);
  });

  it("avec filtre → un objet NEUF qui garde TOUTES les interfaces, vides comprises, dans des tableaux neufs", () => {
    const injected = machine();
    const k = kernelOn(injected);
    const result = k.interfacesFilter({ type: "external" });
    assert.notEqual(result, injected);
    assert.deepEqual(Object.keys(result), ["lo0", "en0", "utun0"]);
    assert.deepEqual(result.lo0, []);
    assert.notEqual(result.en0, injected.en0);
    result.en0!.length = 0;
    assert.equal(injected.en0!.length, 2);
  });

  it("PIÈGE d'origine conservé : UN SEUL critère sous le '&&' par défaut ne garde RIEN (le critère absent vaut faux)", () => {
    const k = kernelOn(machine());
    const nothing = { lo0: [], en0: [], utun0: [] };
    assert.deepEqual(k.interfacesFilter({ type: "external" }), nothing);
    assert.deepEqual(k.interfacesFilter({ type: "local" }), nothing);
    assert.deepEqual(k.interfacesFilter({ family: "IPv4" }), nothing);
    assert.deepEqual(k.interfacesFilter({ family: "IPv6" }), nothing);
  });

  it("type 'external' / 'local' seul tranche sur `internal` — en '||'", () => {
    const k = kernelOn(machine());
    assert.deepEqual(
      k.interfacesFilter({ type: "external", condition: "||" }),
      {
        lo0: [],
        en0: [ipv4("192.168.1.10", false), ipv6("fe80::1", false)],
        utun0: [ipv4("10.0.0.5", false)],
      },
    );
    assert.deepEqual(k.interfacesFilter({ type: "local", condition: "||" }), {
      lo0: [ipv4("127.0.0.1", true), ipv6("::1", true)],
      en0: [],
      utun0: [],
    });
  });

  it("family 'IPv4' / 'IPv6' seule tranche sur `family` — en '||'", () => {
    const k = kernelOn(machine());
    assert.deepEqual(k.interfacesFilter({ family: "IPv4", condition: "||" }), {
      lo0: [ipv4("127.0.0.1", true)],
      en0: [ipv4("192.168.1.10", false)],
      utun0: [ipv4("10.0.0.5", false)],
    });
    assert.deepEqual(k.interfacesFilter({ family: "IPv6", condition: "||" }), {
      lo0: [ipv6("::1", true)],
      en0: [ipv6("fe80::1", false)],
      utun0: [],
    });
  });

  it("type + family : '&&' par défaut, et '==' vaut '&&'", () => {
    const k = kernelOn(machine());
    const expected = {
      lo0: [],
      en0: [ipv4("192.168.1.10", false)],
      utun0: [ipv4("10.0.0.5", false)],
    };
    assert.deepEqual(
      k.interfacesFilter({ type: "external", family: "IPv4" }),
      expected,
    );
    assert.deepEqual(
      k.interfacesFilter({ type: "external", family: "IPv4", condition: "&&" }),
      expected,
    );
    assert.deepEqual(
      k.interfacesFilter({ type: "external", family: "IPv4", condition: "==" }),
      expected,
    );
  });

  it("type + family en '||' : l'un OU l'autre suffit", () => {
    const k = kernelOn(machine());
    assert.deepEqual(
      k.interfacesFilter({ type: "local", family: "IPv4", condition: "||" }),
      {
        lo0: [ipv4("127.0.0.1", true), ipv6("::1", true)],
        en0: [ipv4("192.168.1.10", false)],
        utun0: [ipv4("10.0.0.5", false)],
      },
    );
  });

  it("un seul critère en '||' : l'autre, absent, ne compte pas pour vrai", () => {
    const k = kernelOn(machine());
    assert.deepEqual(k.interfacesFilter({ type: "local", condition: "||" }), {
      lo0: [ipv4("127.0.0.1", true), ipv6("::1", true)],
      en0: [],
      utun0: [],
    });
  });

  it("filtre vide {} ou sans critère → toutes les interfaces, toutes VIDES", () => {
    const k = kernelOn(machine());
    assert.deepEqual(k.interfacesFilter({}), { lo0: [], en0: [], utun0: [] });
    assert.deepEqual(k.interfacesFilter({ condition: "||" }), {
      lo0: [],
      en0: [],
      utun0: [],
    });
  });
});

describe("Kernel — réseau : getNetwork", () => {
  it("rend exactement external/local/ipv4/ipv6/interfaces, `interfaces` étant l'instantané lui-même", () => {
    const injected = machine();
    const k = kernelOn(injected);
    const net = k.getNetwork();
    assert.deepEqual(Object.keys(net).sort(), [
      "external",
      "interfaces",
      "ipv4",
      "ipv6",
      "local",
    ]);
    assert.equal(net.interfaces, injected);
    assert.deepEqual(net.external, k.interfacesFilter({ type: "external" }));
    assert.deepEqual(net.local, k.interfacesFilter({ type: "local" }));
    assert.deepEqual(net.ipv4, k.interfacesFilter({ family: "IPv4" }));
    assert.deepEqual(net.ipv6, k.interfacesFilter({ family: "IPv6" }));
  });

  it("PIÈGE d'origine conservé : external/local/ipv4/ipv6 sont tous VIDES (un critère chacun, sous '&&' — '==' compris)", () => {
    const k = kernelOn(machine());
    const net = k.getNetwork();
    const nothing = { lo0: [], en0: [], utun0: [] };
    assert.deepEqual(net.external, nothing);
    assert.deepEqual(net.local, nothing);
    assert.deepEqual(net.ipv4, nothing);
    assert.deepEqual(net.ipv6, nothing);
  });
});

describe("Kernel — réseau : getFirstExternalInterface", () => {
  it("rend la première adresse EXTERNE IPv4, dans l'ordre des interfaces puis des entrées", () => {
    const k = kernelOn(machine());
    assert.deepEqual(
      k.getFirstExternalInterface(),
      ipv4("192.168.1.10", false),
    );
    assert.deepEqual(
      k.getFirstExternalInterface("IPv4"),
      ipv4("192.168.1.10", false),
    );
  });

  it("family 'IPv6' → la première externe IPv6", () => {
    const k = kernelOn(machine());
    assert.deepEqual(
      k.getFirstExternalInterface("IPv6"),
      ipv6("fe80::1", false),
    );
  });

  it("l'ordre d'insertion des interfaces décide", () => {
    const k = kernelOn({
      utun0: [ipv4("10.0.0.5", false)],
      en0: [ipv4("192.168.1.10", false)],
    });
    assert.deepEqual(k.getFirstExternalInterface(), ipv4("10.0.0.5", false));
  });

  it("aucune interface externe → undefined", () => {
    const k = kernelOn({ lo0: [ipv4("127.0.0.1", true), ipv6("::1", true)] });
    assert.equal(k.getFirstExternalInterface(), undefined);
    assert.equal(k.getFirstExternalInterface("IPv6"), undefined);
  });
});

describe("Kernel — réseau : setDomain", () => {
  it("options.domain nommé → rendu tel quel, sans toucher au champ `domain` (la méthode est pure)", () => {
    const k = kernelOn(machine(), { domain: "example.com" });
    assert.equal(k.setDomain(), "example.com");
    assert.equal(k.domain, "localhost");
  });

  it("options.domain absent ou vide → 'localhost'", () => {
    assert.equal(kernelOn(machine()).setDomain(), "localhost");
    assert.equal(kernelOn(machine(), { domain: "" }).setDomain(), "localhost");
  });

  it("'selectAuto' → la première adresse externe IPv4 de la machine", () => {
    const k = kernelOn(machine(), { domain: "selectAuto" });
    assert.equal(k.setDomain(), "192.168.1.10");
  });

  it("'selectAuto' sans interface externe → 'localhost'", () => {
    const k = kernelOn(
      { lo0: [ipv4("127.0.0.1", true)] },
      { domain: "selectAuto" },
    );
    assert.equal(k.setDomain(), "localhost");
  });
});

describe("KernelNetwork — la classe extraite", () => {
  it("relève l'instantané par le lecteur injecté, UNE fois à la construction, puis à chaque relecture", () => {
    let calls = 0;
    const read: NetworkInterfacesReader = () => {
      calls += 1;
      return { en0: [ipv4("192.168.1.10", false)], ghost: undefined };
    };
    const net = new KernelNetwork(read);
    assert.equal(calls, 1);
    assert.deepEqual(net.interfaces, { en0: [ipv4("192.168.1.10", false)] });
    assert.deepEqual(net.getNetworkInterfaces(), {
      en0: [ipv4("192.168.1.10", false)],
    });
    assert.equal(calls, 2);
  });

  it("sans lecteur injecté, lit l'OS AU MOMENT de l'appel — jamais capturé à la construction", () => {
    const net = new KernelNetwork();
    const spy = vi.spyOn(os, "networkInterfaces");
    net.getNetworkInterfaces();
    assert.equal(spy.mock.calls.length, 1);
  });

  it("porte exactement le contrat que le Kernel délègue — filtres, getNetwork, première externe", () => {
    const net = new KernelNetwork(() => machine());
    const k = kernelOn(machine());
    const filters: (FilterInterface | undefined)[] = [
      undefined,
      {},
      { type: "external" },
      { type: "local", condition: "||" },
      { family: "IPv4", condition: "||" },
      { type: "external", family: "IPv4" },
      { type: "local", family: "IPv6", condition: "||" },
      { type: "external", family: "IPv6", condition: "==" },
    ];
    for (const filter of filters) {
      assert.deepEqual(
        net.interfacesFilter(filter),
        k.interfacesFilter(filter),
      );
    }
    assert.deepEqual(net.getNetwork(), k.getNetwork());
    assert.deepEqual(
      net.getFirstExternalInterface(),
      k.getFirstExternalInterface(),
    );
    assert.deepEqual(
      net.getFirstExternalInterface("IPv6"),
      k.getFirstExternalInterface("IPv6"),
    );
  });
});
