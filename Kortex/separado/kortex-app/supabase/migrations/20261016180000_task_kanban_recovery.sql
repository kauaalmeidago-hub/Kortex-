-- Additive and transactional: no operational row is deleted or reassigned.
ALTER TABLE public.tasks ADD COLUMN deleted_at timestamptz,
 ADD COLUMN deleted_by uuid REFERENCES auth.users(id), ADD COLUMN deletion_key uuid;
ALTER TABLE public.tasks ADD CONSTRAINT task_recovery_consistency CHECK
 ((deleted_at IS NULL AND deleted_by IS NULL) OR (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND deletion_key IS NOT NULL));
CREATE INDEX task_board_live ON public.tasks(board_id,created_at DESC,id) WHERE deleted_at IS NULL;
DROP POLICY tasks_read ON public.tasks;
CREATE POLICY tasks_read ON public.tasks FOR SELECT TO authenticated USING(deleted_at IS NULL AND public.task_can_read(id));
REVOKE DELETE,UPDATE ON public.tasks FROM authenticated;
DO $$ DECLARE cols text;BEGIN
 SELECT string_agg(quote_ident(attname),',') INTO cols FROM pg_attribute
 WHERE attrelid='public.tasks'::regclass AND attnum>0 AND NOT attisdropped
 AND attname NOT IN ('deleted_at','deleted_by','deletion_key');
 EXECUTE 'GRANT UPDATE('||cols||') ON public.tasks TO authenticated';
END $$;
CREATE FUNCTION app_private.guard_task_recovery() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.deleted_at IS NOT NULL OR NEW.deleted_by IS NOT NULL OR NEW.deletion_key IS NOT NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 ELSIF OLD.deleted_at IS NOT NULL THEN
  IF NEW.deleted_at IS NOT NULL THEN RAISE EXCEPTION 'TASK_REMOVED' USING ERRCODE='PT409';END IF;
  IF (to_jsonb(NEW)-ARRAY['deleted_at','deleted_by','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['deleted_at','deleted_by','updated_at']) THEN
   RAISE EXCEPTION 'RESTORE_IMMUTABLE' USING ERRCODE='42501';END IF;
 END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER aa_task_recovery BEFORE INSERT OR UPDATE ON public.tasks FOR EACH ROW EXECUTE FUNCTION app_private.guard_task_recovery();
CREATE FUNCTION public.business_remove_task(p_board uuid,p_id uuid,p_updated timestamptz,p_request uuid) RETURNS public.tasks
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.tasks;BEGIN
 PERFORM 1 FROM public.business_boards WHERE id=p_board FOR SHARE;
 IF auth.uid() IS NULL OR p_request IS NULL OR NOT public.business_can_board(p_board,'write') OR NOT public.task_can_edit(p_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_id AND board_id=p_board FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF t.deleted_at IS NOT NULL THEN
  IF t.deleted_by=auth.uid() AND t.deletion_key=p_request THEN RETURN t;END IF;
  RAISE EXCEPTION 'TASK_REMOVED' USING ERRCODE='PT409';
 END IF;
 IF t.updated_at IS DISTINCT FROM p_updated THEN RAISE EXCEPTION 'TASK_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
 UPDATE public.tasks SET deleted_at=clock_timestamp(),deleted_by=auth.uid(),deletion_key=p_request WHERE id=t.id RETURNING * INTO t;
 INSERT INTO public.task_events(workspace_id,task_id,actor_id,kind,details) VALUES(t.workspace_id,t.id,auth.uid(),'removed',jsonb_build_object('request',p_request,'stage',t.stage_id));
 RETURN t;
END;$$;
CREATE FUNCTION public.business_restore_task(p_board uuid,p_id uuid,p_request uuid) RETURNS public.tasks
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.tasks;BEGIN
 PERFORM 1 FROM public.business_boards WHERE id=p_board FOR SHARE;
 IF auth.uid() IS NULL OR p_request IS NULL OR NOT public.business_can_board(p_board,'write') OR NOT public.task_can_edit(p_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_id AND board_id=p_board FOR UPDATE;
 IF NOT FOUND OR t.deletion_key IS DISTINCT FROM p_request THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF t.deleted_at IS NULL THEN RETURN t;END IF;
 IF t.deleted_by<>auth.uid() THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 UPDATE public.tasks SET deleted_at=NULL,deleted_by=NULL WHERE id=t.id RETURNING * INTO t;
 INSERT INTO public.task_events(workspace_id,task_id,actor_id,kind,details) VALUES(t.workspace_id,t.id,auth.uid(),'restored',jsonb_build_object('request',p_request));
 RETURN t;
END;$$;
CREATE FUNCTION public.business_move_task(p_board uuid,p_id uuid,p_updated timestamptz,p_stage text) RETURNS public.tasks
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE t public.tasks;BEGIN
 PERFORM 1 FROM public.business_boards WHERE id=p_board FOR SHARE;
 IF NOT public.business_can_board(p_board,'write') OR NOT public.task_can_edit(p_id) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO t FROM public.tasks WHERE id=p_id AND board_id=p_board FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF t.deleted_at IS NOT NULL OR t.updated_at IS DISTINCT FROM p_updated THEN RAISE EXCEPTION 'TASK_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
 UPDATE public.tasks SET stage_id=p_stage WHERE id=t.id RETURNING * INTO t;RETURN t;
END;$$;
CREATE FUNCTION public.business_task_column(p_board uuid,p_version timestamptz,p_id text,p_name text,p_create boolean DEFAULT false) RETURNS public.task_stages
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;s public.task_stages;cols jsonb;BEGIN
 IF NOT public.business_can_board(p_board,'manage') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=p_board AND kind='tasks' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 OR p_id IS NULL OR length(p_id)>100 THEN RAISE EXCEPTION 'INVALID_COLUMNS' USING ERRCODE='22023';END IF;
 SELECT * INTO s FROM public.task_stages WHERE board_id=b.id AND id=p_id;
 -- The client-generated column ID is the idempotency key, including after a lost response.
 IF FOUND AND (p_create OR s.name=btrim(p_name)) THEN RETURN s;END IF;
 IF NOT p_create AND s.id IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.position,c.id),'[]') INTO cols FROM public.task_stages c WHERE c.board_id=b.id;
 IF p_create THEN cols:=cols||jsonb_build_array(jsonb_build_object('id',p_id,'name',btrim(p_name),'color','blue','base_status','todo'));
 ELSE SELECT jsonb_agg(CASE WHEN c->>'id'=p_id THEN c||jsonb_build_object('name',btrim(p_name)) ELSE c END ORDER BY n) INTO cols FROM jsonb_array_elements(cols) WITH ORDINALITY a(c,n);END IF;
 PERFORM public.business_save_columns(b.id,p_version,cols,'{}');
 SELECT * INTO s FROM public.task_stages WHERE board_id=b.id AND id=p_id;RETURN s;
END;$$;
CREATE OR REPLACE FUNCTION public.business_task_permissions(p_board uuid) RETURNS TABLE(id uuid,can_edit boolean)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$ SELECT t.id,public.task_can_edit(t.id) FROM public.tasks t WHERE t.board_id=p_board AND t.deleted_at IS NULL AND public.task_can_read(t.id);$$;
REVOKE ALL ON FUNCTION app_private.guard_task_recovery() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.business_remove_task(uuid,uuid,timestamptz,uuid),public.business_restore_task(uuid,uuid,uuid),public.business_move_task(uuid,uuid,timestamptz,text),public.business_task_column(uuid,timestamptz,text,text,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_remove_task(uuid,uuid,timestamptz,uuid),public.business_restore_task(uuid,uuid,uuid),public.business_move_task(uuid,uuid,timestamptz,text),public.business_task_column(uuid,timestamptz,text,text,boolean) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
