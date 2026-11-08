/**
 * Pilote la barre de debug que Nodefony injecte en développement.
 *
 * La barre publie sa poignée sur `globalThis.__NODEFONY_DEBUGBAR__`
 * (`DebugBarHandle` de `nodefony/debugbar`) ; on la lit ici SANS importer le
 * widget, qui entrerait sinon dans le bundle de la page. Absente (production,
 * barre non montée) : `null`, et la page cache ses boutons.
 */
export interface IDebugBarControl {
  isVisible(): boolean;
  setVisible(visible: boolean): void;
  minimize(): void;
  restore(): void;
}

/** Clé sous laquelle la barre publie sa poignée. */
const HANDLE_KEY = "__NODEFONY_DEBUGBAR__";

/**
 * Rend la poignée de la barre de debug, vérifiée méthode par méthode.
 *
 * @returns la poignée, ou `null` si la barre n'est pas montée
 */
export function debugBarControl(): IDebugBarControl | null {
  const handle: unknown = Reflect.get(globalThis, HANDLE_KEY);
  if (typeof handle !== "object" || handle === null) return null;
  if (
    !("isVisible" in handle) ||
    !("setVisible" in handle) ||
    !("minimize" in handle) ||
    !("restore" in handle)
  ) {
    return null;
  }
  const { isVisible, setVisible, minimize, restore } = handle;
  if (
    typeof isVisible !== "function" ||
    typeof setVisible !== "function" ||
    typeof minimize !== "function" ||
    typeof restore !== "function"
  ) {
    return null;
  }
  return {
    isVisible: () => isVisible.call(handle) === true,
    setVisible: (visible) => {
      setVisible.call(handle, visible);
    },
    minimize: () => {
      minimize.call(handle);
    },
    restore: () => {
      restore.call(handle);
    },
  };
}
