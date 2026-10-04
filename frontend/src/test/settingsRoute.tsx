import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { SettingsPage } from "../pages/SettingsPage";

function Where() {
  const { pathname } = useLocation();
  return <output data-testid="path">{pathname}</output>;
}

/** SettingsPage mounted on its real route, starting at the given URL. */
export function SettingsAt({ url = "/settings/school" }: { url?: string }) {
  return (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/settings/:section?" element={<SettingsPage />} />
      </Routes>
      <Where />
    </MemoryRouter>
  );
}
