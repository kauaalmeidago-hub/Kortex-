import { ElementType, ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ClipboardList, MessageCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";

type SettingsItem = {
  icon: ElementType;
  label: string;
  path: string;
};

const settingsItems: SettingsItem[] = [
  { icon: User, label: "Perfil", path: "/settings" },
  { icon: MessageCircle, label: "Canais WhatsApp", path: "/settings/channels/whatsapp" },
  { icon: ClipboardList, label: "Etapas de tarefas", path: "/settings/task-stages" },
];

function isCurrentPath(currentPath: string, itemPath: string) {
  if (itemPath === "/settings") return currentPath === "/settings";
  return currentPath === itemPath || currentPath.startsWith(`${itemPath}/`);
}

export default function SettingsLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="flex h-full min-h-0 overflow-hidden bg-background text-foreground">
      <aside className="hidden w-[236px] shrink-0 border-r border-border bg-card lg:flex lg:flex-col">
        <div className="border-b border-border px-4 py-4">
          <h2 className="text-lg font-black tracking-tight text-foreground">Configurações</h2>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Gerencie sua conta e canais.</p>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto overflow-x-hidden p-2 scrollbar-thin">
          {settingsItems.map((item) => {
            const Icon = item.icon;
            const active = isCurrentPath(location.pathname, item.path);

            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className={cn(
                  "flex h-10 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-border bg-card px-3 py-2 lg:hidden">
          <div className="flex gap-2 overflow-x-auto scrollbar-thin">
            {settingsItems.map((item) => {
              const Icon = item.icon;
              const active = isCurrentPath(location.pathname, item.path);

              return (
                <button
                  key={item.path}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={cn(
                    "flex h-9 shrink-0 items-center gap-2 rounded-xl px-3 text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}
