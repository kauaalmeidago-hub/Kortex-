import { Outlet } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

export default function ProtectedRoute() {
  const { loading } = useAuth();
  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background text-muted-foreground">
        Carregando…
      </div>
    );
  }
  return <Outlet />;
}
