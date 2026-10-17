/**
 * Décor IPC pour les tests du cœur : pose, le temps d'un appel, un
 * `process.send` factice (qui ENREGISTRE au lieu d'envoyer) ou l'absence de
 * tout canal — puis restaure l'état exact du processus.
 *
 * Pourquoi : selon le pool de vitest, le processus de test possède ou non un
 * canal IPC vers son parent. Envoyer un vrai message par `process.send`
 * parlerait au lanceur de tests ; supposer son absence rendrait le test faux
 * d'un pool à l'autre. On impose donc le décor, dans les deux sens, et on le
 * retire aussitôt (tout est synchrone : rien ne s'écoule entre pose et retrait).
 */

/** Un appel enregistré à `process.send` — ses arguments, dans l'ordre. */
export type RecordedSend = readonly unknown[];

function restore(
  key: "send" | "connected",
  desc: PropertyDescriptor | undefined,
): void {
  if (desc) Object.defineProperty(process, key, desc);
  else Reflect.deleteProperty(process, key);
}

/**
 * Exécute `fn` avec un canal IPC factice : `process.send` enregistre ses
 * arguments et rend `returns` ; `process.connected` vaut `true`.
 *
 * @param fn - reçoit le journal des envois (un tableau d'arguments par appel).
 * @param returns - ce que rend le `send` factice (défaut `true`).
 * @returns ce que rend `fn`.
 */
export function withFakeIpc<T>(
  fn: (sent: RecordedSend[]) => T,
  returns = true,
): T {
  const sendDesc = Object.getOwnPropertyDescriptor(process, "send");
  const connectedDesc = Object.getOwnPropertyDescriptor(process, "connected");
  const sent: RecordedSend[] = [];
  Object.defineProperty(process, "send", {
    value: (...args: unknown[]): boolean => {
      sent.push(args);
      return returns;
    },
    configurable: true,
    writable: true,
    enumerable: true,
  });
  Object.defineProperty(process, "connected", {
    value: true,
    configurable: true,
    writable: true,
    enumerable: true,
  });
  try {
    return fn(sent);
  } finally {
    restore("send", sendDesc);
    restore("connected", connectedDesc);
  }
}

/**
 * Exécute `fn` SANS canal IPC : `process.send` est indéfini, `process.connected`
 * aussi — le décor d'un processus lancé sans superviseur ni primaire.
 *
 * @param fn - le code à exécuter sans canal.
 * @returns ce que rend `fn`.
 */
export function withoutIpc<T>(fn: () => T): T {
  const sendDesc = Object.getOwnPropertyDescriptor(process, "send");
  const connectedDesc = Object.getOwnPropertyDescriptor(process, "connected");
  Object.defineProperty(process, "send", {
    value: undefined,
    configurable: true,
    writable: true,
    enumerable: true,
  });
  Object.defineProperty(process, "connected", {
    value: undefined,
    configurable: true,
    writable: true,
    enumerable: true,
  });
  try {
    return fn();
  } finally {
    restore("send", sendDesc);
    restore("connected", connectedDesc);
  }
}
