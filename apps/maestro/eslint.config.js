import react from "@repo/eslint-config/react";
import node from "@repo/eslint-config/node";

// Shared presets carry their own `files`; scope each to the half of the app it describes.
const renderer = ["src/renderer/**/*.{ts,tsx}", "test/renderer/**/*.{ts,tsx}"];
const scope = (configs, extra) =>
  configs.map((c) => (Object.keys(c).length === 1 && c.ignores ? c : { ...c, ...extra }));

export default [
  { ignores: ["out/**", "dist/**", "src/renderer/routeTree.gen.ts", ".claude/**"] },
  // src/renderer/public holds static ES5 assets served as-is (they run before the bundle), not bundled source.
  { ignores: ["src/renderer/public/**"] },
  ...scope(node, { files: ["**/*.{ts,mts,js,mjs}"], ignores: renderer }),
  ...scope(react, { files: renderer }),
];
