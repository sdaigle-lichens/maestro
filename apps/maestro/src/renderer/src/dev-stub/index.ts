/**
 * Browser-only stand-in for the preload bridge, so the renderer can be opened in a plain browser
 * (design captures, Storybook-less screenshots). Electron's preload defines `window.maestro`;
 * a browser has none and the first provider crashes. Dev only: `main.tsx` imports this behind
 * `import.meta.env.DEV`, and only when the bridge is absent, so Electron never loads the sample
 * data. Returns invented sample projects.
 *
 * One file per captured screen's sample data; add a screen's namespaces to `methods`. Anything not
 * listed resolves to `null`, and `on*`/`subscribe*` to a no-op unsubscribe.
 */
import { maestroInstall } from "./maestro-install";
import { openMaestro, projects } from "./projects";
import { sessionLog } from "./session-log";

const methods: Record<string, Record<string, unknown>> = {
  ...projects,
  ...(openMaestro ? { ...maestroInstall, ...sessionLog } : {}),
};

const namespace = (name: string) =>
  new Proxy(methods[name] ?? {}, {
    get: (target, method: string) =>
      method in target ? target[method] : /^(on|subscribe)/.test(method) ? () => () => {} : async () => null,
  });

(window as unknown as { maestro: unknown }).maestro = new Proxy({}, { get: (_, name: string) => namespace(name) });
