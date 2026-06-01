/**
 * Famille JSON du UI kit Studio — vue riche réutilisable.
 *
 * - {@link JsonView} : moteur (arbre repliable + brut + copier).
 * - {@link JsonCard} : petite carte autonome (inline ou en Popover).
 * - {@link JsonPeek} : aperçu compact → carte au survol (« pophover »).
 * - helpers purs : {@link jsonPreview}, {@link tryParseJson}, {@link safeStringify}…
 */
export { JsonView, type JsonViewProps } from "./JsonView";
export { JsonCard, type JsonCardProps } from "./JsonCard";
export { JsonPeek, type JsonPeekProps } from "./JsonPeek";
export {
  jsonKind,
  isExpandable,
  jsonPreview,
  primitiveText,
  countLabel,
  truncate,
  safeStringify,
  tryParseJson,
  JSON_KIND_COLOR,
  type JsonKind,
} from "./jsonFormat";
