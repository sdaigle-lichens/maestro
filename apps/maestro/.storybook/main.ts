import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { dirname } from "path";
import { fileURLToPath } from "url";

// pnpm's strict node_modules: resolve addons from this package, not from wherever Storybook runs.
function getAbsolutePath(value: string) {
  return dirname(fileURLToPath(import.meta.resolve(`${value}/package.json`)));
}

const config: StorybookConfig = {
  stories: ["../src/renderer/src/**/*.stories.@(ts|tsx)", "../../../packages/ui/src/**/*.stories.@(ts|tsx)"],
  addons: [
    getAbsolutePath("@storybook/addon-docs"),
    getAbsolutePath("@storybook/addon-a11y"),
    getAbsolutePath("@storybook/addon-vitest"),
    getAbsolutePath("@storybook/addon-mcp"),
  ],
  framework: getAbsolutePath("@storybook/react-vite"),
  // The app builds with electron-vite, so there is no vite.config.ts for Storybook to pick up:
  // add the one plugin the renderer styles need (Tailwind v4, same as electron.vite.config.ts).
  viteFinal: (viteConfig) => ({ ...viteConfig, plugins: [...(viteConfig.plugins ?? []), tailwindcss()] }),
};
export default config;
