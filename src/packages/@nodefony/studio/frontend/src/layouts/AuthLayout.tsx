import {
  ActionIcon,
  Anchor,
  Box,
  Flex,
  Group,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  useComputedColorScheme,
  useMantineColorScheme,
} from "@mantine/core";
import type { ReactNode } from "react";
import {
  IconActivity,
  IconBolt,
  IconBrandGithub,
  IconMoonStars,
  IconShieldLock,
  IconSun,
  type Icon,
} from "@tabler/icons-react";
import { NodefonyLogo } from "../components/NodefonyLogo";

/**
 * AuthLayout — page d'authentification (Login / SignUp / ForgotPassword) en
 * **split** : panneau de marque à gauche (desktop), formulaire à droite. Sur
 * mobile, le hero disparaît et le formulaire occupe tout l'écran.
 *
 * Le panneau de marque est celui de la page /login du framework et du thème
 * Keycloak : une couleur PLEINE (aucun dégradé ni halo), séparée du formulaire
 * par un filet, en clair comme en sombre. Le bouton en haut à droite bascule
 * le thème — c'est ce choix que le lien vers Keycloak transmet (`?theme=`).
 *
 * Perf : le hero est STATIQUE (0 animation). Styles hissés au niveau module.
 */

const heroStyle: React.CSSProperties = {
  position: "relative",
  flex: 1.05,
  overflow: "hidden",
  background:
    "light-dark(var(--mantine-color-gray-0), var(--mantine-color-dark-8))",
  borderRight: "1px solid var(--mantine-color-default-border)",
};
const formColStyle: React.CSSProperties = {
  position: "relative",
  background: "var(--mantine-color-body)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  // CENTRÉ verticalement — possible SANS faire sauter les champs grâce à la zone
  // message à hauteur RÉSERVÉE (cf Login) : la hauteur totale du bloc ne change
  // pas selon qu'une erreur s'affiche ou non → le centrage reste stable.
  // `safe center` = ne rogne jamais le haut si le contenu dépasse (petit écran).
  justifyContent: "safe center",
  paddingInline: "var(--mantine-spacing-xl)",
  paddingBlock: "var(--mantine-spacing-xl)",
  overflowY: "auto",
};

interface Feature {
  icon: Icon;
  title: string;
  desc: string;
}
const FEATURES: Feature[] = [
  {
    icon: IconBolt,
    title: "Temps réel natif",
    desc: "HTTP et WebSocket, co-citoyens dans le même contexte.",
  },
  {
    icon: IconActivity,
    title: "Observabilité totale",
    desc: "Métriques, logs et traces — en direct.",
  },
  {
    icon: IconShieldLock,
    title: "Zero Trust",
    desc: "Sécurité par défaut, vos données protégées.",
  },
];

/** Bascule clair / sombre, mémorisée par Mantine comme dans la console. */
function ThemeToggle() {
  const { toggleColorScheme } = useMantineColorScheme();
  const scheme = useComputedColorScheme("dark");
  const label =
    scheme === "dark" ? "Passer en thème clair" : "Passer en thème sombre";
  return (
    <Tooltip label={label}>
      <ActionIcon
        variant="default"
        size="lg"
        onClick={toggleColorScheme}
        aria-label={label}
        style={{ position: "absolute", top: 16, right: 16 }}
      >
        {scheme === "dark" ? (
          <IconSun size={18} />
        ) : (
          <IconMoonStars size={18} />
        )}
      </ActionIcon>
    </Tooltip>
  );
}

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <Flex mih="100vh" align="stretch">
      {/* HERO de marque — masqué sous `md` (le formulaire prend tout l'écran). */}
      <Box component="aside" visibleFrom="md" style={heroStyle}>
        <Flex
          direction="column"
          justify="space-between"
          h="100%"
          p={48}
          style={{ position: "relative" }}
        >
          <Group gap={14} align="center">
            <NodefonyLogo height={42} />
            <Text fw={650} fz={22} lh={1}>
              Nodefony Studio
            </Text>
          </Group>

          <Stack gap="xl" maw={480}>
            <Stack gap="sm">
              <Text fz={{ base: 34, lg: 42 }} fw={650} lh={1.08}>
                Le temps réel, nativement.
              </Text>
              <Text fz="lg" c="dimmed">
                Observez, comprenez et contrôlez chaque sous-système de Nodefony
                — en direct.
              </Text>
            </Stack>
            <Stack gap="lg">
              {FEATURES.map((f) => (
                <Group key={f.title} gap="md" wrap="nowrap" align="flex-start">
                  <ThemeIcon size={42} radius="md" variant="default">
                    <f.icon size={22} stroke={1.7} />
                  </ThemeIcon>
                  <div>
                    <Text fw={600}>{f.title}</Text>
                    <Text size="sm" c="dimmed">
                      {f.desc}
                    </Text>
                  </div>
                </Group>
              ))}
            </Stack>
          </Stack>

          <Group justify="space-between">
            <Text size="xs" c="dimmed">
              Nodefony 10 · licence Apache 2.0
            </Text>
            <Anchor
              href="https://github.com/nodefony/nodefony-core"
              target="_blank"
              rel="noreferrer noopener"
              c="dimmed"
            >
              <Group gap={6}>
                <IconBrandGithub size={16} />
                <Text size="xs">GitHub</Text>
              </Group>
            </Anchor>
          </Group>
        </Flex>
      </Box>

      {/* Colonne FORMULAIRE — fond du thème (clair/sombre). */}
      <Box component="main" flex={1} style={formColStyle}>
        <ThemeToggle />
        <Stack gap="xl" w="100%" maw={400}>
          {/* Logo compact — visible seulement quand le hero est masqué (mobile). */}
          <Group gap={8} hiddenFrom="md" justify="center">
            <NodefonyLogo height={30} />
            <Text fw={700} size="lg" c="brand">
              Nodefony Studio
            </Text>
          </Group>
          {children}
        </Stack>
      </Box>
    </Flex>
  );
}
