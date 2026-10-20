import { TaskChatDialogContent } from "./TaskChatDialogContent";
import { useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  connectTaskAi,
  disconnectTaskAi,
  type TaskAiConnection,
} from "@/features/tasks/ai";
import { TaskField } from "./TaskFormDialog";
export default function TaskAiConnectionDialog({
  workspace,
  connection,
  onClose,
  onSaved,
  open = true,
  chatMotion = false,
}: {
  open?: boolean;
  chatMotion?: boolean;
  workspace: string;
  connection?: TaskAiConnection;
  onClose: () => void;
  onSaved: () => Promise<unknown>;
}) {
  const Content=chatMotion ? TaskChatDialogContent : DialogContent;
  const [apiKey, setApiKey] = useState(""),
    [model, setModel] = useState(connection?.model || "gpt-4.1-mini");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [current, setCurrent] = useState(connection),
    pending = useRef(false);
  const change = async (disconnect = false) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = disconnect
        ? await disconnectTaskAi(workspace)
        : await connectTaskAi(workspace, apiKey.trim(), model.trim());
      setApiKey("");
      setCurrent(saved);
      setNotice(
        disconnect
          ? "Conexão removida. Os rascunhos foram preservados."
          : "OpenAI conectada. Revise os rascunhos antes de encaminhar.",
      );
      await onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setApiKey("");
          onClose();
        }
      }}
    >
      <Content className="tasks-theme task-dialog task-ai-dialog">
        <header>
          <div>
            <DialogTitle>Conectar OpenAI</DialogTitle>
            <DialogDescription>
              Configure a interpretação de tarefas para sua conta nesta
              organização.
            </DialogDescription>
          </div>
          <button
            className="task-close"
            aria-label="Fechar conexão OpenAI"
            disabled={busy}
            onClick={() => {
              setApiKey("");
              onClose();
            }}
          >
            <X size={18} />
          </button>
        </header>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void change();
          }}
        >
          <div className="task-dialog-body">
            <p className="task-help" role="status">
              {current?.configured
                ? `Conectada · ${current.model}`
                : "Nenhuma chave configurada."}
            </p>
            <TaskField
              label={
                current?.configured
                  ? "Nova chave de API"
                  : "Chave de API OpenAI"
              }
            >
              <input
                type="password"
                autoComplete="new-password"
                name="openai_api_key"
                placeholder="Cole sua chave de API"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                maxLength={512}
                disabled={busy}
                required
                spellCheck={false}
              />
            </TaskField>
          <p className="task-help"><a className="task-link" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Abrir minhas chaves na OpenAI</a></p>
          <TaskField label="Modelo">
              <input
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Informe o identificador do modelo"
                maxLength={100}
                required
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
              />
            </TaskField>
            <p className="task-help">
              A chave fica criptografada no cofre do servidor e não é exibida
              novamente. Conectar valida o acesso ao modelo sem gerar uma
              resposta.
            </p>
            <p className="task-help">
              Ao interpretar, a mensagem e os campos necessários dos cadastros
              autorizados são enviados à OpenAI. Anexos não são enviados
              automaticamente. O uso da API depende dos créditos e limites da
              sua conta OpenAI.
            </p>
            <p className="task-help">
              A IA prepara rascunhos. Criar e encaminhar uma tarefa continua
              exigindo sua confirmação.
            </p>
            {error && (
              <p role="alert" className="task-error">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="task-help">
                {notice}
              </p>
            )}
          </div>
          <footer>
            {current?.configured && (
              <button
                type="button"
                className="task-button"
                disabled={busy}
                onClick={() => void change(true)}
              >
                Desconectar
              </button>
            )}
            <button
              type="button"
              className="task-button"
              disabled={busy}
              onClick={() => {
                setApiKey("");
                onClose();
              }}
            >
              Fechar
            </button>
            <button
              className="task-button task-cyan"
              disabled={busy || !apiKey.trim() || !model.trim()}
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Validando...
                </>
              ) : (
                "Conectar OpenAI"
              )}
            </button>
          </footer>
        </form>
      </Content>
    </Dialog>
  );
}
