
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_workspace_admin(UUID, UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_workspaces(UUID) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
