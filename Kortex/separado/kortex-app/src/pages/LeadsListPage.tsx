import PageHeader from "@/components/PageHeader";
import { leads } from "@/data/mockData";

export default function LeadsListPage() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="TODOS OS LEADS"
        filterLabel="Leads ativos"
        count={`${leads.length} leads: R$0`}
        actionLabel="NOVO LEAD"
      >
        <span className="text-xs text-muted-foreground">Busca e filtro</span>
      </PageHeader>

      <div className="flex-1 overflow-auto scrollbar-thin">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground uppercase">
              <th className="text-left px-4 py-3 w-8"><input type="checkbox" className="rounded" /></th>
              <th className="text-left px-4 py-3 font-medium">Lead Título</th>
              <th className="text-left px-4 py-3 font-medium">Contato Principal</th>
              <th className="text-left px-4 py-3 font-medium">Empresa do Contato</th>
              <th className="text-left px-4 py-3 font-medium">Etapa do Lead</th>
              <th className="text-right px-4 py-3 font-medium">Venda, R$</th>
            </tr>
          </thead>
          <tbody>
            {leads.map(lead => (
              <tr
                key={lead.id}
                className="border-b border-border/50 hover:bg-secondary/30 transition-colors cursor-pointer"
              >
                <td className="px-4 py-3"><input type="checkbox" className="rounded" /></td>
                <td className="px-4 py-3">
                  <span className="text-primary hover:underline">{lead.name}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-foreground underline decoration-muted-foreground/30">
                    {lead.contact || lead.name}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-foreground underline decoration-muted-foreground/30">
                    {lead.company || ""}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                      {lead.pipeline}
                    </span>
                    {lead.tags && lead.tags[0] && (
                      <span className="px-2 py-0.5 text-[10px] rounded bg-accent/20 text-accent border border-accent/30">
                        {lead.tags[0]}
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-foreground">{lead.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
