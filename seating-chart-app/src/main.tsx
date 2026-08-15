import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// This app is only ever reached via a plain <a href="seating-chart/">
// link from the main site (see ../script.js), so "back" from here and
// "forward" back into it is an ordinary cross-page navigation — exactly
// the case browsers restore from the back/forward cache (bfcache)
// instead of re-running this script. A bfcache restore resumes the
// *exact* JS heap and React tree that was frozen when the user
// navigated away: no module re-evaluation, no fetches, nothing here in
// main.tsx runs again. If that snapshot was mid-load, mid-error, or
// just older than the currently deployed bundle (e.g. taken before a
// later feature shipped), the restored page keeps showing it — which
// matches "the sidebar is gone" and "clearing site data brings back
// features I know we shipped" (a hard clear is one of the few things
// that reliably forces a real reload instead of a bfcache restore).
// `pageshow` fires on both a normal load and a bfcache restore;
// `event.persisted` is true only for the latter, so this reload only
// fires on the case that actually needs it.
window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    window.location.reload();
  }
});

createRoot(document.getElementById("root")!).render(<App />);
