import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createBrowserRouter } from "react-router";
import { AuthGate } from "./auth/AuthGate";
import { I18nProvider } from "./i18n";
import { LanguageRoot } from "./i18n/LanguageRoot";
import { Layout } from "./components/Layout";
import { ConfirmProvider } from "./components/ui/Confirm";
import { ToastProvider } from "./components/ui/Toast";
import { TopProgress } from "./components/ui/TopProgress";
import { ApiError } from "./lib/api";
import { ChromeProvider } from "./lib/chrome";
import { initialLanguage } from "./lib/language";
import { ShortcutProvider } from "./lib/shortcuts";
import { AssistantPage } from "./pages/AssistantPage";
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

// a data router, so EventPage can block navigation away from unsaved notes (useBlocker)
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <CalendarPage /> },
      { path: "board", element: <BoardPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "assistant", element: <AssistantPage /> },
      { path: "review", element: <ReviewPage /> },
      { path: "subjects", element: <SubjectsPage /> },
      { path: "subjects/:id", element: <SubjectPage /> },
      { path: "events/new", element: <NewEventPage /> },
      { path: "events/:id", element: <EventPage /> },
    ],
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={initialLanguage()}>
        <AuthGate>
          <LanguageRoot>
            <ToastProvider>
              <ConfirmProvider>
                <TopProgress />
                <ShortcutProvider>
                  <ChromeProvider>
                    <RouterProvider router={router} />
                  </ChromeProvider>
                </ShortcutProvider>
              </ConfirmProvider>
            </ToastProvider>
          </LanguageRoot>
        </AuthGate>
      </I18nProvider>
    </QueryClientProvider>
  );
}
