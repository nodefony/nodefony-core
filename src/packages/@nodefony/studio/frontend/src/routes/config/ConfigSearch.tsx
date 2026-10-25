/**
 * **ConfigSearch** — le champ de recherche globale de la page Configuration et
 * sa liste de résultats.
 *
 * Pattern ARIA « combobox + listbox » (APG) : le focus reste dans le champ,
 * ↑/↓ parcourent les résultats (`aria-activedescendant`), Entrée ouvre, Échap
 * vide. `/` ou `Ctrl/⌘+K` placent le curseur dans le champ depuis n'importe où
 * sur la page. Le moteur est pur (`configSearchEngine.ts`) : ce composant ne fait
 * qu'afficher.
 */
import {
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  Badge,
  Button,
  Code,
  Group,
  Highlight,
  Kbd,
  Paper,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from "@mantine/core";
import { useHotkeys } from "@mantine/hooks";
import { IconSearch } from "@tabler/icons-react";
import { searchConfig, type ConfigSearchDoc } from "./configSearchEngine";
import { SEARCH_PLACEHOLDER } from "./configTexts";

/** Exemples proposés quand le champ est vide (on apprend en cliquant). */
const EXAMPLES = ["port", "session", "durée", "journal", "base", "NF_"];

/** Longueur maximale d'une valeur affichée dans un résultat. */
const VALUE_MAX = 40;

const SOURCE_BADGE: Record<string, { label: string; color: string }> = {
  app: { label: "app", color: "grape" },
  env: { label: "env", color: "teal" },
  runtime: { label: "à chaud", color: "cyan" },
};

export interface ConfigSearchProps {
  /** Index bâti par la page (`buildConfigSearchIndex`). */
  index: readonly ConfigSearchDoc[];
  /** Ouvre un résultat (mène au réglage dans son module ou dans le noyau). */
  onOpen: (doc: ConfigSearchDoc) => void;
}

/** Valeur courte d'un résultat (masquée pour un secret). */
function shortValue(doc: ConfigSearchDoc): string {
  if (doc.field.secret) return "•••••";
  const v = doc.valueText;
  return v.length > VALUE_MAX ? `${v.slice(0, VALUE_MAX - 1)}…` : v;
}

export function ConfigSearch({ index, onOpen }: ConfigSearchProps) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const deferred = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const { hits, total } = useMemo(
    () => searchConfig(index, deferred),
    [index, deferred],
  );
  const terms = useMemo(
    () =>
      deferred
        .trim()
        .split(/\s+/)
        .filter((t) => t.length > 1),
    [deferred],
  );
  const open = query.trim().length > 0;
  const current = Math.min(active, Math.max(hits.length - 1, 0));
  const optionId = (i: number) => `${listId}-opt-${i}`;

  useHotkeys([
    ["/", () => inputRef.current?.focus()],
    ["mod+K", () => inputRef.current?.focus()],
  ]);

  const change = (v: string) => {
    setQuery(v);
    setActive(0);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && hits.length) {
      e.preventDefault();
      setActive((current + 1) % hits.length);
    } else if (e.key === "ArrowUp" && hits.length) {
      e.preventDefault();
      setActive((current - 1 + hits.length) % hits.length);
    } else if (e.key === "Enter" && hits[current]) {
      e.preventDefault();
      onOpen(hits[current].doc);
    } else if (e.key === "Escape") {
      change("");
    }
  };

  return (
    <Stack gap="xs">
      <TextInput
        ref={inputRef}
        value={query}
        onChange={(e) => change(e.currentTarget.value)}
        onKeyDown={onKeyDown}
        placeholder={SEARCH_PLACEHOLDER}
        size="md"
        leftSection={<IconSearch size={18} />}
        // Le raccourci affiché est `/` : le même sur les trois plateformes
        // (`Ctrl/⌘+K` marche aussi, mais son libellé dépendrait du clavier).
        rightSection={
          <Kbd size="xs" aria-hidden>
            /
          </Kbd>
        }
        role="combobox"
        aria-label="Chercher un réglage de configuration dans tous les modules"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={
          open && hits.length ? optionId(current) : undefined
        }
      />

      {!open && (
        <Group gap={6} wrap="wrap">
          <Text size="xs" c="dimmed">
            Essaie :
          </Text>
          {EXAMPLES.map((ex) => (
            <Button
              key={ex}
              size="compact-xs"
              variant="light"
              color="gray"
              onClick={() => {
                change(ex);
                inputRef.current?.focus();
              }}
            >
              {ex}
            </Button>
          ))}
        </Group>
      )}

      {open && (
        <Paper withBorder radius="md" p={0}>
          <Text
            size="xs"
            c="dimmed"
            px="sm"
            py={6}
            aria-live="polite"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {total === 0
              ? `Aucun réglage ne répond à « ${query.trim()} ». Essaie un morceau de clé (port), un mot français (durée) ou une variable (NF_…).`
              : total > hits.length
                ? `${total} réglages trouvés — les ${hits.length} plus pertinents. ↑ ↓ pour choisir, Entrée pour ouvrir.`
                : `${total} réglage(s) trouvé(s). ↑ ↓ pour choisir, Entrée pour ouvrir.`}
          </Text>
          <div
            id={listId}
            role="listbox"
            aria-label="Résultats de la recherche"
            style={{ maxHeight: "min(60vh, 520px)", overflowY: "auto" }}
          >
            {hits.map(({ doc }, i) => {
              const src = doc.field.source
                ? SOURCE_BADGE[doc.field.source]
                : undefined;
              return (
                <UnstyledButton
                  key={`${doc.moduleKey}:${doc.field.key}`}
                  id={optionId(i)}
                  role="option"
                  aria-selected={i === current}
                  tabIndex={-1}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => onOpen(doc)}
                  px="sm"
                  py={8}
                  w="100%"
                  style={{
                    display: "block",
                    borderTop: "1px solid var(--mantine-color-default-border)",
                    background:
                      i === current
                        ? "var(--mantine-color-default-hover)"
                        : undefined,
                  }}
                >
                  <Group gap={8} wrap="nowrap" justify="space-between">
                    <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
                      <Badge
                        size="sm"
                        variant="light"
                        color={doc.isApp ? "brand" : "gray"}
                        tt="none"
                        style={{ flexShrink: 0 }}
                      >
                        {doc.isApp ? "noyau" : doc.moduleName}
                      </Badge>
                      <Highlight
                        highlight={terms}
                        size="sm"
                        ff="monospace"
                        fw={600}
                        style={{ overflowWrap: "anywhere" }}
                      >
                        {doc.field.key}
                      </Highlight>
                      {src && (
                        <Badge
                          size="xs"
                          variant="light"
                          color={src.color}
                          tt="none"
                        >
                          {src.label}
                        </Badge>
                      )}
                    </Group>
                    {doc.valueText || doc.field.secret ? (
                      <Code style={{ fontSize: 11, flexShrink: 0 }}>
                        {shortValue(doc)}
                      </Code>
                    ) : null}
                  </Group>
                  {doc.description && (
                    <Text size="xs" c="dimmed" lineClamp={1} mt={2}>
                      {doc.description}
                    </Text>
                  )}
                  {doc.envVar && (
                    <Text size="xs" c="dimmed" mt={2}>
                      Variable :{" "}
                      <Code style={{ fontSize: 10 }}>
                        {doc.envSet ?? doc.envVar}
                      </Code>
                      {doc.envSet ? " (posée)" : ""}
                    </Text>
                  )}
                </UnstyledButton>
              );
            })}
          </div>
        </Paper>
      )}
    </Stack>
  );
}
