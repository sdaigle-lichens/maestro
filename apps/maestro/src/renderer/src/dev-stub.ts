/**
 * Browser-only stand-in for the preload bridge, so the renderer can be opened in a plain browser
 * (design captures, Storybook-less screenshots). Electron's preload defines `window.maestro`;
 * a browser has none and the first provider crashes. Dev only: `main.tsx` imports this behind
 * `import.meta.env.DEV` and only when the bridge is absent. Returns invented sample projects.
 */
const recent = [
  { root: "/home/dev/projects/atlas-api", name: "atlas-api", lastOpened: "2026-10-09T14:12:00Z" },
  { root: "/home/dev/projects/harbor-web", name: "harbor-web", lastOpened: "2026-10-08T09:30:00Z" },
  { root: "/home/dev/projects/orbit-mobile", name: "orbit-mobile", lastOpened: "2026-10-05T17:45:00Z" },
];

const methods: Record<string, Record<string, unknown>> = {
  project: { get: async () => ({ current: null, recent }) },
  worktreeLog: { list: async () => [] },
};

const namespace = (name: string) =>
  new Proxy(methods[name] ?? {}, {
    get: (target, method: string) =>
      method in target
        ? target[method]
        : /^(on|subscribe)/.test(method)
          ? () => () => {}
          : async () => null,
  });

if (!("maestro" in window)) {
  (window as unknown as { maestro: unknown }).maestro = new Proxy({}, { get: (_, name: string) => namespace(name) });
}
