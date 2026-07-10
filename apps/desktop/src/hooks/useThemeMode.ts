import { useEffect } from "react";
import { useAppStore } from "../store/appStore";

export function useThemeMode() {
  const themeMode = useAppStore((state) => state.themeMode);
  const toggleThemeMode = useAppStore.getState().toggleThemeMode;

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    localStorage.setItem("multaiplayer:theme", themeMode);
  }, [themeMode]);

  return { themeMode, toggleThemeMode };
}
