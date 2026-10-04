import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { RouterProvider, createBrowserRouter, useRouteError } from "react-router";
import { AuthGate } from "./auth/AuthGate";
import { I18nProvider } from "./i18n";
import { LanguageRoot } from "./i18n/LanguageRoot";
import { ErrorPanel } from "./components/Banners";
import { Layout } from "./components/Layout";
import { ConfirmProvider } from "./components/ui/Confirm";
import { ToastProvider } from "./components/ui/Toast";
import { TopProgress } from "./components/ui/TopProgress";
import { ApiError } from "./lib/api";
import { ChromeProvider } from "./lib/chrome";
import { initialLanguage } from "./lib/language";
import { ShortcutRoot } from "./components/ShortcutRoot";
import { AssistantPage } from "./pages/AssistantPage";
import { BoardPage } from "./pages/BoardPage";
import { DocumentsPage } from "./pages/DocumentsPage";
import { CalendarPage } from "./pages/CalendarPage";
import { EventPage } from "./pages/EventPage";
import { FreeTimePage } from "./pages/FreeTimePage";
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

function RootError() {
  const error = useRouteError();
  return (
    <div className="p-4">
      <ErrorPanel error={error} onRetry={() => window.location.reload()} />
    </div>
  );
}

// a data router, so EventPage can block navigation away from unsaved notes (useBlocker)
const createRouter = () => createBrowserRouter([
  {
    element: <Layout />,
    errorElement: <RootError />,
    children: [
      { index: true, element: <CalendarPage /> },
      { path: "board", element: <BoardPage /> },
      { path: "settings/:section?", element: <SettingsPage /> },
      { path: "assistant", element: <AssistantPage /> },
      { path: "review", element: <ReviewPage /> },
      { path: "free-time", element: <FreeTimePage /> },
      { path: "documents", element: <DocumentsPage /> },
      { path: "subjects", element: <SubjectsPage /> },
      { path: "subjects/:id", element: <SubjectPage /> },
      { path: "events/new", element: <NewEventPage /> },
      { path: "events/:id", element: <EventPage /> },
    ],
  },
]);

// Created on the first render after sign-in, i.e. after Supabase has cleaned the OAuth return URL.
function AuthedRouter() {
  const [router] = useState(createRouter);
  return <RouterProvider router={router} />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <I18nProvider locale={initialLanguage()}>
        <AuthGate>
          <LanguageRoot>
            <ToastProvider>
              <ConfirmProvider>
                <TopProgress />
                <ShortcutRoot>
                  <ChromeProvider>
                    <AuthedRouter />
                  </ChromeProvider>
                </ShortcutRoot>
              </ConfirmProvider>
            </ToastProvider>
          </LanguageRoot>
        </AuthGate>
      </I18nProvider>
    </QueryClientProvider>
  );
}
