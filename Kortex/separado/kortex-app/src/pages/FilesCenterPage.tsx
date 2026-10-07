import { useMemo, useRef, useState } from "react";
import {
  Building2,
  ChevronDown,
  Download,
  Eye,
  File as FileIcon,
  FileImage,
  FileVideo,
  Filter,
  Folder,
  MoreHorizontal,
  Plus,
  Search,
  SlidersVertical,
  Trash2,
  Upload,
} from "lucide-react";

type MediaType = "photos" | "videos" | "attachments";

type LocalAsset = {
  id: string;
  file: globalThis.File;
  type: MediaType;
  category: string;
  source: "Sessão local";
  createdAt: Date;
  url: string;
};

const tabConfig: Record<MediaType, { label: string; singular: string; search: string; upload: string; icon: typeof FileIcon }> = {
  photos: {
    label: "Fotos",
    singular: "foto",
    search: "Buscar fotos...",
    upload: "Enviar foto",
    icon: FileImage,
  },
  videos: {
    label: "Vídeos",
    singular: "vídeo",
    search: "Buscar vídeos...",
    upload: "Enviar vídeo",
    icon: FileVideo,
  },
  attachments: {
    label: "Anexos",
    singular: "anexo",
    search: "Buscar anexos...",
    upload: "Enviar anexo",
    icon: FileIcon,
  },
};

function detectType(file: File, fallback: MediaType): MediaType {
  if (file.type.startsWith("image/")) return "photos";
  if (file.type.startsWith("video/")) return "videos";
  return fallback;
}

function formatSize(size: number) {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function categoryFor(asset: LocalAsset) {
  if (asset.type === "photos") return asset.file.type.startsWith("image/") ? "Fotos locais" : "Imagens";
  if (asset.type === "videos") return "Vídeos locais";
  return asset.file.name.includes(".pdf") ? "PDF" : "Documentos locais";
}

export default function FilesCenterPage() {
  const [activeTab, setActiveTab] = useState<MediaType>("photos");
  const [query, setQuery] = useState("");
  const [assets, setAssets] = useState<LocalAsset[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sortDirection, setSortDirection] = useState<"newest" | "oldest">("newest");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const config = tabConfig[activeTab];
  const Icon = config.icon;

  const visibleAssets = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return assets
      .filter((asset) => asset.type === activeTab)
      .filter((asset) => !normalized || asset.file.name.toLowerCase().includes(normalized) || asset.category.toLowerCase().includes(normalized))
      .sort((a, b) => sortDirection === "newest" ? b.createdAt.getTime() - a.createdAt.getTime() : a.createdAt.getTime() - b.createdAt.getTime());
  }, [activeTab, assets, query, sortDirection]);

  const groupedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    visibleAssets.forEach((asset) => counts.set(asset.category, (counts.get(asset.category) || 0) + 1));
    return Array.from(counts.entries());
  }, [visibleAssets]);

  const addFiles = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const nextAssets = Array.from(fileList).map((file) => {
      const type = detectType(file, activeTab);
      const asset: LocalAsset = {
        id: crypto.randomUUID(),
        file,
        type,
        category: type === "photos" ? "Fotos locais" : type === "videos" ? "Vídeos locais" : "Documentos locais",
        source: "Sessão local",
        createdAt: new Date(),
        url: URL.createObjectURL(file),
      };
      asset.category = categoryFor(asset);
      return asset;
    });
    setAssets((current) => [...nextAssets, ...current]);
  };

  const toggleSelection = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedVisible = visibleAssets.length > 0 && visibleAssets.every((asset) => selected.has(asset.id));

  return (
    <div className="h-full overflow-auto bg-background px-6 py-5 text-foreground scrollbar-thin">
      <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            <span>Empresas</span>
            <span>/</span>
            <span>Dantas Almeida</span>
            <span>/</span>
            <span className="font-semibold text-foreground">Arquivos</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Central de Arquivos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Arquivos selecionados ficam disponíveis apenas nesta sessão até existir storage configurado.
          </p>
          <div className="mt-4 grid w-full max-w-md grid-cols-3 rounded-lg border border-border bg-card p-1">
            {(Object.keys(tabConfig) as MediaType[]).map((key) => (
              <button
                key={key}
                type="button"
                onClick={() => {
                  setActiveTab(key);
                  setSelected(new Set());
                }}
                className={`h-9 rounded-md text-sm font-semibold transition ${
                  activeTab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {tabConfig[key].label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 xl:min-w-[680px]">
          <div className="flex flex-wrap items-center justify-end gap-3">
            <div className="relative min-w-[260px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-card pl-10 pr-3 text-sm outline-none transition placeholder:text-muted-foreground focus:border-primary focus:ring-4 focus:ring-primary/10"
                placeholder={config.search}
                type="search"
              />
            </div>
            <button className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold text-muted-foreground" title="Filtros indisponíveis sem backend de arquivos">
              <Filter className="h-4 w-4" />
              Filtros
            </button>
            <button
              type="button"
              onClick={() => setSortDirection((current) => current === "newest" ? "oldest" : "newest")}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold transition hover:border-primary hover:text-primary"
            >
              <SlidersVertical className="h-4 w-4" />
              Ordenar
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-semibold transition hover:border-primary hover:text-primary"
            >
              <Upload className="h-4 w-4" />
              {config.upload}
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              Novo {config.singular}
              <ChevronDown className="h-4 w-4" />
            </button>
            <input ref={inputRef} type="file" multiple className="hidden" onChange={(event) => addFiles(event.target.files)} />
          </div>

          <div className="grid grid-cols-4 overflow-hidden rounded-xl border border-border bg-card max-md:grid-cols-2">
            <div className="border-r border-border p-4">
              <p className="text-xs text-muted-foreground">Total de {config.label}</p>
              <p className="mt-2 text-2xl font-semibold">{visibleAssets.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">Itens locais</p>
            </div>
            <div className="border-r border-border p-4">
              <p className="text-xs text-muted-foreground">Origem</p>
              <p className="mt-2 text-2xl font-semibold">{visibleAssets.length}</p>
              <p className="mt-1 text-xs text-muted-foreground">Sessão atual</p>
            </div>
            <div className="border-r border-border p-4">
              <p className="text-xs text-muted-foreground">Selecionados</p>
              <p className="mt-2 text-2xl font-semibold">{visibleAssets.filter((asset) => selected.has(asset.id)).length}</p>
              <p className="mt-1 text-xs text-muted-foreground">Para ação em lote</p>
            </div>
            <div className="p-4">
              <p className="text-xs text-muted-foreground">Última atualização</p>
              <p className="mt-2 text-lg font-semibold">{visibleAssets[0] ? formatDate(visibleAssets[0].createdAt) : "Sem arquivos"}</p>
              <p className="mt-1 text-xs text-muted-foreground">Storage pendente</p>
            </div>
          </div>
        </div>
      </div>

      <div className="mb-4 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
        {groupedCounts.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card p-5 text-center text-sm text-muted-foreground md:col-span-4 xl:col-span-7">
            Nenhuma categoria local para {config.label.toLowerCase()}.
          </div>
        ) : (
          groupedCounts.map(([category, count]) => (
            <article key={category} className="rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <Folder className="h-9 w-9 text-muted-foreground" />
                <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
              </div>
              <h2 className="truncate text-sm font-semibold">{category}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{count}</p>
            </article>
          ))
        )}
      </div>

      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          addFiles(event.dataTransfer.files);
        }}
        className="mb-4 flex min-h-[92px] items-center justify-center rounded-xl border border-dashed border-border bg-card p-4 text-center text-sm text-muted-foreground"
      >
        <Icon className="mr-3 h-6 w-6 text-primary" />
        Arraste arquivos para cá para anexar à sessão.
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="w-12 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selectedVisible}
                    onChange={() => {
                      setSelected((current) => {
                        const next = new Set(current);
                        if (selectedVisible) visibleAssets.forEach((asset) => next.delete(asset.id));
                        else visibleAssets.forEach((asset) => next.add(asset.id));
                        return next;
                      });
                    }}
                    className="h-4 w-4 rounded border-border"
                  />
                </th>
                <th className="px-4 py-3">{config.label.slice(0, -1) || "Arquivo"}</th>
                <th className="px-4 py-3">Empresa</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Origem</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Tamanho</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visibleAssets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center text-muted-foreground">
                    Nenhum {config.singular} encontrado. Selecione arquivos para visualizar a experiência local.
                  </td>
                </tr>
              ) : (
                visibleAssets.map((asset) => (
                  <tr key={asset.id} className="border-b border-border/70 last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={selected.has(asset.id)} onChange={() => toggleSelection(asset.id)} className="h-4 w-4 rounded border-border" />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <span className="flex h-10 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-background">
                          {asset.type === "photos" ? (
                            <img src={asset.url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <Icon className="h-5 w-5 text-primary" />
                          )}
                        </span>
                        <span className="font-semibold">{asset.file.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      <span className="inline-flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Dantas Almeida
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold text-primary">
                        {asset.category}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{asset.source}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatDate(asset.createdAt)}</td>
                    <td className="px-4 py-3 text-muted-foreground">{formatSize(asset.file.size)}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => window.open(asset.url, "_blank")} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary">
                          <Eye className="h-4 w-4" />
                        </button>
                        <a href={asset.url} download={asset.file.name} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-primary">
                          <Download className="h-4 w-4" />
                        </a>
                        <button
                          type="button"
                          onClick={() => {
                            setAssets((current) => current.filter((item) => item.id !== asset.id));
                            setSelected((current) => {
                              const next = new Set(current);
                              next.delete(asset.id);
                              return next;
                            });
                          }}
                          className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
          <span>Exibindo {visibleAssets.length} {config.label.toLowerCase()}</span>
          <span>10 por página</span>
        </div>
      </div>
    </div>
  );
}
