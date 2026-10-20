import type { Database, Json } from "./types";

type Table<R> = {
  Row: R;
  Insert: Partial<R>;
  Update: Partial<R>;
  Relationships: [];
};
export type TaskSector = {
  id: string;
  workspace_id: string;
  name: string;
  active: boolean;
};
export type TaskSectorMember = {
  active?: boolean;
  can_dispatch?: boolean;
  can_manage_boards?: boolean;
  can_manage_members?: boolean;
  workspace_id: string;
  sector_id: string;
  user_id: string;
};
export type TaskStageRow = {
  board_id?: string | null;
  workspace_id: string;
  id: string;
  name: string;
  color: string;
  position: number;
  base_status: "todo" | "in_progress" | "review" | "done" | "canceled";
  archived: boolean;
};
export type TaskPerson = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  role: "admin" | "member";
};
export type TaskConversation = {
  board_id?: string | null;
  id: string;
  workspace_id: string;
  created_by: string;
  created_at: string;
};
export type TaskChatCycle = {
  id: string;conversation_id:string;workspace_id:string;created_by:string;
  state:"active"|"completed"|"historical";created_at:string;completed_at:string|null;begin_key:string;
};
export type TaskHistoryRequest = {kind:"tasks"|"drafts"|"messages";ids:string[];intent:"view"|"resume"|"revise";resolved?:boolean};
export type TaskMessage = {
  cycle_id?: string | null;
  id: string;
  workspace_id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  request_key: string;
  result: Json | null;
  created_at: string;
};
export type TaskDraft = {
  cycle_id?: string | null;
  cycle_position?: number | null;
  original_cycle_id?: string | null;
  batch_id?: string;
  source_message_id?: string | null;
  position?: number;
  id: string;
  workspace_id: string;
  conversation_id: string;
  created_by: string;
  payload: Json;
  version: number;
  target_task_id: string | null;
  target_updated_at: string | null;
  confirmed_task_id: string | null;
  confirmed_version: number | null;
  created_at: string;
  updated_at: string;
};
export type TaskAttachment = {
  id: string;
  workspace_id: string;
  draft_id: string;
  task_id: string | null;
  storage_path: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  created_by: string;
  created_at: string;
};
export type TaskEvent = {
  id: string;
  workspace_id: string;
  task_id: string | null;
  draft_id: string | null;
  actor_id: string;
  kind: string;
  details: Json;
  created_at: string;
};
export type TaskTables = {
  task_chat_cycles: Table<TaskChatCycle>;
  task_sectors: Table<TaskSector>;
  task_sector_members: Table<TaskSectorMember>;
  task_stages: Table<TaskStageRow>;
  task_conversations: Table<TaskConversation>;
  task_messages: Table<TaskMessage>;
  task_drafts: Table<TaskDraft>;
  task_attachments: Table<TaskAttachment>;
  task_events: Table<TaskEvent>;
};
type Task = Database["public"]["Tables"]["tasks"]["Row"];
export type TaskFunctions = {
  task_current_cycle: {Args:{p_conversation:string};Returns:Json};
  task_prepare_cycle: {Args:{p_conversation:string;p_expected:string|null;p_request:string};Returns:TaskChatCycle[]};
  task_post_cycle_message: {Args:{p_cycle:string;p_request:string;p_content:string};Returns:TaskMessage[]};
  task_save_cycle_draft: {Args:{p_cycle:string;p_id:string;p_version:number;p_payload:Json;p_target:string|null};Returns:TaskDraft[]};
  task_resume_cycle_draft: {Args:{p_cycle:string;p_draft:string;p_version:number};Returns:TaskDraft[]};
  task_confirm_cycle: {Args:{p_cycle:string;p_items:Json};Returns:Json};
  task_history_lookup: {Args:{p_conversation:string;p_kind:string;p_query?:string;p_from?:string;p_to?:string;p_limit?:number};Returns:Json};
  task_history_records: {Args:{p_conversation:string;p_kind:string;p_ids:string[]};Returns:Json};
  task_operational_conversation: {
    Args: { p_board: string };
    Returns: TaskConversation[];
  };
  task_confirm_batch: {
    Args: { p_conversation: string; p_items: Json };
    Returns: Json;
  };
  task_people: { Args: { p_workspace: string }; Returns: TaskPerson[] };
  task_save_personal: {
    Args: {
      p_workspace: string;
      p_request: string;
      p_id: string | null;
      p_updated: string | null;
      p_payload: Json;
    };
    Returns: Task[];
  };
  task_save_stages: {
    Args: { p_workspace: string; p_stages: Json };
    Returns: TaskStageRow[];
  };
  task_start_conversation: {
    Args: { p_workspace: string; p_id: string };
    Returns: TaskConversation[];
  };
  task_post_message: {
    Args: { p_conversation: string; p_request: string; p_content: string };
    Returns: TaskMessage[];
  };
  task_save_draft: {
    Args: {
      p_conversation: string;
      p_id: string;
      p_version: number;
      p_payload: Json;
      p_target?: string | null;
    };
    Returns: TaskDraft[];
  };
  task_confirm_draft: {
    Args: { p_id: string; p_version: number };
    Returns: Task[];
  };
  task_register_attachment: {
    Args: {
      p_draft: string;
      p_id: string;
      p_name: string;
      p_mime: string;
      p_size: number;
      p_path: string;
    };
    Returns: TaskAttachment[];
  };
  task_remove_attachment: {
    Args: {p_draft:string;p_id:string;p_version:number};
    Returns: Json;
  };
  task_record_interpretation: {
    Args: {
      p_message: string;
      p_reply: string;
      p_drafts: Json;
      p_query_result?: Json;
    };
    Returns: Json;
  };
};
