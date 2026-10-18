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
