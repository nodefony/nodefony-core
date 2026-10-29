/**
 * Surface d'hôte COMMUNE au navigateur et à Node, la seule que le code partagé
 * (`src/realtime/`) a le droit d'utiliser. Lue par `tsconfig.shared.json` seul :
 * tout ce qui n'est pas déclaré ici (`Blob`, `window`, `Buffer`…) fait échouer
 * la compilation neutre. Le handle de minuterie reste opaque — un `number` dans
 * le navigateur, un `Timeout` sous Node.
 */
declare const sharedTimerHandle: unique symbol;
type SharedTimerHandle = { readonly [sharedTimerHandle]: true };
declare function setTimeout(
  handler: () => void,
  timeout?: number,
): SharedTimerHandle;
declare function clearTimeout(handle: SharedTimerHandle | undefined): void;

/**
 * Encodage UTF-8 de l'hôte (WHATWG Encoding), identique dans le navigateur et sous
 * Node ; déclaré au minimum de ce que le codec CBOR emploie. `fatal` fait lever un
 * `TypeError` sur une séquence invalide ; `ignoreBOM` garde un U+FEFF initial.
 */
declare class TextEncoder {
  encodeInto(
    source: string,
    destination: Uint8Array,
  ): { readonly read: number; readonly written: number };
}
declare class TextDecoder {
  constructor(
    label?: string,
    options?: { readonly fatal?: boolean; readonly ignoreBOM?: boolean },
  );
  decode(input?: ArrayBufferView | ArrayBuffer): string;
}
