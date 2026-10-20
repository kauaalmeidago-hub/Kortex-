CREATE FUNCTION public.wa_mark_read(p_connection uuid,p_conversation uuid,p_before timestamptz) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$ BEGIN
 PERFORM 1 FROM public.wa_conversations WHERE id=p_conversation AND connection_id=p_connection FOR UPDATE;
 UPDATE public.wa_conversations c SET last_read_at=greatest(c.last_read_at,p_before),
 unread_count=(SELECT count(*) FROM public.wa_messages m WHERE m.conversation_id=c.id AND NOT m.from_me AND m.sent_at>greatest(coalesce(c.last_read_at,'1970-01-01'),p_before)) WHERE c.id=p_conversation AND c.connection_id=p_connection;
END $$;
REVOKE ALL ON FUNCTION public.wa_mark_read(uuid,uuid,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.wa_mark_read(uuid,uuid,timestamptz) TO service_role;
