import { useEffect, useState } from "react";
import type { ThemeMode } from "../components/DesktopSidebar";
import { loadThemeMode } from "../lib/appRuntime";

export function useThemeMode() {
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => loadThemeMode());

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem("multaiplayer:theme", themeMode);
  }, [themeMode]);

  function toggleThemeMode() {
    setThemeMode((current) => current === "dark" ? "light" : "dark");
  }

  return { themeMode, toggleThemeMode };
}
