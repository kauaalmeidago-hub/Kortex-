import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute() {
  const { loading, user, session } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background text-muted-foreground">
        Carregando…
      </div>
    );
  }
  if (!user || !session?.access_token) {
    return <Navigate to="/auth" state={{ from: location }} replace />;
  }
  return <Outlet />;
}
