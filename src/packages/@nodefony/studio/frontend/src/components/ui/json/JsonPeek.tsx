/**
 * **JsonPeek** — déclencheur **compact** qui ouvre une {@link JsonCard} au survol
 * (et au focus clavier) : un aperçu une-ligne (`jsonPreview`) cliquable/survolable
 * → `HoverCard` contenant la carte JSON complète. Le « pophover » prêt à l'emploi
 * pour montrer un payload sans encombrer la ligne (cellule de table, message WS…).
 *
 * La carte n'est montée (et le JSON sérialisé) **qu'à l'ouverture** du survol →
 * 0 coût tant qu'on ne pointe pas. Rendu TEXTE → sûr pour données non maîtrisées.
 */
import { Code, HoverCard } from "@mantine/core";
import type { ReactNode } from "react";
import { JsonCard } from "./JsonCard";
import { jsonPreview } from "./jsonFormat";

export interface JsonPeekProps {
  /** Valeur JSON à prévisualiser / détailler. */
  value: unknown;
  /** Texte du déclencheur (défaut = aperçu compact de `value`). */
  label?: ReactNode;
  /** Longueur max de l'aperçu auto (défaut 48). */
  previewLength?: number;
  /** Titre de la carte ouverte. */
  title?: ReactNode;
  /** Largeur de la carte (px). Défaut 380. */
  width?: number;
  /** Hauteur max scrollable de la carte (px). Défaut 320. */
  maxHeight?: number;
}

/** Aperçu JSON cliquable → carte détaillée en `HoverCard` (lazy). */
export function JsonPeek({
  value,
  label,
  previewLength = 48,
  title,
  width = 380,
  maxHeight = 320,
}: JsonPeekProps) {
  return (
    <HoverCard
      width={width}
      shadow="md"
      radius="md"
      withArrow
      openDelay={120}
      closeDelay={120}
      position="top"
      withinPortal
    >
      <HoverCard.Target>
        <Code
          tabIndex={0}
          style={{ cursor: "pointer", whiteSpace: "nowrap" }}
          aria-label="Aperçu JSON — survoler pour le détail"
        >
          {label ?? jsonPreview(value, previewLength)}
        </Code>
      </HoverCard.Target>
      <HoverCard.Dropdown p="xs">
        <JsonCard
          value={value}
          title={title}
          width={width - 24}
          maxHeight={maxHeight}
          toolbar
        />
      </HoverCard.Dropdown>
    </HoverCard>
  );
}
