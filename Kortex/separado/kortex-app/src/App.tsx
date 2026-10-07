import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import AppLayout from "./components/AppLayout";
import Index from "./pages/Index";
import PipelinePage from "./pages/PipelinePage";
import LeadsListPage from "./pages/LeadsListPage";
import LeadDetailPage from "./pages/LeadDetailPage";
import ContactsPage from "./pages/ContactsPage";
import CompaniesPage from "./pages/CompaniesPage";
import FilesCenterPage from "./pages/FilesCenterPage";
import BillingKitPage from "./pages/BillingKitPage";
import MovementsPage from "./pages/MovementsPage";
import CalendarPage from "./pages/CalendarPage";
import InsightsPage from "./pages/InsightsPage";
import InboxPage from "./pages/InboxPage";
import TeamChatPage from "./pages/TeamChatPage";
import PhonePage from "./pages/PhonePage";
import TasksPage from "./pages/TasksPage";
import AutomationsPage from "./pages/AutomationsPage";
import SettingsPage from "./pages/SettingsPage";
import WhatsAppConnectionPage from "./pages/WhatsAppConnectionPage";
import TaskStagesSettingsPage from "./pages/TaskStagesSettingsPage";
import NotFound from "./pages/NotFound";
import { ThemeProvider } from "./contexts/ThemeContext";
import { AuthProvider } from "./contexts/AuthContext";
import AuthPage from "./pages/AuthPage";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
    <AuthProvider>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth/*" element={<AuthPage />} />
          <Route element={<ProtectedRoute />}>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Index />} />
            <Route path="/inbox" element={<InboxPage />} />
            <Route path="/team-chat" element={<TeamChatPage />} />
            <Route path="/phone" element={<PhonePage />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/automations" element={<AutomationsPage />} />
            <Route path="/kit-faturamento" element={<BillingKitPage />} />
            <Route path="/billing-kit" element={<BillingKitPage />} />
            <Route path="/movimentacoes" element={<MovementsPage />} />
            <Route path="/movimentacoes/:flowId" element={<MovementsPage />} />
            <Route path="/pipeline/:pipelineId" element={<PipelinePage />} />
            <Route path="/leads" element={<LeadsListPage />} />
            <Route path="/lead/:leadId" element={<LeadDetailPage />} />
            <Route path="/leads/:leadId" element={<LeadDetailPage />} />
            <Route path="/contacts" element={<ContactsPage />} />
            <Route path="/companies" element={<CompaniesPage />} />
            <Route path="/files" element={<FilesCenterPage />} />
            <Route path="/companies/:companyId/files" element={<FilesCenterPage />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/insights" element={<InsightsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/settings/whatsapp" element={<Navigate to="/settings/channels/whatsapp" replace />} />
            <Route path="/settings/channels/whatsapp" element={<WhatsAppConnectionPage />} />
            <Route path="/settings/task-stages" element={<TaskStagesSettingsPage />} />
            <Route path="/settings/workspace/task-stages" element={<TaskStagesSettingsPage />} />
          </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
    </AuthProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
