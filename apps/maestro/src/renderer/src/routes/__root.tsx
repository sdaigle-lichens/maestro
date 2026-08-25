import { createRootRoute, Outlet } from "@tanstack/react-router";
import { Toaster } from "@repo/ui/toast";
import { SessionLogProvider } from "../utils/session-log-context";
import { ProjectProvider } from "../utils/project-context";
import { InstallProvider } from "../utils/install-context";
import { SessionProvider } from "../utils/session-context";
import SessionPane from "../components/session-pane";

// No `shellComponent` here, unlike the web app: TanStack Start rendered the whole <html>
// document server-side, so the root route owned <head>/<body>/<Scripts> and injected the theme
// script. In Electron the document is a static index.html — see ../../index.html, which carries
// the theme bootstrap and the renderer's CSP.
export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <ProjectProvider>
      <InstallProvider>
        <SessionLogProvider>
          {/*
            Inside ProjectProvider, because a project switch ends the session — and above the
            Outlet, because TopNav (which carries the toggle) is mounted per ROUTE. Holding the
            transcript below this line would drop it on every navigation, along with the only
            handle on a turn still streaming.
          */}
          <SessionProvider>
            {/*
              THE PANE SHIFTS THE LAYOUT RATHER THAN COVERING IT. A flex row at the root, with the
              route in a `min-w-0` column and the pane as its sibling: the route genuinely narrows,
              which is what makes a conversation something you work beside rather than something
              that hides the thing you are asking about. The help chat this replaces was an overlay,
              and that was the right shape for a panel you dismiss and the wrong one for a session
              you steer. Routes still own their own full-height shell inside that column.
            */}
            <div className="flex h-screen w-full overflow-hidden">
              <div className="flex-1 min-w-0 overflow-hidden">
                <Outlet />
              </div>
              <SessionPane />
            </div>
            <Toaster />
          </SessionProvider>
        </SessionLogProvider>
      </InstallProvider>
    </ProjectProvider>
  );
}
