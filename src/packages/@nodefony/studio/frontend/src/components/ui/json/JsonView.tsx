/**
 * **JsonView** — moteur de la famille JSON : arbre **repliable** d'une valeur
 * JSON, avec aperçu compact des nœuds repliés, couleurs par type (adaptatives
 * dark/light), et bascule **Arbre ↔ Brut**. Toolbar : tout déplier / tout
 * replier / copier.
 *
 * 100 % TEXTE (`<span>` / `<Code>`), jamais d'HTML injecté → rendu sûr pour des
 * données serveur non maîtrisées (messages WebSocket, réponses data plane…).
 * Perf : profondeur ouverte bornée (`defaultExpandedDepth`), enfants plafonnés
 * (`MAX_CHILDREN`) avec révélation à la demande, styles hissés au module.
 */
import { type CSSProperties, useEffect, useMemo, useState } from "react";
import {
  ActionIcon,
  Badge,
  Box,
  Code,
  Group,
  SegmentedControl,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconCheck,
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconCopy,
} from "@tabler/icons-react";
import {
  JSON_KIND_COLOR,
  countLabel,
  isExpandable,
  jsonKind,
  jsonPreview,
  primitiveText,
  safeStringify,
} from "./jsonFormat";

/** Plafond d'enfants rendus d'un coup (au-delà → « +N de plus »). */
const MAX_CHILDREN = 100;
/** Indentation horizontale par niveau (px). */
const IND = 14;

const ROW: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  alignItems: "baseline",
  gap: 4,
  lineHeight: 1.55,
};
const KEY_STYLE: CSSProperties = {
  color: "light-dark(var(--mantine-color-gray-9), var(--mantine-color-gray-2))",
  fontWeight: 600,
};
const PUNCT: CSSProperties = { color: "var(--mantine-color-dimmed)" };
const PREVIEW: CSSProperties = {
  color: "var(--mantine-color-dimmed)",
  fontStyle: "italic",
  whiteSpace: "pre",
};
const FONT: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "var(--mantine-font-size-xs)",
  fontVariantNumeric: "tabular-nums",
};

/** Signal d'ouverture/fermeture en masse propagé du toolbar aux nœuds. */
interface ExpandSignal {
  /** Jeton qui change à chaque action (force le re-sync des nœuds). */
  v: number;
  /** `true` = tout déplier ; `false` = tout replier. */
  open: boolean;
}

function Chevron({ open }: { open: boolean }) {
  return (
    <IconChevronRight
      size={13}
      style={{
        flexShrink: 0,
        transition: "transform 120ms ease",
        transform: open ? "rotate(90deg)" : "none",
        color: "var(--mantine-color-dimmed)",
      }}
    />
  );
}

interface JsonNodeProps {
  /** Clé / index parent (absent à la racine). */
  name?: string;
  value: unknown;
  depth: number;
  defaultExpandedDepth: number;
  /** Dernier enfant de son parent → pas de virgule de fin. */
  isLast: boolean;
  signal: ExpandSignal | null;
}

/** Un nœud de l'arbre — récursif. Primitive = 1 ligne ; objet/array = repliable. */
function JsonNode({
  name,
  value,
  depth,
  defaultExpandedDepth,
  isLast,
  signal,
}: JsonNodeProps) {
  const kind = jsonKind(value);
  const expandable = isExpandable(value);
  const [open, setOpen] = useState(depth < defaultExpandedDepth);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (signal) setOpen(signal.open);
  }, [signal]);

  const keyEl =
    name !== undefined ? (
      <>
        <span style={KEY_STYLE}>{name}</span>
        <span style={PUNCT}>:</span>
      </>
    ) : null;
  const comma = !isLast ? <span style={PUNCT}>,</span> : null;

  // Primitive, ou objet/tableau VIDE → une seule ligne.
  if (!expandable) {
    const text =
      kind === "object" ? "{}" : kind === "array" ? "[]" : primitiveText(value);
    return (
      <div style={{ ...ROW, paddingLeft: depth * IND }}>
        {keyEl}
        <span
          style={{
            color: JSON_KIND_COLOR[kind],
            fontStyle: kind === "null" ? "italic" : undefined,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {text}
        </span>
        {comma}
      </div>
    );
  }

  const isArr = Array.isArray(value);
  const entries: [string, unknown][] = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v])
    : Object.entries(value as Record<string, unknown>);
  const openBr = isArr ? "[" : "{";
  const closeBr = isArr ? "]" : "}";
  const shown = showAll ? entries : entries.slice(0, MAX_CHILDREN);
  const hidden = entries.length - shown.length;

  return (
    <div>
      <div
        style={{ ...ROW, paddingLeft: depth * IND, cursor: "pointer" }}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${name ?? openBr} — ${open ? "replier" : "déplier"}`}
      >
        <Chevron open={open} />
        {keyEl}
        <span style={PUNCT}>{openBr}</span>
        {open ? null : (
          <>
            <span style={PREVIEW}> {jsonPreview(value, 56)} </span>
            <span style={PUNCT}>{closeBr}</span>
            {comma}
          </>
        )}
        <Badge size="xs" variant="light" color="gray" style={{ flexShrink: 0 }}>
          {countLabel(value)}
        </Badge>
      </div>
      {open ? (
        <>
          {shown.map(([k, v], i) => (
            <JsonNode
              key={k}
              name={k}
              value={v}
              depth={depth + 1}
              defaultExpandedDepth={defaultExpandedDepth}
              isLast={i === shown.length - 1 && hidden === 0}
              signal={signal}
            />
          ))}
          {hidden > 0 ? (
            <Box
              style={{ paddingLeft: (depth + 1) * IND }}
              onClick={() => setShowAll(true)}
            >
              <Text
                size="xs"
                c="dimmed"
                style={{
                  cursor: "pointer",
                  textDecoration: "underline dotted",
                }}
              >
                +{hidden} de plus…
              </Text>
            </Box>
          ) : null}
          <div style={{ ...ROW, paddingLeft: depth * IND }}>
            <span style={PUNCT}>{closeBr}</span>
            {comma}
          </div>
        </>
      ) : null}
    </div>
  );
}

/** État + handler de copie presse-papier (feedback 1,2 s). */
function useCopy(text: string): { copied: boolean; copy: () => void } {
  const [copied, setCopied] = useState(false);
  const copy = (): void => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    });
  };
  return { copied, copy };
}

export interface JsonViewProps {
  /** Valeur à afficher (objet, tableau, primitive…). */
  value: unknown;
  /** Hauteur max scrollable (px). Défaut 420. */
  maxHeight?: number;
  /** Profondeur ouverte par défaut (0 = tout replié à la racine). Défaut 1. */
  defaultExpandedDepth?: number;
  /** Affiche la barre d'outils (mode, déplier/replier, copier). Défaut `true`. */
  toolbar?: boolean;
}

/**
 * Vue JSON riche réutilisable — arbre repliable + bascule Brut, avec copie.
 * Brique de base ; pour un aperçu en survol utiliser `JsonPeek`, pour une carte
 * compacte autonome `JsonCard`.
 */
export function JsonView({
  value,
  maxHeight = 420,
  defaultExpandedDepth = 1,
  toolbar = true,
}: JsonViewProps) {
  const [mode, setMode] = useState<"tree" | "raw">("tree");
  const [signal, setSignal] = useState<ExpandSignal | null>(null);
  const raw = useMemo(() => safeStringify(value), [value]);
  const { copied, copy } = useCopy(raw);

  return (
    <Box>
      {toolbar ? (
        <Group justify="space-between" gap="xs" mb={6} wrap="nowrap">
          <SegmentedControl
            size="xs"
            value={mode}
            onChange={(v) => setMode(v as "tree" | "raw")}
            data={[
              { label: "Arbre", value: "tree" },
              { label: "Brut", value: "raw" },
            ]}
          />
          <Group gap={4} wrap="nowrap">
            {mode === "tree" ? (
              <>
                <Tooltip label="Tout déplier">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label="Tout déplier"
                    onClick={() => setSignal({ v: Date.now(), open: true })}
                  >
                    <IconChevronsDown size={15} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Tout replier">
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    size="sm"
                    aria-label="Tout replier"
                    onClick={() => setSignal({ v: Date.now(), open: false })}
                  >
                    <IconChevronsUp size={15} />
                  </ActionIcon>
                </Tooltip>
              </>
            ) : null}
            <Tooltip label={copied ? "Copié" : "Copier le JSON"}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                aria-label="Copier le JSON"
                onClick={copy}
              >
                {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
              </ActionIcon>
            </Tooltip>
          </Group>
        </Group>
      ) : null}

      {mode === "tree" ? (
        <Box style={{ ...FONT, maxHeight, overflow: "auto" }}>
          <JsonNode
            value={value}
            depth={0}
            defaultExpandedDepth={defaultExpandedDepth}
            isLast
            signal={signal}
          />
        </Box>
      ) : (
        <Code
          block
          style={{
            maxHeight,
            overflow: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {raw}
        </Code>
      )}
    </Box>
  );
}
