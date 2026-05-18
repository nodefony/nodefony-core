import { createTheme, type MantineColorsTuple } from "@mantine/core";

/**
 * Theme Nodefony Studio.
 *
 * Primary = orange (signature Nodefony). Radius medium, font système.
 * Le `MantineProvider` est wrappé dans App.tsx avec `defaultColorScheme="dark"`.
 */
const nodefonyOrange: MantineColorsTuple = [
  "#fff5e6",
  "#ffe8cc",
  "#ffd199",
  "#ffb866",
  "#ffa040",
  "#ff8c1a",
  "#ff7a00",
  "#e66a00",
  "#cc5d00",
  "#b35100",
];

export const studioTheme = createTheme({
  primaryColor: "orange",
  primaryShade: { light: 6, dark: 5 },
  colors: {
    orange: nodefonyOrange,
  },
  defaultRadius: "md",
  fontFamily:
    "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  headings: {
    fontWeight: "600",
  },
});
