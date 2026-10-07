import { Outlet } from "react-router-dom";
import AppSidebar from "./AppSidebar";

export default function AppLayout() {
  return (
    <div className="flex h-[100dvh] min-h-[100dvh] w-full overflow-hidden bg-background text-foreground">
      <AppSidebar />
      <main className="kortex-app-main m-2 flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl bg-card shadow-[0_18px_50px_rgba(13,27,62,0.08)] sm:m-3 sm:rounded-2xl">
        <Outlet />
      </main>
    </div>
  );
}
