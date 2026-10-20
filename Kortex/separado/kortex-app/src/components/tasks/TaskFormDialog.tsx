import { TaskChatDialogContent } from "./TaskChatDialogContent";
import { useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { formatCnpj } from "@/features/companies/model";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  taskValues,
  validateTask,
  type TaskCatalog,
  type TaskValues,
} from "@/features/tasks/model";

export function TaskField({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <label className="task-field">
      <span>{label}</span>
      {children}
    </label>
  );
}
export function TaskFields({
  values: v,
  onChange,
  catalog,
  admin = false,
  disabled = false,
  showStage = true,
}: {
  values: TaskValues;
  onChange: (v: TaskValues) => void;
  catalog: TaskCatalog;
  admin?: boolean;
  disabled?: boolean;
  showStage?: boolean;
}) {
  const [notice, setNotice] = useState("");
  const board=catalog.boards?.find(b=>b.board_id===v.board_id);
  const change = (key: keyof TaskValues, value: string) =>
    onChange({ ...v, [key]: value });
  const company = catalog.companies.find((c) => c.id === v.company_id);
  const scopedCompanies=board?catalog.companies.filter(c=>c.sector_id===board.sector_id):catalog.companies;
  const companies = company ? [company] : scopedCompanies;
  const operators = Array.from(
    new Set(
      companies.flatMap((c) =>
        Array.isArray(c.offerings)
          ? c.offerings.flatMap((o) =>
              o &&
              typeof o === "object" &&
              !Array.isArray(o) &&
              typeof o.operator === "string"
                ? [o.operator]
                : [],
            )
          : [],
      ),
    ),
  ).sort();
  const projects = Array.from(
    new Set(companies.flatMap((c) => (c.project ? [c.project] : []))),
  ).sort();
  const select = (
    key: keyof TaskValues,
    label: string,
    options: { id: string; name: string }[],
    empty: string,
  ) => (
    <TaskField label={label}>
      <select
        name={key}
        value={v[key]}
        disabled={disabled}
        onChange={(e) => change(key, e.target.value)}
      >
        <option value="">{empty}</option>
        {v[key] && !options.some((o) => o.id === v[key]) && (
          <option value={v[key]}>
            {key === "operator" || key === "project"
              ? v[key]
              : "Seleção indisponível — revise"}
          </option>
        )}
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </TaskField>
  );
  return (
    <>
      {admin&&Boolean(catalog.boards?.length)&&<TaskField label="Quadro de destino"><select aria-label="Quadro de destino" value={v.board_id??''} disabled={disabled} onChange={e=>{
        const next=catalog.boards?.find(b=>b.board_id===e.target.value);if(next)onChange({...v,board_id:next.board_id,sector_id:next.sector_id,stage_id:catalog.stages.find(s=>s.board_id===next.board_id&&!s.archived)?.id??'',company_id:'',operator:'',project:'',assigned_to:''});
      }}><option value="">Selecione o quadro autorizado</option>{catalog.boards?.map(b=><option value={b.board_id} key={b.board_id}>{b.sector_name} · {b.board_name}</option>)}</select></TaskField>}
      <TaskField label="Título da tarefa">
        <input
          name="title"
          value={v.title}
          placeholder="Informe o título"
          maxLength={240}
          required
          disabled={disabled}
          onChange={(e) => change("title", e.target.value)}
        />
      </TaskField>
      <div
        className={`task-context-fields ${admin ? "task-context-fields--admin" : ""}`}
      >
        <TaskField label="Empresa">
          <select
            name="company_id"
            disabled={disabled}
            value={v.company_id}
            onChange={(e) => {
              change("company_id", e.target.value);
              setNotice(
                "Confira operadora, projeto e código no novo contexto. As escolhas foram preservadas para revisão.",
              );
            }}
          >
            <option value="">Selecione a empresa (opcional)</option>
            {v.company_id && !company && (
              <option value={v.company_id}>
                Empresa indisponível — revise
              </option>
            )}
            {scopedCompanies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.cnpj ? ` · ${formatCnpj(c.cnpj)}` : ""}
              </option>
            ))}
          </select>
        </TaskField>
        <TaskField label="Código">
          <input
            name="operational_code"
            value={v.operational_code}
            placeholder="Informe o código"
            disabled={disabled}
            maxLength={120}
            onChange={(e) => change("operational_code", e.target.value)}
          />
        </TaskField>
        {select(
          "operator",
          "Operadora",
          operators.map((name) => ({ id: name, name })),
          "Selecione a operadora (opcional)",
        )}
        {select(
          "project",
          "Projeto",
          projects.map((name) => ({ id: name, name })),
          "Selecione o projeto (opcional)",
        )}
      </div>
      {notice && (
        <p className="task-help" role="status">
          {notice}
        </p>
      )}
      {admin && (
        <div className="task-assignment-fields">
          <TaskField label="Setor">
            <select
              name="sector_id"
              value={v.sector_id}
              disabled={disabled||Boolean(board)}
              onChange={(e) => {
                change("sector_id", e.target.value);
                if (v.assigned_to)
                  setNotice(
                    "Confira se o responsável pertence ao setor selecionado antes de salvar.",
                  );
              }}
            >
              <option value="">Selecione o setor</option>
              {catalog.sectors
                .filter((s) => s.active || s.id === v.sector_id)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.active ? "" : " (inativo)"}
                  </option>
                ))}
            </select>
          </TaskField>
          {select(
            "assigned_to",
            "Responsável",
            catalog.people
              .filter((p) =>
                catalog.members.some(
                  (m) => m.sector_id === v.sector_id && m.user_id === p.user_id,
                ),
              )
              .map((p) => ({
                id: p.user_id,
                name:
                  p.full_name && p.email
                    ? `${p.full_name} · ${p.email}`
                    : p.full_name || p.email || "Integrante sem nome",
              })),
            "Sem responsável — fila do setor",
          )}
          <TaskField label="Data de vencimento">
            <input
              type="date"
              name="due_date"
              value={v.due_date}
              disabled={disabled}
              onChange={(e) => change("due_date", e.target.value)}
            />
          </TaskField>
          {select(
            "priority",
            "Prioridade",
            [
              { id: "high", name: "Alta" },
              { id: "medium", name: "Média" },
              { id: "low", name: "Baixa" },
            ],
            "Selecione a prioridade",
          )}
        </div>
      )}
      <div
        className={`task-form-bottom ${admin ? "task-form-bottom--admin" : ""}`}
      >
        <TaskField label="Descrição">
          <textarea
            aria-label="Descrição"
            name="description"
            placeholder="Adicione detalhes da tarefa..."
            value={v.description}
            disabled={disabled}
            onChange={(e) => change("description", e.target.value)}
            aria-describedby="task-description-count"
          />
          <small
            id="task-description-count"
            className={v.description.length > 500 ? "task-error" : ""}
          >
            {v.description.length}/500
          </small>
        </TaskField>
        <div className="task-meta-fields">
          {!admin && (
            <>
              <TaskField label="Data de vencimento">
                <input
                  type="date"
                  name="due_date"
                  value={v.due_date}
                  disabled={disabled}
                  onChange={(e) => change("due_date", e.target.value)}
                />
              </TaskField>
              {select(
                "priority",
                "Prioridade",
                [
                  { id: "high", name: "Alta" },
                  { id: "medium", name: "Média" },
                  { id: "low", name: "Baixa" },
                ],
                "Selecione a prioridade",
              )}
            </>
          )}
          {showStage &&
            select(
              "stage_id",
              "Etapa",
              catalog.stages.filter(s=>!board||s.board_id===board.board_id).map((s) => ({ id: s.id, name: s.name })),
              "Selecione a etapa",
            )}
        </div>
      </div>
    </>
  );
}
export default function TaskFormDialog({
  initial,
  catalog,
  admin = false,
  title = "Nova tarefa",
  submitLabel = "Criar tarefa",
  onClose,
  onSave,
  disabledReason,
  returnFocus,
  open = true,
  chatMotion = false,
  children,
}: {
  initial?: TaskValues;
  catalog: TaskCatalog;
  admin?: boolean;
  title?: string;
  submitLabel?: string;
  onClose: () => void;
  onSave: (values: TaskValues, request: string) => Promise<void>;
  disabledReason?: string;
  returnFocus?: HTMLElement | null;
  open?: boolean;
  chatMotion?: boolean;
  children?: ReactNode;
}) {
  const Content = chatMotion ? TaskChatDialogContent : DialogContent;
  const [values, setValues] = useState(
    () =>
      initial ??
      taskValues(undefined, catalog.stages.find((s) => !s.archived)?.id),
  );
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const inFlight = useRef(false);
  const request = useRef(crypto.randomUUID());
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Content
        className={`tasks-theme task-dialog ${admin ? "task-dialog--admin" : ""}`}
        onCloseAutoFocus={(e) => {
          if (returnFocus) {
            e.preventDefault();
            returnFocus.focus();
          }
        }}
        onEscapeKeyDown={(e) => {
          if (saving) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          if (saving) e.preventDefault();
        }}
      >
        <header>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {admin
              ? "Confira os dados e o destino. Salvar ajustes não cria nem encaminha a tarefa."
              : "Crie uma tarefa própria. Empresa, contexto corporativo e vencimento são opcionais."}
          </DialogDescription>
          <DialogClose asChild>
            <button
              className="task-close"
              aria-label="Fechar formulário de tarefa"
              disabled={saving}
            >
              <X size={19} />
            </button>
          </DialogClose>
        </header>
        <form
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            if (inFlight.current) return;
            const invalid = validateTask(values, catalog, admin);
            if (invalid) {
              setError(invalid);
              return;
            }
            if (disabledReason) {
              setError(disabledReason);
              return;
            }
            inFlight.current = true;
            setSaving(true);
            setError("");
            try {
              await onSave(values, request.current);
              onClose();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              inFlight.current = false;
              setSaving(false);
            }
          }}
        >
          <div className="task-dialog-body">
            <TaskFields
              values={values}
              onChange={setValues}
              catalog={catalog}
              admin={admin}
              disabled={saving}
              showStage={!admin}
            />
            {children}
            {disabledReason && <p className="task-help">{disabledReason}</p>}
            {error && (
              <p role="alert" className="task-error">
                {error}
              </p>
            )}
          </div>
          <footer>
            {admin && (
              <TaskField label="Etapa">
                <select
                  name="stage_id"
                  value={values.stage_id}
                  disabled={saving}
                  onChange={(e) =>
                    setValues({ ...values, stage_id: e.target.value })
                  }
                >
                  {catalog.stages.map((stage) => (
                    <option key={stage.id} value={stage.id}>
                      {stage.name}
                    </option>
                  ))}
                </select>
              </TaskField>
            )}
            <div className="task-actions">
              <button
                type="button"
                className="task-button"
                disabled={saving}
                onClick={onClose}
              >
                Cancelar
              </button>
              <button
                className="task-button task-cyan"
                disabled={saving || Boolean(disabledReason)}
              >
                {saving ? "Salvando..." : submitLabel}
              </button>
            </div>
          </footer>
        </form>
      </Content>
    </Dialog>
  );
}
