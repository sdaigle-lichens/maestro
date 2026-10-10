import type { Preview } from "@storybook/react-vite";
import { useEffect } from "react";
import "../src/renderer/src/styles.css";

// The app switches modes with a `dark` class and `colorScheme` on <html> (ThemeToggle), so the
// toolbar does the same.
const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Color mode",
      toolbar: { title: "Theme", icon: "circlehollow", items: ["light", "dark"], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: "light" },
  decorators: [
    (Story, { globals }) => {
      useEffect(() => {
        const root = document.documentElement;
        root.classList.remove("light", "dark");
        root.classList.add(globals.theme);
        root.style.colorScheme = globals.theme;
      }, [globals.theme]);
      return <Story />;
    },
  ],
  parameters: {
    controls: { matchers: { color: /(background|color)$/i, date: /Date$/i } },
  },
};

export default preview;
