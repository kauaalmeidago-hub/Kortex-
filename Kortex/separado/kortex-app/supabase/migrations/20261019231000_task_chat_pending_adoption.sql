-- Preserve the last unfinished review during rollout. Earlier batches remain
-- historical; the latest confirmed batch never adopts an unrelated old draft.
DO $$ DECLARE o record;last_draft public.task_drafts;cy public.task_chat_cycles;started timestamptz;BEGIN
 FOR o IN SELECT * FROM app_private.task_operational_conversations WHERE active_cycle_id IS NULL LOOP
  SELECT * INTO last_draft FROM public.task_drafts WHERE conversation_id=o.conversation_id ORDER BY created_at DESC,id DESC LIMIT 1;
  IF last_draft.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.task_drafts WHERE conversation_id=o.conversation_id AND confirmed_task_id IS NULL AND (CASE WHEN last_draft.batch_id IS NULL THEN id=last_draft.id ELSE batch_id=last_draft.batch_id END)) THEN CONTINUE;END IF;
  INSERT INTO public.task_chat_cycles(conversation_id,workspace_id,created_by,begin_key)
  SELECT id,workspace_id,created_by,md5('adopt-current-review:'||id::text)::uuid FROM public.task_conversations WHERE id=o.conversation_id RETURNING * INTO cy;
  SELECT min(created_at) INTO started FROM public.task_drafts WHERE conversation_id=o.conversation_id AND (CASE WHEN last_draft.batch_id IS NULL THEN id=last_draft.id ELSE batch_id=last_draft.batch_id END);
  UPDATE public.task_drafts d SET cycle_id=cy.id,cycle_position=numbered.n FROM (SELECT id,row_number() OVER(ORDER BY position,id)::integer n FROM public.task_drafts WHERE conversation_id=o.conversation_id AND (CASE WHEN last_draft.batch_id IS NULL THEN id=last_draft.id ELSE batch_id=last_draft.batch_id END)) numbered WHERE d.id=numbered.id;
  UPDATE public.task_messages SET cycle_id=cy.id WHERE conversation_id=o.conversation_id AND (created_at>=started OR id IN(SELECT source_message_id FROM public.task_drafts WHERE cycle_id=cy.id));
  UPDATE app_private.task_operational_conversations SET active_cycle_id=cy.id WHERE conversation_id=o.conversation_id AND user_id=o.user_id;
 END LOOP;
END $$;
NOTIFY pgrst,'reload schema';
