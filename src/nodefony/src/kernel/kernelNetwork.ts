/**
 * Interfaces réseau de la machine, telles que le noyau les relève et les filtre
 * — la famille RÉSEAU de `Kernel.ts`, détenue par COMPOSITION : le Kernel porte
 * une instance (`network`), construite à l'instant même où l'instantané était
 * relevé avant l'extraction (un seul appel système, ni en plus ni déplacé), et
 * délègue ses méthodes publiques sans rien allouer.
 *
 * Module FEUILLE : aucun import de `./Kernel`. `Kernel.ts` ré-exporte les types
 * (`NetworkInterface`, `FamilyType`, `FilterInterface`) : sa surface publique
 * est inchangée. `domain` et `setDomain` RESTENT sur le Kernel — `domain` est lu
 * sur le chemin de requête (serveurs, `domainMatcher`, `portBinder`).
 */
import os from "node:os";

export interface NetworkInterface {
  [name: string]: os.NetworkInterfaceInfo[];
}
export type FamilyType = "IPv4" | "IPv6";

export interface FilterInterface {
  type?: "local" | "external";
  family?: FamilyType;
  condition?: "&&" | "||" | "==";
}

/**
 * Résultat de `Kernel.getNetwork()` — définition UNIQUE, ré-exportée par
 * `types/IKernel.ts` (ce module feuille n'importe rien du noyau : aucun cycle).
 */
export interface KernelNetworkResult {
  external: Record<string, os.NetworkInterfaceInfo[]>;
  local: Record<string, os.NetworkInterfaceInfo[]>;
  ipv4: Record<string, os.NetworkInterfaceInfo[]>;
  ipv6: Record<string, os.NetworkInterfaceInfo[]>;
  interfaces: Record<string, os.NetworkInterfaceInfo[]>;
}

/**
 * Lecteur des interfaces réseau — la forme exacte de `os.networkInterfaces()`,
 * injectable pour éprouver les filtres sur une machine fictive.
 */
export type NetworkInterfacesReader = () => ReturnType<
  typeof os.networkInterfaces
>;

/** Lecteur par défaut : l'OS, résolu À L'APPEL (jamais capturé — un banc peut l'espionner après coup). */
const READ_OS: NetworkInterfacesReader = () => os.networkInterfaces();

/**
 * Instantané des interfaces réseau et ses filtres.
 *
 * Le contrat des filtres est celui d'origine, piège compris : chaque critère
 * (`type`, `family`) vaut FAUX tant qu'il n'est pas posé, et la condition par
 * défaut est `&&` (`"=="` vaut `&&`). Un filtre à UN seul critère ne garde donc
 * rien sous `&&` — il faut `condition: "||"` pour sélectionner par le type ou
 * la famille seuls. Verrouillé par `tests/kernelNetwork.test.ts`.
 */
export class KernelNetwork {
  /** Instantané des interfaces, relevé UNE fois à la construction (`Kernel.interfaces`). */
  interfaces: NetworkInterface;
  private readonly read: NetworkInterfacesReader;

  /**
   * @param read - lecteur des interfaces (défaut : l'OS). Appelé une fois ici,
   *   puis à chaque {@link getNetworkInterfaces}.
   */
  constructor(read: NetworkInterfacesReader = READ_OS) {
    this.read = read;
    this.interfaces = this.getNetworkInterfaces();
  }

  /**
   * Filtre l'instantané des interfaces par type (`local` = `internal`,
   * `external` sinon) et par famille (`IPv4`/`IPv6`).
   *
   * Seuls les critères POSÉS participent : sous `&&` (défaut, `"=="` en est
   * l'alias), chacun doit être vrai ; sous `||`, un seul suffit. Un filtre sans
   * critère (`{}`, `{ condition: "||" }`) rend l'instantané lui-même, comme
   * l'absence de filtre.
   *
   * @param filters - critères ; absent ou sans critère → tout l'instantané
   * @returns un objet neuf qui garde TOUTES les interfaces (vides comprises)
   *   quand un critère est posé ; l'instantané lui-même sinon
   */
  interfacesFilter(filters?: FilterInterface): NetworkInterface {
    const type = filters?.type;
    const family = filters?.family;
    if (type === undefined && family === undefined) return this.interfaces;
    const anyOf = filters?.condition === "||";
    const interfaces: NetworkInterface = {};
    for (const [name, list] of Object.entries(this.interfaces)) {
      const kept: os.NetworkInterfaceInfo[] = [];
      interfaces[name] = kept;
      for (const infos of list) {
        // `null` = critère absent : il ne fait ni réussir ni échouer.
        const matchType =
          type === undefined ? null : infos.internal === (type === "local");
        const matchFamily =
          family === undefined ? null : infos.family === family;
        const keep = anyOf
          ? matchType === true || matchFamily === true
          : matchType !== false && matchFamily !== false;
        if (keep) kept.push(infos);
      }
    }
    return interfaces;
  }

  /** Relit les interfaces à chaque appel (un appel système) et écarte les entrées vides. */
  getNetworkInterfaces(): { [name: string]: os.NetworkInterfaceInfo[] } {
    const nets = this.read();
    const devices: { [name: string]: os.NetworkInterfaceInfo[] } = {};
    Object.entries(nets).forEach(([name, ni]) => {
      if (!ni) return;
      devices[name] = ni;
    });
    return devices;
  }

  getNetwork(): KernelNetworkResult {
    return {
      external: this.interfacesFilter({ type: "external" }),
      local: this.interfacesFilter({ type: "local", condition: "==" }),
      ipv4: this.interfacesFilter({ family: "IPv4" }),
      ipv6: this.interfacesFilter({ family: "IPv6" }),
      interfaces: this.interfaces,
    };
  }

  getFirstExternalInterface(
    family?: FamilyType,
  ): os.NetworkInterfaceInfo | undefined {
    const filter: FilterInterface = {
      type: "external",
      family: family || "IPv4",
      condition: "&&",
    };
    const res: NetworkInterface = this.interfacesFilter(filter);
    const ele: os.NetworkInterfaceInfo[] = [];
    for (const list of Object.values(res)) {
      for (const info of list) {
        ele.push(info);
      }
    }
    return ele[0];
  }
}
