/* ═══════════════════════════════════════════
   NEXUS CHAT — app.js
   Main application logic
   ═══════════════════════════════════════════ */

// ── Supabase credentials (hardcode after first setup) ──
const SUPABASE_URL = '';
const SUPABASE_KEY = '';

// ── Constants ──
const CFG_KEY = 'nx_cfg_v3';
const COLORS = ['#5c6cf5','#34d399','#f97316','#ec4899','#0ea5e9','#a855f7','#ef4444','#eab308'];
const EMOJIS = ['😊','😂','❤️','👍','🎉','🔥','✨','😎','🤔','👋','🙏','😅','💯','🚀','😍','🥳','😇','🤩','💪','🎯','👌','🤝','💬','⚡','🌟','🎊','🙌','💡','📌','🎯'];

// ── State ──
let SB = null, ME = null, CHAT = null, TAB = 'chats', Q = '', realtimeSub = null;
let friends = [], requests = [], messages = {};

// ── Utilities ──
const clr = u => COLORS[u.split('').reduce((a,c) => a + c.charCodeAt(0), 0) % COLORS.length];
const ini = n => n.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
const ava = (name, sz = '') => `<div class="ava ${sz}" style="background:${clr(name)}">${ini(name)}</div>`;
const setHTML = html => document.getElementById('app').innerHTML = html;
const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function fmtShort(ts) {
  const d = new Date(ts), n = new Date(), diff = n - d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function fmtDate(ts) {
  const d = new Date(ts), n = new Date();
  if (d.toDateString() === n.toDateString()) return 'Today';
  const y = new Date(n); y.setDate(n.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
}

function toast(msg, icon = '✅') {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span style="font-size:17px">${icon}</span><span>${msg}</span>`;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s,transform .25s';
    el.style.opacity = '0'; el.style.transform = 'translateY(14px)';
    setTimeout(() => el.remove(), 260);
  }, 2600);
}

async function hashPwd(p) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p + 'nx_salt_2024'));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ── Setup SQL ──
const SETUP_SQL = `-- Run this ONCE in Supabase SQL Editor

drop table if exists messages;
drop table if exists friendships;
drop table if exists profiles;

create table profiles (
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text not null,
  password_hash text not null,
  created_at timestamptz default now()
);
create table friendships (
  id uuid primary key default gen_random_uuid(),
  from_user text not null,
  to_user text not null,
  status text default 'pending',
  created_at timestamptz default now(),
  unique(from_user, to_user)
);
create table messages (
  id uuid primary key default gen_random_uuid(),
  from_user text not null,
  to_user text not null,
  content text not null,
  read boolean default false,
  created_at timestamptz default now()
);
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table friendships;
alter table profiles enable row level security;
alter table friendships enable row level security;
alter table messages enable row level security;
create policy "allow_all" on profiles for all using (true) with check (true);
create policy "allow_all" on friendships for all using (true) with check (true);
create policy "allow_all" on messages for all using (true) with check (true);`;

// ──────────────────────────────────────────
// SETUP SCREEN
// ──────────────────────────────────────────
function showSetup() {
  setHTML(`<div class="setup-screen">
    <div class="setup-card">
      <div class="setup-logo">
        <div class="setup-logo-mark">⚡</div>
        <span class="setup-logo-text">Nexus Chat</span>
      </div>
      <h2>First-Time Setup</h2>
      <p class="setup-sub">This screen only appears once — for you as the site owner.<br>After setup, all visitors go straight to the login page.</p>
      <div class="notice">
        <strong>Step 1:</strong> Go to <a href="https://supabase.com" target="_blank">supabase.com</a> → create a free project<br>
        <strong>Step 2:</strong> Click "Show SQL" below, copy it, run it in your Supabase <strong>SQL Editor</strong><br>
        <strong>Step 3:</strong> Go to <strong>Settings → API</strong>, copy URL + anon key, paste below
      </div>
      <button class="sql-toggle" id="sql-toggle">📋 Show / Copy Setup SQL</button>
      <div id="sql-area" style="display:none">
        <div class="sql-box">${SETUP_SQL}</div>
        <button class="copy-btn" id="copy-sql">📋 Copy to clipboard</button>
      </div>
      <div style="height:12px"></div>
      <div class="sf"><label>Supabase Project URL</label><input id="s-url" placeholder="https://xxxxxxxxxxxx.supabase.co" autocomplete="off"/></div>
      <div class="sf"><label>Supabase Anon Key</label><input id="s-key" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." autocomplete="off"/></div>
      <div id="setup-msg"></div>
      <button class="btn-setup" id="btn-setup">Test Connection & Continue →</button>
      <div class="hardcode-tip">
        <strong>Remove this screen permanently:</strong> Open <code>index.html</code>, find<br>
        <code>const SUPABASE_URL = '';</code> and <code>const SUPABASE_KEY = '';</code><br>
        Paste your credentials → save → re-upload. Done ✅
      </div>
    </div>
  </div>`);

  document.getElementById('sql-toggle').onclick = () => {
    const a = document.getElementById('sql-area');
    a.style.display = a.style.display === 'none' ? 'block' : 'none';
  };
  document.getElementById('copy-sql').onclick = () => {
    navigator.clipboard.writeText(SETUP_SQL).then(() => toast('SQL copied!', '📋'));
  };
  document.getElementById('btn-setup').onclick = doSetup;
  ['s-url','s-key'].forEach(id => document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') doSetup(); }));
}

async function doSetup() {
  const url = document.getElementById('s-url').value.trim().replace(/\/$/, '');
  const key = document.getElementById('s-key').value.trim();
  const msg = document.getElementById('setup-msg');
  if (!url || !key) { msg.innerHTML = '<div class="msg-err">Please fill in both fields</div>'; return; }
  if (!url.startsWith('https://')) { msg.innerHTML = '<div class="msg-err">URL must start with https://</div>'; return; }
  const btn = document.getElementById('btn-setup');
  btn.disabled = true; btn.textContent = 'Testing...';
  try {
    const client = supabase.createClient(url, key);
    const { error } = await client.from('profiles').select('id').limit(1);
    if (error) throw new Error(error.message);
    localStorage.setItem(CFG_KEY, JSON.stringify({ url, key }));
    SB = client;
    toast('Connected! Now hardcode the credentials.', '✅');
    btn.textContent = '✅ Connected!';
    setTimeout(() => showAuth(), 900);
  } catch (e) {
    msg.innerHTML = `<div class="msg-err">Failed: ${e.message}<br><small>Make sure you ran the SQL first and credentials are correct.</small></div>`;
    btn.disabled = false; btn.textContent = 'Test Connection & Continue →';
  }
}

// ──────────────────────────────────────────
// AUTH SCREEN
// ──────────────────────────────────────────
function showAuth(mode = 'login') {
  setHTML(`<div class="auth-screen">
    <div class="auth-card">
      <div class="logo-wrap">
        <div class="logo-mark">⚡</div>
        <span class="logo-text">Nexus</span>
      </div>
      <div id="auth-body">${mode === 'login' ? loginForm() : signupForm()}</div>
    </div>
  </div>`);
  bindAuth();
}

function loginForm() {
  return `<h2 class="auth-title">Welcome back</h2>
    <p class="auth-sub">Sign in to your account</p>
    <div id="amsg"></div>
    <div class="field"><label>Username</label><input id="ain-u" placeholder="your username" autocomplete="username"/></div>
    <div class="field"><label>Password</label><input id="ain-p" type="password" placeholder="••••••••"/></div>
    <button class="btn-primary" id="btn-auth">Sign In</button>
    <p class="auth-switch">No account? <a id="sw">Create one</a></p>`;
}

function signupForm() {
  return `<h2 class="auth-title">Create account</h2>
    <p class="auth-sub">Join Nexus — it's free</p>
    <div id="amsg"></div>
    <div class="field"><label>Display Name</label><input id="ain-n" placeholder="Your name"/></div>
    <div class="field"><label>Username</label><input id="ain-u" placeholder="letters, numbers, _ only"/></div>
    <div class="field"><label>Password</label><input id="ain-p" type="password" placeholder="at least 6 characters"/></div>
    <button class="btn-primary" id="btn-auth">Create Account</button>
    <p class="auth-switch">Have an account? <a id="sw">Sign in</a></p>`;
}

function amsg(html, cls) {
  const el = document.getElementById('amsg');
  if (el) el.innerHTML = `<div class="${cls}">${html}</div>`;
}

function bindAuth() {
  const isLogin = !document.getElementById('ain-n');
  document.getElementById('sw')?.addEventListener('click', () => showAuth(isLogin ? 'signup' : 'login'));
  document.getElementById('btn-auth')?.addEventListener('click', isLogin ? doLogin : doSignup);
  ['ain-u','ain-p','ain-n'].forEach(id => document.getElementById(id)?.addEventListener('keydown', e => { if (e.key === 'Enter') { isLogin ? doLogin() : doSignup(); } }));
  document.getElementById('ain-u')?.focus();
}

async function doLogin() {
  const u = document.getElementById('ain-u')?.value.trim().toLowerCase();
  const p = document.getElementById('ain-p')?.value;
  if (!u || !p) { amsg('Please fill in both fields', 'msg-err'); return; }
  const btn = document.getElementById('btn-auth'); btn.disabled = true; btn.textContent = 'Signing in...';
  const { data, error } = await SB.from('profiles').select('*').eq('username', u).single();
  if (error || !data) { amsg('Username not found', 'msg-err'); btn.disabled = false; btn.textContent = 'Sign In'; return; }
  const hash = await hashPwd(p);
  if (data.password_hash !== hash) { amsg('Wrong password', 'msg-err'); btn.disabled = false; btn.textContent = 'Sign In'; return; }
  ME = data; localStorage.setItem('nx_session', JSON.stringify({ username: u })); startApp();
}

async function doSignup() {
  const n = document.getElementById('ain-n')?.value.trim();
  const u = document.getElementById('ain-u')?.value.trim().toLowerCase();
  const p = document.getElementById('ain-p')?.value;
  if (!n || !u || !p) { amsg('Please fill in all fields', 'msg-err'); return; }
  if (p.length < 6) { amsg('Password needs at least 6 characters', 'msg-err'); return; }
  if (!/^[a-z0-9_]+$/.test(u)) { amsg('Username: only letters, numbers, underscores', 'msg-err'); return; }
  if (u.length < 3 || u.length > 20) { amsg('Username must be 3–20 characters', 'msg-err'); return; }
  const btn = document.getElementById('btn-auth'); btn.disabled = true; btn.textContent = 'Checking...';
  const { data: ex } = await SB.from('profiles').select('id').eq('username', u).single();
  if (ex) { amsg('Username taken — choose another', 'msg-err'); btn.disabled = false; btn.textContent = 'Create Account'; return; }
  btn.textContent = 'Creating...';
  const hash = await hashPwd(p);
  const { data, error } = await SB.from('profiles').insert({ username: u, display_name: n, password_hash: hash }).select().single();
  if (error) { amsg('Error: ' + error.message, 'msg-err'); btn.disabled = false; btn.textContent = 'Create Account'; return; }
  ME = data; localStorage.setItem('nx_session', JSON.stringify({ username: u }));
  toast('Account created! Welcome 🎉', '🎉'); startApp();
}

// ──────────────────────────────────────────
// APP BOOT
// ──────────────────────────────────────────
async function startApp() {
  setHTML(`<div class="loading-screen"><div class="spinner"></div><p class="loading-lbl">Loading your chats...</p></div>`);
  await loadData(); renderApp(); subscribeRealtime();
}

async function loadData() {
  const u = ME.username;
  const { data: fr1 } = await SB.from('friendships').select('*').eq('from_user', u).eq('status', 'accepted');
  const { data: fr2 } = await SB.from('friendships').select('*').eq('to_user', u).eq('status', 'accepted');
  const frSet = new Set([...(fr1 || []).map(r => r.to_user), ...(fr2 || []).map(r => r.from_user)]);
  friends = [];
  if (frSet.size > 0) {
    const { data: p } = await SB.from('profiles').select('username,display_name').in('username', [...frSet]);
    friends = p || [];
  }
  const { data: reqs } = await SB.from('friendships').select('*').or(`from_user.eq.${u},to_user.eq.${u}`).eq('status', 'pending');
  requests = reqs || [];
  messages = {};
  for (const f of friends) {
    const { data: msgs } = await SB.from('messages').select('*')
      .or(`and(from_user.eq.${u},to_user.eq.${f.username}),and(from_user.eq.${f.username},to_user.eq.${u})`)
      .order('created_at', { ascending: true });
    messages[f.username] = msgs || [];
  }
}

async function loadMessages(fr) {
  const u = ME.username;
  const { data: msgs } = await SB.from('messages').select('*')
    .or(`and(from_user.eq.${u},to_user.eq.${fr}),and(from_user.eq.${fr},to_user.eq.${u})`)
    .order('created_at', { ascending: true });
  messages[fr] = msgs || [];
  await SB.from('messages').update({ read: true }).eq('to_user', u).eq('from_user', fr).eq('read', false);
}

function subscribeRealtime() {
  if (realtimeSub) SB.removeChannel(realtimeSub);
  realtimeSub = SB.channel('nx-' + ME.username)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => {
      const msg = p.new, u = ME.username;
      if (msg.from_user !== u && msg.to_user !== u) return;
      const other = msg.from_user === u ? msg.to_user : msg.from_user;
      if (!messages[other]) messages[other] = [];
      if (!messages[other].find(m => m.id === msg.id)) messages[other].push(msg);
      if (CHAT === other) {
        if (msg.from_user !== u) SB.from('messages').update({ read: true }).eq('id', msg.id);
        refreshMsgs();
      } else {
        refreshConvList();
        if (msg.from_user !== u) toast(`New message from @${msg.from_user}`, '💬');
      }
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'friendships' }, p => {
      if (p.new.status === 'accepted') { loadData().then(() => renderApp()); toast('Friend request accepted! 🎉', '🎉'); }
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'friendships' }, p => {
      if (p.new.to_user === ME.username) { loadData().then(() => renderApp()); toast(`Friend request from @${p.new.from_user}`, '👋'); }
    })
    .subscribe();
}

// ──────────────────────────────────────────
// RENDER
// ──────────────────────────────────────────
function renderApp() {
  setHTML(`<div class="app-wrap">${renderSidebar()}${CHAT ? renderChat() : renderEmpty()}</div>`);
  bindApp();
}

function renderSidebar() {
  const inc = requests.filter(r => r.to_user === ME.username);
  const unr = friends.reduce((s, f) => s + (messages[f.username] || []).filter(m => m.from_user !== ME.username && !m.read).length, 0);
  return `<div class="sidebar">
    <div class="sb-header">
      <div class="me-row">
        ${ava(ME.display_name)}
        <div class="me-info">
          <div class="me-name">${ME.display_name}</div>
          <div class="me-handle">@${ME.username}</div>
        </div>
        <button class="logout-btn" id="btn-logout" title="Sign out">⏏</button>
      </div>
      <div class="tabs">
        <button class="tab ${TAB === 'chats' ? 'on' : ''}" id="t-chats">
          <span>💬</span><span>Chats</span>${unr > 0 ? `<span class="chip">${unr}</span>` : ''}
        </button>
        <button class="tab ${TAB === 'friends' ? 'on' : ''}" id="t-friends">
          <span>👥</span><span>Friends</span>${inc.length > 0 ? `<span class="chip">${inc.length}</span>` : ''}
        </button>
      </div>
    </div>
    ${TAB === 'chats' ? renderConvList() : renderFrList()}
  </div>`;
}

function renderConvList() {
  const fil = friends.filter(f => !Q || f.username.includes(Q.toLowerCase()) || f.display_name.toLowerCase().includes(Q.toLowerCase()));
  return `<div class="sb-search"><span class="si">🔍</span><input id="q-in" placeholder="Search..." value="${Q}"/></div>
    <div class="conv-list" id="conv-list">
      ${fil.length === 0
        ? `<div class="empty-state">${friends.length === 0 ? 'No friends yet.<br>Go to Friends tab.' : 'No matches.'}</div>`
        : fil.map(f => {
          const msgs = messages[f.username] || [], last = msgs[msgs.length - 1];
          const unr = msgs.filter(m => m.from_user !== ME.username && !m.read).length;
          return `<div class="conv-row ${CHAT === f.username ? 'active' : ''}" data-fr="${f.username}">
            ${ava(f.display_name, 'sm')}
            <div class="conv-body">
              <div class="conv-name">${f.display_name}</div>
              <div class="conv-prev">${last ? (last.from_user === ME.username ? 'You: ' : '') + esc(last.content) : 'Start chatting...'}</div>
            </div>
            <div class="conv-side">
              ${last ? `<span class="conv-time">${fmtShort(last.created_at)}</span>` : ''}
              ${unr > 0 ? `<span class="unread-dot">${unr}</span>` : ''}
            </div>
          </div>`;
        }).join('')}
    </div>`;
}

function renderFrList() {
  const inc = requests.filter(r => r.to_user === ME.username);
  const out = requests.filter(r => r.from_user === ME.username);
  return `<div class="fr-panel">
    <button class="add-fr-btn" id="btn-add-fr">➕ Add Friend by Username</button>
    ${inc.length ? `<div class="sec-lbl">Incoming — ${inc.length}</div>${inc.map(r => `
      <div class="fr-row">
        ${ava(r.from_user, 'sm')}
        <div class="fr-info"><div class="fr-name">@${r.from_user}</div><div class="fr-sub">sent you a request</div></div>
        <span class="tag in">Incoming</span>
        <div class="fr-acts">
          <button class="act-btn ok" data-accept="${r.from_user}">✓</button>
          <button class="act-btn no" data-decline="${r.id}">✕</button>
        </div>
      </div>`).join('')}` : ''}
    ${out.length ? `<div class="sec-lbl">Sent</div>${out.map(r => `
      <div class="fr-row">
        ${ava(r.to_user, 'sm')}
        <div class="fr-info"><div class="fr-name">@${r.to_user}</div><div class="fr-sub">waiting...</div></div>
        <span class="tag out">Pending</span>
      </div>`).join('')}` : ''}
    ${friends.length ? `<div class="sec-lbl">Friends — ${friends.length}</div>${friends.map(f => `
      <div class="fr-row">
        ${ava(f.display_name, 'sm')}
        <div class="fr-info">
          <div class="fr-name">${f.display_name}</div>
          <div class="fr-sub" style="color:var(--green)">● Online</div>
        </div>
        <div class="fr-acts">
          <button class="act-btn go" data-chat="${f.username}">💬</button>
        </div>
      </div>`).join('')}` : `<div class="empty-state">No friends yet!<br>Add someone above.</div>`}
  </div>`;
}

function renderEmpty() {
  return `<div class="chat-wrap">
    <div class="no-chat">
      <div class="no-chat-icon">⚡</div>
      <h2>Nexus Chat</h2>
      <p>Select a conversation or add a friend to get started</p>
    </div>
  </div>`;
}

function renderChat() {
  const fr = friends.find(f => f.username === CHAT);
  if (!fr) return renderEmpty();
  return `<div class="chat-wrap">
    <div class="chat-hdr">
      ${ava(fr.display_name, 'md')}
      <div class="hdr-info">
        <div class="hdr-name">${fr.display_name}</div>
        <div class="hdr-status">Online</div>
      </div>
      <div class="hdr-btns">
        <button class="hdr-btn" title="Call">📞</button>
        <button class="hdr-btn" title="Video">📹</button>
        <button class="hdr-btn" title="More">⋯</button>
      </div>
    </div>
    <div class="msgs" id="msgs">${renderMsgList(messages[CHAT] || [])}</div>
    <div class="input-zone">
      <div class="input-box">
        <button class="ia-btn" title="Attach">📎</button>
        <textarea class="msg-ta" id="msg-ta" placeholder="Message ${fr.display_name}..." rows="1"></textarea>
        <div class="ia">
          <button class="ia-btn" id="emoji-btn" title="Emoji">😊</button>
          <button class="send-btn" id="send-btn" title="Send">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderMsgList(msgs) {
  if (!msgs.length) return `<div style="text-align:center;color:var(--text-3);font-size:13px;padding:40px 0">No messages yet — say hello 👋</div>`;
  let html = '', lastDate = '';
  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i], isOut = m.from_user === ME.username;
    const d = new Date(m.created_at).toDateString();
    if (d !== lastDate) { html += `<div class="date-sep">${fmtDate(m.created_at)}</div>`; lastDate = d; }
    const showAva = !isOut && (i === msgs.length - 1 || msgs[i + 1]?.from_user === ME.username);
    const showLbl = !isOut && (i === 0 || msgs[i - 1]?.from_user === ME.username);
    const fr = friends.find(f => f.username === m.from_user);
    const name = fr ? fr.display_name : m.from_user;
    html += `<div class="msg-row ${isOut ? 'out' : ''}">
      ${!isOut ? (showAva ? ava(name, 'sm') : `<div class="msg-ava-spacer"></div>`) : ''}
      <div>
        ${showLbl && !isOut ? `<div class="sender-lbl">${name}</div>` : ''}
        <div class="bubble ${isOut ? 'out' : 'in'}">
          ${esc(m.content)}
          <div class="msg-time">
            ${fmtTime(m.created_at)}
            ${isOut ? `<span class="ticks ${m.read ? 'read' : ''}">✓✓</span>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }
  return html;
}

function refreshMsgs() {
  const area = document.getElementById('msgs');
  if (area && CHAT) {
    area.innerHTML = renderMsgList(messages[CHAT] || []);
    area.scrollTop = area.scrollHeight;
  }
  refreshConvList();
}

function refreshConvList() {
  const cl = document.getElementById('conv-list');
  if (!cl) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = renderConvList();
  const nl = tmp.querySelector('#conv-list');
  if (nl) { cl.innerHTML = nl.innerHTML; bindConvItems(); }
}

// ──────────────────────────────────────────
// ACTIONS
// ──────────────────────────────────────────
async function sendMsg() {
  const ta = document.getElementById('msg-ta');
  if (!ta || !CHAT) return;
  const txt = ta.value.trim();
  if (!txt) return;
  ta.value = ''; ta.style.height = 'auto';
  const { data, error } = await SB.from('messages').insert({ from_user: ME.username, to_user: CHAT, content: txt, read: false }).select().single();
  if (!error && data) {
    if (!messages[CHAT]) messages[CHAT] = [];
    messages[CHAT].push(data);
    refreshMsgs();
  }
}

async function acceptFriend(fromUser) {
  await SB.from('friendships').update({ status: 'accepted' }).eq('from_user', fromUser).eq('to_user', ME.username);
  toast(`You and @${fromUser} are now friends! 🎉`, '🎉');
  await loadData(); renderApp();
}

async function declineFriend(reqId) {
  await SB.from('friendships').delete().eq('id', reqId);
  requests = requests.filter(r => r.id !== reqId); renderApp();
}

function openAddFriend() {
  const div = document.createElement('div');
  div.className = 'overlay'; div.id = 'overlay';
  div.innerHTML = `<div class="modal">
    <h3>Add Friend</h3>
    <p>Enter their exact username to send a friend request.</p>
    <div id="mmsg"></div>
    <div class="field">
      <label>Username</label>
      <input id="m-u" placeholder="e.g. alex123" autocomplete="off"/>
    </div>
    <div class="modal-row">
      <button class="btn-sec" id="m-cancel">Cancel</button>
      <button class="btn-acc" id="m-send">Send Request</button>
    </div>
  </div>`;
  document.body.appendChild(div);
  document.getElementById('m-u').focus();
  document.getElementById('m-cancel').onclick = () => div.remove();
  div.addEventListener('click', e => { if (e.target === div) div.remove(); });
  document.getElementById('m-u').addEventListener('keydown', e => { if (e.key === 'Enter') doSendReq(); });
  document.getElementById('m-send').onclick = doSendReq;
}

async function doSendReq() {
  const t = document.getElementById('m-u')?.value.trim().toLowerCase();
  const mm = (html, cls) => { const el = document.getElementById('mmsg'); if (el) el.innerHTML = `<div class="${cls}">${html}</div>`; };
  if (!t) { mm('Enter a username', 'msg-err'); return; }
  if (t === ME.username) { mm("You can't add yourself 😅", 'msg-err'); return; }
  const btn = document.getElementById('m-send'); btn.disabled = true; btn.textContent = 'Searching...';
  const { data: prof } = await SB.from('profiles').select('username').eq('username', t).single();
  if (!prof) { mm('User not found — check the spelling', 'msg-err'); btn.disabled = false; btn.textContent = 'Send Request'; return; }
  if (friends.find(f => f.username === t)) { mm('Already friends!', 'msg-err'); btn.disabled = false; btn.textContent = 'Send Request'; return; }
  const { data: ex } = await SB.from('friendships').select('id')
    .or(`and(from_user.eq.${ME.username},to_user.eq.${t}),and(from_user.eq.${t},to_user.eq.${ME.username})`)
    .eq('status', 'pending').single();
  if (ex) { mm('Request already pending', 'msg-err'); btn.disabled = false; btn.textContent = 'Send Request'; return; }
  const { error } = await SB.from('friendships').insert({ from_user: ME.username, to_user: t, status: 'pending' });
  if (error) { mm('Error: ' + error.message, 'msg-err'); btn.disabled = false; btn.textContent = 'Send Request'; return; }
  document.getElementById('overlay')?.remove();
  requests.push({ from_user: ME.username, to_user: t, status: 'pending' });
  toast(`Request sent to @${t}!`, '📨'); renderApp();
}

// ──────────────────────────────────────────
// BINDINGS
// ──────────────────────────────────────────
function bindApp() {
  document.getElementById('btn-logout')?.addEventListener('click', () => {
    ME = null; CHAT = null; TAB = 'chats'; Q = '';
    localStorage.removeItem('nx_session');
    if (realtimeSub) SB.removeChannel(realtimeSub);
    showAuth();
  });
  document.getElementById('t-chats')?.addEventListener('click', () => { TAB = 'chats'; renderApp(); });
  document.getElementById('t-friends')?.addEventListener('click', () => { TAB = 'friends'; renderApp(); });
  document.getElementById('btn-add-fr')?.addEventListener('click', openAddFriend);
  document.getElementById('q-in')?.addEventListener('input', e => { Q = e.target.value; refreshConvList(); });
  bindConvItems(); bindFriendActions(); bindChatInput();
  const area = document.getElementById('msgs');
  if (area) setTimeout(() => area.scrollTop = area.scrollHeight, 30);
}

function bindConvItems() {
  document.querySelectorAll('.conv-row[data-fr]').forEach(el => el.addEventListener('click', async () => {
    CHAT = el.dataset.fr; await loadMessages(CHAT); renderApp();
  }));
}

function bindFriendActions() {
  document.querySelectorAll('[data-accept]').forEach(el => el.addEventListener('click', () => acceptFriend(el.dataset.accept)));
  document.querySelectorAll('[data-decline]').forEach(el => el.addEventListener('click', () => declineFriend(el.dataset.decline)));
  document.querySelectorAll('[data-chat]').forEach(el => el.addEventListener('click', async () => {
    CHAT = el.dataset.chat; TAB = 'chats'; await loadMessages(CHAT); renderApp();
  }));
}

function bindChatInput() {
  const ta = document.getElementById('msg-ta');
  if (!ta) return;
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
  ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 120) + 'px'; });
  ta.focus();
  document.getElementById('send-btn')?.addEventListener('click', sendMsg);

  // Emoji picker
  document.getElementById('emoji-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('epicker')?.remove();
    const pick = document.createElement('div');
    pick.id = 'epicker'; pick.className = 'epicker';
    EMOJIS.forEach(em => {
      const b = document.createElement('button');
      b.className = 'e-btn'; b.textContent = em;
      b.addEventListener('click', e2 => {
        e2.stopPropagation();
        const t2 = document.getElementById('msg-ta');
        if (t2) {
          const start = t2.selectionStart, end = t2.selectionEnd;
          t2.value = t2.value.slice(0, start) + em + t2.value.slice(end);
          t2.selectionStart = t2.selectionEnd = start + em.length;
          t2.focus();
          t2.dispatchEvent(new Event('input'));
        }
        pick.remove();
      });
      pick.appendChild(b);
    });
    // Position relative to chat-wrap
    const cw = document.querySelector('.chat-wrap');
    if (cw) { cw.style.position = 'relative'; cw.appendChild(pick); }
    setTimeout(() => document.addEventListener('click', () => pick.remove(), { once: true }), 10);
  });
}

// ──────────────────────────────────────────
// BOOT
// ──────────────────────────────────────────
async function boot() {
  let url = SUPABASE_URL.trim(), key = SUPABASE_KEY.trim();
  if (!url || !key) {
    const saved = JSON.parse(localStorage.getItem(CFG_KEY) || 'null');
    if (saved) { url = saved.url; key = saved.key; }
  }
  if (!url || !key) { showSetup(); return; }
  SB = supabase.createClient(url, key);
  const { error } = await SB.from('profiles').select('id').limit(1);
  if (error) { showSetup(); return; }
  const sess = JSON.parse(localStorage.getItem('nx_session') || 'null');
  if (sess) {
    const { data: prof } = await SB.from('profiles').select('*').eq('username', sess.username).single();
    if (prof) { ME = prof; startApp(); return; }
  }
  showAuth();
}

boot();
