import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { SettingsPage } from "../pages/SettingsPage";

function Where() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output data-testid="path">{pathname}</output>
      <button type="button" onClick={() => navigate(-1)}>
        history-back
      </button>
    </>
  );
}

/** SettingsPage mounted on its real route, starting at the given URL (after any earlier history entries). */
export function SettingsAt({ url = "/settings/school", before = [] }: { url?: string; before?: string[] }) {
  return (
    <MemoryRouter initialEntries={[...before, url]} initialIndex={before.length}>
      <Routes>
        <Route path="/settings/:section?" element={<SettingsPage />} />
        <Route path="/start" element={<p>start</p>} />
      </Routes>
      <Where />
    </MemoryRouter>
  );
}
