import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, FileText, Loader2, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { askSalesAssistant, listSalesOpportunities, type SalesOpportunity } from "./salesAssistantApi";
import { buildProposalText, createSalesQuote, productLabels, proposalIssues,
  type SalesAction, type SalesAnalysis, type SalesClient, type SalesDraft, type SalesQuote } from "./salesProposal";

export interface SalesProposalSession {
  draft: SalesDraft;
  analysis: SalesAnalysis | null;
  analysisContext: string;
}

const control = "mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-primary/30";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0 text-xs font-medium text-muted-foreground">{label}{children}</label>;
}

function AnalysisSection({ label, children }: { label: string; children: React.ReactNode }) {
  return <section className="space-y-2 border-b border-border pb-4 last:border-b-0">
    <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
    <div className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{children}</div>
  </section>;
}

export function SalesProposalPanel({ client, session, onChange, onInsertMessage, onClose, isClosing = false }: {
  client: SalesClient;
  session: SalesProposalSession;
  onChange: (session: SalesProposalSession) => void;
  onInsertMessage: (text: string) => void;
  onClose: () => void;
  isClosing?: boolean;
}) {
  const { user, workspace } = useAuth();
  const [tab, setTab] = useState("assistant");
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([]);
  const [opportunityError, setOpportunityError] = useState("");
  const [loadingOpportunities, setLoadingOpportunities] = useState(false);
  const [showIssues, setShowIssues] = useState(false);
  const [preview, setPreview] = useState("");
  const [inserted, setInserted] = useState(false);
  const request = useRef<AbortController | null>(null);
  const requestNumber = useRef(0);
  const closeButton = useRef<HTMLButtonElement>(null);
  const latestContext = useRef("");
  const draft = session.draft;
  const contextKey = JSON.stringify({ client, draft });
  latestContext.current = contextKey;
  const stale = Boolean(session.analysis && session.analysisContext !== contextKey);
  const issues = proposalIssues(draft);
  const selectedOpportunity = opportunities.find(item => item.id === draft.leadId);

  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    return () => {
      requestNumber.current += 1;
      request.current?.abort();
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    let active = true;
    if (!user?.id || !workspace?.id) return;
    setLoadingOpportunities(true);
    setOpportunityError("");
    listSalesOpportunities(workspace.id, user.id).then(items => {
      if (active) setOpportunities(items);
    }).catch(failure => {
      if (active) setOpportunityError(failure.message);
    }).finally(() => { if (active) setLoadingOpportunities(false); });
    return () => { active = false; };
  }, [user?.id, workspace?.id]);

  useEffect(() => { setInserted(false); }, [contextKey]);

  function updateDraft(patch: Partial<SalesDraft>) {
    onChange({ ...session, draft: { ...draft, ...patch } });
  }

  function updateQuote(id: string, patch: Partial<SalesQuote>) {
    updateDraft({ quotes: draft.quotes.map(quote => quote.id === id ? { ...quote, ...patch } : quote) });
  }

  async function ask(action: SalesAction) {
    if (!user || !workspace) {
      setError("Entre em uma conta vinculada à equipe para usar a IA comercial. Você pode preparar o rascunho nesta sessão.");
      return;
    }
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const currentRequest = ++requestNumber.current;
    const sentContext = contextKey;
    setBusy(true);
    setError("");
    try {
      const analysis = await askSalesAssistant({ workspaceId: workspace.id, action, question, client, draft }, controller.signal);
      if (currentRequest !== requestNumber.current || controller.signal.aborted) return;
      if (sentContext !== latestContext.current) {
        setError("Os dados do cliente ou da proposta mudaram durante a análise. Solicite uma nova análise.");
        return;
      }
      onChange({ ...session, analysis, analysisContext: sentContext });
      setQuestion("");
      setTab("assistant");
    } catch (failure) {
      if (currentRequest === requestNumber.current && !controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Não foi possível analisar este cliente.");
      }
    } finally {
      if (currentRequest === requestNumber.current) setBusy(false);
    }
  }

  function insert(text: string) {
    onInsertMessage(text);
    setInserted(true);
  }

  const textField = (label: string, key: "modality" | "lives" | "region", placeholder: string) => <Field label={label}>
    <input className={control} value={draft[key]} maxLength={300} inputMode={key === "lives" ? "numeric" : undefined}
      placeholder={placeholder} onChange={event => updateDraft({ [key]: event.target.value })} />
  </Field>;

  return (
    <aside aria-label={`Elaboração de proposta para ${client.name}`}
      onKeyDown={event => { if (event.key === "Escape" && !preview) { event.stopPropagation(); onClose(); } }}
      className={`absolute inset-y-0 right-0 z-20 flex w-full max-w-[460px] flex-col border-l border-border bg-card shadow-2xl xl:relative xl:z-0 xl:w-[420px] xl:min-w-[420px] xl:shadow-none ${isClosing ? "koa-panel-exit" : "koa-panel-enter"}`}>
      <header className="shrink-0 border-b border-border p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <img src="/brand/koa-ghost-static.png" alt="" className="h-10 w-10 shrink-0 object-contain" />
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-foreground">KOA Comercial</h2>
              <p className="text-xs text-muted-foreground">Elaboração de proposta</p>
            </div>
          </div>
          <button ref={closeButton} type="button" onClick={onClose} aria-label="Fechar elaboração de proposta"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 min-w-0 border-l-2 border-primary pl-3">
          <p className="break-words text-sm font-medium text-foreground">{client.name}</p>
          {client.company && <p className="break-words text-xs text-muted-foreground">{client.company}</p>}
          <p className="mt-1 text-xs text-muted-foreground">{user?.user_metadata?.full_name || "Vendedor"} · Rascunho da sessão</p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col">
        <TabsList aria-label="Ferramentas comerciais" className="mx-4 mt-3 grid shrink-0 grid-cols-2 rounded-xl">
          <TabsTrigger value="assistant" className="gap-2 rounded-lg"><Sparkles className="h-4 w-4" />Assistente</TabsTrigger>
          <TabsTrigger value="proposal" className="gap-2 rounded-lg"><FileText className="h-4 w-4" />Proposta</TabsTrigger>
        </TabsList>

        <TabsContent value="assistant" className="m-0 min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
          <div className="space-y-5">
            <p className="text-sm leading-relaxed text-muted-foreground">Use a conversa de {client.name} para preparar a abordagem e organizar a proposta.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" disabled={busy} onClick={() => ask("analyze")}><Sparkles className="mr-2 h-3.5 w-3.5" />Analisar cliente</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => ask("message")}>Sugerir abordagem</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => ask("proposal")}>Estruturar proposta</Button>
            </div>
            <form onSubmit={event => { event.preventDefault(); if (question.trim() && !busy) ask("question"); }} className="space-y-2">
              <Field label="Como o KOA pode ajudar neste atendimento?">
                <textarea value={question} onChange={event => setQuestion(event.target.value)} maxLength={2000} rows={3}
                  className={`${control} resize-y`} placeholder="Ex.: Como abordar a preocupação deste cliente com o custo?" />
              </Field>
              <Button size="sm" type="submit" disabled={busy || !question.trim()}><Send className="mr-2 h-3.5 w-3.5" />Perguntar ao KOA</Button>
            </form>
            {busy && <p role="status" className="flex items-center gap-2 text-sm text-primary"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />Analisando este atendimento…</p>}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {stale && <p role="status" className="text-xs text-muted-foreground">O contexto foi atualizado. Analise novamente antes de usar a sugestão.</p>}
            {session.analysis && <div className="space-y-4">
              <AnalysisSection label="Contexto do cliente">{session.analysis.summary}</AnalysisSection>
              <AnalysisSection label="Informações a confirmar">
                {session.analysis.missingInformation.length ? <ul className="list-disc space-y-1 pl-4">
                  {session.analysis.missingInformation.map((item, index) => <li key={index}>{item}</li>)}
                </ul> : "Nenhuma pendência identificada nesta análise. Confira as condições da cotação."}
              </AnalysisSection>
              <AnalysisSection label="Orientação ao vendedor">{session.analysis.salesApproach}</AnalysisSection>
              <AnalysisSection label="Mensagem sugerida">
                <p>{session.analysis.suggestedMessage}</p>
                <Button className="mt-3" size="sm" variant="outline" disabled={stale || busy || !session.analysis.suggestedMessage.trim()}
                  onClick={() => insert(session.analysis!.suggestedMessage)}>Inserir no campo de mensagem<ChevronRight className="ml-1 h-3.5 w-3.5" /></Button>
              </AnalysisSection>
              <AnalysisSection label="Estrutura da proposta">{session.analysis.proposalOutline}</AnalysisSection>
            </div>}
            <Button variant="ghost" className="w-full justify-between" onClick={() => setTab("proposal")}>Preencher proposta<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </TabsContent>

        <TabsContent value="proposal" className="m-0 min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin">
          <div className="space-y-5">
            <Field label="Oportunidade do seu funil">
              <select className={control} value={draft.leadId} disabled={!user || !workspace || loadingOpportunities}
                onChange={event => updateDraft({ leadId: event.target.value })}>
                <option value="">{loadingOpportunities ? "Carregando…" : "Sem vínculo com oportunidade"}</option>
                {opportunities.map(item => <option key={item.id} value={item.id}>{item.title} · {item.pipeline}</option>)}
              </select>
            </Field>
            {selectedOpportunity && <p className="text-xs text-muted-foreground">Etapa atual: {selectedOpportunity.stage}</p>}
            {opportunityError && <p role="alert" className="text-xs text-destructive">{opportunityError}</p>}
            <Field label="Produto">
              <select className={control} value={draft.product} onChange={event => updateDraft({ product: event.target.value as SalesDraft["product"] })}>
                {Object.entries(productLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            {textField("Modalidade", "modality", "Ex.: PME, individual ou coletivo por adesão")}
            <div className="grid grid-cols-1 gap-4 min-[380px]:grid-cols-2">
              {textField("Total de vidas confirmado", "lives", "Ex.: 12")}
              {textField("Região de atendimento", "region", "Ex.: Belo Horizonte / MG")}
            </div>
            <Field label="Necessidades e preferências confirmadas">
              <textarea className={`${control} resize-y`} rows={3} maxLength={3000} value={draft.needs}
                placeholder="Rede desejada, acomodação, orçamento e outros pontos da conversa" onChange={event => updateDraft({ needs: event.target.value })} />
            </Field>
            <div className="space-y-5 border-t border-border pt-4">
              <p className="text-sm font-medium text-foreground">Opções cotadas</p>
              {draft.quotes.map((quote, index) => <section key={quote.id} aria-label={`Opção ${index + 1}`} className="space-y-3 rounded-2xl border border-border bg-background/50 p-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-foreground">Opção {index + 1}</h3>
                  <button type="button" aria-label={`Remover opção ${index + 1}`} onClick={() => updateDraft({ quotes: draft.quotes.filter(item => item.id !== quote.id) })}
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-primary"><Trash2 className="h-4 w-4" /></button>
                </div>
                {([
                  ["insurer", "Operadora", "Nome da operadora"], ["plan", "Produto / plano", "Nome exato do produto"],
                  ["monthlyAmount", "Valor mensal total (R$)", "Ex.: 1.234,56"], ["source", "Origem da cotação", "Ex.: portal, protocolo ou arquivo recebido"],
                ] as const).map(([key, label, placeholder]) => <Field key={key} label={label}>
                  <input className={control} value={quote[key]} maxLength={300} inputMode={key === "monthlyAmount" ? "decimal" : undefined}
                    placeholder={placeholder} onChange={event => updateQuote(quote.id, { [key]: event.target.value })} />
                </Field>)}
                <Field label="Validade da cotação"><input type="date" className={control} value={quote.validUntil} onChange={event => updateQuote(quote.id, { validUntil: event.target.value })} /></Field>
                <Field label="Condições da operadora"><textarea rows={3} className={`${control} resize-y`} value={quote.conditions} maxLength={2000}
                  placeholder="Coberturas, coparticipação, carências e condições verificadas" onChange={event => updateQuote(quote.id, { conditions: event.target.value })} /></Field>
              </section>)}
              <Button variant="outline" size="sm" disabled={draft.quotes.length >= 5} onClick={() => updateDraft({ quotes: [...draft.quotes, createSalesQuote()] })}><Plus className="mr-2 h-4 w-4" />Adicionar opção</Button>
            </div>
            {showIssues && issues.length > 0 && <div role="alert" className="space-y-2 text-sm text-destructive">
              <p>Complete a proposta antes de gerar a apresentação:</p>
              <ul className="list-disc space-y-1 pl-4">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>
            </div>}
            <Button className="w-full" onClick={() => {
              setShowIssues(true);
              if (!issues.length) setPreview(buildProposalText(client, draft));
            }}><FileText className="mr-2 h-4 w-4" />Revisar apresentação</Button>
          </div>
        </TabsContent>
      </Tabs>
      <footer className="shrink-0 border-t border-border px-4 py-3">
        {inserted ? <p role="status" className="flex items-center gap-2 text-xs text-primary"><Check className="h-3.5 w-3.5" />Texto inserido para revisão. Envie pelo chat quando estiver pronto.</p> :
          <p className="text-xs leading-relaxed text-muted-foreground">Rascunho mantido enquanto esta página estiver aberta. As sugestões são internas; o vendedor revisa o envio.</p>}
      </footer>
      <Dialog open={Boolean(preview)} onOpenChange={open => { if (!open) setPreview(""); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>Revisar apresentação comercial</DialogTitle>
            <DialogDescription>Confira o texto e as condições antes de inserir no campo de mensagem.</DialogDescription></DialogHeader>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{preview}</p>
          <Button onClick={() => { insert(preview); setPreview(""); }}>Inserir no campo de mensagem</Button>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
