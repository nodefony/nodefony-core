import type Kernel from "./kernel/Kernel";
import { version as pkgVersion } from "../package.json";
import { v4 as uuidv4, v5 as uuidv5 } from "uuid";

export class Nodefony {
  static readonly version: string = pkgVersion;
  static #kernel: Kernel | null = null;

  private constructor() {}

  static getKernel(): Kernel | null {
    return Nodefony.#kernel;
  }

  static setKernel(k: Kernel): void {
    Nodefony.#kernel = k;
  }

  static generateId(): string {
    return uuidv4();
  }

  static generateV5Id(name: string, namespace?: string): string {
    return uuidv5(name, namespace || uuidv4());
  }
}
