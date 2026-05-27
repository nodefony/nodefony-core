import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  Box,
  Group,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
  rem,
} from "@mantine/core";
import { IconList, IconSearch } from "@tabler/icons-react";

/* ════════════════════════════════════════════════════════════════════════
 * DocToc — sommaire « sur cette page » GÉNÉRIQUE (titres d'un markdown).
 *
 * Ergonomie d'un bon sommaire de doc (cf MDN/React docs) :
 *  - généré automatiquement des titres `##`/`###` (algo, 0 saisie manuelle) ;
 *  - **scrollspy** : la section visible est surlignée (repère de position) ;
 *  - **recherche** : filtre les entrées dès qu'il y en a beaucoup ;
 *  - **smooth scroll** au clic + indentation par niveau.
 * Les `id` des titres sont posés par `MarkdownDoc` via le MÊME `slugifyHeading`.
 * ════════════════════════════════════════════════════════════════════════ */

export interface TocHeading {
  level: number;
  text: string;
  id: string;
}

/** Slug déterministe d'un titre (partagé entre TOC et titres rendus). */
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents combinés
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Extrait les titres markdown (niveaux min→max), hors blocs de code ```. */
export function extractHeadings(
  markdown: string,
  min = 2,
  max = 3,
): TocHeading[] {
  if (!markdown) return [];
  const out: TocHeading[] = [];
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    const level = m[1].length;
    if (level < min || level > max) continue;
    const text = m[2].replace(/[*_`]/g, "").trim();
    if (text) out.push({ level, text, id: slugifyHeading(text) });
  }
  return out;
}

export interface DocTocProps {
  markdown: string;
  /** Conteneur scrollable (viewport ScrollArea) pour le scrollspy. Sinon viewport. */
  scrollRootRef?: RefObject<HTMLElement | null>;
  minLevel?: number;
  maxLevel?: number;
  /**
   * Si fourni → panneau auto-porté : en-tête FIXE + liste qui scrolle (flex column,
   * `maxHeight`). Robuste (≠ `position:sticky` dans un `ScrollArea` Mantine, cassé).
   * Sinon → en-tête + liste en flux (le parent gère le scroll).
   */
  maxHeight?: string;
}

export function DocToc({
  markdown,
  scrollRootRef,
  minLevel = 2,
  maxLevel = 3,
  maxHeight,
}: DocTocProps) {
  const headings = useMemo(
    () => extractHeadings(markdown, minLevel, maxLevel),
    [markdown, minLevel, maxLevel],
  );
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const baseLevel = useRef(minLevel);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t
      ? headings.filter((h) => h.text.toLowerCase().includes(t))
      : headings;
  }, [headings, q]);

  // Scrollspy : surligne le titre actuellement en haut de la zone de lecture.
  useEffect(() => {
    if (!headings.length) return;
    const els = headings
      .map((h) => document.getElementById(h.id))
      .filter((el): el is HTMLElement => el !== null);
    if (!els.length) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          )[0];
        if (top) setActiveId(top.target.id);
      },
      {
        root: scrollRootRef?.current ?? null,
        rootMargin: "0px 0px -70% 0px",
        threshold: 0,
      },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [headings, scrollRootRef]);

  if (!headings.length) return null;

  const go = (id: string) => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document
      .getElementById(id)
      ?.scrollIntoView({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
    setActiveId(id);
  };

  const header = (
    <Box style={{ flexShrink: 0 }}>
      <Group gap={6} mb={6} px="xs">
        <IconList size={14} />
        <Text size="xs" fw={700} tt="uppercase" c="dimmed">
          Sur cette page
        </Text>
      </Group>
      {headings.length > 8 && (
        <TextInput
          size="xs"
          mb={6}
          placeholder="Filtrer le sommaire…"
          value={q}
          onChange={(e) => setQ(e.currentTarget.value)}
          leftSection={<IconSearch size={13} />}
          aria-label="Filtrer le sommaire"
        />
      )}
    </Box>
  );

  const list = (
    <Stack gap={1}>
      {filtered.map((h) => {
        const active = h.id === activeId;
        return (
          <UnstyledButton
            key={h.id}
            onClick={() => go(h.id)}
            style={{
              paddingLeft: rem((h.level - baseLevel.current) * 12 + 10),
              paddingTop: rem(3),
              paddingBottom: rem(3),
              borderLeft: `2px solid ${active ? "var(--mantine-primary-color-filled)" : "transparent"}`,
            }}
          >
            <Text
              size="xs"
              lineClamp={2}
              c={active ? undefined : "dimmed"}
              fw={active ? 600 : 400}
            >
              {h.text}
            </Text>
          </UnstyledButton>
        );
      })}
      {!filtered.length && (
        <Text size="xs" c="dimmed" px="xs" py={4}>
          Aucun titre ne correspond.
        </Text>
      )}
    </Stack>
  );

  // En-tête FIXE + liste scrollable (flex column) si maxHeight ; sinon flux simple.
  if (maxHeight) {
    return (
      <Box
        style={{
          display: "flex",
          flexDirection: "column",
          maxHeight,
          minHeight: 0,
        }}
      >
        {header}
        <ScrollArea type="hover" style={{ flex: 1, minHeight: 0 }}>
          {list}
        </ScrollArea>
      </Box>
    );
  }
  return (
    <Box>
      {header}
      {list}
    </Box>
  );
}

export default DocToc;
