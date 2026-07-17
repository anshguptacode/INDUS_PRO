import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api';
import { getSocket } from '../socket';

const META = {
  twitter: { label: 'Twitter / X', icon: '𝕏' },
  instagram: { label: 'Instagram', icon: '📸' },
  github: { label: 'GitHub', icon: '🐙' },
};

export default function Accounts() {
  const [platforms, setPlatforms] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [params] = useSearchParams();

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
        setMsg(`✅ ${platform} connected in mock mode — demo data is syncing.`);
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

      <section className="cards">
        {platforms.map(({ platform, mode }) => {
          const acc = accountFor(platform);
          const meta = META[platform] || { label: platform, icon: '🔗' };
          return (
            <div className="card account-card" key={platform}>
              <div className="account-head">
                <h2>{meta.icon} {meta.label}</h2>
                <span className={`mode-badge ${mode}`}>{mode === 'live' ? 'LIVE API' : 'MOCK'}</span>
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
                  <p className="muted">
                    {mode === 'live'
                      ? 'You will be redirected to authorize access.'
                      : 'No API keys configured — connects with realistic demo data.'}
                  </p>
                  <button onClick={() => connect(platform)} disabled={busy === platform}>
                    {busy === platform ? 'Connecting…' : 'Connect'}
                  </button>
                </>
              )}
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
