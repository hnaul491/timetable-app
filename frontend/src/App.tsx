import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router";
import { AuthGate } from "./auth/AuthGate";
import { I18nProvider } from "./i18n";
import { LanguageRoot } from "./i18n/LanguageRoot";
import { Layout } from "./components/Layout";
import { ConfirmProvider } from "./components/ui/Confirm";
import { ToastProvider } from "./components/ui/Toast";
import { TopProgress } from "./components/ui/TopProgress";
import { ApiError } from "./lib/api";
import { initialLanguage } from "./lib/language";
import { BoardPage } from "./pages/BoardPage";
import { CalendarPage } from "./pages/CalendarPage";
import { EventPage } from "./pages/EventPage";
import { NewEventPage } from "./pages/NewEventPage";
import { ReviewPage } from "./pages/ReviewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SubjectPage } from "./pages/SubjectPage";
import { SubjectsPage } from "./pages/SubjectsPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
      staleTime: 60_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={initialLanguage()}>
        <AuthGate>
          <LanguageRoot>
            <ToastProvider>
              <ConfirmProvider>
                <TopProgress />
                <BrowserRouter>
                  <Routes>
                    <Route element={<Layout />}>
                      <Route index element={<CalendarPage />} />
                      <Route path="board" element={<BoardPage />} />
                      <Route path="settings" element={<SettingsPage />} />
                      <Route path="review" element={<ReviewPage />} />
                      <Route path="subjects" element={<SubjectsPage />} />
                      <Route path="subjects/:id" element={<SubjectPage />} />
                      <Route path="events/new" element={<NewEventPage />} />
                      <Route path="events/:id" element={<EventPage />} />
                    </Route>
                  </Routes>
                </BrowserRouter>
              </ConfirmProvider>
            </ToastProvider>
          </LanguageRoot>
        </AuthGate>
      </I18nProvider>
    </QueryClientProvider>
  );
}
