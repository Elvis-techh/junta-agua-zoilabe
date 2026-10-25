import { useCallback, useEffect, useState } from "react";

import type { Me } from "./api.ts";
import { ApiError, api } from "./api.ts";
import { Shell } from "./components/Shell.tsx";
import { InvitationScreen } from "./screens/Invitation.tsx";
import { PinScreen } from "./screens/Pin.tsx";
import { UnregisteredScreen } from "./screens/Unregistered.tsx";

type State =
  | { kind: "loading" }
  | { kind: "signedIn"; me: Me }
  | { kind: "pinNeeded"; name: string; locked: boolean }
  | { kind: "unregistered" }
  | { kind: "offline"; message: string };

/**
 * Which screen to show: the invitation (when the link was opened), the PIN pad
 * (a remembered phone), "open your invitation" (an unknown phone), or the app.
 */
export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const onInvitation = window.location.pathname === "/invitacion";

  const refresh = useCallback(async () => {
    try {
      const { user } = await api<{ user: Me }>("GET", "/auth/me");
      setState({ kind: "signedIn", me: user });
    } catch (error) {
      if (error instanceof ApiError && error.code === "pin_needed") {
        const device = error.body.device as { name: string; locked: boolean };
        setState({ kind: "pinNeeded", name: device.name, locked: device.locked });
      } else if (error instanceof ApiError && error.status === 401) {
        setState({ kind: "unregistered" });
      } else {
        setState({ kind: "offline", message: (error as Error).message });
      }
    }
  }, []);

  useEffect(() => {
    if (!onInvitation) {
      void refresh();
    }
  }, [onInvitation, refresh]);

  if (onInvitation) {
    // A full load of "/" afterwards, so the link (and its token) leaves the address bar and history.
    return <InvitationScreen onDone={() => window.location.replace("/")} />;
  }

  switch (state.kind) {
    case "loading":
      return <main className="screen centered"><p className="muted">Cargando…</p></main>;
    case "offline":
      return (
        <main className="screen centered stack">
          <p className="message error">{state.message}</p>
          <button className="btn primary block" onClick={() => void refresh()}>Intentar de nuevo</button>
        </main>
      );
    case "unregistered":
      return <UnregisteredScreen />;
    case "pinNeeded":
      return <PinScreen name={state.name} locked={state.locked} onSignedIn={() => void refresh()} />;
    case "signedIn":
      return <Shell me={state.me} onSignedOut={() => void refresh()} />;
  }
}
