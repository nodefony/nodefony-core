import { observer } from "mobx-react-lite";
import { useSearchParams } from "react-router-dom";
import { Badge, Code, Group, NavLink, Stack, Text, rem } from "@mantine/core";
import {
  IconBroadcast,
  IconCircleDot,
  IconFileText,
} from "@tabler/icons-react";
import { useNodefonyState } from "nodefony/react";
import {
  DocLayout,
  DocPageHeader,
  MarkdownDoc,
  PageHeader,
} from "../components/ui";
import { LiveGraphSection } from "../realtime/socket/LiveGraphSection";
import { findSocketPage, socketPages } from "../realtime/socket/pages";

/* ════════════════════════════════════════════════════════════════════════
 * SocketPocPage — Phases A → C.
 *
 * Consomme le **registry** `realtime/socket/pages.ts` (Vite glob sur
 * `docs/realtime/socket/*.md`). Ajouter un fichier MD → il apparaît
 * automatiquement dans la nav. La page active vient du query string
 * `?sub=<slug>` (deep-link OK, F5 OK, mono-segment route — pas de fallback
 * SPA backend à ajouter).
 *
 * Les graphes live sont déclarés DANS le registry (`LIVE_GRAPHS[slug]`).
 * Une page sans entrée n'affiche pas de bloc « Schéma live ».
 * ════════════════════════════════════════════════════════════════════════ */

export const SocketPocPage = observer(() => {
  const [params, setParams] = useSearchParams();
  const activeSlug = params.get("sub") ?? socketPages[0]?.slug ?? "";
  const page = findSocketPage(activeSlug);
  const clientState = useNodefonyState();

  const sourceUrl = page.meta.source
    ? `https://github.com/nodefony/nodefony-core/edit/claude-ts/${page.meta.source}`
    : `https://github.com/nodefony/nodefony-core/edit/claude-ts/${page.sourcePath}`;

  return (
    <Stack gap="md">
      <PageHeader
        title="La Socket Nodefony — documentation"
        subtitle={
          <Group gap={6} wrap="wrap">
            <Text component="span" size="sm" c="dimmed">
              Source :
            </Text>
            <Code>{page.sourcePath}</Code>
            <Text component="span" size="sm" c="dimmed">
              · édite le fichier, Vite recharge (HMR).
            </Text>
            <Badge
              color={clientState === "connected" ? "teal" : "gray"}
              variant="dot"
              ml="xs"
            >
              client : {clientState}
            </Badge>
          </Group>
        }
        icon={<IconBroadcast size={22} />}
        sticky
      />
      <DocLayout
        navTitle="La Socket"
        nav={
          <Stack gap={2}>
            {socketPages.map((p) => (
              <NavLink
                key={p.slug}
                active={p.slug === activeSlug}
                label={
                  <Group gap={6} wrap="nowrap">
                    <Text
                      size="xs"
                      c="dimmed"
                      style={{ fontVariantNumeric: "tabular-nums" }}
                    >
                      {String(p.order).padStart(2, "0")}
                    </Text>
                    <Text size="sm" lineClamp={1} style={{ flex: 1 }}>
                      {p.title}
                    </Text>
                  </Group>
                }
                leftSection={
                  p.LiveGraph ? (
                    <IconCircleDot
                      size={14}
                      color="var(--mantine-color-teal-5)"
                    />
                  ) : (
                    <IconFileText size={14} />
                  )
                }
                onClick={() => setParams({ sub: p.slug })}
                styles={{ label: { fontSize: rem(13) } }}
              />
            ))}
          </Stack>
        }
        title={
          <DocPageHeader
            breadcrumbs={["Documentation", "Realtime", "Socket"]}
            title={page.meta.title ?? page.title}
            version={page.meta.version}
            status={page.meta.status}
            updated={page.meta.updated}
            sourceUrl={sourceUrl}
          />
        }
        tocMarkdown={page.body}
        mode="page"
      >
        <MarkdownDoc markdown={page.body} />
        {page.LiveGraph && (
          <LiveGraphSection
            LiveGraph={page.LiveGraph}
            height={560}
            title={`Schéma live — ${page.title}`}
          />
        )}
      </DocLayout>
    </Stack>
  );
});

export default SocketPocPage;
