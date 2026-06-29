import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  NavLink,
  rem,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import {
  IconChevronsDown,
  IconChevronsUp,
  IconFileText,
  IconSearch,
} from "@tabler/icons-react";
import { hasRole } from "nodefony/roles";
import { useAuth, useStore } from "../stores";
import { ROLE_NODEFONY_ADMIN, ROLE_SUPERVISOR } from "../auth/roles";
import { useResource } from "../hooks";
import { RoleSwitch } from "../components/RoleSwitch";
import {
  DataState,
  DocLayout,
  DocPageHeader,
  MarkdownDoc,
  PAGE_CONTENT_HEIGHT,
  PageLayout,
} from "../components/ui";
import { LiveGraphSection } from "../realtime/socket/LiveGraphSection";
import { findSocketLiveGraph } from "../realtime/socket/pages";

/* ════════════════════════════════════════════════════════════════════════
 * Documentation — portail unifié `/nodefony/documentation`.
 *
 * Source de vérité = `DocumentationController` (data plane backend, scan FS
 * + frontmatter, index transverse par section). Studio reste GÉNÉRIQUE : il
 * affiche n'importe quel `.md` du repo via `MarkdownDoc` + DocLayout.
 *
 * Graphes live = registry isomorphe `realtime/socket/pages.ts` (composants
 * `*LiveGraph` du dossier). Mapping slug↔composant via `findSocketLiveGraph()`
 * qui accepte les 2 formats (POC court + scan FS long). Une page sans entrée
 * dans le registry rend juste le markdown (pas de bloc « Schéma live »).
 *
 * Cf mémoire [[project_doc_portal_faisabilite]].
 * ════════════════════════════════════════════════════════════════════════ */

type Persona = "developer" | "devops" | "supervisor" | "admin";

/* ─── Types data plane (miroir local — pas d'import serveur) ─────────────── */
interface DocPage {
  slug: string;
  title: string;
  audience?: Persona[];
  version?: string;
  status?: string;
  wip?: boolean;
}
interface DocSection {
  id: string;
  label: string;
  pages: DocPage[];
}
interface DocTree {
  audiences: { key: Persona; label: string; desc: string }[];
  sections: DocSection[];
}
interface DocContent {
  slug: string;
  title: string;
  version?: string;
  /** Statut de page (frontmatter `status`). Reconnu : stable/draft/experimental/deprecated. */
  status?: string;
  /** Date ISO de dernière mise à jour (frontmatter `updated` ou git mtime). */
  updated?: string;
  /** URL absolue de la source markdown (lien « Modifier sur GitHub »). */
  sourceUrl?: string;
  vars?: Record<string, string | number>;
  markdown: string;
  temporary?: boolean;
}

function resolveVars(
  md: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return md;
  return md.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) =>
    k in vars ? String(vars[k]) : m,
  );
}

/**
 * Persona de lecture par défaut, dérivé du RÔLE réel de l'utilisateur (admin →
 * tout, superviseur → exploitation, sinon développeur). Avant : figé sur
 * « developer » sans aucun lien avec l'identité (la doc s'affichait pareil pour
 * tout le monde). Le `RoleSwitch` permet ensuite d'explorer la doc des autres
 * personas — le défaut reflète juste qui on est.
 */
function personaForRoles(roles: string[]): Persona {
  if (hasRole(roles, ROLE_NODEFONY_ADMIN)) return "admin";
  if (hasRole(roles, ROLE_SUPERVISOR)) return "supervisor";
  return "developer";
}

/* ════════════════════════════════════════════════════════════════════════
 * PAGE
 * ════════════════════════════════════════════════════════════════════════ */
export const Documentation = observer(() => {
  const store = useStore();
  const auth = useAuth();
  // Défaut = le persona correspondant au rôle de l'utilisateur (réactif MobX :
  // le composant est `observer`). Modifiable ensuite via le RoleSwitch.
  const [persona, setPersona] = useState<Persona>(() =>
    personaForRoles(auth.roles),
  );

  const treeFetcher = useCallback(
    () => store.api.getAbsolute<DocTree>("/nodefony/documentation/api/tree"),
    [store],
  );
  const tree = useResource(treeFetcher);

  // Routing — `?doc=<slug>` (deep-link + F5 + bouton retour navigateur OK).
  // Fallback ROBUSTE = 1re page réelle de l'arbre (scan FS backend) plutôt qu'un
  // slug codé en dur qui casse si le fichier est renommé/déplacé. Tant que
  // l'arbre n'est pas chargé, on retombe sur la 1re page Socket connue (évite la
  // page blanche au tout premier paint).
  const [params, setParams] = useSearchParams();
  const firstSlug = tree.data?.sections.find((s) => s.pages.length > 0)
    ?.pages[0]?.slug;
  const activeSlug =
    params.get("doc") ?? firstSlug ?? "root~realtime~socket~01-vue-ensemble";
  const setActiveSlug = useCallback(
    (slug: string) => setParams({ doc: slug }, { replace: false }),
    [setParams],
  );

  /**
   * Réécrit un lien `./<file>.md` (relatif au dossier du MD courant) vers le
   * slug portail correspondant. Le préfixe « dossier » est tout ce qui précède
   * le dernier `~` du slug actuel — ex. `root~realtime~socket~04-fan-out` →
   * préfixe `root~realtime~socket~`. On rappelle `setActiveSlug` et on retourne
   * `true` pour empêcher la navigation par défaut (qui ferait 404).
   *
   * Si le slug actuel n'a pas de `~` (cas spécial : `migration`, etc.), on
   * laisse `MarkdownDoc` rendre le lien en ancre normale (`return false`).
   */
  const onInternalLink = useCallback(
    (shortSlug: string): boolean => {
      if (!activeSlug.includes("~")) return false;
      const prefix = activeSlug.replace(/[^~]+$/, "");
      setActiveSlug(prefix + shortSlug);
      return true;
    },
    [activeSlug, setActiveSlug],
  );
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [navQuery, setNavQuery] = useState("");

  const pageFetcher = useCallback(
    () =>
      store.api.getAbsolute<DocContent>(
        `/nodefony/documentation/api/page/${encodeURIComponent(activeSlug)}`,
      ),
    [store, activeSlug],
  );
  const page = useResource(pageFetcher);

  const visible = (audience?: Persona[]) =>
    persona === "admin" || !audience || audience.includes(persona);

  const sections = tree.data?.sections ?? [];
  const markdown = page.data
    ? resolveVars(page.data.markdown, page.data.vars)
    : "";
  // Graphe live optionnel — pour l'instant uniquement les pages Socket.
  const LiveGraph = findSocketLiveGraph(activeSlug);

  // Recherche dans la nav : filtre les pages (titre) ; déplie les sections trouvées.
  const navQ = navQuery.trim().toLowerCase();
  const navSections = sections
    .map((s) => ({
      ...s,
      pages: s.pages.filter(
        (p) =>
          visible(p.audience) &&
          (!navQ || p.title.toLowerCase().includes(navQ)),
      ),
    }))
    .filter((s) => s.pages.length > 0);

  // Breadcrumb : section qui contient la page active (sinon racine seule).
  const activeSection = sections.find((s) =>
    s.pages.some((p) => p.slug === activeSlug),
  );
  const breadcrumbs = activeSection
    ? ["Documentation", activeSection.label]
    : ["Documentation"];

  // À l'arrivée OU au changement de page active, déplie automatiquement la
  // section qui la contient → l'utilisateur voit immédiatement le surlignage
  // de la page courante (sinon la section est repliée par défaut et le
  // NavLink actif reste invisible).
  useEffect(() => {
    if (!activeSection) return;
    setCollapsed((c) =>
      c[activeSection.id] === false ? c : { ...c, [activeSection.id]: false },
    );
  }, [activeSection]);
  const expandAll = () =>
    setCollapsed(Object.fromEntries(sections.map((s) => [s.id, false])));
  const collapseAll = () =>
    setCollapsed(Object.fromEntries(sections.map((s) => [s.id, true])));

  return (
    <PageLayout
      title="Documentation"
      subtitle="Portail unifié — sections, audiences, doc dynamique"
      icon={<IconFileText size={22} />}
      actions={
        <RoleSwitch
          value={persona}
          onChange={(v) => setPersona(v as Persona)}
          size="sm"
        />
      }
    >
      <DocLayout
        navTitle="Documentation"
        navActions={
          <Group gap={2} wrap="nowrap">
            <Tooltip label="Tout déplier">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={expandAll}
                aria-label="Tout déplier"
              >
                <IconChevronsDown size={15} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Tout plier">
              <ActionIcon
                variant="subtle"
                color="gray"
                size="sm"
                onClick={collapseAll}
                aria-label="Tout plier"
              >
                <IconChevronsUp size={15} />
              </ActionIcon>
            </Tooltip>
          </Group>
        }
        navSearch={
          <TextInput
            size="xs"
            mb={6}
            placeholder="Rechercher une page…"
            value={navQuery}
            onChange={(e) => setNavQuery(e.currentTarget.value)}
            leftSection={<IconSearch size={13} />}
            aria-label="Rechercher dans la documentation"
          />
        }
        nav={
          <DataState
            loading={tree.loading && !tree.data}
            error={tree.error}
            onRetry={tree.reload}
            minHeight={120}
          >
            <Stack gap={2}>
              {navSections.map((s) => {
                // En recherche → toujours déplié ; sinon tout plié par défaut.
                const isCollapsed = navQ ? false : (collapsed[s.id] ?? true);
                return (
                  <NavLink
                    key={s.id}
                    // Mantine NavLink hiérarchique : chevron auto-animé,
                    // children = NavLink imbriqués (cohérent avec le reste du
                    // shell Studio, plus propre que UnstyledButton + Collapse
                    // hand-rolled).
                    label={
                      <Group
                        gap={6}
                        wrap="nowrap"
                        justify="space-between"
                        style={{ width: "100%" }}
                      >
                        <Text
                          size="xs"
                          fw={700}
                          tt="uppercase"
                          c="dimmed"
                          style={{ letterSpacing: "0.04em" }}
                        >
                          {s.label}
                        </Text>
                        <Badge size="xs" variant="default" radius="sm">
                          {s.pages.length}
                        </Badge>
                      </Group>
                    }
                    opened={!isCollapsed}
                    onChange={(o) =>
                      setCollapsed((c) => ({ ...c, [s.id]: !o }))
                    }
                    childrenOffset={14}
                    styles={{ root: { borderRadius: rem(6) } }}
                  >
                    {s.pages.map((p) => (
                      <NavLink
                        key={p.slug}
                        active={p.slug === activeSlug}
                        label={p.title}
                        leftSection={<IconFileText size={14} />}
                        rightSection={
                          p.wip ? (
                            <Badge size="xs" variant="light" color="gray">
                              à venir
                            </Badge>
                          ) : undefined
                        }
                        disabled={p.wip}
                        onClick={() => !p.wip && setActiveSlug(p.slug)}
                        styles={{
                          root: { borderRadius: rem(6) },
                          label: { fontSize: rem(12.5) },
                        }}
                      />
                    ))}
                  </NavLink>
                );
              })}
              {!navSections.length && (
                <Text size="xs" c="dimmed" px="xs" py={4}>
                  Aucune page ne correspond.
                </Text>
              )}
            </Stack>
          </DataState>
        }
        title={
          <DocPageHeader
            breadcrumbs={breadcrumbs}
            title={page.data?.title ?? "—"}
            version={page.data?.version}
            status={page.data?.temporary ? "temporary" : page.data?.status}
            updated={page.data?.updated}
            sourceUrl={page.data?.sourceUrl}
          />
        }
        tocMarkdown={markdown}
        mode="container"
        height={PAGE_CONTENT_HEIGHT}
      >
        <DataState
          loading={page.loading && !page.data}
          error={page.error}
          onRetry={page.reload}
          minHeight={300}
        >
          {page.data?.temporary && (
            <Alert
              color="yellow"
              variant="light"
              icon={<IconFileText size={18} />}
              mb="md"
            >
              Page <b>temporaire</b> branchée pour ta lecture — contenu lu en
              direct depuis le fichier du repo. Le vrai module gérera ça
              proprement.
            </Alert>
          )}
          <MarkdownDoc
            markdown={markdown}
            maxWidth={1000}
            onInternalLink={onInternalLink}
          />
          {LiveGraph && (
            <LiveGraphSection
              LiveGraph={LiveGraph}
              height={560}
              title={`Schéma live — ${page.data?.title ?? "page"}`}
            />
          )}
        </DataState>
      </DocLayout>
    </PageLayout>
  );
});

export default Documentation;
