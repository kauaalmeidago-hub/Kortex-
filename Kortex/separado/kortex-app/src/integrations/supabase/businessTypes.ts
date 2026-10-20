import type { Database, Json } from "./types";
type Table<R> = {
  Row: R;
  Insert: Partial<R>;
  Update: Partial<R>;
  Relationships: [];
};
export type BusinessContext = {
  board_id: string;
  workspace_id: string;
  sector_id: string;
  sector_name: string;
  board_name: string;
  kind: "tasks" | "pipeline";
  visibility: "personal" | "sector";
  can_write: boolean;
  can_manage: boolean;
  can_dispatch: boolean;
  can_share: boolean;
  pipeline_id: string | null;
  version: string;
  workspace_name?: string;
  can_create_shared?: boolean;
};
export type PipelineSetupScope = {
  workspace_id: string; workspace_name: string; sector_id: string; sector_name: string;
  can_create: boolean; can_create_shared: boolean;
};
export type PipelineSetupResult = { board_id: string; pipeline_id: string; workspace_id: string; sector_id: string };
export type BusinessBoard = {
  id: string;
  workspace_id: string;
  sector_id: string;
  owner_id: string;
  kind: "tasks" | "pipeline";
  name: string;
  visibility: string;
  access_mode: string;
  archived: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
};
export type LeadFile = {
  id: string;
  workspace_id: string;
  lead_id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_by: string;
  created_at: string;
};
export type BusinessTables = {
  lead_contacts: Table<{lead_id:string;contact_id:string;created_by:string;created_at:string}>;
  business_boards: Table<BusinessBoard>;
  business_board_members: Table<{
    workspace_id: string;
    sector_id: string;
    board_id: string;
    user_id: string;
    active: boolean;
    can_write: boolean;
    can_manage: boolean;
    can_share: boolean;
    can_read_personal: boolean;
  }>;
  lead_files: Table<LeadFile>;
};
type Rpc<A, R> = { Args: A; Returns: R };
export type BusinessFunctions = {
  business_lead_contact: Rpc<{p_lead:string;p_contact:string;p_action:string;p_values?:Json;p_updated?:string|null},string>;
  koa_whatsapp_status: Rpc<{p_board:string}, import('@/components/tasks/WhatsAppSupervision').WhatsAppSupervisionStatus|null>;
  koa_whatsapp_conversations: Rpc<{p_board:string;p_enabled:boolean}, import('@/components/tasks/WhatsAppSupervision').WhatsAppSupervisionStatus>;
  koa_whatsapp_tasks: Rpc<{p_board:string;p_enabled:boolean}, import('@/components/tasks/WhatsAppSupervision').WhatsAppSupervisionStatus>;
  business_pipeline_column: Rpc<{p_board:string;p_version:string;p_id:string;p_name:string;p_create:boolean},Database['public']['Tables']['stages']['Row']>;
  business_pipeline_column_count: Rpc<{p_board:string;p_id:string},number>;
  business_pipeline_remove_column: Rpc<{p_board:string;p_version:string;p_id:string;p_destination:string;p_request:string},Json>;
  business_pipeline_restore_column: Rpc<{p_board:string;p_version:string;p_request:string},string>;
  task_admin_accept_invite: Rpc<{p_workspace?:string|null},boolean>;
  task_admin_access: Rpc<{p_board:string},boolean>;
  task_admin_create_sector: Rpc<{p_workspace:string;p_code:string},string>;
  task_ai_status: Rpc<{p_workspace:string},import('@/features/tasks/ai').TaskAiConnection>;
  business_remove_task: Rpc<{p_board:string;p_id:string;p_updated:string;p_request:string},Database['public']['Tables']['tasks']['Row'][]>;
  business_restore_task: Rpc<{p_board:string;p_id:string;p_request:string},Database['public']['Tables']['tasks']['Row'][]>;
  business_move_task: Rpc<{p_board:string;p_id:string;p_updated:string;p_stage:string},Database['public']['Tables']['tasks']['Row'][]>;
  business_task_column: Rpc<{p_board:string;p_version:string;p_id:string;p_name:string;p_create:boolean},import('./taskTypes').TaskStageRow[]>;

  business_contexts: Rpc<Record<string, never>, BusinessContext[]>;
  business_onboard_personal: Rpc<{ p_sector: string }, undefined>;
  business_create_board: Rpc<
    {
      p_sector: string;
      p_kind: string;
      p_name: string;
      p_visibility?: string;
      p_access?: string;
    },
    string
  >;
  business_create_sector: Rpc<{ p_workspace: string; p_code: string }, string>;
  business_can_board: Rpc<{ p_board: string; p_capability?: string }, boolean>;
  business_my_workspace_admin: Rpc<{ p_workspace: string }, boolean>;
  business_people: Rpc<{ p_board: string }, import("./taskTypes").TaskPerson[]>;
  business_save_task: Rpc<
    {
      p_board: string;
      p_request: string;
      p_id: string | null;
      p_updated: string | null;
      p_payload: Json;
    },
    Database["public"]["Tables"]["tasks"]["Row"][]
  >;
  business_task_permissions: Rpc<
    { p_board: string },
    { id: string; can_edit: boolean }[]
  >;
  business_lead_permissions: Rpc<
    { p_board: string },
    { id: string; can_edit: boolean }[]
  >;
  business_save_columns: Rpc<
    { p_board: string; p_version: string; p_columns: Json; p_moves?: Json },
    undefined
  >;
  business_start_conversation: Rpc<
    { p_board: string; p_id: string },
    import("./taskTypes").TaskConversation[]
  >;
  business_set_sector_member: Rpc<
    {
      p_sector: string;
      p_user: string;
      p_active: boolean;
      p_dispatch?: boolean;
      p_manage_boards?: boolean;
      p_manage_members?: boolean;
      p_read_personal?: boolean;
    },
    undefined
  >;
  business_set_board_member: Rpc<
    {
      p_board: string;
      p_user: string;
      p_active: boolean;
      p_write?: boolean;
      p_manage?: boolean;
      p_share?: boolean;
      p_read_personal?: boolean;
    },
    undefined
  >;
  business_set_participant: Rpc<
    {
      p_kind: string;
      p_record: string;
      p_user: string;
      p_edit: boolean;
      p_remove?: boolean;
    },
    undefined
  >;
  business_can_lead: Rpc<{ p_lead: string; p_write?: boolean }, boolean>;
  business_pipeline_setup_scopes: Rpc<Record<string, never>, PipelineSetupScope[]>;
  business_pipeline_setup_status: Rpc<{ p_request: string }, PipelineSetupResult[]>;
  business_create_pipeline_setup: Rpc<{ p_sector: string; p_name: string; p_columns: Json; p_request: string; p_visibility?: string }, PipelineSetupResult[]>;
  business_can_company: Rpc<{ p_id: string; p_write?: boolean }, boolean>;
  business_can_contact: Rpc<{ p_id: string; p_write?: boolean }, boolean>;
};
