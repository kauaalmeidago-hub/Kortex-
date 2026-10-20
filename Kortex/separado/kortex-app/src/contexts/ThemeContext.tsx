import React, {
  createContext,
  useContext,
  useState,
  useLayoutEffect,
} from "react";
import {
  applyTheme,
  lightPortal,
  resolveTheme,
  type ThemeMode,
} from "@/theme-policy";

interface ThemeContextType {
  mode: ThemeMode;
  toggleMode: () => void;
  forcedLight?: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "light",
  toggleMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    try {
      return resolveTheme(localStorage.getItem("crm-theme-mode"));
    } catch {
      return resolveTheme(null);
    }
  });

  useLayoutEffect(() => {
    applyTheme(mode);
    if (!lightPortal) {
      try {
        localStorage.setItem("crm-theme-mode", mode);
      } catch {
        /* Storage may be unavailable. */
      }
    }
  }, [mode]);

  const toggleMode = () => {
    if (!lightPortal) setMode((m) => (m === "dark" ? "light" : "dark"));
  };

  return (
    <ThemeContext.Provider
      value={{ mode, toggleMode, forcedLight: lightPortal }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
