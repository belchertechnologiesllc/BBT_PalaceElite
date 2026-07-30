import { useState } from 'react';
import { useAuth } from './AuthProvider';

export function LoginScreen() {
  const { signInWithGitHub } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  const handleLogin = async () => {
    setWorking(true);
    setError(null);
    try {
      await signInWithGitHub();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to start GitHub sign-in.');
      setWorking(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-card">
        <p className="eyebrow">Affiliation 4135905</p>
        <h1>Palace Elite Membership Manager</h1>
        <p className="subtitle">Private benefit inventory, reservation ledger, and family equity tracking.</p>
        <button className="primary-button" type="button" onClick={handleLogin} disabled={working}>
          {working ? 'Opening GitHub…' : 'Continue with GitHub'}
        </button>
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>
    </main>
  );
}
