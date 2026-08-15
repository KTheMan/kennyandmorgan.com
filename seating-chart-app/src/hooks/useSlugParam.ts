import { useCallback, useEffect, useState } from "react";

// No react-router here on purpose: this is a single static page
// (/seating-chart/index.html) published on GitHub Pages, which can't
// serve arbitrary sub-paths like /seating-chart/some-slug without a
// server-side rewrite. A query param always resolves to the same file,
// so it's the simplest thing that makes a chart's URL shareable.
const PARAM = "v";

function readSlug(): string | null {
  return new URLSearchParams(window.location.search).get(PARAM);
}

export function useSlugParam() {
  const [slug, setSlug] = useState<string | null>(() => readSlug());

  useEffect(() => {
    const onPopState = () => setSlug(readSlug());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigateToSlug = useCallback((nextSlug: string | null) => {
    const url = new URL(window.location.href);
    if (nextSlug) {
      url.searchParams.set(PARAM, nextSlug);
    } else {
      url.searchParams.delete(PARAM);
    }
    window.history.pushState({}, "", url.toString());
    setSlug(nextSlug);
  }, []);

  return { slug, navigateToSlug };
}
