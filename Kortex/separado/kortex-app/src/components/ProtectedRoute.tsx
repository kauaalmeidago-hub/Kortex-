import { Navigate, Outlet, useLocation } from "react-router-dom";
import {useAuth} from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export default function ProtectedRoute() {
  const {user,loading}=useAuth();const location=useLocation();
  const onboarding = useQuery({ queryKey: ['wa-onboarding-gate', user?.id], enabled: Boolean(user && !loading), retry: false, staleTime: 30000, refetchOnWindowFocus: false,
    queryFn: async ({ signal }) => {
      const { data, error } = await (supabase.rpc as CallableFunction)('wa_onboarding_required').abortSignal(signal);
      if (error) throw new Error('Não foi possível recuperar o progresso da sua conta.');
      return data === true;
    } });
  if(loading)return <div role="status" className="p-8 text-sm text-muted-foreground">Validando sua sessão...</div>;
  if(!user)return <Navigate to="/auth/login" state={{from:location}} replace/>;
  if(onboarding.isLoading)return <div role="status" className="p-8 text-sm">Recuperando seu progresso...</div>;
  if(onboarding.error)return <div role="alert" className="p-8 text-sm">{onboarding.error.message}<button className="ml-3 underline" onClick={() => void onboarding.refetch()}>Tentar novamente</button></div>;
  if(onboarding.data)return <Navigate to="/auth/whatsapp" replace/>;
  return <Outlet />;
}
