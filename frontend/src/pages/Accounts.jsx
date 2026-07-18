import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';

const META = {
  twitter: { label: 'Twitter / X', icon: '𝕏' },
  instagram: { label: 'Instagram', icon: '📸' },
  github: { label: 'GitHub', icon: '🐙' },
};

const MODE_BADGE = {
  demo: { cls: 'demo', text: 'DEMO' },
  'own-keys': { cls: 'live', text: 'YOUR KEYS' },
  'server-keys': { cls: 'live', text: 'LIVE API' },
  mock: { cls: 'mock', text: 'MOCK' },
  'needs-keys': { cls: 'needs', text: 'NEEDS KEYS' },
};

/* per-platform "bring your own API keys" editor */
function KeyForm({ platform, status, onSaved }) {
  const [open, setOpen] = useState(status.mode === 'needs-keys');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  async function save(e) {
    e.preventDefault();
    setSaving(true); setErr('');
    try {
      await api.put(`/keys/${platform}`, { clientId, clientSecret });
      setClientId(''); setClientSecret(''); setOpen(false);
      await onSaved();
    } catch (ex) {
      setErr(ex.response?.data?.error || 'could not save keys');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove your ${platform} API keys?`)) return;
    await api.delete(`/keys/${platform}`);
    await onSaved();
  }

  if (status.has_own_keys && !open) {
    return (
      <div className="key-row">
        <span className="muted">🔑 Using your keys ({status.client_id_masked})</span>
        <button className="ghost mini" onClick={() => setOpen(true)}>Replace</button>
        <button className="ghost danger mini" onClick={remove}>Remove</button>
      </div>
    );
  }

  if (!open) {
    return (
      <button className="ghost mini" onClick={() => setOpen(true)}>
        🔑 Use your own API keys
      </button>
    );
  }

  return (
    <form className="key-form" onSubmit={save}>
      <input placeholder="Client ID" value={clientId}
        onChange={(e) => setClientId(e.target.value)} required autoComplete="off" />
      <input placeholder="Client Secret" type="password" value={clientSecret}
        onChange={(e) => setClientSecret(e.target.value)} required autoComplete="off" />
      {err && <span className="error">{err}</span>}
      <div className="key-actions">
        <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save keys'}</button>
        <button type="button" className="ghost mini" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <p className="muted key-hint">
        Create an OAuth app on the platform's developer portal with callback
        {' '}<code>{window.location.origin}/api/connect/{platform}/callback</code>,
        then paste its credentials here. Stored encrypted, never shown again.
      </p>
    </form>
  );
}

export default function Accounts() {
  const [platforms, setPlatforms] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [params] = useSearchParams();
  const user = useMemo(() => JSON.parse(localStorage.getItem('user') || '{}'), []);
  const isDemo = user.is_demo || platforms.some((p) => p.is_demo_user);

  const load = useCallback(async () => {
    const [st, ac, sj] = await Promise.all([
      api.get('/connect/status'), api.get('/accounts'), api.get('/sync-jobs'),
    ]);
    setPlatforms(st.data);
    setAccounts(ac.data);
    setJobs(sj.data);
  }, []);

  useEffect(() => {
    load().catch(console.error);
    const err = params.get('error');
    const ok = params.get('connected');
    if (err) setMsg(`⚠️ ${err}`);
    else if (ok) setMsg(`✅ ${ok} connected — first sync is running.`);
  }, [load, params]);

  // live updates: refresh the panel whenever a background sync finishes
  useEffect(() => {
    const socket = getSocket();
    const onSync = () => load().catch(console.error);
    socket.on('sync:complete', onSync);
    return () => socket.off('sync:complete', onSync);
  }, [load]);

  async function connect(platform) {
    setBusy(platform);
    setMsg('');
    try {
      const { data } = await api.get(`/connect/${platform}`);
      if (data.url) {
        window.location.href = data.url; // real OAuth consent screen
      } else if (data.mock) {
        setMsg(`✅ ${platform} connected — demo data is syncing.`);
        await load();
      }
    } catch (err) {
      setMsg(`⚠️ ${err.response?.data?.error || 'connect failed'}`);
    } finally {
      setBusy('');
    }
  }

  async function disconnect(platform) {
    if (!window.confirm(`Disconnect ${platform}? Its synced data stays until the next cleanup.`)) return;
    await api.delete(`/connect/${platform}`);
    await load();
  }

  async function syncNow() {
    setBusy('sync');
    try {
      await api.post('/sync');
      setMsg('⏳ Sync queued — this panel updates live when it finishes.');
    } finally {
      setBusy('');
    }
  }

  const accountFor = (p) => accounts.find((a) => a.platform === p);

  const HINTS = {
    demo: 'Presentation account — connects instantly with rich demo data.',
    mock: 'Demo mode — connects with realistic generated data.',
    'server-keys': 'You will be redirected to authorize access.',
    'own-keys': 'Connects live using your saved API keys.',
    'needs-keys': 'Add your API keys below, then connect your real account.',
  };

  return (
    <div className="page">
      <header>
        <h1>👣 Footprint Pro</h1>
        <div className="header-right">
          <Link to="/" className="nav-link">← Dashboard</Link>
          <button onClick={syncNow} disabled={busy === 'sync' || !accounts.length}>
            {busy === 'sync' ? 'Queueing…' : '↻ Sync all now'}
          </button>
        </div>
      </header>
      {msg && <div className="sync-msg">{msg}</div>}
      {isDemo && (
        <div className="sync-msg demo-banner">
          🎓 Demo account — everything here runs on built-in presentation data.
          Regular users sign up and add their own API keys to analyze real accounts.
        </div>
      )}

      <section className="cards">
        {platforms.map((st) => {
          const { platform, mode } = st;
          const acc = accountFor(platform);
          const meta = META[platform] || { label: platform, icon: '🔗' };
          const badge = MODE_BADGE[mode] || MODE_BADGE.mock;
          return (
            <div className="card account-card" key={platform}>
              <div className="account-head">
                <h2>{meta.icon} {meta.label}</h2>
                <span className={`mode-badge ${badge.cls}`}>{badge.text}</span>
              </div>
              {acc ? (
                <>
                  <p><strong>@{acc.handle}</strong></p>
                  <p className="muted">
                    Last synced: {acc.last_synced_at ? new Date(acc.last_synced_at).toLocaleString() : 'first sync pending…'}
                  </p>
                  {acc.sync_error && <p className="error">Last sync error: {acc.sync_error}</p>}
                  <button className="ghost danger" onClick={() => disconnect(platform)}>Disconnect</button>
                </>
              ) : (
                <>
                  <p className="muted">{HINTS[mode]}</p>
                  <button onClick={() => connect(platform)}
                    disabled={busy === platform || mode === 'needs-keys'}>
                    {busy === platform ? 'Connecting…' : 'Connect'}
                  </button>
                </>
              )}
              {!isDemo && <KeyForm platform={platform} status={st} onSaved={load} />}
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>Sync activity</h2>
        {jobs.length === 0 && <p className="muted">No syncs yet — connect an account above.</p>}
        <table className="jobs-table">
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td>{j.platform || 'all'}</td>
                <td><span className={`status ${j.status}`}>{j.status}</span></td>
                <td className="muted">{new Date(j.started_at).toLocaleString()}</td>
                <td className="muted">
                  {j.detail?.new_posts != null && `${j.detail.new_posts} new posts`}
                  {j.detail?.error && <span className="error"> {j.detail.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
