import { useCallback, useEffect, useState } from "preact/hooks";

export type Theme = "light" | "dark";

function loadTheme(): Theme {
  const saved = localStorage.getItem("web-js-theme");
  if (saved === "dark" || saved === "light") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(loadTheme);

  const toggle = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("web-js-theme", theme);
  }, [theme]);

  return { theme, toggle };
}
