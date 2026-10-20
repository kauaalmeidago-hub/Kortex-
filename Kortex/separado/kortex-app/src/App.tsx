import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  BrowserRouter,
  Navigate,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "./components/AppLayout";
import Index from "./pages/Index";
import PipelinePage from "./pages/PipelinePage";
import PipelineSetupPage from "./pages/PipelineSetupPage";
import LeadsListPage from "./pages/LeadsListPage";
import LeadDetailPage from "./pages/LeadDetailPage";
import ContactsPage from "./pages/ContactsPage";
import CompaniesPage from "./pages/CompaniesPage";
import CompanyProfilePage from "./pages/CompanyProfilePage";
import FilesCenterPage from "./pages/FilesCenterPage";
import BillingKitPage from "./pages/BillingKitPage";
import MovementsPage from "./pages/MovementsPage";
import CalendarPage from "./pages/CalendarPage";
import InsightsPage from "./pages/InsightsPage";
import InboxPage from "./pages/InboxPage";
import TeamChatPage from "./pages/TeamChatPage";
import PhonePage from "./pages/PhonePage";
import TasksPage from "./pages/TasksPage";
import TaskAdministrationPage from "./pages/TaskAdministrationPage";
import PipelineStagesSettingsPage from "./pages/PipelineStagesSettingsPage";
import AuthPage from "./pages/AuthPage";
import AutomationsPage from "./pages/AutomationsPage";
import SettingsPage from "./pages/SettingsPage";
import WhatsAppConnectionPage from "./pages/WhatsAppConnectionPage";
import TaskStagesSettingsPage from "./pages/TaskStagesSettingsPage";
import NotFound from "./pages/NotFound";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import { BusinessAccessProvider } from "./features/access/BusinessAccess";
import { fullModules } from "./features/access/environment";
import WhatsAppOnboardingPage from './features/whatsapp/OnboardingPage';

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <AuthProvider>
        <BusinessAccessProvider>
          <TooltipProvider>
            <Toaster />
            <Sonner />
            {(import.meta.env.VITE_APP_ENV === "staging" ||
              (import.meta.env.DEV && import.meta.env.VITE_ISOLATION_TEST === "1")) && (
                <div className="pointer-events-none fixed right-4 bottom-2 z-[100] rounded-full border border-primary/20 bg-card/95 px-3 py-1 font-sans text-[11px] text-muted-foreground">
                  {import.meta.env.VITE_APP_ENV === "staging"
                    ? "Homologação · Supabase staging"
                    : "Homologação local · dados de teste"}
                </div>
              )}
            <BrowserRouter>
              <Routes>
                <Route path="/auth/whatsapp" element={<WhatsAppOnboardingPage />} />
                <Route path="/auth/*" element={<AuthPage />} />
                <Route element={<ProtectedRoute />}>
                  <Route element={<AppLayout />}>
                    <Route path="/inbox" element={<InboxPage />} />
                    <Route path="/settings/whatsapp" element={<Navigate to="/settings/channels/whatsapp" replace />} />
                    <Route path="/settings/channels/whatsapp" element={<WhatsAppConnectionPage />} />
                    <Route
                      path="/"
                      element={
                        fullModules ? (
                          import.meta.env.DEV ? (
                            <Navigate to="/inbox" replace />
                          ) : (
                            <Index />
                          )
                        ) : (
                          <Navigate to="/tasks" replace />
                        )
                      }
                    />
                    <Route
                      element={
                        fullModules ? (
                          <Outlet />
                        ) : (
                          <Navigate to="/tasks" replace />
                        )
                      }
                    >
                      <Route path="/team-chat" element={<TeamChatPage />} />
                      <Route path="/phone" element={<PhonePage />} />
                      <Route
                        path="/automations"
                        element={<AutomationsPage />}
                      />
                      <Route
                        path="/kit-faturamento"
                        element={<BillingKitPage />}
                      />
                      <Route path="/billing-kit" element={<BillingKitPage />} />
                      <Route
                        path="/movimentacoes"
                        element={<MovementsPage />}
                      />
                      <Route
                        path="/movimentacoes/:flowId"
                        element={<MovementsPage />}
                      />
                      <Route path="/contacts" element={<ContactsPage />} />
                      <Route path="/companies" element={<CompaniesPage />} />
                      <Route
                        path="/companies/:companyId"
                        element={<CompanyProfilePage />}
                      />
                      <Route path="/files" element={<FilesCenterPage />} />
                      <Route
                        path="/companies/:companyId/files"
                        element={<CompanyProfilePage />}
                      />
                      <Route path="/calendar" element={<CalendarPage />} />
                      <Route path="/insights" element={<InsightsPage />} />
                    </Route>
                    <Route path="/tasks" element={<TasksPage />} />
                    <Route path="/admin/tasks" element={<TaskAdministrationPage />} />
                    <Route path="/pipeline" element={<PipelinePage />} />
                    <Route path="/pipeline/new" element={<PipelineSetupPage />} />
                    <Route path="/settings/pipelines" element={<PipelineStagesSettingsPage />} />
                    <Route
                      path="/pipeline/:pipelineId"
                      element={<PipelinePage />}
                    />
                    <Route path="/leads" element={<LeadsListPage />} />
                    <Route path="/lead/:leadId" element={<LeadDetailPage />} />
                    <Route path="/leads/:leadId" element={<LeadDetailPage />} />
                    <Route
                      path="/settings"
                      element={
                        fullModules ? (
                          <SettingsPage />
                        ) : (
                          <Navigate to="/tasks" replace />
                        )
                      }
                    />
                    <Route
                      path="/settings/task-stages"
                      element={<TaskStagesSettingsPage />}
                    />
                    <Route
                      path="/settings/workspace/task-stages"
                      element={<TaskStagesSettingsPage />}
                    />
                  </Route>
                </Route>
                <Route path="*" element={<NotFound />} />
              </Routes>
            </BrowserRouter>
          </TooltipProvider>
        </BusinessAccessProvider>
      </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
