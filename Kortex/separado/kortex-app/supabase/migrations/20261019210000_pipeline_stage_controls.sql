-- Additive operations around the existing, authorized, versioned column transaction.
CREATE TABLE app_private.pipeline_column_removals (
 board_id uuid NOT NULL REFERENCES public.business_boards(id),request_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES auth.users(id),stage jsonb NOT NULL,
 destination_id uuid NOT NULL,record_count integer NOT NULL,
 removed_at timestamptz NOT NULL DEFAULT now(),restored_at timestamptz,
 PRIMARY KEY(board_id,request_id)
);
ALTER TABLE app_private.pipeline_column_removals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.pipeline_column_removals FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.business_pipeline_column(p_board uuid,p_version timestamptz,p_id uuid,p_name text,p_create boolean DEFAULT false)
 RETURNS public.stages LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;s public.stages;cols jsonb;pipeline uuid;BEGIN
 IF NOT public.business_can_board(p_board,'manage') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=p_board AND kind='pipeline' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF p_id IS NULL OR p_name IS NULL OR length(btrim(p_name)) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'INVALID_COLUMNS' USING ERRCODE='22023';END IF;
 SELECT id INTO pipeline FROM public.pipelines WHERE board_id=b.id;
 SELECT * INTO s FROM public.stages WHERE id=p_id AND pipeline_id=pipeline;
 -- A stable client ID makes creation safe after a lost response.
 IF FOUND AND (p_create OR s.name=btrim(p_name)) THEN RETURN s;END IF;
 IF NOT p_create AND s.id IS NULL THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.position,c.id),'[]') INTO cols FROM public.stages c WHERE c.pipeline_id=pipeline;
 IF p_create THEN cols:=cols||jsonb_build_array(jsonb_build_object('id',p_id,'name',btrim(p_name),'color','blue'));
 ELSE SELECT jsonb_agg(CASE WHEN c->>'id'=p_id::text THEN c||jsonb_build_object('name',btrim(p_name)) ELSE c END ORDER BY n)
 INTO cols FROM jsonb_array_elements(cols) WITH ORDINALITY a(c,n);END IF;
 PERFORM public.business_save_columns(b.id,p_version,cols,'{}');
 SELECT * INTO s FROM public.stages WHERE id=p_id AND pipeline_id=pipeline;RETURN s;
END;$$;

-- Counts include filtered-out records. Inaccessible records block the operation
-- without disclosing their count or content.
CREATE FUNCTION public.business_pipeline_column_count(p_board uuid,p_id uuid) RETURNS integer
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE pipeline uuid;n integer;BEGIN
 IF NOT public.business_can_board(p_board,'manage') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT p.id INTO pipeline FROM public.pipelines p JOIN public.business_boards b ON b.id=p.board_id
 WHERE b.id=p_board AND b.kind='pipeline';
 IF pipeline IS NULL OR NOT EXISTS(SELECT 1 FROM public.stages WHERE id=p_id AND pipeline_id=pipeline) THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF EXISTS(SELECT 1 FROM public.leads l WHERE l.pipeline_id=pipeline AND l.stage_id=p_id AND NOT public.business_can_lead(l.id,true)) THEN
 RAISE EXCEPTION 'COLUMN_MOVE_REQUIRES_AUTHORITY' USING ERRCODE='42501';END IF;
 SELECT count(*) INTO n FROM public.leads WHERE pipeline_id=pipeline AND stage_id=p_id;RETURN n;
END;$$;

CREATE FUNCTION public.business_pipeline_remove_column(p_board uuid,p_version timestamptz,p_id uuid,p_destination uuid,p_request uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;s public.stages;r app_private.pipeline_column_removals;cols jsonb;n integer;BEGIN
 IF auth.uid() IS NULL OR p_request IS NULL OR NOT public.business_can_board(p_board,'manage') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=p_board AND kind='pipeline' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO r FROM app_private.pipeline_column_removals WHERE board_id=b.id AND request_id=p_request;
 IF FOUND THEN
  IF r.actor_id IS DISTINCT FROM auth.uid() OR r.stage->>'id' IS DISTINCT FROM p_id::text OR r.destination_id IS DISTINCT FROM p_destination THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
  RETURN jsonb_build_object('count',r.record_count,'undoable',r.record_count=0 AND r.restored_at IS NULL);
 END IF;
 SELECT s1.* INTO s FROM public.stages s1 JOIN public.pipelines p ON p.id=s1.pipeline_id WHERE p.board_id=b.id AND s1.id=p_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 -- Also lock the affected records before checking authority and migrating them.
 PERFORM 1 FROM public.leads WHERE pipeline_id=s.pipeline_id AND stage_id=s.id FOR UPDATE;
 n:=public.business_pipeline_column_count(b.id,s.id);
 SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.position,c.id),'[]') INTO cols FROM public.stages c WHERE pipeline_id=s.pipeline_id AND id<>s.id;
 IF jsonb_array_length(cols)=0 THEN RAISE EXCEPTION 'COLUMN_DESTINATION_REQUIRED' USING ERRCODE='22023';END IF;
 PERFORM public.business_save_columns(b.id,p_version,cols,jsonb_build_object(s.id::text,p_destination::text));
 INSERT INTO app_private.pipeline_column_removals(board_id,request_id,actor_id,stage,destination_id,record_count)
 VALUES(b.id,p_request,auth.uid(),to_jsonb(s),p_destination,n);
 RETURN jsonb_build_object('count',n,'undoable',n=0);
END;$$;

CREATE FUNCTION public.business_pipeline_restore_column(p_board uuid,p_version timestamptz,p_request uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b public.business_boards;r app_private.pipeline_column_removals;cols jsonb;pipeline uuid;BEGIN
 IF NOT public.business_can_board(p_board,'manage') THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 SELECT * INTO b FROM public.business_boards WHERE id=p_board AND kind='pipeline' FOR UPDATE;
 SELECT * INTO r FROM app_private.pipeline_column_removals WHERE board_id=b.id AND request_id=p_request FOR UPDATE;
 IF NOT FOUND OR r.actor_id<>auth.uid() OR r.record_count<>0 THEN RAISE EXCEPTION 'SCOPE_UNAVAILABLE' USING ERRCODE='42501';END IF;
 IF r.restored_at IS NOT NULL THEN RETURN (r.stage->>'id')::uuid;END IF;
 SELECT id INTO pipeline FROM public.pipelines WHERE board_id=b.id;
 IF EXISTS(SELECT 1 FROM public.stages WHERE id=(r.stage->>'id')::uuid) THEN RAISE EXCEPTION 'BOARD_VERSION_CONFLICT' USING ERRCODE='PT409';END IF;
 SELECT jsonb_agg(c ORDER BY pos,priority) INTO cols FROM (
  SELECT to_jsonb(s) c,s.position pos,1 priority FROM public.stages s WHERE pipeline_id=pipeline
  UNION ALL SELECT r.stage,(r.stage->>'position')::integer,0
 ) all_columns;
 PERFORM public.business_save_columns(b.id,p_version,cols,'{}');
 UPDATE app_private.pipeline_column_removals SET restored_at=clock_timestamp() WHERE board_id=b.id AND request_id=p_request;
 RETURN (r.stage->>'id')::uuid;
END;$$;

REVOKE ALL ON FUNCTION public.business_pipeline_column(uuid,timestamptz,uuid,text,boolean),public.business_pipeline_column_count(uuid,uuid),
 public.business_pipeline_remove_column(uuid,timestamptz,uuid,uuid,uuid),public.business_pipeline_restore_column(uuid,timestamptz,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.business_pipeline_column(uuid,timestamptz,uuid,text,boolean),public.business_pipeline_column_count(uuid,uuid),
 public.business_pipeline_remove_column(uuid,timestamptz,uuid,uuid,uuid),public.business_pipeline_restore_column(uuid,timestamptz,uuid) TO authenticated,service_role;
NOTIFY pgrst,'reload schema';
