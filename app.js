/* ═══════════════════════════════════════════
   NEXUS CHAT — app.js
   ═══════════════════════════════════════════ */

const SUPABASE_URL = '';
const SUPABASE_KEY = '';

const CFG_KEY      = 'nx_cfg_v3';
const SETTINGS_KEY = 'nx_settings_v1';
const COLORS  = ['#5c6cf5','#34d399','#f97316','#ec4899','#0ea5e9','#a855f7','#ef4444','#eab308'];
const EMOJIS  = ['😊','😂','❤️','👍','🎉','🔥','✨','😎','🤔','👋','🙏','😅','💯','🚀','😍','🥳','😇','🤩','💪','🎯','👌','🤝','💬','⚡','🌟','🎊','🙌','💡','📌','🎯'];
const ACCENT_COLORS = [
  {name:'Discord',  value:'#5865f2'},
  {name:'Purple',   value:'#a855f7'},
  {name:'Pink',     value:'#ec4899'},
  {name:'Green',    value:'#23a55a'},
  {name:'WA Green', value:'#00a884'},
  {name:'Sky',      value:'#0ea5e9'},
  {name:'Orange',   value:'#f97316'},
  {name:'Red',      value:'#ef4444'},
];

let SB = null, ME = null, CHAT = null, TAB = 'chats', Q = '', realtimeSub = null;
let friends = [], requests = [], messages = {};

/* Settings state */
let SETTINGS = {
  theme: 'dark',
  accent: '#5865f2',
  micId: '',
  speakerId: '',
  notifSound: true,
};

/* Voice recording state */
let mediaRecorder = null, audioChunks = [], recInterval = null, recSeconds = 0;
let currentAudio = null;

/* ── Utilities ── */
const clr = u => COLORS[u.split('').reduce((a,c)=>a+c.charCodeAt(0),0) % COLORS.length];
const ini  = n => n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
const ava  = (name, sz='') => `<div class="ava${sz?' '+sz:''}" style="background:${clr(name)}">${ini(name)}</div>`;
const $    = id => document.getElementById(id);
const setHTML = html => { document.getElementById('app').innerHTML = html; };
const esc  = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function fmtShort(ts) {
  const d=new Date(ts), n=new Date(), diff=n-d;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff/60000)+'m';
  if (d.toDateString()===n.toDateString()) return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString([],{month:'short',day:'numeric'});
}
function fmtTime(ts) { return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}); }
function fmtDate(ts) {
  const d=new Date(ts), n=new Date();
  if (d.toDateString()===n.toDateString()) return 'Today';
  const y=new Date(n); y.setDate(n.getDate()-1);
  if (d.toDateString()===y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});
}
function fmtDuration(secs) {
  const m=Math.floor(secs/60), s=secs%60;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function toast(msg, icon='✅') {
  const el=document.createElement('div');
  el.className='toast';
  el.innerHTML=`<span style="font-size:17px">${icon}</span><span>${msg}</span>`;
  document.body.appendChild(el);
  setTimeout(()=>{
    el.style.transition='opacity .25s,transform .25s';
    el.style.opacity='0'; el.style.transform='translateY(12px)';
    setTimeout(()=>el.remove(), 260);
  }, 2800);
}

async function hashPwd(p) {
  const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p+'nx_salt_2024'));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

/* ── Settings persistence ── */
function loadSettings() {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');
  if (saved) SETTINGS = {...SETTINGS,...saved};
  applySettings();
}
function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(SETTINGS));
  applySettings();
}
function applySettings() {
  document.documentElement.dataset.theme = SETTINGS.theme;
  document.documentElement.style.setProperty('--accent', SETTINGS.accent);
  document.documentElement.style.setProperty('--accent-h', adjustColor(SETTINGS.accent, -20));
  document.documentElement.style.setProperty('--accent-lo', hexToRgba(SETTINGS.accent, .18));
}
function hexToRgba(hex, alpha) {
  const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
function adjustColor(hex, amount) {
  const r=Math.max(0,Math.min(255,parseInt(hex.slice(1,3),16)+amount));
  const g=Math.max(0,Math.min(255,parseInt(hex.slice(3,5),16)+amount));
  const b=Math.max(0,Math.min(255,parseInt(hex.slice(5,7),16)+amount));
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

/* ── Setup SQL ── */
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

/* ════════════════════════════════════════════
   SETUP SCREEN
════════════════════════════════════════════ */
function showSetup() {
  setHTML(`<div class="setup-wrap">
    <div class="setup-box">
      <h2>⚡ First-Time Setup</h2>
      <p>This screen only appears once. After setup, all visitors go straight to login.</p>
      <div class="notice-box">
        <strong>Step 1:</strong> Go to <a href="https://supabase.com" target="_blank">supabase.com</a> → create a free project<br>
        <strong>Step 2:</strong> Click "Show SQL", copy it, run it in your <strong>SQL Editor</strong><br>
        <strong>Step 3:</strong> Go to <strong>Settings → API</strong>, copy URL + anon key below
      </div>
      <button class="sql-toggle-btn" id="sql-toggle">📋 Show / Copy Setup SQL</button>
      <div id="sql-area" style="display:none">
        <pre class="sql-pre">${esc(SETUP_SQL)}</pre>
        <button class="copy-sql-btn" id="copy-sql">📋 Copy to clipboard</button>
      </div>
      <div class="f-group"><label>Supabase Project URL</label><input id="s-url" placeholder="https://xxxxxxxxxxxx.supabase.co" autocomplete="off"/></div>
      <div class="f-group"><label>Supabase Anon Key</label><input id="s-key" placeholder="eyJhbGci..." autocomplete="off"/></div>
      <div id="setup-msg"></div>
      <button class="btn-auth" id="btn-setup">Test Connection & Continue →</button>
      <div class="setup-tip">
        <strong>Tip:</strong> To remove this screen permanently, open <code>app.js</code>,<br>
        set <code>SUPABASE_URL</code> and <code>SUPABASE_KEY</code> directly.
      </div>
    </div>
  </div>`);
  $('sql-toggle').onclick = () => { const a=$('sql-area'); a.style.display=a.style.display==='none'?'block':'none'; };
  $('copy-sql').onclick = ()=>navigator.clipboard.writeText(SETUP_SQL).then(()=>toast('SQL copied!','📋'));
  $('btn-setup').onclick = doSetup;
  ['s-url','s-key'].forEach(id=>$(id)?.addEventListener('keydown',e=>{if(e.key==='Enter')doSetup();}));
}

async function doSetup() {
  const url=$('s-url').value.trim().replace(/\/$/,'');
  const key=$('s-key').value.trim();
  const msgEl=$('setup-msg');
  if (!url||!key) { msgEl.innerHTML='<div class="alert err">Please fill in both fields</div>'; return; }
  if (!url.startsWith('https://')) { msgEl.innerHTML='<div class="alert err">URL must start with https://</div>'; return; }
  const btn=$('btn-setup'); btn.disabled=true; btn.textContent='Testing...';
  try {
    const client=supabase.createClient(url,key);
    const {error}=await client.from('profiles').select('id').limit(1);
    if (error) throw new Error(error.message);
    localStorage.setItem(CFG_KEY,JSON.stringify({url,key}));
    SB=client; btn.textContent='✅ Connected!';
    toast('Connected! Redirecting…','✅');
    setTimeout(()=>showAuth(), 900);
  } catch(e) {
    msgEl.innerHTML=`<div class="alert err">Failed: ${e.message}<br><small>Make sure you ran the SQL first.</small></div>`;
    btn.disabled=false; btn.textContent='Test Connection & Continue →';
  }
}

/* ════════════════════════════════════════════
   AUTH SCREEN
════════════════════════════════════════════ */
function showAuth(mode='login') {
  setHTML(`<div class="auth-wrap">
    <div class="auth-box">
      <div class="auth-logo">
        <div class="auth-logo-icon">
          <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
        </div>
        <span>Nexus</span>
      </div>
      <div id="auth-body">${mode==='login'?loginForm():signupForm()}</div>
    </div>
  </div>`);
  bindAuth();
}

function loginForm() {
  return `<h2 class="auth-title">Welcome back</h2>
    <p class="auth-sub">Sign in to continue</p>
    <div id="amsg"></div>
    <div class="f-group"><label>Username</label><input id="ain-u" placeholder="your username" autocomplete="username"/></div>
    <div class="f-group"><label>Password</label><input id="ain-p" type="password" placeholder="••••••••"/></div>
    <button class="btn-auth" id="btn-auth">Sign In</button>
    <p class="auth-switch">No account? <a id="sw">Create one</a></p>`;
}

function signupForm() {
  return `<h2 class="auth-title">Create account</h2>
    <p class="auth-sub">Join Nexus — it's free</p>
    <div id="amsg"></div>
    <div class="f-group"><label>Display Name</label><input id="ain-n" placeholder="Your name"/></div>
    <div class="f-group"><label>Username</label><input id="ain-u" placeholder="letters, numbers, _ only"/></div>
    <div class="f-group"><label>Password</label><input id="ain-p" type="password" placeholder="at least 6 characters"/></div>
    <button class="btn-auth" id="btn-auth">Create Account</button>
    <p class="auth-switch">Have an account? <a id="sw">Sign in</a></p>`;
}

function amsg(html, cls) { const el=$('amsg'); if(el) el.innerHTML=`<div class="alert ${cls}">${html}</div>`; }

function bindAuth() {
  const isLogin=!$('ain-n');
  $('sw')?.addEventListener('click',()=>showAuth(isLogin?'signup':'login'));
  $('btn-auth')?.addEventListener('click',isLogin?doLogin:doSignup);
  ['ain-u','ain-p','ain-n'].forEach(id=>$(id)?.addEventListener('keydown',e=>{if(e.key==='Enter'){isLogin?doLogin():doSignup();}}));
  $('ain-u')?.focus();
}

async function doLogin() {
  const u=$('ain-u')?.value.trim().toLowerCase(), p=$('ain-p')?.value;
  if (!u||!p) { amsg('Please fill in both fields','err'); return; }
  const btn=$('btn-auth'); btn.disabled=true; btn.textContent='Signing in...';
  const {data,error}=await SB.from('profiles').select('*').eq('username',u).single();
  if (error||!data) { amsg('Username not found','err'); btn.disabled=false; btn.textContent='Sign In'; return; }
  const hash=await hashPwd(p);
  if (data.password_hash!==hash) { amsg('Wrong password','err'); btn.disabled=false; btn.textContent='Sign In'; return; }
  ME=data; localStorage.setItem('nx_session',JSON.stringify({username:u})); startApp();
}

async function doSignup() {
  const n=$('ain-n')?.value.trim(), u=$('ain-u')?.value.trim().toLowerCase(), p=$('ain-p')?.value;
  if (!n||!u||!p) { amsg('Please fill in all fields','err'); return; }
  if (p.length<6) { amsg('Password needs at least 6 characters','err'); return; }
  if (!/^[a-z0-9_]+$/.test(u)) { amsg('Username: only letters, numbers, underscores','err'); return; }
  if (u.length<3||u.length>20) { amsg('Username must be 3–20 characters','err'); return; }
  const btn=$('btn-auth'); btn.disabled=true; btn.textContent='Checking...';
  const {data:ex}=await SB.from('profiles').select('id').eq('username',u).single();
  if (ex) { amsg('Username taken','err'); btn.disabled=false; btn.textContent='Create Account'; return; }
  btn.textContent='Creating...';
  const hash=await hashPwd(p);
  const {data,error}=await SB.from('profiles').insert({username:u,display_name:n,password_hash:hash}).select().single();
  if (error) { amsg('Error: '+error.message,'err'); btn.disabled=false; btn.textContent='Create Account'; return; }
  ME=data; localStorage.setItem('nx_session',JSON.stringify({username:u}));
  toast('Welcome to Nexus! 🎉','🎉'); startApp();
}

/* ════════════════════════════════════════════
   BOOT / LOAD
════════════════════════════════════════════ */
async function startApp() {
  setHTML(`<div class="loading"><div class="spin"></div><p>Loading your chats…</p></div>`);
  await loadData(); renderApp(); subscribeRealtime();
}

async function loadData() {
  const u=ME.username;
  const {data:fr1}=await SB.from('friendships').select('*').eq('from_user',u).eq('status','accepted');
  const {data:fr2}=await SB.from('friendships').select('*').eq('to_user',u).eq('status','accepted');
  const frSet=new Set([...(fr1||[]).map(r=>r.to_user),...(fr2||[]).map(r=>r.from_user)]);
  friends=[];
  if (frSet.size>0) {
    const {data:p}=await SB.from('profiles').select('username,display_name').in('username',[...frSet]);
    friends=p||[];
  }
  const {data:reqs}=await SB.from('friendships').select('*').or(`from_user.eq.${u},to_user.eq.${u}`).eq('status','pending');
  requests=reqs||[];
  messages={};
  for (const f of friends) {
    const {data:msgs}=await SB.from('messages').select('*')
      .or(`and(from_user.eq.${u},to_user.eq.${f.username}),and(from_user.eq.${f.username},to_user.eq.${u})`)
      .order('created_at',{ascending:true});
    messages[f.username]=msgs||[];
  }
}

async function loadMessages(fr) {
  const u=ME.username;
  const {data:msgs}=await SB.from('messages').select('*')
    .or(`and(from_user.eq.${u},to_user.eq.${fr}),and(from_user.eq.${fr},to_user.eq.${u})`)
    .order('created_at',{ascending:true});
  messages[fr]=msgs||[];
  await SB.from('messages').update({read:true}).eq('to_user',u).eq('from_user',fr).eq('read',false);
}

function subscribeRealtime() {
  if (realtimeSub) SB.removeChannel(realtimeSub);
  realtimeSub = SB.channel('nx-'+ME.username)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},p=>{
      const msg=p.new, u=ME.username;
      if (msg.from_user!==u&&msg.to_user!==u) return;
      const other=msg.from_user===u?msg.to_user:msg.from_user;
      if (!messages[other]) messages[other]=[];
      if (!messages[other].find(m=>m.id===msg.id)) messages[other].push(msg);
      if (CHAT===other) {
        if (msg.from_user!==u) SB.from('messages').update({read:true}).eq('id',msg.id);
        refreshMsgs();
      } else {
        refreshConvList();
        if (msg.from_user!==u) toast(`New message from @${msg.from_user}`,'💬');
      }
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'friendships'},p=>{
      if (p.new.status==='accepted') { loadData().then(()=>renderApp()); toast('Friend request accepted! 🎉','🎉'); }
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'friendships'},p=>{
      if (p.new.to_user===ME.username) { loadData().then(()=>renderApp()); toast(`Friend request from @${p.new.from_user}`,'👋'); }
    })
    .subscribe();
}

/* ════════════════════════════════════════════
   RENDER
════════════════════════════════════════════ */
function renderApp() {
  setHTML(`<div class="shell">${renderSidebar()}${CHAT?renderChatPanel():renderEmptyPanel()}</div>`);
  bindApp();
}

/* ── Sidebar ── */
function renderSidebar() {
  const inc=requests.filter(r=>r.to_user===ME.username);
  const unr=friends.reduce((s,f)=>s+(messages[f.username]||[]).filter(m=>m.from_user!==ME.username&&!m.read).length,0);
  return `<div class="sidebar">
    <div class="sb-top">
      <div class="me-row">
        ${ava(ME.display_name)}
        <div class="me-info">
          <div class="me-name">${esc(ME.display_name)}</div>
          <div class="me-handle">@${ME.username}</div>
        </div>
        <button class="logout-btn" id="btn-logout" title="Sign out">⏏</button>
      </div>
      <div class="tabs">
        <button class="tab ${TAB==='chats'?'on':''}" id="t-chats">
          💬 Chats ${unr>0?`<span class="chip">${unr}</span>`:''}
        </button>
        <button class="tab ${TAB==='friends'?'on':''}" id="t-friends">
          👥 Friends ${inc.length>0?`<span class="chip">${inc.length}</span>`:''}
        </button>
        <button class="tab ${TAB==='settings'?'on':''}" id="t-settings">⚙️</button>
      </div>
    </div>
    ${TAB==='chats'?renderConvPanel():TAB==='friends'?renderFrPanel():renderSettingsPanel()}
  </div>`;
}

function renderConvPanel() {
  const fil=friends.filter(f=>!Q||f.username.includes(Q.toLowerCase())||f.display_name.toLowerCase().includes(Q.toLowerCase()));
  return `<div class="sb-search">
      <span class="si">🔍</span>
      <input id="q-in" placeholder="Search…" value="${esc(Q)}"/>
    </div>
    <div class="conv-list" id="conv-list">
      ${fil.length===0
        ? `<div class="empty-state">${friends.length===0?'No friends yet.<br>Go to the Friends tab to add someone.':'No matches.'}</div>`
        : fil.map(f=>{
            const msgs=messages[f.username]||[], last=msgs[msgs.length-1];
            const unr=msgs.filter(m=>m.from_user!==ME.username&&!m.read).length;
            const isVoice=last?.content?.startsWith('[voice]');
            const lastPreview=last?(last.from_user===ME.username?'You: ':'')+(isVoice?'🎤 Voice message':esc(last.content)):'Start chatting…';
            return `<div class="conv-item ${CHAT===f.username?'active':''}" data-fr="${f.username}">
              ${ava(f.display_name,'sm')}
              <div class="conv-body">
                <div class="conv-name">${esc(f.display_name)}</div>
                <div class="conv-last">${lastPreview}</div>
              </div>
              <div class="conv-meta">
                ${last?`<span class="conv-time">${fmtShort(last.created_at)}</span>`:''}
                ${unr>0?`<span class="unread-dot">${unr}</span>`:''}
              </div>
            </div>`;
          }).join('')}
    </div>`;
}

function renderFrPanel() {
  const inc=requests.filter(r=>r.to_user===ME.username);
  const out=requests.filter(r=>r.from_user===ME.username);
  return `<div class="fr-panel">
    <button class="add-fr-btn" id="btn-add-fr">➕ Add Friend by Username</button>
    ${inc.length?`<div class="sec-lbl">Incoming (${inc.length})</div>
      ${inc.map(r=>`<div class="fr-row">
        ${ava(r.from_user,'sm')}
        <div class="fr-info"><div class="fr-name">@${r.from_user}</div><div class="fr-sub">wants to be friends</div></div>
        <span class="tag in">Incoming</span>
        <div class="fr-acts">
          <button class="act-btn ok" data-accept="${r.from_user}" title="Accept">✓</button>
          <button class="act-btn no" data-decline="${r.id}" title="Decline">✕</button>
        </div>
      </div>`).join('')}`:''}
    ${out.length?`<div class="sec-lbl">Sent</div>
      ${out.map(r=>`<div class="fr-row">
        ${ava(r.to_user,'sm')}
        <div class="fr-info"><div class="fr-name">@${r.to_user}</div><div class="fr-sub">waiting…</div></div>
        <span class="tag out">Pending</span>
      </div>`).join('')}`:''}
    ${friends.length?`<div class="sec-lbl">Friends (${friends.length})</div>
      ${friends.map(f=>`<div class="fr-row">
        ${ava(f.display_name,'sm')}
        <div class="fr-info">
          <div class="fr-name">${esc(f.display_name)}</div>
          <div class="fr-sub" style="color:var(--green)">● Online</div>
        </div>
        <div class="fr-acts">
          <button class="act-btn go" data-chat="${f.username}" title="Message">💬</button>
        </div>
      </div>`).join('')}`
    :`<div class="empty-state">No friends yet!<br>Use the button above to add someone.</div>`}
  </div>`;
}

/* ── Settings Panel ── */
function renderSettingsPanel() {
  const swatches = ACCENT_COLORS.map(c=>
    `<div class="swatch${SETTINGS.accent===c.value?' active':''}" data-color="${c.value}" title="${c.name}" style="background:${c.value}"></div>`
  ).join('');

  return `<div class="settings-panel" id="settings-panel">

    <div class="set-section">
      <div class="set-section-title">Appearance</div>

      <div class="set-row">
        <div>
          <div class="set-row-label">Theme</div>
          <div class="set-row-sub">Choose your colour mode</div>
        </div>
        <div class="set-row-right">
          <select class="set-select" id="set-theme">
            <option value="dark" ${SETTINGS.theme==='dark'?'selected':''}>🌙 Dark</option>
            <option value="light" ${SETTINGS.theme==='light'?'selected':''}>☀️ Light</option>
          </select>
        </div>
      </div>

      <div class="set-row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div class="set-row-label">Accent Colour</div>
        <div class="color-swatches" id="color-swatches">${swatches}</div>
      </div>
    </div>

    <div class="set-section">
      <div class="set-section-title">Audio Devices</div>

      <div class="set-row">
        <div>
          <div class="set-row-label">🎤 Microphone</div>
          <div class="set-row-sub">Input device for voice messages</div>
        </div>
        <div class="set-row-right">
          <select class="set-select" id="set-mic" style="max-width:140px">
            <option value="">Default</option>
          </select>
        </div>
      </div>

      <div class="set-row">
        <div>
          <div class="set-row-label">🔊 Speaker</div>
          <div class="set-row-sub">Output device for audio</div>
        </div>
        <div class="set-row-right">
          <select class="set-select" id="set-speaker" style="max-width:140px">
            <option value="">Default</option>
          </select>
        </div>
      </div>
    </div>

    <div class="set-section">
      <div class="set-section-title">Notifications</div>
      <div class="set-row">
        <div>
          <div class="set-row-label">Sound Alerts</div>
          <div class="set-row-sub">Play a sound for new messages</div>
        </div>
        <div class="set-row-right">
          <label class="toggle">
            <input type="checkbox" id="set-notif" ${SETTINGS.notifSound?'checked':''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </div>

  </div>`;
}

/* ── Empty panel ── */
function renderEmptyPanel() {
  return `<div class="chat-panel" style="display:flex;align-items:center;justify-content:center">
    <div class="no-chat">
      <div class="no-chat-icon">⚡</div>
      <h2>Nexus Chat</h2>
      <p>Select a conversation or add a friend to get started</p>
    </div>
  </div>`;
}

/* ── Chat panel ── */
function renderChatPanel() {
  const fr=friends.find(f=>f.username===CHAT);
  if (!fr) return renderEmptyPanel();
  return `<div class="chat-panel" style="position:relative">
    <div class="chat-hdr">
      ${ava(fr.display_name,'md')}
      <div class="hdr-info">
        <div class="hdr-name">${esc(fr.display_name)}</div>
        <div class="hdr-status">Online</div>
      </div>
      <div class="hdr-btns">
        <button class="hdr-btn" title="Call">📞</button>
        <button class="hdr-btn" title="Video">📹</button>
        <button class="hdr-btn" title="More">⋯</button>
      </div>
    </div>
    <div class="msgs" id="msgs">${renderMsgList(messages[CHAT]||[])}</div>
    <div class="input-zone">
      <div class="input-box" id="input-box">
        <button class="ia-btn" title="Attach">📎</button>
        <textarea class="msg-ta" id="msg-ta" placeholder="Message ${esc(fr.display_name)}…" rows="1"></textarea>
        <div class="ia">
          <button class="ia-btn" id="emoji-btn" title="Emoji">😊</button>
          <button class="voice-rec-btn" id="voice-btn" title="Hold to record voice message">🎤</button>
          <button class="send-btn" id="send-btn" title="Send">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  </div>`;
}

function renderMsgList(msgs) {
  if (!msgs.length) return `<div style="text-align:center;color:var(--t3);font-size:13px;padding:48px 0">No messages yet — say hello 👋</div>`;
  let html='', lastDate='';
  for (let i=0;i<msgs.length;i++) {
    const m=msgs[i], isOut=m.from_user===ME.username;
    const d=new Date(m.created_at).toDateString();
    if (d!==lastDate) { html+=`<div class="date-sep">${fmtDate(m.created_at)}</div>`; lastDate=d; }
    const showAva=!isOut&&(i===msgs.length-1||msgs[i+1]?.from_user===ME.username);
    const showLbl=!isOut&&(i===0||msgs[i-1]?.from_user===ME.username);
    const fr=friends.find(f=>f.username===m.from_user);
    const name=fr?fr.display_name:m.from_user;
    const isVoice=m.content.startsWith('[voice]');
    const bubbleContent=isVoice?renderVoiceBubble(m.content,m.id):esc(m.content);
    html+=`<div class="msg-row${isOut?' out':''}">
      ${!isOut?(showAva?ava(name,'sm'):`<div class="msg-ava-spacer"></div>`):''}
      <div>
        ${showLbl&&!isOut?`<div class="sender-lbl">${esc(name)}</div>`:''}
        <div class="bubble ${isOut?'out':'in'}">
          ${bubbleContent}
          <div class="msg-time">
            ${fmtTime(m.created_at)}
            ${isOut?`<span class="ticks${m.read?' read':''}">✓✓</span>`:''}
          </div>
        </div>
      </div>
    </div>`;
  }
  return html;
}

function renderVoiceBubble(content, id) {
  const b64=content.slice('[voice]'.length);
  const safeId='vp-'+id.replace(/-/g,'');
  return `<div class="voice-msg">
    <button class="voice-play-btn" id="${safeId}" data-src="${b64}" onclick="playVoice('${safeId}')">▶</button>
    <div class="voice-waveform">
      ${Array.from({length:8},(_,i)=>`<div class="voice-bar paused" id="${safeId}-bar${i}"></div>`).join('')}
    </div>
    <span class="voice-duration" id="${safeId}-dur">0:00</span>
  </div>`;
}

/* ── Refresh helpers ── */
function refreshMsgs() {
  const area=$('msgs');
  if (area&&CHAT) { area.innerHTML=renderMsgList(messages[CHAT]||[]); area.scrollTop=area.scrollHeight; }
  refreshConvList();
}

function refreshConvList() {
  const cl=$('conv-list');
  if (!cl) return;
  const tmp=document.createElement('div');
  tmp.innerHTML=renderConvPanel();
  const nl=tmp.querySelector('#conv-list');
  if (nl) { cl.innerHTML=nl.innerHTML; bindConvItems(); }
}

/* ════════════════════════════════════════════
   VOICE MESSAGES
════════════════════════════════════════════ */
async function startRecording() {
  try {
    const constraints = {audio: SETTINGS.micId ? {deviceId:{exact:SETTINGS.micId}} : true};
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    audioChunks = []; recSeconds = 0;
    mediaRecorder = new MediaRecorder(stream, {mimeType: getSupportedMimeType()});
    mediaRecorder.ondataavailable = e => { if (e.data.size>0) audioChunks.push(e.data); };
    mediaRecorder.start(100);

    /* Show recording UI */
    const inputBox = $('input-box');
    if (inputBox) {
      inputBox.innerHTML = `
        <div class="recording-indicator">
          <div class="rec-dot"></div>
          <span class="rec-timer" id="rec-timer">0:00</span>
          <span style="flex:1;font-size:12px;color:var(--t3)">Recording…</span>
          <button class="rec-cancel" id="rec-cancel">Cancel</button>
        </div>
        <button class="voice-rec-btn recording" id="voice-btn" title="Stop recording">⏹</button>
      `;
      $('rec-cancel').onclick = cancelRecording;
      $('voice-btn').onclick  = stopRecording;
    }

    recInterval = setInterval(()=>{
      recSeconds++;
      const t=$('rec-timer');
      if (t) t.textContent=fmtDuration(recSeconds);
      if (recSeconds >= 120) stopRecording();
    }, 1000);

  } catch(err) {
    toast('Microphone access denied','🚫');
  }
}

function getSupportedMimeType() {
  const types=['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'];
  return types.find(t=>MediaRecorder.isTypeSupported(t))||'';
}

function cancelRecording() {
  clearInterval(recInterval);
  if (mediaRecorder&&mediaRecorder.state!=='inactive') {
    mediaRecorder.stream.getTracks().forEach(t=>t.stop());
    mediaRecorder.stop();
  }
  mediaRecorder=null; audioChunks=[];
  restoreInputBox();
}

async function stopRecording() {
  clearInterval(recInterval);
  if (!mediaRecorder||audioChunks.length===0) { cancelRecording(); return; }

  await new Promise(resolve=>{
    mediaRecorder.onstop=resolve;
    mediaRecorder.stream.getTracks().forEach(t=>t.stop());
    if (mediaRecorder.state!=='inactive') mediaRecorder.stop();
  });

  const blob = new Blob(audioChunks, {type: mediaRecorder.mimeType||'audio/webm'});
  audioChunks = []; mediaRecorder = null;

  /* Convert to base64 */
  const reader = new FileReader();
  reader.onloadend = async () => {
    const b64 = reader.result; /* data:audio/...;base64,... */
    await sendVoiceMsg(b64);
  };
  reader.readAsDataURL(blob);
  restoreInputBox();
}

async function sendVoiceMsg(b64) {
  if (!CHAT) return;
  const content = '[voice]' + b64;
  const {data,error} = await SB.from('messages').insert({from_user:ME.username,to_user:CHAT,content,read:false}).select().single();
  if (!error&&data) {
    if (!messages[CHAT]) messages[CHAT]=[];
    messages[CHAT].push(data);
    refreshMsgs();
  } else {
    toast('Failed to send voice message','❌');
  }
}

function restoreInputBox() {
  const fr=friends.find(f=>f.username===CHAT);
  if (!fr) return;
  const inputBox=$('input-box');
  if (!inputBox) return;
  inputBox.innerHTML=`
    <button class="ia-btn" title="Attach">📎</button>
    <textarea class="msg-ta" id="msg-ta" placeholder="Message ${esc(fr.display_name)}…" rows="1"></textarea>
    <div class="ia">
      <button class="ia-btn" id="emoji-btn" title="Emoji">😊</button>
      <button class="voice-rec-btn" id="voice-btn" title="Hold to record voice message">🎤</button>
      <button class="send-btn" id="send-btn" title="Send">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>`;
  bindChatInput();
}

/* Play voice message */
function playVoice(safeId) {
  const btn=document.getElementById(safeId);
  if (!btn) return;
  const b64=btn.dataset.src;
  const bars=Array.from({length:8},(_,i)=>document.getElementById(`${safeId}-bar${i}`));
  const durEl=document.getElementById(`${safeId}-dur`);

  if (currentAudio&&!currentAudio.paused) {
    currentAudio.pause();
    currentAudio=null;
    bars.forEach(b=>b&&b.classList.add('paused'));
    btn.textContent='▶';
    return;
  }

  const audio=new Audio(b64);
  currentAudio=audio;

  if (SETTINGS.speakerId && audio.setSinkId) {
    audio.setSinkId(SETTINGS.speakerId).catch(()=>{});
  }

  audio.onloadedmetadata=()=>{
    if (durEl) durEl.textContent=fmtDuration(Math.round(audio.duration));
  };
  audio.ontimeupdate=()=>{
    if (durEl) durEl.textContent=fmtDuration(Math.round(audio.currentTime));
  };
  audio.onplay=()=>{ btn.textContent='⏸'; bars.forEach(b=>b&&b.classList.remove('paused')); };
  audio.onpause=audio.onended=()=>{ btn.textContent='▶'; bars.forEach(b=>b&&b.classList.add('paused')); currentAudio=null; };
  audio.play().catch(()=>toast('Could not play audio','❌'));
}

/* ════════════════════════════════════════════
   ACTIONS
════════════════════════════════════════════ */
async function sendMsg() {
  const ta=$('msg-ta');
  if (!ta||!CHAT) return;
  const txt=ta.value.trim();
  if (!txt) return;
  ta.value=''; ta.style.height='auto';
  const {data,error}=await SB.from('messages').insert({from_user:ME.username,to_user:CHAT,content:txt,read:false}).select().single();
  if (!error&&data) {
    if (!messages[CHAT]) messages[CHAT]=[];
    messages[CHAT].push(data);
    refreshMsgs();
  }
}

async function acceptFriend(fromUser) {
  await SB.from('friendships').update({status:'accepted'}).eq('from_user',fromUser).eq('to_user',ME.username);
  toast(`You and @${fromUser} are now friends! 🎉`,'🎉');
  await loadData(); renderApp();
}

async function declineFriend(reqId) {
  await SB.from('friendships').delete().eq('id',reqId);
  requests=requests.filter(r=>r.id!==reqId); renderApp();
}

function openAddFriend() {
  const div=document.createElement('div');
  div.className='overlay'; div.id='overlay';
  div.innerHTML=`<div class="modal">
    <h3>Add Friend</h3>
    <p>Enter their exact username to send a friend request.</p>
    <div id="mmsg"></div>
    <div class="f-group"><label>Username</label><input id="m-u" placeholder="e.g. alex123" autocomplete="off"/></div>
    <div class="modal-row">
      <button class="btn-sec" id="m-cancel">Cancel</button>
      <button class="btn-acc" id="m-send">Send Request</button>
    </div>
  </div>`;
  document.body.appendChild(div);
  $('m-u').focus();
  $('m-cancel').onclick=()=>div.remove();
  div.addEventListener('click',e=>{if(e.target===div)div.remove();});
  $('m-u').addEventListener('keydown',e=>{if(e.key==='Enter')doSendReq();});
  $('m-send').onclick=doSendReq;
}

async function doSendReq() {
  const t=$('m-u')?.value.trim().toLowerCase();
  const mm=(html,cls)=>{ const el=$('mmsg'); if(el) el.innerHTML=`<div class="alert ${cls}">${html}</div>`; };
  if (!t) { mm('Enter a username','err'); return; }
  if (t===ME.username) { mm("You can't add yourself 😅",'err'); return; }
  const btn=$('m-send'); btn.disabled=true; btn.textContent='Searching…';
  const {data:prof}=await SB.from('profiles').select('username').eq('username',t).single();
  if (!prof) { mm('User not found — check the spelling','err'); btn.disabled=false; btn.textContent='Send Request'; return; }
  if (friends.find(f=>f.username===t)) { mm('Already friends!','err'); btn.disabled=false; btn.textContent='Send Request'; return; }
  const {data:ex}=await SB.from('friendships').select('id')
    .or(`and(from_user.eq.${ME.username},to_user.eq.${t}),and(from_user.eq.${t},to_user.eq.${ME.username})`)
    .eq('status','pending').single();
  if (ex) { mm('Request already pending','err'); btn.disabled=false; btn.textContent='Send Request'; return; }
  const {error}=await SB.from('friendships').insert({from_user:ME.username,to_user:t,status:'pending'});
  if (error) { mm('Error: '+error.message,'err'); btn.disabled=false; btn.textContent='Send Request'; return; }
  $('overlay')?.remove();
  requests.push({from_user:ME.username,to_user:t,status:'pending'});
  toast(`Request sent to @${t}!`,'📨'); renderApp();
}

/* ════════════════════════════════════════════
   SETTINGS BINDINGS
════════════════════════════════════════════ */
async function loadAudioDevices() {
  try {
    await navigator.mediaDevices.getUserMedia({audio:true}).then(s=>s.getTracks().forEach(t=>t.stop()));
    const devices=await navigator.mediaDevices.enumerateDevices();
    const mics=devices.filter(d=>d.kind==='audioinput');
    const speakers=devices.filter(d=>d.kind==='audiooutput');
    const micSel=$('set-mic'), spkSel=$('set-speaker');
    if (micSel) {
      mics.forEach(d=>{
        const o=document.createElement('option');
        o.value=d.deviceId; o.textContent=d.label||`Microphone ${mics.indexOf(d)+1}`;
        if (d.deviceId===SETTINGS.micId) o.selected=true;
        micSel.appendChild(o);
      });
    }
    if (spkSel) {
      speakers.forEach(d=>{
        const o=document.createElement('option');
        o.value=d.deviceId; o.textContent=d.label||`Speaker ${speakers.indexOf(d)+1}`;
        if (d.deviceId===SETTINGS.speakerId) o.selected=true;
        spkSel.appendChild(o);
      });
    }
  } catch(e) {
    /* silently ignore if no mic permission */
  }
}

function bindSettingsPanel() {
  $('set-theme')?.addEventListener('change',e=>{
    SETTINGS.theme=e.target.value; saveSettings(); toast('Theme updated','🎨');
  });
  $('set-mic')?.addEventListener('change',e=>{
    SETTINGS.micId=e.target.value; saveSettings(); toast('Microphone updated','🎤');
  });
  $('set-speaker')?.addEventListener('change',e=>{
    SETTINGS.speakerId=e.target.value; saveSettings(); toast('Speaker updated','🔊');
  });
  $('set-notif')?.addEventListener('change',e=>{
    SETTINGS.notifSound=e.target.checked; saveSettings();
  });
  document.querySelectorAll('.swatch').forEach(el=>{
    el.addEventListener('click',()=>{
      SETTINGS.accent=el.dataset.color; saveSettings();
      document.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('active',s===el));
      toast('Accent colour updated','🎨');
    });
  });
  loadAudioDevices();
}

/* ════════════════════════════════════════════
   BINDINGS
════════════════════════════════════════════ */
function bindApp() {
  $('btn-logout')?.addEventListener('click',()=>{
    ME=null; CHAT=null; TAB='chats'; Q='';
    localStorage.removeItem('nx_session');
    if (realtimeSub) SB.removeChannel(realtimeSub);
    showAuth();
  });
  $('t-chats')?.addEventListener('click',()=>{ TAB='chats'; renderApp(); });
  $('t-friends')?.addEventListener('click',()=>{ TAB='friends'; renderApp(); });
  $('t-settings')?.addEventListener('click',()=>{ TAB='settings'; renderApp(); });
  $('btn-add-fr')?.addEventListener('click',openAddFriend);
  $('q-in')?.addEventListener('input',e=>{ Q=e.target.value; refreshConvList(); });
  bindConvItems(); bindFriendActions(); bindChatInput();
  if (TAB==='settings') bindSettingsPanel();
  const area=$('msgs');
  if (area) setTimeout(()=>area.scrollTop=area.scrollHeight, 30);
}

function bindConvItems() {
  document.querySelectorAll('.conv-item[data-fr]').forEach(el=>el.addEventListener('click',async()=>{
    CHAT=el.dataset.fr; await loadMessages(CHAT); renderApp();
  }));
}

function bindFriendActions() {
  document.querySelectorAll('[data-accept]').forEach(el=>el.addEventListener('click',()=>acceptFriend(el.dataset.accept)));
  document.querySelectorAll('[data-decline]').forEach(el=>el.addEventListener('click',()=>declineFriend(el.dataset.decline)));
  document.querySelectorAll('[data-chat]').forEach(el=>el.addEventListener('click',async()=>{
    CHAT=el.dataset.chat; TAB='chats'; await loadMessages(CHAT); renderApp();
  }));
}

function bindChatInput() {
  const ta=$('msg-ta');
  if (!ta) return;
  ta.addEventListener('keydown',e=>{ if(e.key==='Enter'&&!e.shiftKey){ e.preventDefault(); sendMsg(); } });
  ta.addEventListener('input',()=>{ ta.style.height='auto'; ta.style.height=Math.min(ta.scrollHeight,120)+'px'; });
  ta.focus();
  $('send-btn')?.addEventListener('click',sendMsg);

  /* Voice recording button */
  const vb=$('voice-btn');
  if (vb) {
    let pressTimer=null;
    vb.addEventListener('mousedown', e=>{
      e.preventDefault();
      pressTimer=setTimeout(startRecording, 180);
    });
    vb.addEventListener('mouseup',()=>{
      if (pressTimer) { clearTimeout(pressTimer); pressTimer=null; }
    });
    vb.addEventListener('click',()=>{
      if (mediaRecorder&&mediaRecorder.state==='recording') { stopRecording(); }
      else if (!mediaRecorder) { startRecording(); }
    });
    /* Touch support */
    vb.addEventListener('touchstart',e=>{ e.preventDefault(); startRecording(); },{passive:false});
    vb.addEventListener('touchend',e=>{ e.preventDefault(); stopRecording(); },{passive:false});
  }

  $('emoji-btn')?.addEventListener('click',e=>{
    e.stopPropagation();
    document.getElementById('epicker')?.remove();
    const pick=document.createElement('div');
    pick.id='epicker'; pick.className='epicker';
    EMOJIS.forEach(em=>{
      const b=document.createElement('button');
      b.className='e-btn'; b.textContent=em;
      b.addEventListener('click',e2=>{
        e2.stopPropagation();
        const t2=$('msg-ta');
        if (t2) {
          const s=t2.selectionStart, en=t2.selectionEnd;
          t2.value=t2.value.slice(0,s)+em+t2.value.slice(en);
          t2.selectionStart=t2.selectionEnd=s+em.length;
          t2.focus(); t2.dispatchEvent(new Event('input'));
        }
        pick.remove();
      });
      pick.appendChild(b);
    });
    document.querySelector('.chat-panel')?.appendChild(pick);
    setTimeout(()=>document.addEventListener('click',()=>pick.remove(),{once:true}), 10);
  });
}

/* ════════════════════════════════════════════
   BOOT
════════════════════════════════════════════ */
async function boot() {
  loadSettings();
  let url=SUPABASE_URL.trim(), key=SUPABASE_KEY.trim();
  if (!url||!key) {
    const saved=JSON.parse(localStorage.getItem(CFG_KEY)||'null');
    if (saved) { url=saved.url; key=saved.key; }
  }
  if (!url||!key) { showSetup(); return; }
  SB=supabase.createClient(url,key);
  const {error}=await SB.from('profiles').select('id').limit(1);
  if (error) { showSetup(); return; }
  const sess=JSON.parse(localStorage.getItem('nx_session')||'null');
  if (sess) {
    const {data:prof}=await SB.from('profiles').select('*').eq('username',sess.username).single();
    if (prof) { ME=prof; startApp(); return; }
  }
  showAuth();
}

boot();
