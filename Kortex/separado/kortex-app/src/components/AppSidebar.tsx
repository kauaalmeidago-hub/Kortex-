import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  Home, MessageSquare, BarChart3, Calendar, List,
  Settings, ChevronDown, ChevronRight,
  CheckSquare, LogOut, BriefcaseBusiness,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { pipelines } from "@/data/mockData";

interface MenuChild {
  label: string;
  path: string;
  disabled?: boolean;
  disabledReason?: string;
}

interface MenuItem {
  icon: React.ElementType;
  label: string;
  path?: string;
  badge?: number;
  expandable?: boolean;
  children?: MenuChild[];
}

const phoneDisabledReason = "Telefonia indisponível no momento";

const menuItems: MenuItem[] = [
  { icon: Home, label: "Início", path: "/" },
  {
    icon: MessageSquare, label: "Comunicações", badge: 3, expandable: true,
    children: [
      { label: "Caixa de entrada", path: "/inbox" },
      { label: "Bate-papo de equipe", path: "/team-chat" },
      { label: "Telefone", path: "/phone", disabled: true, disabledReason: phoneDisabledReason },
    ]
  },
  { icon: CheckSquare, label: "Tarefas", path: "/tasks", badge: 7 },
  { icon: Calendar, label: "Calendário", path: "/calendar" },
  {
    icon: List, label: "Listas", expandable: true,
    children: [
      { label: "Contatos", path: "/contacts" },
      { label: "Empresas", path: "/companies" },
    ]
  },
  {
    icon: BriefcaseBusiness, label: "Operacional", expandable: true,
    children: [
      { label: "Kit faturamento", path: "/kit-faturamento" },
      { label: "Arquivos", path: "/files" },
    ]
  },
  {
    icon: BarChart3, label: "Pipelines", expandable: true,
    children: pipelines.map((pipeline) => ({ label: pipeline.name, path: `/pipeline/${pipeline.id}` })),
  },
  { icon: KoaIcon, label: "Koa", path: "/movimentacoes/inclusao" },
];

const bottomItems: MenuItem[] = [
  {
    icon: Settings,
    label: "Configurações",
    expandable: true,
    children: [
      { label: "Perfil", path: "/settings" },
      { label: "Automações", path: "/automations" },
    ],
  },
];

const brandSymbol = "/brand/kortex-symbol.png";
const koaLogo = "/brand/koa-ghost-static.png";

function KoaIcon({ size = 20, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <img
      src={koaLogo}
      alt=""
      className={`koa-symbol-motion shrink-0 object-contain ${className ?? ""}`}
      style={{ width: size, height: size }}
    />
  );
}

export default function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [isNarrowViewport, setIsNarrowViewport] = useState(false);
  const [expanded, setExpanded] = useState<string[]>(["Operacional", "Pipelines", "Listas", "Configurações"]);
  const restoreAfterKoaRef = useRef(false);
  const { user, signOut } = useAuth();
  const compact = collapsed || isNarrowViewport;

  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const syncViewport = () => setIsNarrowViewport(media.matches);

    syncViewport();
    media.addEventListener("change", syncViewport);
    return () => media.removeEventListener("change", syncViewport);
  }, []);

  useEffect(() => {
    const handleKoaOpen = () => {
      if (isNarrowViewport) return;
      setCollapsed((current) => {
        restoreAfterKoaRef.current = !current;
        return true;
      });
    };

    const handleKoaClose = () => {
      if (isNarrowViewport) return;
      setCollapsed((current) => (restoreAfterKoaRef.current ? false : current));
      restoreAfterKoaRef.current = false;
    };

    window.addEventListener("kortex:koa-panel-open", handleKoaOpen);
    window.addEventListener("kortex:koa-panel-close", handleKoaClose);

    return () => {
      window.removeEventListener("kortex:koa-panel-open", handleKoaOpen);
      window.removeEventListener("kortex:koa-panel-close", handleKoaClose);
    };
  }, [isNarrowViewport]);

  const toggle = (label: string) =>
    setExpanded(prev => prev.includes(label) ? prev.filter(l => l !== label) : [...prev, label]);

  const isActive = (path?: string) => path && location.pathname === path;
  const isChildActive = (children?: MenuChild[]) =>
    children?.some(c => !c.disabled && (location.pathname === c.path || location.pathname.startsWith(c.path + '/')));
  const isItemActive = (item: MenuItem) => {
    if (isActive(item.path)) return true;
    if (item.label === "Pipelines" && location.pathname.startsWith("/pipeline/")) return true;
    if (item.label === "Koa" && location.pathname.startsWith("/movimentacoes")) return true;
    if (item.label === "Operacional" && location.pathname.startsWith("/files")) return true;
    if (item.expandable && isChildActive(item.children)) return true;
    return false;
  };

  const handleMainItemClick = (item: MenuItem) => {
    if (item.expandable) {
      const firstEnabledChild = item.children?.find((child) => !child.disabled);
      if (compact && firstEnabledChild) {
        navigate(firstEnabledChild.path);
        return;
      }
      toggle(item.label);
      return;
    }
    if (item.path) navigate(item.path);
  };

  const renderSubItems = (item: MenuItem) => {
    if (!item.expandable || compact || !expanded.includes(item.label) || !item.children) return null;

    return (
      <div className="ml-10 mt-1 space-y-1 border-l border-sidebar-border pl-3">
        {item.children.map(child => {
          const disabled = Boolean(child.disabled);
          const active = !disabled && isActive(child.path);

          return (
            <button
              key={child.path}
              type="button"
              disabled={disabled}
              aria-disabled={disabled || undefined}
              title={disabled ? child.disabledReason : undefined}
              onClick={() => {
                if (!disabled) navigate(child.path);
              }}
              className={`h-8 w-full rounded-xl px-3 text-left text-sm font-normal transition-all ${
                disabled
                  ? "cursor-not-allowed text-sidebar-foreground/35"
                  : active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground"
              }`}
            >
              <span className="block truncate">{child.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <aside
      className={`flex h-screen flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground shadow-[8px_0_30px_rgba(15,23,42,0.08)] transition-[width,min-width] duration-200 ${
        compact ? "w-[52px] min-w-[52px]" : "w-[240px] min-w-[240px]"
      }`}
    >
      <div className={`flex h-[72px] shrink-0 items-center border-b border-sidebar-border ${compact ? "justify-center px-1.5" : "px-4"}`}>
        <button
          type="button"
          onClick={() => {
            if (!isNarrowViewport) setCollapsed((current) => !current);
          }}
          disabled={isNarrowViewport}
          className={`group flex items-center rounded-2xl outline-none transition hover:opacity-85 focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
            compact ? "h-10 w-10 justify-center" : "h-11 w-full justify-start gap-3"
          }`}
          aria-label={isNarrowViewport ? "Menu compacto" : compact ? "Expandir menu" : "Recolher menu"}
          title={isNarrowViewport ? "Menu compacto" : compact ? "Expandir menu" : "Recolher menu"}
        >
          {compact ? (
            <img src={brandSymbol} alt="" className="h-6 w-6 object-contain drop-shadow-[0_5px_12px_rgba(15,23,42,0.18)] transition group-hover:scale-105" />
          ) : (
            <>
              <img src={brandSymbol} alt="" className="h-7 w-7 shrink-0 object-contain drop-shadow-[0_5px_12px_rgba(15,23,42,0.18)] transition group-hover:scale-105" />
              <span className="min-w-0 text-[1.22rem] font-bold leading-none tracking-normal text-foreground">
                KORTEX
              </span>
            </>
          )}
        </button>
      </div>

      <nav className={`flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin ${compact ? "space-y-2.5 px-1.5 py-2.5" : "space-y-1 px-2 py-3"}`}>
        {menuItems.map((item) => {
          const active = isItemActive(item);
          const Icon = item.icon;

          return (
          <div key={item.label} className={item.label === "Koa" && compact ? "border-t border-sidebar-border pt-3" : undefined}>
            <button
              onClick={() => handleMainItemClick(item)}
              aria-label={item.label}
              className={`relative flex w-full items-center rounded-2xl font-normal outline-none transition-all focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
                compact ? "h-10 justify-center px-0" : "h-10 gap-3 px-3 text-sm"
              } ${
                active
                  ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/75 hover:text-sidebar-accent-foreground"
              }`}
              title={compact ? item.label : undefined}
            >
              <Icon size={compact ? 24 : item.label === "Koa" ? 24 : 20} className={`shrink-0 ${active && item.label !== "Koa" ? "text-sidebar-primary" : ""}`} strokeWidth={1.5} />
              {!compact && <span className="flex-1 text-left font-[inherit]">{item.label}</span>}
              {item.badge && (
                <span className={`flex items-center justify-center rounded-full bg-[#f43f5e] text-[0.72rem] font-black leading-none text-white shadow-[0_8px_18px_rgba(244,63,94,0.3)] ${
                  compact ? "absolute -right-0.5 top-0 h-5 min-w-5 px-1.5 text-[0.66rem]" : "h-5 min-w-5 px-1.5 text-[0.66rem]"
                }`}>
                  {item.badge}
                </span>
              )}
              {item.expandable && !compact && (
                expanded.includes(item.label) ? <ChevronDown size={18} strokeWidth={1.5} /> : <ChevronRight size={18} strokeWidth={1.5} />
              )}
            </button>
            {renderSubItems(item)}
          </div>
        )})}
      </nav>

      <div className={`mt-auto shrink-0 border-t border-sidebar-border ${compact ? "space-y-2.5 px-1.5 py-2.5" : "space-y-1 px-2 py-3"}`}>
        {bottomItems.map(item => {
          const Icon = item.icon;
          const active = isItemActive(item);
          return (
          <div key={item.label}>
          <button
            onClick={() => handleMainItemClick(item)}
            aria-label={item.label}
            className={`flex w-full items-center rounded-2xl font-normal outline-none transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
              compact ? "h-10 justify-center" : "h-10 gap-3 px-3 text-sm"
            } ${
              active ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-sm" : ""
            }`}
            title={compact ? item.label : undefined}
          >
            <Icon size={compact ? 21 : 20} strokeWidth={1.5} className={active ? "text-sidebar-primary" : ""} />
            {!compact && <span className="flex-1 text-left">{item.label}</span>}
            {item.expandable && !compact && (
              expanded.includes(item.label) ? <ChevronDown size={18} strokeWidth={1.5} /> : <ChevronRight size={18} strokeWidth={1.5} />
            )}
          </button>
          {renderSubItems(item)}
          </div>
        )})}

        <div className={`flex items-center ${compact ? "justify-center py-1.5" : "gap-3 rounded-2xl px-3 py-2"}`}>
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sidebar-primary text-sm font-semibold text-sidebar-primary-foreground shadow-sm"
          >
            {(user?.email?.[0] ?? "K").toUpperCase()}
          </div>
          {!compact && (
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-sidebar-accent-foreground">{user?.email ?? "Convidado"}</p>
            </div>
          )}
        </div>

        <button
          onClick={signOut}
          aria-label="Sair"
          className={`flex w-full items-center rounded-2xl font-normal outline-none transition-all hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring ${
            compact ? "h-10 justify-center" : "h-10 gap-3 px-3 text-sm"
          }`}
          title={compact ? "Sair" : undefined}
        >
          <LogOut size={compact ? 21 : 20} strokeWidth={1.5} />
          {!compact && <span>Sair</span>}
        </button>
      </div>
    </aside>
  );
}
