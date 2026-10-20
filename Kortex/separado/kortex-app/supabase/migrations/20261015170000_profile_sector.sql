-- A declared profile sector is independent of workspace roles and task queues.
ALTER TABLE public.profiles ADD COLUMN sector text;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_sector_valid
  CHECK (sector IS NULL OR sector IN ('financeiro', 'relacionamento', 'comercial'));

CREATE FUNCTION public.capture_new_profile_sector()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE declared_sector text := lower(btrim(NEW.raw_user_meta_data->>'sector'));
BEGIN
  IF declared_sector IN ('financeiro', 'relacionamento', 'comercial') THEN
    UPDATE public.profiles SET sector = declared_sector
    WHERE id = NEW.id AND sector IS NULL;
  END IF;
  RETURN NEW;
END; $$;
REVOKE ALL ON FUNCTION public.capture_new_profile_sector() FROM PUBLIC, anon, authenticated;
-- PostgreSQL runs same-event triggers by name; the existing profile creator runs first.
CREATE TRIGGER on_auth_user_profile_sector AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.capture_new_profile_sector();

UPDATE public.profiles p SET sector = lower(btrim(u.raw_user_meta_data->>'sector'))
FROM auth.users u WHERE p.id = u.id AND p.sector IS NULL
AND lower(btrim(u.raw_user_meta_data->>'sector')) IN ('financeiro','relacionamento','comercial');

CREATE FUNCTION public.complete_my_profile(p_sector text, p_full_name text DEFAULT NULL)
RETURNS public.profiles LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
DECLARE result public.profiles;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_sector IS NULL OR p_sector NOT IN ('financeiro','relacionamento','comercial') THEN
    RAISE EXCEPTION 'INVALID_PROFILE_SECTOR' USING ERRCODE='22023';
  END IF;
  IF char_length(btrim(p_full_name)) > 160 THEN RAISE EXCEPTION 'INVALID_PROFILE_NAME' USING ERRCODE='22023'; END IF;
  INSERT INTO public.profiles (id, sector, full_name)
  VALUES (auth.uid(), p_sector, nullif(btrim(p_full_name), ''))
  ON CONFLICT (id) DO UPDATE SET sector = EXCLUDED.sector,
    full_name = CASE WHEN nullif(btrim(profiles.full_name), '') IS NULL
      THEN EXCLUDED.full_name ELSE profiles.full_name END
  RETURNING * INTO result;
  RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.complete_my_profile(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_my_profile(text, text) TO authenticated;
