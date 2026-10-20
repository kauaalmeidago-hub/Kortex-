-- Explicit requests to KOA only; no passive capture of group conversations.
ALTER TABLE public.koa_whatsapp_channels DROP CONSTRAINT koa_whatsapp_channels_tasks_enabled_check;
ALTER TABLE public.koa_whatsapp_channels ADD COLUMN tasks_activated_at timestamptz;
CREATE TABLE public.koa_whatsapp_destinations (
 channel_id uuid NOT NULL REFERENCES public.koa_whatsapp_channels(id),
 sector_code text NOT NULL CHECK(sector_code IN ('comercial','relacionamento')),
 board_id uuid NOT NULL REFERENCES public.business_boards(id),
 recipient_id uuid NOT NULL REFERENCES auth.users(id),
 PRIMARY KEY(channel_id,sector_code),UNIQUE(channel_id,board_id)
);
CREATE TABLE public.koa_whatsapp_task_runs (
 channel_id uuid NOT NULL REFERENCES public.koa_whatsapp_channels(id),event_id text NOT NULL,
 source_at timestamptz NOT NULL,request_hash text NOT NULL,results jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(channel_id,event_id)
);
ALTER TABLE public.koa_whatsapp_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.koa_whatsapp_task_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.koa_whatsapp_destinations,public.koa_whatsapp_task_runs FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.koa_whatsapp_destinations,public.koa_whatsapp_task_runs TO service_role;

CREATE FUNCTION app_private.koa_normalize(p_text text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
 SELECT btrim(regexp_replace(translate(lower(coalesce(p_text,'')),'áàâãäéèêëíìîïóòôõöúùûüç','aaaaaeeeeiiiiooooouuuuc'),'[^a-z0-9]+',' ','g'));
$$;
REVOKE ALL ON FUNCTION app_private.koa_normalize(text) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.koa_whatsapp_create_tasks(p_channel uuid,p_event text,p_source_at timestamptz,p_items jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.koa_whatsapp_channels;d public.koa_whatsapp_destinations;b public.business_boards;
 t public.tasks;old_task public.tasks;cached public.koa_whatsapp_task_runs;item jsonb;result jsonb:='[]';
 stage text;due date;label text;state text;old_sub text;request_hash text;
BEGIN
 IF p_event IS NULL OR length(p_event) NOT BETWEEN 1 AND 200 OR jsonb_typeof(p_items)<>'array' OR jsonb_array_length(p_items) NOT BETWEEN 1 AND 3
 THEN RAISE EXCEPTION 'TASK_REQUEST_INVALID' USING ERRCODE='22023';END IF;
 SELECT * INTO c FROM public.koa_whatsapp_channels WHERE id=p_channel FOR SHARE;
 IF c.id IS NULL OR NOT c.tasks_enabled OR c.tasks_activated_at IS NULL OR p_source_at<c.tasks_activated_at
 OR p_source_at<c.activated_at OR p_source_at>now()+interval '2 minutes' OR p_source_at IS NULL
 OR NOT app_private.task_admin_actor(c.workspace_id,c.actor_id)
 THEN RAISE EXCEPTION 'TASK_MODE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('koa-request:'||c.workspace_id::text,9));
 request_hash:=md5(p_items::text);
 SELECT * INTO cached FROM public.koa_whatsapp_task_runs WHERE channel_id=c.id AND event_id=p_event;
 IF FOUND THEN
  IF cached.request_hash<>request_hash THEN RAISE EXCEPTION 'TASK_SOURCE_CONFLICT' USING ERRCODE='40001';END IF;
  RETURN cached.results;
 END IF;
 old_sub:=current_setting('request.jwt.claim.sub',true);
 PERFORM set_config('request.jwt.claim.sub',c.actor_id::text,true);
 FOR item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
  IF jsonb_typeof(item)<>'object' OR length(btrim(coalesce(item->>'title',''))) NOT BETWEEN 1 AND 240
  OR length(coalesce(item->>'description',''))>500 OR length(coalesce(item->>'operational_code',''))>120
  OR coalesce(item->>'priority','') NOT IN ('low','medium','high')
  OR coalesce(item->>'sector','') NOT IN ('comercial','relacionamento')
  OR (coalesce(item->>'due_date','')<>'' AND item->>'due_date' !~ '^\d{4}-\d{2}-\d{2}$')
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(item) k WHERE k NOT IN ('title','description','operational_code','priority','due_date','sector'))
  THEN RAISE EXCEPTION 'TASK_REQUEST_INVALID' USING ERRCODE='22023';END IF;
  due:=nullif(item->>'due_date','')::date;
  SELECT * INTO d FROM public.koa_whatsapp_destinations WHERE channel_id=c.id AND sector_code=item->>'sector';
  SELECT * INTO b FROM public.business_boards WHERE id=d.board_id AND workspace_id=c.workspace_id AND kind='tasks' AND NOT archived;
  IF b.id IS NULL OR NOT app_private.task_admin_board_actor(b.id,c.actor_id)
  OR NOT app_private.board_user(b.id,d.recipient_id,true)
  OR NOT EXISTS(SELECT 1 FROM public.task_sectors s WHERE s.id=b.sector_id AND s.workspace_id=c.workspace_id AND s.code=d.sector_code AND s.active)
  THEN RAISE EXCEPTION 'TASK_DESTINATION_UNAVAILABLE' USING ERRCODE='42501';END IF;
  SELECT id INTO stage FROM public.task_stages WHERE board_id=b.id AND NOT archived AND base_status='todo' ORDER BY position,id LIMIT 1;
  IF stage IS NULL THEN RAISE EXCEPTION 'TASK_INITIAL_STAGE_UNAVAILABLE' USING ERRCODE='22023';END IF;
  -- Check real records, including tasks registered manually in either destination.
  SELECT * INTO old_task FROM public.tasks existing WHERE existing.workspace_id=c.workspace_id AND existing.deleted_at IS NULL
   AND existing.board_id IN (SELECT board_id FROM public.koa_whatsapp_destinations WHERE channel_id=c.id)
   AND app_private.koa_normalize(existing.title)=app_private.koa_normalize(item->>'title')
   AND app_private.koa_normalize(existing.operational_code)=app_private.koa_normalize(item->>'operational_code')
   AND (existing.due_date AT TIME ZONE 'America/Sao_Paulo')::date IS NOT DISTINCT FROM due
   ORDER BY existing.created_at,existing.id LIMIT 1;
  IF old_task.id IS NOT NULL THEN
   state:=CASE WHEN app_private.koa_normalize(old_task.description)=app_private.koa_normalize(item->>'description') THEN 'duplicate' ELSE 'review' END;
   result:=result||jsonb_build_array(jsonb_build_object('status',state,'task_id',old_task.id,'sector',item->>'sector','title',item->>'title'));
  ELSE
   INSERT INTO public.tasks(workspace_id,sector_id,board_id,owner_id,visibility,title,description,operational_code,assigned_to,created_by,due_date,priority,stage_id,request_key)
   VALUES(c.workspace_id,b.sector_id,b.id,d.recipient_id,'sector',btrim(item->>'title'),nullif(item->>'description',''),nullif(item->>'operational_code',''),d.recipient_id,c.actor_id,
    CASE WHEN due IS NULL THEN NULL ELSE (due+time '12:00') AT TIME ZONE 'America/Sao_Paulo' END,(item->>'priority')::public.task_priority,stage,gen_random_uuid()) RETURNING * INTO t;
   INSERT INTO public.task_events(workspace_id,task_id,actor_id,kind,details)
   VALUES(c.workspace_id,t.id,c.actor_id,'koa_requested',jsonb_build_object('channel_id',c.id,'event_id',p_event,'source_at',p_source_at,'sector',d.sector_code));
   result:=result||jsonb_build_array(jsonb_build_object('status','created','task_id',t.id,'sector',d.sector_code,'title',t.title));
  END IF;
 END LOOP;
 INSERT INTO public.koa_whatsapp_task_runs(channel_id,event_id,source_at,request_hash,results) VALUES(c.id,p_event,p_source_at,request_hash,result);
 PERFORM set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 RETURN result;
END;$$;
REVOKE ALL ON FUNCTION public.koa_whatsapp_create_tasks(uuid,text,timestamptz,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.koa_whatsapp_create_tasks(uuid,text,timestamptz,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.koa_whatsapp_status(p_board uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT public.task_admin_access(p_board) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 RETURN (SELECT jsonb_build_object('id',c.id,'group_name',c.group_name,'conversations_enabled',c.conversations_enabled,'tasks_enabled',c.tasks_enabled,
  'participant_policy',c.participant_policy,'connection_state',c.connection_state,'phone_suffix',c.phone_suffix,'heartbeat_at',c.heartbeat_at,
  'last_event_at',c.last_event_at,'last_reply_at',c.last_reply_at,'received_count',c.received_count,'reply_count',c.reply_count,'last_error_code',c.last_error_code,
  'tasks_mode','on_request','tasks_activated_at',c.tasks_activated_at,
  'destinations',(SELECT coalesce(jsonb_agg(jsonb_build_object('sector',d.sector_code,'email',u.email) ORDER BY d.sector_code),'[]') FROM public.koa_whatsapp_destinations d JOIN auth.users u ON u.id=d.recipient_id WHERE d.channel_id=c.id))
 FROM public.koa_whatsapp_channels c JOIN public.business_boards b ON b.id=p_board AND b.workspace_id=c.workspace_id
 WHERE c.actor_id=auth.uid() AND app_private.task_admin_actor(c.workspace_id,auth.uid()));
END;$$;
CREATE OR REPLACE FUNCTION public.koa_whatsapp_conversations(p_board uuid,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
BEGIN
 IF NOT public.task_admin_access(p_board) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 UPDATE public.koa_whatsapp_channels c SET conversations_enabled=p_enabled,activated_at=CASE WHEN p_enabled AND NOT c.conversations_enabled THEN date_trunc('second',now()) ELSE c.activated_at END
 WHERE c.actor_id=auth.uid() AND app_private.task_admin_actor(c.workspace_id,auth.uid()) AND EXISTS(SELECT 1 FROM public.business_boards b WHERE b.id=p_board AND b.workspace_id=c.workspace_id AND NOT b.archived);
 IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;RETURN public.koa_whatsapp_status(p_board);
END;$$;
CREATE FUNCTION public.koa_whatsapp_tasks(p_board uuid,p_enabled boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c public.koa_whatsapp_channels;
BEGIN
 IF NOT public.task_admin_access(p_board) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT ch.* INTO c FROM public.koa_whatsapp_channels ch JOIN public.business_boards b ON b.id=p_board AND b.workspace_id=ch.workspace_id
 WHERE ch.actor_id=auth.uid() AND app_private.task_admin_actor(ch.workspace_id,auth.uid()) FOR UPDATE OF ch;
 IF c.id IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF p_enabled AND (SELECT count(*) FROM public.koa_whatsapp_destinations d JOIN public.business_boards b ON b.id=d.board_id AND b.workspace_id=c.workspace_id
  JOIN public.task_sectors s ON s.id=b.sector_id AND s.code=d.sector_code AND s.active
  WHERE d.channel_id=c.id AND app_private.task_admin_board_actor(b.id,c.actor_id) AND app_private.board_user(b.id,d.recipient_id,true))<>2
 THEN RAISE EXCEPTION 'TASK_DESTINATIONS_REQUIRED' USING ERRCODE='42501';END IF;
 UPDATE public.koa_whatsapp_channels SET tasks_enabled=p_enabled,tasks_activated_at=CASE WHEN p_enabled AND NOT tasks_enabled THEN date_trunc('second',now()) ELSE tasks_activated_at END WHERE id=c.id;
 RETURN public.koa_whatsapp_status(p_board);
END;$$;
REVOKE ALL ON FUNCTION public.koa_whatsapp_tasks(uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.koa_whatsapp_tasks(uuid,boolean) TO authenticated;
NOTIFY pgrst,'reload schema';
