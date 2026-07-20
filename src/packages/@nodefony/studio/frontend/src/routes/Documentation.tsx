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
  IconChevronRight,
  IconChevronsDown,
  IconChevronsUp,
  IconFileText,
  IconHome,
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

/* ════════════════════════════════════════════════════════════════════════
 * Documentation — portail unifié `/nodefony/documentation`.
 *
 * Source de vérité = `DocumentationController` (data plane backend, scan FS
 * + frontmatter, index transverse par section). Studio reste GÉNÉRIQUE : il
 * affiche n'importe quel `.md` du repo via `MarkdownDoc` + DocLayout.
 *
 * Graphes live : plus rien à câbler ICI. Une page qui veut un schéma vivant
 * pose une fence ```nodefony-livegraph — `MarkdownDoc` la résout contre le
 * registre `realtime/socket/liveGraphs.ts` et monte le composant AU FIL du
 * propos. Avant, le graphe était injecté par SLUG et collé en pied de page :
 * réservé aux pages d'un seul dossier, et jamais là où il expliquait quelque
 * chose.
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
  /** `true` pour un `index.md` : le point d'entrée de sa section. */
  isHub?: boolean;
}
interface DocSection {
  id: string;
  label: string;
  /** Nom du module propriétaire — absent pour une section de `docs/` racine. */
  module?: string;
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
  // Sans `?doc=`, on ouvre le HUB GLOBAL (`docs/index.md`) : c'est le point
  // d'entrée de la documentation, celui qui porte les parcours guidés et le
  // catalogue. À défaut (corpus sans hub racine), le premier hub rencontré,
  // puis seulement la première page — jamais une page arbitraire en accueil.
  const sections = tree.data?.sections ?? [];
  const allPages = sections.flatMap((s) => s.pages);
  const homeSlug =
    allPages.find((p) => p.slug === "root~index")?.slug ??
    allPages.find((p) => p.isHub)?.slug ??
    allPages[0]?.slug;
  const activeSlug = params.get("doc") ?? homeSlug ?? "root~index";
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
    (target: string): boolean => {
      // Le serveur traduit désormais TOUS les liens internes en slugs complets
      // (`DocumentationService.#resolveLinks`) : un slug commence par `root~` ou
      // `mod~`. On navigue tel quel — lui recoller un préfixe fabriquerait
      // `root~architecture~root~index` et garantirait un 404.
      if (/^(root|mod)~/.test(target)) {
        setActiveSlug(target);
        return true;
      }
      // Repli historique : lien plat écrit dans une page pas encore servie par le
      // résolveur — on le résout dans le dossier de la page courante.
      if (!activeSlug.includes("~")) return false;
      const prefix = activeSlug.replace(/[^~]+$/, "");
      setActiveSlug(prefix + target);
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

  const markdown = page.data
    ? resolveVars(page.data.markdown, page.data.vars)
    : "";
  // Recherche dans la nav : filtre les pages (titre) ; déplie les sections trouvées.
  const navQ = navQuery.trim().toLowerCase();
  const navSections = sections
    .map((s) => ({
      ...s,
      // « Module security » → « security » : le préfixe, répété 13 fois, est du
      // bruit ; c'est la FAMILLE (ci-dessous) qui porte l'information.
      label: s.module ? s.label.replace(/^Module\s+/i, "") : s.label,
      pages: s.pages.filter(
        (p) =>
          visible(p.audience) &&
          (!navQ || p.title.toLowerCase().includes(navQ)),
      ),
    }))
    .filter((s) => s.pages.length > 0);

  /**
   * Le menu était illisible non par manque de repli, mais parce qu'il alignait
   * **20 sections au même niveau**, par ordre alphabétique : « ADR » et
   * « Audits » (références internes) y côtoyaient les modules et l'architecture.
   * On les range en trois familles, dans l'ordre où on en a besoin — sans
   * ajouter de niveau cliquable (les sections restent à un clic).
   */
  const NAV_FAMILIES: {
    key: string;
    label: string;
    match: (s: DocSection) => boolean;
  }[] = [
    {
      key: "guides",
      label: "Comprendre & construire",
      match: (s) =>
        !s.module && /architecture|guide|racine|tutoriel/i.test(s.label),
    },
    { key: "modules", label: "Modules", match: (s) => Boolean(s.module) },
    { key: "refs", label: "Références internes", match: () => true },
  ];
  const navFamilies = NAV_FAMILIES.map((f) => ({
    ...f,
    sections: navSections.filter(
      (s) =>
        f.match(s) &&
        !NAV_FAMILIES.slice(0, NAV_FAMILIES.indexOf(f)).some((prev) =>
          prev.match(s),
        ),
    ),
  })).filter((f) => f.sections.length > 0);

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
              {/* Retour à l'accueil : toujours en tête, jamais enfoui dans une
                  section — c'est le point d'entrée de toute la documentation. */}
              {!navQ && homeSlug ? (
                <NavLink
                  active={activeSlug === homeSlug}
                  label="Accueil"
                  fw={600}
                  leftSection={<IconHome size={15} />}
                  onClick={() => setActiveSlug(homeSlug)}
                  styles={{ root: { borderRadius: rem(6) } }}
                />
              ) : null}
              {navFamilies.map((fam) => (
                <Stack key={fam.key} gap={2} mt={6}>
                  <Text
                    size="10px"
                    fw={700}
                    tt="uppercase"
                    c="dimmed"
                    px={8}
                    style={{ letterSpacing: "0.08em" }}
                  >
                    {fam.label}
                  </Text>
                  {fam.sections.map((s) => {
                    // En recherche → toujours déplié ; sinon tout plié par défaut.
                    const isCollapsed = navQ
                      ? false
                      : (collapsed[s.id] ?? true);
                    // Le hub du module = sa porte d'entrée. Ouvrir un module doit
                    // AMENER QUELQUE PART : déplier une liste de titres sans rien
                    // afficher laisse le lecteur choisir avant d'avoir compris.
                    const hub = s.pages.find((p) => p.isHub) ?? s.pages[0];
                    const onHub = hub ? activeSlug === hub.slug : false;
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
                        active={onHub}
                        // DEUX gestes distincts sur deux cibles distinctes. Le
                        // toggle automatique de Mantine (`onChange`) est retiré :
                        // laissé en place, il se déclenchait AUSSI au clic sur le
                        // corps et se battait avec la navigation — un clic pliait
                        // et dépliait dans le même mouvement.
                        onClick={() => {
                          // Le CORPS mène au hub, et déplie pour montrer la suite.
                          setCollapsed((c) => ({ ...c, [s.id]: false }));
                          if (hub) setActiveSlug(hub.slug);
                        }}
                        rightSection={
                          <ActionIcon
                            component="div"
                            role="button"
                            tabIndex={0}
                            variant="subtle"
                            color="gray"
                            size="sm"
                            aria-label={
                              isCollapsed
                                ? `Déplier ${s.label}`
                                : `Replier ${s.label}`
                            }
                            aria-expanded={!isCollapsed}
                            // Le CHEVRON ne fait QUE plier/déplier : il ne navigue
                            // pas. D'où l'arrêt de propagation — sans lui, le clic
                            // remonterait au NavLink et ouvrirait le hub.
                            onClick={(e) => {
                              e.stopPropagation();
                              setCollapsed((c) => ({
                                ...c,
                                [s.id]: !isCollapsed,
                              }));
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                setCollapsed((c) => ({
                                  ...c,
                                  [s.id]: !isCollapsed,
                                }));
                              }
                            }}
                          >
                            <IconChevronRight
                              size={14}
                              style={{
                                transition: "transform 150ms ease",
                                transform: isCollapsed
                                  ? "rotate(0deg)"
                                  : "rotate(90deg)",
                              }}
                            />
                          </ActionIcon>
                        }
                        childrenOffset={14}
                        styles={{ root: { borderRadius: rem(6) } }}
                      >
                        {s.pages.map((p) => (
                          <NavLink
                            key={p.slug}
                            active={p.slug === activeSlug}
                            label={p.title}
                            // Le hub ouvre sa section : icône distincte + libellé en
                            // gras, pour qu'il se repère sans lire toute la liste.
                            fw={p.isHub ? 600 : undefined}
                            leftSection={
                              p.isHub ? (
                                <IconHome size={14} />
                              ) : (
                                <IconFileText size={14} />
                              )
                            }
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
                </Stack>
              ))}
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
        </DataState>
      </DocLayout>
    </PageLayout>
  );
});

export default Documentation;
