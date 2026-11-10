import { useCallback, useEffect, useState } from "react";

import type { Me } from "./api.ts";
import { ApiError, api } from "./api.ts";
import { Shell } from "./components/Shell.tsx";
import { recall, remember } from "./queue.ts";
import { SignInScreen } from "./screens/SignIn.tsx";

type State =
  | { kind: "loading" }
  | { kind: "signedIn"; me: Me; offline: boolean }
  | { kind: "signedOut" }
  | { kind: "offline"; message: string };

/** Which screen to show: "Entrar" (number and password), or the app. */
export function App() {
  const [state, setState] = useState<State>({ kind: "loading" });

  const refresh = useCallback(async () => {
    try {
      const { user } = await api<{ user: Me }>("GET", "/auth/me");
      remember("me", user);
      setState({ kind: "signedIn", me: user, offline: false });
    } catch (error) {
      const remembered = recall<Me>("me");
      if (error instanceof ApiError && error.status === 0 && remembered) {
        // No signal: open on the profile from the last sign-in, so census
        // entries can still be typed. The server checks everything when they are sent.
        setState({ kind: "signedIn", me: remembered, offline: true });
      } else if (error instanceof ApiError && error.status === 401) {
        // Signed out, or the password changed: it must not open offline either.
        remember("me", null);
        setState({ kind: "signedOut" });
      } else {
        setState({ kind: "offline", message: (error as Error).message });
      }
    }
  }, []);

  const retry = useCallback(() => void refresh(), [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

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
    case "signedOut":
      return <SignInScreen onSignedIn={() => void refresh()} />;
    case "signedIn":
      return <Shell me={state.me} offline={state.offline} onSignedOut={() => void refresh()} onRetry={retry} />;
  }
}
