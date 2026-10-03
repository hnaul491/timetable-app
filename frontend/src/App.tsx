import { AuthGate } from "./auth/AuthGate";

export default function App() {
  return (
    <AuthGate>
      <p className="p-8">Signed in.</p>
    </AuthGate>
  );
}
