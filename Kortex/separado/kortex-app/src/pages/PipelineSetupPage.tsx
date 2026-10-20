import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ClipboardList, GripVertical, Loader2, MoreHorizontal, Plus, Trash2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBusinessAccess } from "@/features/access/BusinessAccess";
import { environmentKey } from "@/features/access/environment";
import { useUnsavedChanges } from "@/hooks/useUnsavedChanges";
import { pipelineReturn } from "@/features/pipeline/navigation";
import { blankColumn, createPipelineSetup, emptyPipelineSetup, pipelineSetupScopes, pipelineSetupStatus, PipelineSetupError, reorderSetup, setupValidation, validPipelineSetup, type PipelineSetupDraft } from "@/features/pipeline/setup";
import type { PipelineSetupResult, PipelineSetupScope } from "@/integrations/supabase/businessTypes";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import "./TasksPage.css";
import "./PipelineSetupPage.css";

export default function PipelineSetupPage() {
  const { user, workspace } = useAuth();
  const access = useBusinessAccess();
  const [params] = useSearchParams();
  const scopes = useQuery({
    queryKey: [environmentKey, "pipeline-setup-scopes", user?.id, access.token],
    queryFn: ({ signal }) => pipelineSetupScopes(signal), enabled: Boolean(user && !access.loading && !access.error), retry: false,
  });
  const requested = scopes.data?.find(s => s.sector_id === params.get("sector"));
  const workspaceId = requested?.workspace_id ?? workspace?.id ?? access.selected("pipeline")?.workspace_id ?? access.selected("tasks")?.workspace_id;
  const options = (scopes.data ?? []).filter(s => !workspaceId || s.workspace_id === workspaceId);
  const preferred = requested?.sector_id ?? options.find(s => s.sector_id === access.selected("pipeline")?.sector_id)?.sector_id ??
    options.find(s => s.sector_id === access.selected("tasks")?.sector_id)?.sector_id ?? (options.length === 1 ? options[0].sector_id : "");
  if (access.loading || scopes.isLoading) return <div className="tasks-theme pipeline-setup-page"><p role="status">Carregando configuração da pipeline...</p></div>;
  if (access.error || scopes.error) return <div className="tasks-theme pipeline-setup-page"><div role="alert" className="pipeline-setup-block"><p>{access.error || scopes.error?.message}</p><button className="task-button" onClick={() => { void access.retry(); void scopes.refetch(); }}>Tentar novamente</button></div></div>;
  if (!user || !options.some(s => s.can_create)) return <div className="tasks-theme pipeline-setup-page"><div className="pipeline-setup-block"><h1>Configuração da pipeline</h1><p>Você não tem permissão para criar uma pipeline neste contexto. Solicite o vínculo ou a permissão à gestão da organização.</p><Link className="task-link" to="/pipeline?setup=cancelled">Voltar para pipelines</Link></div></div>;
  return <PipelineSetupForm key={`${user.id}:${workspaceId ?? ""}:${params.get("sector") ?? ""}`}
    userId={user.id} workspaceId={workspaceId ?? ""} options={options} preferred={preferred} returnTo={params.get("return")} />;
}

function PipelineSetupForm({ userId, workspaceId, options, preferred, returnTo }: {
  userId: string; workspaceId: string; options: PipelineSetupScope[]; preferred: string; returnTo: string | null;
}) {
  const access = useBusinessAccess(), client = useQueryClient(), navigate = useNavigate();
  const draftKey = [environmentKey, "pipeline-setup-draft", userId, workspaceId, preferred];
  const [draft, setDraft] = useState(() => client.getQueryData<PipelineSetupDraft>(draftKey) ?? emptyPipelineSetup(preferred));
  const current = useRef(draft), mounted = useRef(true), lock = useRef(false), restore = useRef(false);
  const [busy, setBusy] = useState(false), [completed, setCompleted] = useState(false), [uncertain, setUncertain] = useState(draft.attempted);
  const [error, setError] = useState("");
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(""), [dragging, setDragging] = useState(""), [over, setOver] = useState("");
  const inputs = useRef(new Map<string, HTMLInputElement>()), addButton = useRef<HTMLButtonElement>(null), menuMovedFocus = useRef(false);
  const errors = setupValidation(draft), valid = validPipelineSetup(draft);
  const selected = options.find(s => s.sector_id === draft.sectorId);
  const dirty = Boolean(draft.name || draft.columns.length !== 3 || draft.columns.some(c => c.name) || draft.attempted || draft.sectorId !== preferred || draft.visibility !== "personal");
  useUnsavedChanges(dirty && !completed);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const change = (update: (value: PipelineSetupDraft) => PipelineSetupDraft) => {
    const next = update(current.current); current.current = next; setDraft(next); client.setQueryData(draftKey, next);
  };
  useLayoutEffect(() => {
    if (!focus) return;
    const input = focus === "__add" ? addButton.current : inputs.current.get(focus); input?.focus({ preventScroll: true });
    input?.closest("article")?.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    setFocus("");
  }, [focus, draft.columns]);
  const openCreated = async (result: PipelineSetupResult) => {
    if (!mounted.current) return;
    setCompleted(true); client.removeQueries({ queryKey: draftKey, exact: true });
    await access.retry();
    // This navigation stays valid even if the access boundary remounts after discovering the new board.
    navigate(`/pipeline/${result.pipeline_id}`, { replace: true });
  };
  useEffect(() => {
    if (!current.current.attempted || restore.current) return;
    restore.current = true; lock.current = true; setBusy(true);
    void pipelineSetupStatus(current.current.requestId).then(async result => {
      if (!mounted.current) return;
      if (result) await openCreated(result); else { setUncertain(false); setError(""); }
    }).catch(() => { if (mounted.current) setError("Não foi possível recuperar o resultado da criação. Tente novamente; o rascunho foi preservado."); })
      .finally(() => { lock.current = false; if (mounted.current) setBusy(false); });
    // Recover this form's stable request once after an access-boundary remount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cancel = () => {
    if (busy || uncertain) return;
    if (dirty && !window.confirm("Existem alterações não salvas. Deseja cancelar a configuração?")) return;
    setCompleted(true); client.removeQueries({ queryKey: draftKey, exact: true });
    const back = returnTo === "/settings/pipelines" ? returnTo : pipelineReturn(returnTo);
    navigate(back === "/pipeline" ? `/pipeline?setup=cancelled${draft.sectorId ? `&sector=${draft.sectorId}` : ""}` : back, { replace: true });
  };
  const move = (id: string, target: string) => { change(d => ({ ...d, columns: reorderSetup(d.columns, id, target) })); setFocus(id); };
  const disabled = busy || uncertain;
  return <div className="tasks-theme pipeline-setup-page">
    <form noValidate onSubmit={async event => {
      event.preventDefault(); if (lock.current) return;
      setTouched(new Set(["pipeline", "sector", ...draft.columns.map(c => c.id)]));
      if (!valid || !selected?.can_create) return;
      lock.current = true; setBusy(true); setError("");
      const submission = { ...current.current, attempted: true }; change(() => submission);
      try { const result = await createPipelineSetup(submission); await openCreated(result); }
      catch (e) { if (mounted.current) { setError((e as Error).message); setUncertain(e instanceof PipelineSetupError && e.uncertain); } }
      finally { lock.current = false; if (mounted.current) setBusy(false); }
    }}>
      <section className="pipeline-setup-block pipeline-setup-heading" aria-label="Criar pipeline">
        <div className="pipeline-setup-context">
          {options.length > 1 ? <label className="pipeline-setup-field"><span>Organização e setor</span><select value={draft.sectorId} disabled={disabled} onChange={event => change(d => ({...d,sectorId:event.target.value,visibility:"personal"}))}>
            <option value="">Selecione o setor autorizado</option>{options.map(s => <option key={s.sector_id} value={s.sector_id} disabled={!s.can_create}>{s.workspace_name} · {s.sector_name}{!s.can_create ? " · Sem permissão de criação" : ""}</option>)}
          </select></label> : <span>{selected?.workspace_name} · {selected?.sector_name}</span>}
          {selected?.can_create_shared && <label className="pipeline-setup-field"><span>Visibilidade</span><select value={draft.visibility} disabled={disabled} onChange={event => change(d => ({...d,visibility:event.target.value as PipelineSetupDraft["visibility"]}))}><option value="personal">Pessoal</option><option value="sector">Compartilhada com o setor</option></select></label>}
        </div>
        <label className="pipeline-setup-field pipeline-setup-name"><span>Nome da pipeline</span><input required maxLength={100} value={draft.name} disabled={disabled} placeholder="Digite o nome da pipeline" aria-invalid={touched.has("pipeline") && Boolean(errors.name)} aria-describedby={errors.name && touched.has("pipeline") ? "pipeline-name-error" : undefined}
          onBlur={() => setTouched(t => new Set(t).add("pipeline"))} onChange={event => change(d => ({...d,name:event.target.value}))} />
          {touched.has("pipeline") && errors.name && <small id="pipeline-name-error" className="task-error">{errors.name}</small>}
        </label>
        <div className="pipeline-setup-actions"><button type="submit" className="task-button task-cyan" disabled={busy || !valid || !selected?.can_create}>{busy && <Loader2 size={16} className="animate-spin" />}{busy ? "Criando..." : "Criar pipeline"}</button><button type="button" className="task-button" disabled={disabled} onClick={cancel}>Cancelar</button></div>
        {!valid && <p className="pipeline-setup-guidance">Informe o nome da pipeline e dê nome a todas as colunas para criar seu quadro.</p>}
        {error && <p role="alert" className="task-error pipeline-setup-guidance">{error}</p>}
      </section>
      <section className="pipeline-setup-block" aria-labelledby="pipeline-structure-title">
        <h1 id="pipeline-structure-title">Estrutura da pipeline</h1><p className="pipeline-setup-subtitle">Crie as colunas da sua pipeline e defina as etapas do seu processo.</p>
        <div className="pipeline-setup-editors" aria-label="Colunas em configuração">
          {draft.columns.map((column, index) => <article key={column.id} className={`pipeline-setup-editor${over === column.id ? " pipeline-setup-editor--over" : ""}`} onDragOver={event => { if (dragging && !disabled) { event.preventDefault(); setOver(column.id); } }} onDrop={event => { event.preventDefault(); if (dragging && !disabled) move(dragging,column.id); setDragging(""); setOver(""); }}>
            <button type="button" className="pipeline-setup-icon pipeline-setup-grip" aria-label={`Ordenar coluna ${index+1}`} title="Arraste ou use as setas para ordenar" disabled={disabled} draggable={!disabled} onDragStart={event => { setDragging(column.id); event.dataTransfer.effectAllowed="move"; event.dataTransfer.setData("text/plain",column.id); }} onDragEnd={() => {setDragging("");setOver("");}}
              onKeyDown={event => { const next = event.key === "ArrowLeft" ? index-1 : event.key === "ArrowRight" ? index+1 : -1; if (next >= 0 && next < draft.columns.length) {event.preventDefault();move(column.id,draft.columns[next].id);} }}><GripVertical size={20} /></button>
            <label className="pipeline-setup-field"><span className="sr-only">Nome da coluna {index+1}</span><input ref={input => { if (input) inputs.current.set(column.id,input); else inputs.current.delete(column.id); }} required maxLength={80} placeholder="Nome da coluna" value={column.name} disabled={disabled} aria-invalid={touched.has(column.id) && Boolean(errors.fields[column.id])} aria-describedby={`column-help-${column.id}`} onBlur={() => setTouched(t => new Set(t).add(column.id))} onChange={event => change(d => ({...d,columns:d.columns.map(c => c.id === column.id ? {...c,name:event.target.value} : c)}))} /></label>
            <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="pipeline-setup-icon" aria-label={`Ações da coluna ${index+1}`} disabled={disabled}><MoreHorizontal size={20} /></button></DropdownMenuTrigger><DropdownMenuContent align="end" onCloseAutoFocus={event => { if (menuMovedFocus.current) {event.preventDefault();menuMovedFocus.current=false;} }}>
              <DropdownMenuItem disabled={index===0} onSelect={() => {menuMovedFocus.current=true;move(column.id,draft.columns[index-1].id);}}><ArrowLeft size={15} />Mover para antes</DropdownMenuItem>
              <DropdownMenuItem disabled={index===draft.columns.length-1} onSelect={() => {menuMovedFocus.current=true;move(column.id,draft.columns[index+1].id);}}><ArrowRight size={15} />Mover para depois</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { menuMovedFocus.current=true;change(d => ({...d,columns:d.columns.filter(c => c.id!==column.id)})); setFocus(draft.columns[index+1]?.id ?? draft.columns[index-1]?.id ?? "__add"); }}><Trash2 size={15} />Remover coluna</DropdownMenuItem>
            </DropdownMenuContent></DropdownMenu>
            <small id={`column-help-${column.id}`} className={touched.has(column.id) && errors.fields[column.id] ? "task-error" : ""}>{touched.has(column.id) && errors.fields[column.id] ? errors.fields[column.id] : "Defina a etapa que deseja criar."}</small>
          </article>)}
          <button ref={addButton} type="button" className="pipeline-setup-add" disabled={disabled || draft.columns.length >= 30} onClick={() => { const column=blankColumn(); change(d => ({...d,columns:[...d.columns,column]}));setFocus(column.id); }}><span><Plus size={25} /></span>Adicionar coluna</button>
        </div>
        {errors.columns && <p className="task-error mt-3" role="status">{errors.columns}</p>}
        {draft.columns.length >= 30 && <p className="pipeline-setup-subtitle mt-3">O limite é de 30 colunas.</p>}
      </section>
      <section className="pipeline-setup-block" aria-labelledby="pipeline-preview-title">
        <h2 id="pipeline-preview-title">Pré-visualização da pipeline</h2>
        <div className="pipeline-setup-preview" aria-label="Prévia das colunas">
          {draft.columns.map(column => <section className="pipeline-setup-preview-column" key={column.id}>
            <h3 className={!column.name.trim() ? "is-placeholder" : ""}>{column.name.trim() ? column.name : "Nome da coluna"}</h3>
            <button type="button" disabled className="pipeline-setup-preview-add" title="Disponível após criar a pipeline"><Plus size={15} />Adição rápida</button>
            <div className="pipeline-setup-preview-empty"><ClipboardList size={32} strokeWidth={1.3} /><p>Os registros poderão ser adicionados após criar a pipeline.</p></div>
          </section>)}
          {!draft.columns.length && <p className="pipeline-setup-subtitle">Adicione uma coluna para visualizar a estrutura.</p>}
        </div>
      </section>
    </form>
  </div>;
}

export function PipelineInitialState({ workspaceId, sectorId, cancelled }: {workspaceId?: string; sectorId?: string; cancelled: boolean}) {
  const {user}=useAuth(); const access=useBusinessAccess();
  const scopes=useQuery({queryKey:[environmentKey,"pipeline-setup-scopes",user?.id,access.token],queryFn:({signal})=>pipelineSetupScopes(signal),retry:false});
  const options=(scopes.data??[]).filter(s=>(!workspaceId||s.workspace_id===workspaceId)&&(!sectorId||s.sector_id===sectorId));
  const target=options.find(s=>s.can_create);
  if(scopes.isLoading)return <p className="task-empty" role="status">Consultando configuração da pipeline...</p>;
  if(scopes.error)return <div className="task-empty" role="alert"><p>{scopes.error.message}</p><button className="task-button" onClick={()=>void scopes.refetch()}>Tentar novamente</button></div>;
  const destination=`/pipeline/new${target ? `?sector=${target.sector_id}` : ""}`;
  if(target&&!cancelled)return <Navigate to={destination} replace />;
  return <div className="pipeline-setup-welcome"><ClipboardList size={42} strokeWidth={1.3}/><h1>Nenhuma pipeline configurada neste contexto</h1><p>{target?"Defina o nome e as colunas para começar seu quadro.":"Solicite à gestão da organização o vínculo ou a permissão para criar uma pipeline."}</p>{target&&<Link className="task-button task-cyan" to={destination}><Plus size={16}/>Configurar pipeline</Link>}</div>;
}
