import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import api from '../api';
import { closeSocket, getSocket } from '../socket';

const PLATFORM_COLORS = { twitter: '#1d9bf0', instagram: '#e1306c', github: '#24292e', mock: '#6c5ce7' };
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/* animated number — counts up smoothly whenever the value changes */
function CountUp({ value, suffix = '' }) {
  const [shown, setShown] = useState(0);
  const fromRef = useRef(0);
  useEffect(() => {
    const from = fromRef.current;
    const to = Number(value) || 0;
    const decimals = String(value).includes('.') ? 1 : 0;
    const t0 = performance.now();
    const dur = 700;
    let raf;
    const tick = (t) => {
      const p = Math.min((t - t0) / dur, 1);
      const eased = 1 - (1 - p) ** 3; // ease-out cubic
      setShown(+(from + (to - from) * eased).toFixed(decimals));
      if (p < 1) raf = requestAnimationFrame(tick);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{shown.toLocaleString()}{suffix}</>;
}

/* memoized chart blocks — a live sync:complete refresh only re-renders
   the charts whose data actually changed */
const TrendChart = memo(function TrendChart({ data, platforms }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} />
        <Tooltip /><Legend />
        {platforms.map((p) => (
          <Line key={p} dataKey={p} stroke={PLATFORM_COLORS[p] || '#6c5ce7'}
            dot={false} strokeWidth={2} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
});

const GrowthChart = memo(function GrowthChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="week" fontSize={11} minTickGap={40} /><YAxis fontSize={11} domain={['auto', 'auto']} />
        <Tooltip />
        <Area dataKey="followers" stroke="#6c5ce7" fill="#6c5ce733" strokeWidth={2} />
      </AreaChart>
    </ResponsiveContainer>
  );
});

const TopicChart = memo(function TopicChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="topic" fontSize={11} interval={0} angle={-25} textAnchor="end" height={60} />
        <YAxis fontSize={11} /><Tooltip />
        <Bar dataKey="avg_likes" fill="#00b894" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
});

const SentimentChart = memo(function SentimentChart({ data }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" fontSize={11} /><YAxis fontSize={11} />
        <Tooltip /><Legend />
        <Line dataKey="positive" stroke="#00b894" dot={false} strokeWidth={2} />
        <Line dataKey="neutral" stroke="#b2bec3" dot={false} strokeWidth={2} />
        <Line dataKey="negative" stroke="#d63031" dot={false} strokeWidth={2} />
      </LineChart>
    </ResponsiveContainer>
  );
});

const Heatmap = memo(function Heatmap({ rows }) {
  const { map, max } = useMemo(() => {
    const m = {};
    let mx = 0;
    for (const r of rows) {
      m[`${r.dow}-${r.hour}`] = r.engagement;
      mx = Math.max(mx, r.engagement);
    }
    return { map: m, max: mx };
  }, [rows]);
  return (
    <div className="heatmap">
      {DAYS.map((day, d) => (
        <div className="heat-row" key={day}>
          <span className="heat-label">{day}</span>
          {Array.from({ length: 24 }, (_, h) => {
            const v = map[`${d + 1}-${h}`];
            const alpha = v ? Math.min(1, v / (max || 1)) : 0;
            return <span key={h} className="heat-cell"
              title={`${day} ${h}:00 — ${v != null ? `${v} avg engagement` : 'no posts'}`}
              style={{ background: `rgba(108, 92, 231, ${alpha})` }} />;
          })}
        </div>
      ))}
      <div className="heat-row">
        <span className="heat-label" />
        {Array.from({ length: 24 }, (_, h) => (
          <span key={h} className="heat-hour">{h % 6 === 0 ? h : ''}</span>
        ))}
      </div>
    </div>
  );
});

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [growth, setGrowth] = useState([]);
  const [topics, setTopics] = useState([]);
  const [sentiment, setSentiment] = useState([]);
  const [heatmap, setHeatmap] = useState([]);
  const [topPosts, setTopPosts] = useState([]);
  const [insights, setInsights] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [liveMsg, setLiveMsg] = useState('');
  const user = useMemo(() => JSON.parse(localStorage.getItem('user') || '{}'), []);

  const loadAll = useCallback(async () => {
    const [s, t, g, tp, st, hm, pp, ins, pr] = await Promise.all([
      api.get('/dashboard/summary'), api.get('/dashboard/engagement-trend'),
      api.get('/dashboard/follower-growth'), api.get('/dashboard/topic-performance'),
      api.get('/dashboard/sentiment-trend'), api.get('/dashboard/heatmap'),
      api.get('/dashboard/top-posts'), api.get('/insights'), api.get('/predictions'),
    ]);
    setSummary(s.data); setTrend(t.data); setGrowth(g.data); setTopics(tp.data);
    setSentiment(st.data); setHeatmap(hm.data); setTopPosts(pp.data);
    setInsights(ins.data); setPredictions(pr.data);
  }, []);

  useEffect(() => { loadAll().catch(console.error); }, [loadAll]);

  // real-time: background workers push sync:complete when fresh data lands
  useEffect(() => {
    const socket = getSocket();
    const onSync = (d) => {
      setLiveMsg(`Live: ${d.platform} synced ${d.new_posts} new post${d.new_posts === 1 ? '' : 's'} at ${new Date().toLocaleTimeString()}`);
      loadAll().catch(console.error);
    };
    socket.on('sync:complete', onSync);
    return () => socket.off('sync:complete', onSync);
  }, [loadAll]);

  const trendPlatforms = useMemo(
    () => [...new Set(trend.map((r) => r.platform))], [trend]);

  const trendByMonth = useMemo(() => {
    const map = {};
    for (const r of trend) {
      map[r.month] ??= { month: r.month };
      map[r.month][r.platform] = r.engagement_rate;
    }
    return Object.values(map).sort((a, b) => a.month.localeCompare(b.month));
  }, [trend]);

  const byType = useMemo(() => Object.fromEntries(
    insights.map((i) => [i.insight_type, i.payload])), [insights]);
  const optimal = byType.optimal_time;
  const topTopic = byType.top_topic;
  const sentSummary = byType.sentiment_summary;
  const keyword = byType.keyword_boost;
  const influencer = byType.influencer_score;

  async function logout() {
    try { await api.post('/auth/logout', { refreshToken: localStorage.getItem('refreshToken') }); } catch { /* best-effort */ }
    closeSocket();
    localStorage.clear();
    window.location.href = '/login';
  }

  const noData = summary && summary.total_posts === 0;

  return (
    <div className="page">
      <header>
        <h1>👣 Footprint Pro</h1>
        <div className="header-right">
          <span className="muted">{user.name}</span>
          <Link to="/accounts" className="nav-link">⚙ Accounts</Link>
          <button className="ghost" onClick={logout}>Log out</button>
        </div>
      </header>
      {liveMsg && <div className="sync-msg"><span className="live-dot" />{liveMsg}</div>}

      {!summary && (
        <>
          <section className="cards">
            {Array.from({ length: 4 }, (_, i) => (
              <div className="card kpi" key={i}>
                <div className="skeleton" style={{ width: '50%' }} />
                <div className="skeleton kpi-skel" />
              </div>
            ))}
          </section>
          <section className="grid2">
            <div className="card"><div className="skeleton chart-skel" /></div>
            <div className="card"><div className="skeleton chart-skel" /></div>
          </section>
        </>
      )}

      {noData && (
        <div className="card empty-state">
          <h2>No data yet</h2>
          <p>Connect your first account and the dashboard fills itself in — live.</p>
          <Link to="/accounts"><button>Connect accounts →</button></Link>
        </div>
      )}

      {summary && !noData && (
        <section className="cards">
          <div className="card kpi">
            <div className="kpi-label">Total Followers</div>
            <div className="kpi-value"><CountUp value={summary.total_followers} /></div>
          </div>
          <div className="card kpi">
            <div className="kpi-label">Avg. Engagement Rate</div>
            <div className="kpi-value"><CountUp value={summary.avg_engagement_rate} suffix="%" /></div>
          </div>
          <div className="card kpi">
            <div className="kpi-label">Engagement (month over month)</div>
            <div className={`kpi-value ${summary.engagement_change_pct >= 0 ? 'up' : 'down'}`}>
              {summary.engagement_change_pct >= 0 ? '↑' : '↓'} <CountUp value={Math.abs(summary.engagement_change_pct)} suffix="%" />
            </div>
          </div>
          <div className="card kpi">
            <div className="kpi-label">Posts Analyzed</div>
            <div className="kpi-value"><CountUp value={summary.total_posts} /></div>
          </div>
          {influencer && (
            <div className="card kpi">
              <div className="kpi-label">Influencer Score</div>
              <div className="kpi-value"><CountUp value={influencer.detail.score} />/100</div>
            </div>
          )}
        </section>
      )}

      {!noData && (
        <>
          <section className="grid2">
            <div className="card">
              <h2>Engagement Trend (%)</h2>
              <TrendChart data={trendByMonth} platforms={trendPlatforms} />
            </div>
            <div className="card">
              <h2>Follower Growth</h2>
              <GrowthChart data={growth} />
            </div>
            <div className="card">
              <h2>Post Performance by Topic (avg likes)</h2>
              <TopicChart data={topics} />
            </div>
            <div className="card">
              <h2>Sentiment Trend (%)</h2>
              <SentimentChart data={sentiment} />
            </div>
          </section>

          <section className="card">
            <h2>When Your Audience Engages (day × hour, your timezone)</h2>
            <Heatmap rows={heatmap} />
          </section>

          <section className="grid2">
            <div className="card">
              <h2>Top Performing Posts</h2>
              <ol className="top-posts">
                {topPosts.map((p, i) => (
                  <li key={i}>
                    <span className={`badge ${p.platform}`}>{p.platform}</span>
                    <span className="post-text">{p.content}</span>
                    <span className="post-likes">♥ {p.likes}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="card">
              <h2>Recommendations & Forecast</h2>
              {optimal && (
                <p>🎯 <strong>{optimal.title}</strong> — {optimal.detail.lift}× your average
                  engagement (based on {optimal.detail.sample} posts)</p>
              )}
              {topTopic && (
                <p>🏷️ <strong>{topTopic.title}</strong> — {topTopic.detail.lift}× average</p>
              )}
              {keyword && (
                <p>🔑 <strong>{keyword.title}</strong> — {keyword.detail.lift}× average</p>
              )}
              {sentSummary && (
                <p>😊 <strong>Tone:</strong> {sentSummary.detail.positive_pct}% positive,
                  {' '}{sentSummary.detail.neutral_pct}% neutral,
                  {' '}{sentSummary.detail.negative_pct}% negative
                  {sentSummary.detail.positive_lift ? ` — positive posts earn ${sentSummary.detail.positive_lift}× engagement` : ''}</p>
              )}
              {predictions.length > 0 && (
                <>
                  <h3>Predicted engagement (next 7 days)</h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={predictions}>
                      <XAxis dataKey="target_date" fontSize={10} /><YAxis fontSize={10} />
                      <Tooltip />
                      <Bar dataKey="predicted_high" fill="#74b9ff" name="high" />
                      <Bar dataKey="predicted_low" fill="#0984e3" name="low" />
                    </BarChart>
                  </ResponsiveContainer>
                  <p className="muted">Model: {predictions[0].model} · confidence {Math.round(predictions[0].confidence * 100)}%</p>
                </>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
