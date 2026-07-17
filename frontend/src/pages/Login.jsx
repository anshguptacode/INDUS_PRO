import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api';

export default function Login() {
  const [mode, setMode] = useState('login');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = mode === 'login' ? { email, password } : { name, email, password };
      const { data } = await api.post(`/auth/${mode}`, body);
      localStorage.setItem('token', data.token);
      localStorage.setItem('refreshToken', data.refreshToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      navigate(mode === 'register' ? '/accounts' : '/');
    } catch (err) {
      setError(err.response?.data?.error || `${mode} failed — is the backend up?`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>👣 Footprint Pro</h1>
        <p className="muted">Real-time analytics across your social accounts.</p>
        {mode === 'register' && (
          <label>Name
            <input value={name} onChange={(e) => setName(e.target.value)} required minLength={2} />
          </label>
        )}
        <label>Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        </label>
        <label>Password
          <input value={password} onChange={(e) => setPassword(e.target.value)}
            type="password" required minLength={8}
            placeholder={mode === 'register' ? 'min 8 characters' : ''} />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="muted center">
          {mode === 'login' ? 'New here? ' : 'Already have an account? '}
          <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode(mode === 'login' ? 'register' : 'login'); }}>
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </a>
        </p>
      </form>
    </div>
  );
}
