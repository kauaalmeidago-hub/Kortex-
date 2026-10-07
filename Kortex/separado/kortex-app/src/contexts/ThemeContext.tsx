import React, { createContext, useContext, useState, useEffect } from "react";

type ThemeMode = "light" | "dark";

interface ThemeContextType {
  mode: ThemeMode;
  toggleMode: () => void;
}

const ThemeContext = createContext<ThemeContextType>({
  mode: "dark",
  toggleMode: () => {},
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem("crm-theme-mode");
    return (saved === "light" || saved === "dark") ? saved : "dark";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", mode === "dark");
    localStorage.setItem("crm-theme-mode", mode);
  }, [mode]);

  const toggleMode = () => setMode(m => m === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ mode, toggleMode }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
