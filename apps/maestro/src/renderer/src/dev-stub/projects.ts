const recent = [
  { root: "/home/dev/projects/atlas-api", name: "atlas-api", lastOpened: "2026-10-09T14:12:00Z" },
  { root: "/home/dev/projects/harbor-web", name: "harbor-web", lastOpened: "2026-10-08T09:30:00Z" },
  { root: "/home/dev/projects/orbit-mobile", name: "orbit-mobile", lastOpened: "2026-10-05T17:45:00Z" },
];

// `?project=maestro` opens a project whose Maestro runtime is installed and current, so the
// install page (`/maestro`) can be captured past its "no project is open" state.
export const openMaestro = new URLSearchParams(window.location.search).get("project") === "maestro";
export const maestroRoot = "/home/dev/projects/maestro";
const maestroProject = { root: maestroRoot, name: "maestro", lastOpened: "2026-10-11T08:00:00Z" };

export const projects = {
  project: {
    get: async () => ({
      current: openMaestro ? maestroProject : null,
      recent: openMaestro ? [maestroProject, ...recent] : recent,
    }),
  },
  worktreeLog: { list: async () => [] },
};
