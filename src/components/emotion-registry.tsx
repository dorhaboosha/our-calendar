"use client";

import createCache from "@emotion/cache";
import { CacheProvider } from "@emotion/react";
import { useServerInsertedHTML } from "next/navigation";
import { useState, type ReactNode } from "react";

// Chakra UI styles with Emotion. By default Emotion writes a <style> tag right next to
// each element during server rendering. In content streamed in after a Suspense boundary
// the browser finds those tags where React expects the element, and hydration fails.
// This registry collects the styles instead and lets Next.js put them in the HTML stream
// before the content that uses them (the pattern from Next's CSS-in-JS guide).
export function EmotionRegistry({ children }: { children: ReactNode }) {
  const [registry] = useState(() => {
    const cache = createCache({ key: "css" });
    // Compat mode: Emotion skips its own inline <style> tags.
    cache.compat = true;

    let pending: string[] = [];
    const insert = cache.insert;
    cache.insert = (...args) => {
      const [, serialized] = args;
      if (cache.inserted[serialized.name] === undefined) pending.push(serialized.name);
      return insert(...args);
    };

    const flush = () => {
      const names = pending;
      pending = [];
      return names;
    };
    return { cache, flush };
  });

  useServerInsertedHTML(() => {
    const names = registry.flush();
    if (names.length === 0) return null;
    let styles = "";
    for (const name of names) {
      const rule = registry.cache.inserted[name];
      if (typeof rule === "string") styles += rule;
    }
    return (
      <style
        key={names.join(" ")}
        data-emotion={`${registry.cache.key} ${names.join(" ")}`}
        dangerouslySetInnerHTML={{ __html: styles }}
      />
    );
  });

  return <CacheProvider value={registry.cache}>{children}</CacheProvider>;
}
