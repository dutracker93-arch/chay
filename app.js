/* ═══════════════════════════════════════════
   NEXUS CHAT — app.js
   ═══════════════════════════════════════════ */

const SUPABASE_URL  = 'https://tmfnmjciuoingrsbxnhr.supabase.co';
const SUPABASE_KEY  = 'sb_publishable_PPfG_ZYHhFQWiXBqRyDdbQ_3i1igdZ0';
const CFG_KEY       = 'nx_cfg_v3';
const SETTINGS_KEY  = 'nx_settings_v1';
const BLOCKS_KEY    = 'nx_blocks_v1';
const MAX_FILE_BYTES = 600 * 1024;

const COLORS = ['#5c6cf5','#34d399','#f97316','#ec4899','#0ea5e9','#a855f7','#ef4444','#eab308'];
const EMOJIS = ['😊','😂','❤️','👍','🎉','🔥','✨','😎','🤔','👋','🙏','😅','💯','🚀','😍','🥳','😇','🤩','💪','🎯','👌','🤝','💬','⚡','🌟','🎊','🙌','💡','📌','🎯','😜','🫶','👏','🤣','😭','💀','🔑','🎵','🍕','🌈','⭐','🎮','🏆','💎','🔥'];
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
const FILE_ICONS = {
  'pdf':'📄','doc':'📝','docx':'📝','xls':'📊','xlsx':'📊','ppt':'📋','pptx':'📋',
  'zip':'🗜️','rar':'🗜️','7z':'🗜️','mp3':'🎵','wav':'🎵','mp4':'🎬','mov':'🎬',
  'avi':'🎬','txt':'📃','js':'💻','py':'💻','html':'💻','css':'💻','json':'💻',
  'default':'📎'
};

let SB = null, ME = null, CHAT = null, TAB = 'chats', Q = '', realtimeSub = null;
let friends = [], requests = [], messages = {};
let SETTINGS = { theme:'dark', accent:'#5865f2', micId:'', speakerId:'', notifSound:true };
let mediaRecorder = null, audioChunks = [], recInterval = null, recSeconds = 0;
let currentAudio = null, ctxMenu = null;
let isStoppingRecording = false;
let voicePreviewDataUrl = null, voicePreviewAudio = null;
let onlineUsers = new Set();
let presenceChannel = null;
let profilePics = {}; // username -> dataUrl (in-memory cache from Supabase)
let blockedUsers = new Set(); // usernames blocked by ME (persisted in localStorage)

/* ── Utilities ── */
const clr = u => COLORS[u.split('').reduce((a,c)=>a+c.charCodeAt(0),0) % COLORS.length];
const ini  = n => n.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
const $    = id => document.getElementById(id);
const setHTML = html => { document.getElementById('app').innerHTML = html; };
const esc  = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const isMobile = () => window.innerWidth <= 640;

function ava(name, sz='', username='') {
  const pic = username ? profilePics[username] : null;
  const inner = pic ? `<img src="${pic}" alt="${esc(name)}">` : ini(name);
  return `<div class="ava${sz?' '+sz:''}" style="background:${clr(name)}">${inner}</div>`;
}

/* ── Block system (persisted per-user in localStorage) ── */
function loadBlocks() {
  const saved = JSON.parse(localStorage.getItem(BLOCKS_KEY) || '{}');
  blockedUsers = new Set(saved[ME?.username] || []);
}
function saveBlocks() {
  const saved = JSON.parse(localStorage.getItem(BLOCKS_KEY) || '{}');
  saved[ME.username] = [...blockedUsers];
  localStorage.setItem(BLOCKS_KEY, JSON.stringify(saved));
}
function isBlocked(username) { return blockedUsers.has(username); }
function doBlockUser(username) {
  blockedUsers.add(username);
  saveBlocks();
}
function doUnblockUser(username) {
  blockedUsers.delete(username);
  saveBlocks();
}

/* ── Load profile pictures from Supabase ── */
async function loadProfilePics() {
  const usernames = [...new Set([...(friends.map(f=>f.username)), ME?.username].filter(Boolean))];
  if (!usernames.length) return;
  const { data } = await SB.from('profiles').select('username,avatar_url').in('username', usernames);
  if (data) data.forEach(row => { if (row.avatar_url) profilePics[row.username] = row.avatar_url; });
}

/* ── fmtShort / fmtTime / fmtDate / fmtDuration / fmtBytes ── */
function fmtShort(ts){const d=new Date(ts),n=new Date(),diff=n-d;if(diff<60000)return 'now';if(diff<3600000)return Math.floor(diff/60000)+'m';if(d.toDateString()===n.toDateString())return d.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});return d.toLocaleDateString([],{month:'short',day:'numeric'});}
function fmtTime(ts){return new Date(ts).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});}
function fmtDate(ts){const d=new Date(ts),n=new Date();if(d.toDateString()===n.toDateString())return 'Today';const y=new Date(n);y.setDate(n.getDate()-1);if(d.toDateString()===y.toDateString())return 'Yesterday';return d.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric'});}
function fmtDuration(secs){const m=Math.floor(secs/60),s=secs%60;return `${m}:${String(s).padStart(2,'0')}`;}
function fmtBytes(b){if(b<1024)return b+'B';if(b<1024*1024)return(b/1024).toFixed(1)+'KB';return(b/1024/1024).toFixed(1)+'MB';}
function fileIcon(name){const ext=(name.split('.').pop()||'').toLowerCase();return FILE_ICONS[ext]||FILE_ICONS.default;}

function toast(msg, icon='✅') {
  const el=document.createElement('div');el.className='toast';
  el.innerHTML=`<span style="font-size:17px">${icon}</span><span>${msg}</span>`;
  document.body.appendChild(el);
  setTimeout(()=>{el.style.transition='opacity .25s,transform .25s';el.style.opacity='0';el.style.transform='translateY(12px)';setTimeout(()=>el.remove(),260);},2800);
}

async function hashPwd(p){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(p+'nx_salt_2024'));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}

/* ── Settings ── */
function loadSettings(){const s=JSON.parse(localStorage.getItem(SETTINGS_KEY)||'null');if(s)SETTINGS={...SETTINGS,...s};applySettings();}
function saveSettings(){localStorage.setItem(SETTINGS_KEY,JSON.stringify(SETTINGS));applySettings();}
function applySettings(){
  document.documentElement.dataset.theme=SETTINGS.theme;
  document.documentElement.style.setProperty('--accent',SETTINGS.accent);
  document.documentElement.style.setProperty('--accent-h',adjustColor(SETTINGS.accent,-22));
  document.documentElement.style.setProperty('--accent-lo',hexRgba(SETTINGS.accent,.18));
}
function hexRgba(hex,a){const r=parseInt(hex.slice(1,3),16),g=parseInt(hex.slice(3,5),16),b=parseInt(hex.slice(5,7),16);return `rgba(${r},${g},${b},${a})`;}
function adjustColor(hex,amt){const c=v=>Math.max(0,Math.min(255,parseInt(hex.slice(v,v+2),16)+amt)).toString(16).padStart(2,'0');return `#${c(1)}${c(3)}${c(5)}`;}

/* ════════════════════════════════════════════
   PRESENCE — real online / offline
   Uses Supabase Realtime Presence channel.
   Tracks when tab is hidden or closed.
════════════════════════════════════════════ */
function startPresence() {
  if (presenceChannel) SB.removeChannel(presenceChannel);

  presenceChannel = SB.channel('presence:global', {
    config: { presence: { key: ME.username } }
  });

  presenceChannel
    .on('presence', { event: 'sync' }, () => {
      onlineUsers = new Set(Object.keys(presenceChannel.presenceState()));
      updateOnlineUI();
    })
    .on('presence', { event: 'join' }, ({ key }) => { onlineUsers.add(key); updateOnlineUI(); })
    .on('presence', { event: 'leave' }, ({ key }) => { onlineUsers.delete(key); updateOnlineUI(); })
    .subscribe(async status => {
      if (status === 'SUBSCRIBED') {
        await presenceChannel.track({ username: ME.username, t: Date.now() });
      }
    });

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('beforeunload', onUnload);
  window.addEventListener('pagehide', onUnload);
}

async function onVisibility() {
  if (!presenceChannel) return;
  if (document.hidden) await presenceChannel.untrack();
  else await presenceChannel.track({ username: ME.username, t: Date.now() });
}
async function onUnload() {
  if (presenceChannel) await presenceChannel.untrack();
}

function stopPresence() {
  document.removeEventListener('visibilitychange', onVisibility);
  window.removeEventListener('beforeunload', onUnload);
  window.removeEventListener('pagehide', onUnload);
  if (presenceChannel) { SB.removeChannel(presenceChannel); presenceChannel = null; }
  onlineUsers.clear();
}

function isOnline(u) { return onlineUsers.has(u); }

function updateOnlineUI() {
  // Header status dot
  const statusEl = document.querySelector('.hdr-status');
  if (statusEl && CHAT) {
    const on = isOnline(CHAT);
    statusEl.textContent = on ? 'Online' : 'Offline';
    statusEl.className = 'hdr-status ' + (on ? 'online' : 'offline');
  }
  // Friends list dots (live update without re-render)
  document.querySelectorAll('[data-ustatus]').forEach(el => {
    const u = el.dataset.ustatus;
    const on = isOnline(u);
    el.textContent = on ? '● Online' : '○ Offline';
    el.style.color = on ? 'var(--green)' : 'var(--t3)';
  });
  // Conv list dots
  document.querySelectorAll('[data-udot]').forEach(el => {
    el.style.background = isOnline(el.dataset.udot) ? 'var(--green)' : 'var(--t4)';
  });
}

/* ════════════════════════════════════════════
   AVATAR EDITOR
   — Discord-style drag + zoom crop modal
   — Saves compressed JPEG to Supabase profiles.avatar_url
   — Requires: ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
════════════════════════════════════════════ */
function openAvatarEditor() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*';
  inp.onchange = () => {
    const file = inp.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => showCropModal(reader.result);
    reader.readAsDataURL(file);
  };
  inp.click();
}

function showCropModal(srcUrl) {
  document.getElementById('crop-overlay')?.remove();

  const div = document.createElement('div');
  div.className = 'overlay'; div.id = 'crop-overlay';
  div.innerHTML = `<div class="modal crop-modal">
    <h3>✂️ Adjust Profile Picture</h3>
    <div class="crop-stage" id="crop-stage">
      <img id="crop-img" src="${srcUrl}" draggable="false">
    </div>
    <p class="crop-hint">Drag to reposition · Scroll or pinch to zoom</p>
    <div class="crop-zoom-row">
      <span style="font-size:13px">🔍</span>
      <input type="range" id="crop-zoom" min="1" max="4" step="0.01" value="1">
      <span style="font-size:13px">🔎</span>
    </div>
    <div class="modal-row">
      <button class="btn-sec" id="crop-cancel">Cancel</button>
      <button class="btn-acc" id="crop-save">Save Picture</button>
    </div>
  </div>`;
  document.body.appendChild(div);

  const stage = $('crop-stage'), img = $('crop-img'), zoom = $('crop-zoom');
  let scale=1, ox=0, oy=0, dragging=false, startX, startY, startOx, startOy;
  let baseW=0, baseH=0;

  function applyT() { img.style.transform=`translate(calc(-50% + ${ox}px),calc(-50% + ${oy}px)) scale(${scale})`; }

  function initImageSize() {
    const stW=stage.offsetWidth, stH=stage.offsetHeight;
    const natW=img.naturalWidth, natH=img.naturalHeight;
    if(!natW||!natH) return;
    // Scale image to cover the circular stage area
    const cover=Math.max(stW/natW, stH/natH);
    baseW=natW*cover; baseH=natH*cover;
    img.style.width=baseW+'px';
    img.style.height=baseH+'px';
    applyT();
  }

  if(img.complete && img.naturalWidth) { initImageSize(); }
  else { img.addEventListener('load', initImageSize, {once:true}); }

  zoom.addEventListener('input',()=>{scale=parseFloat(zoom.value);applyT();});

  stage.addEventListener('mousedown',e=>{dragging=true;startX=e.clientX;startY=e.clientY;startOx=ox;startOy=oy;e.preventDefault();});
  window.addEventListener('mousemove',e=>{if(!dragging)return;ox=startOx+(e.clientX-startX);oy=startOy+(e.clientY-startY);applyT();});
  window.addEventListener('mouseup',()=>{dragging=false;});

  let lastDist=null;
  stage.addEventListener('touchstart',e=>{
    if(e.touches.length===1){dragging=true;startX=e.touches[0].clientX;startY=e.touches[0].clientY;startOx=ox;startOy=oy;}
    e.preventDefault();
  },{passive:false});
  stage.addEventListener('touchmove',e=>{
    if(e.touches.length===2){
      const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
      if(lastDist)scale=Math.max(1,Math.min(4,scale*(d/lastDist)));
      lastDist=d;zoom.value=scale;applyT();
    } else if(dragging&&e.touches.length===1){ox=startOx+(e.touches[0].clientX-startX);oy=startOy+(e.touches[0].clientY-startY);applyT();}
    e.preventDefault();
  },{passive:false});
  stage.addEventListener('touchend',()=>{dragging=false;lastDist=null;});
  stage.addEventListener('wheel',e=>{scale=Math.max(1,Math.min(4,scale-e.deltaY*0.003));zoom.value=scale;applyT();e.preventDefault();},{passive:false});

  $('crop-cancel').onclick=()=>div.remove();
  div.addEventListener('click',e=>{if(e.target===div)div.remove();});

  $('crop-save').onclick = async () => {
    const btn=$('crop-save'); btn.disabled=true; btn.textContent='Saving…';
    try {
      await new Promise(r=>{if(img.complete&&img.naturalWidth)r();else img.addEventListener('load',r,{once:true});});
      if(!baseW) initImageSize();

      const sz=200, canvas=document.createElement('canvas');
      canvas.width=sz; canvas.height=sz;
      const ctx=canvas.getContext('2d');
      ctx.beginPath(); ctx.arc(sz/2,sz/2,sz/2,0,Math.PI*2); ctx.clip();

      const stW=stage.offsetWidth, stH=stage.offsetHeight;
      const natW=img.naturalWidth, natH=img.naturalHeight;
      // Actual rendered size with current scale
      const rendW=baseW*scale, rendH=baseH*scale;
      // Top-left of rendered image in stage coordinates
      const imgL=stW/2+ox-rendW/2, imgT=stH/2+oy-rendH/2;
      // Source region in natural image coords (what is visible inside the stage)
      const srcX=(0-imgL)/rendW*natW, srcY=(0-imgT)/rendH*natH;
      const srcW=stW/rendW*natW, srcH=stH/rendH*natH;

      ctx.drawImage(img,srcX,srcY,srcW,srcH,0,0,sz,sz);
      const dataUrl=canvas.toDataURL('image/jpeg',0.88);

      const {error}=await SB.from('profiles').update({avatar_url:dataUrl}).eq('username',ME.username);
      if(error) throw new Error(error.message);

      profilePics[ME.username]=dataUrl;
      ME.avatar_url=dataUrl;
      div.remove();
      toast('Profile picture updated!','🖼️');
      renderApp();
    } catch(e) {
      toast('Failed to save: '+e.message,'❌');
      btn.disabled=false; btn.textContent='Save Picture';
    }
  };
}

/* ════════════════════════════════════════════
   SETUP SQL
   NOTE: If you already have the DB set up, just run:
   ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url text;
════════════════════════════════════════════ */
const SETUP_SQL=`-- Run ONCE in Supabase SQL Editor
drop table if exists messages;
drop table if exists friendships;
drop table if exists profiles;
create table profiles(
  id uuid primary key default gen_random_uuid(),
  username text unique not null,
  display_name text not null,
  password_hash text not null,
  avatar_url text,
  created_at timestamptz default now()
);
create table friendships(id uuid primary key default gen_random_uuid(),from_user text not null,to_user text not null,status text default 'pending',created_at timestamptz default now(),unique(from_user,to_user));
create table messages(id uuid primary key default gen_random_uuid(),from_user text not null,to_user text not null,content text not null,read boolean default false,created_at timestamptz default now());
alter publication supabase_realtime add table messages;
alter publication supabase_realtime add table friendships;
alter publication supabase_realtime add table profiles;
alter table profiles enable row level security;
alter table friendships enable row level security;
alter table messages enable row level security;
create policy "allow_all" on profiles for all using(true)with check(true);
create policy "allow_all" on friendships for all using(true)with check(true);
create policy "allow_all" on messages for all using(true)with check(true);`;

/* ════════════════ SETUP ════════════════════════════════════ */
function showSetup(){
  setHTML(`<div class="setup-wrap"><div class="setup-box">
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
    <div class="f-group"><label>Supabase Project URL</label><input id="s-url" placeholder="https://xxxx.supabase.co" autocomplete="off"/></div>
    <div class="f-group"><label>Supabase Anon Key</label><input id="s-key" placeholder="eyJhbGci..." autocomplete="off"/></div>
    <div id="setup-msg"></div>
    <button class="btn-auth" id="btn-setup">Test Connection & Continue →</button>
    <div class="setup-tip"><strong>Tip:</strong> To skip this screen, set <code>SUPABASE_URL</code> and <code>SUPABASE_KEY</code> in <code>app.js</code>.</div>
  </div></div>`);
  $('sql-toggle').onclick=()=>{const a=$('sql-area');a.style.display=a.style.display==='none'?'block':'none';};
  $('copy-sql').onclick=()=>navigator.clipboard.writeText(SETUP_SQL).then(()=>toast('SQL copied!','📋'));
  $('btn-setup').onclick=doSetup;
  ['s-url','s-key'].forEach(id=>$(id)?.addEventListener('keydown',e=>{if(e.key==='Enter')doSetup();}));
}
async function doSetup(){
  const url=$('s-url').value.trim().replace(/\/$/,''),key=$('s-key').value.trim(),msgEl=$('setup-msg');
  if(!url||!key){msgEl.innerHTML='<div class="alert err">Please fill in both fields</div>';return;}
  if(!url.startsWith('https://')){msgEl.innerHTML='<div class="alert err">URL must start with https://</div>';return;}
  const btn=$('btn-setup');btn.disabled=true;btn.textContent='Testing...';
  try{
    const client=supabase.createClient(url,key);
    const {error}=await client.from('profiles').select('id').limit(1);
    if(error)throw new Error(error.message);
    localStorage.setItem(CFG_KEY,JSON.stringify({url,key}));
    SB=client;btn.textContent='✅ Connected!';toast('Connected!','✅');
    setTimeout(()=>showAuth(),900);
  }catch(e){
    msgEl.innerHTML=`<div class="alert err">Failed: ${e.message}</div>`;
    btn.disabled=false;btn.textContent='Test Connection & Continue →';
  }
}

/* ════════════════ AUTH ════════════════════════════════════ */
function showAuth(mode='login'){
  setHTML(`<div class="auth-wrap"><div class="auth-box">
    <div class="auth-logo"><div class="auth-logo-icon"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg></div><span>Nexus</span></div>
    <div id="auth-body">${mode==='login'?loginForm():signupForm()}</div>
  </div></div>`);
  bindAuth();
}
function loginForm(){return `<h2 class="auth-title">Welcome back</h2><p class="auth-sub">Sign in to continue</p><div id="amsg"></div><div class="f-group"><label>Username</label><input id="ain-u" placeholder="your username" autocomplete="username"/></div><div class="f-group"><label>Password</label><input id="ain-p" type="password" placeholder="••••••••"/></div><button class="btn-auth" id="btn-auth">Sign In</button><p class="auth-switch">No account? <a id="sw">Create one</a></p>`;}
function signupForm(){return `<h2 class="auth-title">Create account</h2><p class="auth-sub">Join Nexus — it's free</p><div id="amsg"></div><div class="f-group"><label>Display Name</label><input id="ain-n" placeholder="Your name"/></div><div class="f-group"><label>Username</label><input id="ain-u" placeholder="letters, numbers, _ only"/></div><div class="f-group"><label>Password</label><input id="ain-p" type="password" placeholder="at least 6 characters"/></div><button class="btn-auth" id="btn-auth">Create Account</button><p class="auth-switch">Have an account? <a id="sw">Sign in</a></p>`;}
function amsg(html,cls){const el=$('amsg');if(el)el.innerHTML=`<div class="alert ${cls}">${html}</div>`;}
function bindAuth(){
  const isLogin=!$('ain-n');
  $('sw')?.addEventListener('click',()=>showAuth(isLogin?'signup':'login'));
  $('btn-auth')?.addEventListener('click',isLogin?doLogin:doSignup);
  ['ain-u','ain-p','ain-n'].forEach(id=>$(id)?.addEventListener('keydown',e=>{if(e.key==='Enter'){isLogin?doLogin():doSignup();}}));
  $('ain-u')?.focus();
}
async function doLogin(){
  const u=$('ain-u')?.value.trim().toLowerCase(),p=$('ain-p')?.value;
  if(!u||!p){amsg('Please fill in both fields','err');return;}
  const btn=$('btn-auth');btn.disabled=true;btn.textContent='Signing in...';
  const {data,error}=await SB.from('profiles').select('*').eq('username',u).single();
  if(error||!data){amsg('Username not found','err');btn.disabled=false;btn.textContent='Sign In';return;}
  const hash=await hashPwd(p);
  if(data.password_hash!==hash){amsg('Wrong password','err');btn.disabled=false;btn.textContent='Sign In';return;}
  ME=data;
  if(ME.avatar_url) profilePics[ME.username]=ME.avatar_url;
  localStorage.setItem('nx_session',JSON.stringify({username:u}));
  startApp();
}
async function doSignup(){
  const n=$('ain-n')?.value.trim(),u=$('ain-u')?.value.trim().toLowerCase(),p=$('ain-p')?.value;
  if(!n||!u||!p){amsg('Please fill in all fields','err');return;}
  if(p.length<6){amsg('Password needs at least 6 characters','err');return;}
  if(!/^[a-z0-9_]+$/.test(u)){amsg('Username: only letters, numbers, underscores','err');return;}
  if(u.length<3||u.length>20){amsg('Username must be 3–20 characters','err');return;}
  const btn=$('btn-auth');btn.disabled=true;btn.textContent='Checking...';
  const {data:ex}=await SB.from('profiles').select('id').eq('username',u).single();
  if(ex){amsg('Username taken','err');btn.disabled=false;btn.textContent='Create Account';return;}
  btn.textContent='Creating...';
  const hash=await hashPwd(p);
  const {data,error}=await SB.from('profiles').insert({username:u,display_name:n,password_hash:hash}).select().single();
  if(error){amsg('Error: '+error.message,'err');btn.disabled=false;btn.textContent='Create Account';return;}
  ME=data;
  localStorage.setItem('nx_session',JSON.stringify({username:u}));
  toast('Welcome to Nexus! 🎉','🎉');
  startApp();
}

/* ════════════════ BOOT / DATA ════════════════════════════ */
async function startApp(){
  setHTML(`<div class="loading"><div class="spin"></div><p>Loading your chats…</p></div>`);
  loadBlocks();
  await loadData();
  await loadProfilePics();
  renderApp();
  subscribeRealtime();
  startPresence();
}
async function loadData(){
  const u=ME.username;
  const {data:fr1}=await SB.from('friendships').select('*').eq('from_user',u).eq('status','accepted');
  const {data:fr2}=await SB.from('friendships').select('*').eq('to_user',u).eq('status','accepted');
  const frSet=new Set([...(fr1||[]).map(r=>r.to_user),...(fr2||[]).map(r=>r.from_user)]);
  friends=[];
  if(frSet.size>0){
    const {data:p}=await SB.from('profiles').select('username,display_name,avatar_url').in('username',[...frSet]);
    friends=(p||[]);
    friends.forEach(f=>{if(f.avatar_url)profilePics[f.username]=f.avatar_url;});
  }
  const {data:reqs}=await SB.from('friendships').select('*').or(`from_user.eq.${u},to_user.eq.${u}`).eq('status','pending');
  requests=reqs||[];
  messages={};
  for(const f of friends){
    const {data:msgs}=await SB.from('messages').select('*')
      .or(`and(from_user.eq.${u},to_user.eq.${f.username}),and(from_user.eq.${f.username},to_user.eq.${u})`)
      .order('created_at',{ascending:true});
    messages[f.username]=msgs||[];
  }
}
async function loadMessages(fr){
  const u=ME.username;
  const {data:msgs}=await SB.from('messages').select('*')
    .or(`and(from_user.eq.${u},to_user.eq.${fr}),and(from_user.eq.${fr},to_user.eq.${u})`)
    .order('created_at',{ascending:true});
  messages[fr]=msgs||[];
  // Mark as read locally right away so the badge clears immediately
  messages[fr]=messages[fr].map(m=>m.to_user===u&&!m.read?{...m,read:true}:m);
  refreshConvList();
  // Persist read status to DB (fire-and-forget)
  SB.from('messages').update({read:true}).eq('to_user',u).eq('from_user',fr).eq('read',false);
}
function subscribeRealtime(){
  if(realtimeSub)SB.removeChannel(realtimeSub);
  realtimeSub=SB.channel('nx-'+ME.username)
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'messages'},p=>{
      const msg=p.new,u=ME.username;
      if(msg.from_user!==u&&msg.to_user!==u)return;
      // Ignore messages from blocked users
      if(isBlocked(msg.from_user)||isBlocked(msg.to_user))return;
      const other=msg.from_user===u?msg.to_user:msg.from_user;
      if(!messages[other])messages[other]=[];
      if(!messages[other].find(m=>m.id===msg.id))messages[other].push(msg);
      if(CHAT===other){
        if(msg.from_user!==u){
          // Mark read locally and in DB immediately
          const idx=messages[other].findIndex(m=>m.id===msg.id);
          if(idx!==-1)messages[other][idx]={...messages[other][idx],read:true};
          SB.from('messages').update({read:true}).eq('id',msg.id);
        }
        refreshMsgs();
      } else {
        refreshConvList();
        if(msg.from_user!==u)toast(`New message from @${msg.from_user}`,'💬');
      }
    })
    // Live read-receipt updates → blue ticks for sender
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'messages'},p=>{
      const msg=p.new,u=ME.username;
      if(msg.from_user!==u&&msg.to_user!==u)return;
      const other=msg.from_user===u?msg.to_user:msg.from_user;
      if(messages[other]){
        const idx=messages[other].findIndex(m=>m.id===msg.id);
        if(idx!==-1){
          messages[other][idx]={...messages[other][idx],...msg};
          if(CHAT===other)refreshMsgs();
          else refreshConvList();
        }
      }
    })
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'friendships'},p=>{
      if(p.new.status==='accepted'){loadData().then(async()=>{await loadProfilePics();renderApp();});toast('Friend request accepted! 🎉','🎉');}
    })
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'friendships'},p=>{
      if(p.new.to_user===ME.username){loadData().then(async()=>{await loadProfilePics();renderApp();});toast(`Friend request from @${p.new.from_user}`,'👋');}
    })
    // Real-time message deletion — remove from peer's screen immediately
    .on('postgres_changes',{event:'DELETE',schema:'public',table:'messages'},p=>{
      const msgId=p.old?.id;if(!msgId)return;
      for(const [friend,msgs] of Object.entries(messages)){
        const idx=msgs.findIndex(m=>m.id===msgId);
        if(idx!==-1){
          messages[friend]=msgs.filter(m=>m.id!==msgId);
          if(CHAT===friend)refreshMsgs();else refreshConvList();
          break;
        }
      }
    })
    // Live avatar updates from other users
    .on('postgres_changes',{event:'UPDATE',schema:'public',table:'profiles'},p=>{
      if(p.new.avatar_url&&p.new.username!==ME.username){
        profilePics[p.new.username]=p.new.avatar_url;
        // Update any rendered avatars inline
        document.querySelectorAll(`.ava[data-uname="${p.new.username}"] img`).forEach(img=>{img.src=p.new.avatar_url;});
      }
    })
    .subscribe();
}

/* ════════════════ RENDER ════════════════════════════════════ */
function renderApp(){
  const mobileChat=CHAT&&isMobile();
  setHTML(`<div class="shell${mobileChat?' chat-active':''}">${renderSidebar()}${CHAT?renderChatPanel():renderEmptyPanel()}</div>`);
  bindApp();
}

function renderSidebar(){
  const inc=requests.filter(r=>r.to_user===ME.username);
  const unr=friends.reduce((s,f)=>s+(messages[f.username]||[]).filter(m=>m.from_user!==ME.username&&!m.read).length,0);
  return `<div class="sidebar">
    <div class="sb-top">
      <div class="me-row">
        <div class="ava-wrap">
          ${ava(ME.display_name,'',ME.username)}
          <button class="ava-edit-btn" id="btn-edit-avatar" title="Change profile picture">✏️</button>
        </div>
        <div class="me-info">
          <div class="me-name">${esc(ME.display_name)}</div>
          <div class="me-handle">@${ME.username}</div>
        </div>
        <button class="logout-btn" id="btn-logout" title="Sign out">⏏</button>
      </div>
      <div class="tabs">
        <button class="tab ${TAB==='chats'?'on':''}" id="t-chats">💬 Chats ${unr>0?`<span class="chip">${unr}</span>`:''}</button>
        <button class="tab ${TAB==='friends'?'on':''}" id="t-friends">👥 Friends ${inc.length>0?`<span class="chip">${inc.length}</span>`:''}</button>
        <button class="tab ${TAB==='settings'?'on':''}" id="t-settings">⚙️</button>
      </div>
    </div>
    ${TAB==='chats'?renderConvPanel():TAB==='friends'?renderFrPanel():renderSettingsPanel()}
  </div>`;
}

function renderConvPanel(){
  const fil=friends.filter(f=>!Q||f.username.includes(Q.toLowerCase())||f.display_name.toLowerCase().includes(Q.toLowerCase()));
  return `<div class="sb-search"><span class="si">🔍</span><input id="q-in" placeholder="Search…" value="${esc(Q)}"/></div>
    <div class="conv-list" id="conv-list">
      ${fil.length===0
        ?`<div class="empty-state">${friends.length===0?'No friends yet.<br>Go to Friends tab to add someone.':'No matches.'}</div>`
        :fil.map(f=>{
          const msgs=messages[f.username]||[],last=msgs[msgs.length-1];
          const unr=msgs.filter(m=>m.from_user!==ME.username&&!m.read).length;
          const preview=last?previewContent(last):'Start chatting…';
          const pre=last&&last.from_user===ME.username?'You: ':'';
          const online=isOnline(f.username);
          return `<div class="conv-item${CHAT===f.username?' active':''}" data-fr="${f.username}">
            <div style="position:relative;flex-shrink:0">
              ${ava(f.display_name,'sm',f.username)}
              <span data-udot="${f.username}" style="position:absolute;bottom:-1px;right:-1px;width:11px;height:11px;border-radius:50%;background:${online?'var(--green)':'var(--t4)'};border:2px solid var(--c-sidebar);display:block"></span>
            </div>
            <div class="conv-body">
              <div class="conv-name">${esc(f.display_name)}</div>
              <div class="conv-last">${pre}${preview}</div>
            </div>
            <div class="conv-meta">
              ${last?`<span class="conv-time">${fmtShort(last.created_at)}</span>`:''}
              ${unr>0?`<span class="unread-dot">${unr}</span>`:''}
            </div>
          </div>`;
        }).join('')}
    </div>`;
}

function previewContent(msg){
  const c=msg.content;
  if(c.startsWith('[voice]'))return '🎤 Voice message';
  if(c.startsWith('[img]'))return '🖼️ Image';
  if(c.startsWith('[file:'))return `📎 ${c.slice(6,c.indexOf(']'))}`;
  return esc(c.slice(0,60));
}

function renderFrPanel(){
  const inc=requests.filter(r=>r.to_user===ME.username);
  const out=requests.filter(r=>r.from_user===ME.username);
  return `<div class="fr-panel">
    <button class="add-fr-btn" id="btn-add-fr">➕ Add Friend by Username</button>
    ${inc.length?`<div class="sec-lbl">Incoming (${inc.length})</div>${inc.map(r=>`<div class="fr-row">
      ${ava(r.from_user,'sm')}
      <div class="fr-info"><div class="fr-name">@${r.from_user}</div><div class="fr-sub">wants to be friends</div></div>
      <span class="tag in">Incoming</span>
      <div class="fr-acts">
        <button class="act-btn ok" data-accept="${r.from_user}" title="Accept">✓</button>
        <button class="act-btn no" data-decline="${r.id}" title="Decline">✕</button>
      </div>
    </div>`).join('')}`:''}
    ${out.length?`<div class="sec-lbl">Sent</div>${out.map(r=>`<div class="fr-row">
      ${ava(r.to_user,'sm')}
      <div class="fr-info"><div class="fr-name">@${r.to_user}</div><div class="fr-sub">waiting…</div></div>
      <span class="tag out">Pending</span>
    </div>`).join('')}`:''}
    ${friends.length?`<div class="sec-lbl">Friends (${friends.length})</div>${friends.map(f=>`<div class="fr-row">
      ${ava(f.display_name,'sm',f.username)}
      <div class="fr-info">
        <div class="fr-name">${esc(f.display_name)}</div>
        <div class="fr-sub" data-ustatus="${f.username}" style="color:${isOnline(f.username)?'var(--green)':'var(--t3)'}">${isOnline(f.username)?'● Online':'○ Offline'}</div>
      </div>
      <div class="fr-acts"><button class="act-btn go" data-chat="${f.username}" title="Message">💬</button></div>
    </div>`).join('')}`:`<div class="empty-state">No friends yet!<br>Use the button above to add someone.</div>`}
  </div>`;
}

function renderSettingsPanel(){
  const swatches=ACCENT_COLORS.map(c=>`<div class="swatch${SETTINGS.accent===c.value?' active':''}" data-color="${c.value}" title="${c.name}" style="background:${c.value}"></div>`).join('');
  return `<div class="settings-panel" id="settings-panel">
    <div class="set-section">
      <div class="set-section-title">Appearance</div>
      <div class="set-row"><div><div class="set-row-label">Theme</div><div class="set-row-sub">Colour mode</div></div>
        <div class="set-row-right"><select class="set-select" id="set-theme">
          <option value="dark" ${SETTINGS.theme==='dark'?'selected':''}>🌙 Dark</option>
          <option value="light" ${SETTINGS.theme==='light'?'selected':''}>☀️ Light</option>
        </select></div>
      </div>
      <div class="set-row" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div class="set-row-label">Accent Colour</div>
        <div class="color-swatches">${swatches}</div>
      </div>
    </div>
    <div class="set-section">
      <div class="set-section-title">Audio Devices</div>
      <div class="set-row"><div><div class="set-row-label">🎤 Microphone</div></div>
        <div class="set-row-right"><select class="set-select" id="set-mic"><option value="">Default</option></select></div>
      </div>
      <div class="set-row"><div><div class="set-row-label">🔊 Speaker</div></div>
        <div class="set-row-right"><select class="set-select" id="set-speaker"><option value="">Default</option></select></div>
      </div>
    </div>
    <div class="set-section">
      <div class="set-section-title">Notifications</div>
      <div class="set-row"><div><div class="set-row-label">Sound Alerts</div></div>
        <div class="set-row-right"><label class="toggle"><input type="checkbox" id="set-notif" ${SETTINGS.notifSound?'checked':''}><span class="toggle-slider"></span></label></div>
      </div>
    </div>
  </div>`;
}

function renderEmptyPanel(){return `<div class="chat-panel" style="display:flex;align-items:center;justify-content:center"><div class="no-chat"><div class="no-chat-icon">⚡</div><h2>Nexus Chat</h2><p>Select a conversation or add a friend to get started</p></div></div>`;}

function renderChatPanel(){
  const fr=friends.find(f=>f.username===CHAT);if(!fr)return renderEmptyPanel();
  const online=isOnline(fr.username);
  return `<div class="chat-panel" style="position:relative">
    <div class="chat-hdr">
      <button class="back-btn" id="btn-back">‹</button>
      ${ava(fr.display_name,'md',fr.username)}
      <div class="hdr-info">
        <div class="hdr-name">${esc(fr.display_name)}</div>
        <div class="hdr-status ${online?'online':'offline'}">${online?'Online':'Offline'}</div>
      </div>
      <div class="hdr-btns">
        <button class="hdr-btn" id="btn-profile-dots" title="View profile">⋮</button>
      </div>
    </div>
    <div class="msgs" id="msgs">${renderMsgList(messages[CHAT]||[])}</div>
    <div class="input-zone">
      <div class="input-box" id="input-box">
        <button class="ia-btn" id="attach-btn" title="Attach file">📎</button>
        <textarea class="msg-ta" id="msg-ta" placeholder="Message ${esc(fr.display_name)}…" rows="1"></textarea>
        <div class="ia">
          <button class="ia-btn" id="emoji-btn" title="Emoji"><img src="emoji.png" class="ia-img" alt="emoji"></button>
          <button class="voice-rec-btn" id="voice-btn" title="Record voice message"><img src="mic.png" class="ia-img" alt="mic"></button>
          <button class="send-btn" id="send-btn" title="Send">
            <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
          </button>
        </div>
      </div>
    </div>
    <input type="file" id="file-input" style="display:none" accept="*/*" multiple>
    <input type="file" id="img-input" style="display:none" accept="image/*,video/*">
  </div>`;
}

/* ── Message list ── */
function renderMsgList(msgs){
  // Filter out messages sent by blocked users (but keep your own outgoing messages)
  msgs = msgs.filter(m => m.from_user === ME.username || !isBlocked(m.from_user));
  if(!msgs.length)return `<div style="text-align:center;color:var(--t3);font-size:13px;padding:48px 0">No messages yet — say hello 👋</div>`;
  let html='',lastDate='';
  for(let i=0;i<msgs.length;i++){
    const m=msgs[i],isOut=m.from_user===ME.username;
    const d=new Date(m.created_at).toDateString();
    if(d!==lastDate){html+=`<div class="date-sep">${fmtDate(m.created_at)}</div>`;lastDate=d;}
    const showAva=!isOut&&(i===msgs.length-1||msgs[i+1]?.from_user===ME.username);
    const showLbl=!isOut&&(i===0||msgs[i-1]?.from_user===ME.username);
    const fr=friends.find(f=>f.username===m.from_user);
    const name=fr?fr.display_name:m.from_user;
    const safeContent=esc(m.content).replace(/'/g,'&#39;');
    html+=`<div class="msg-row${isOut?' out':''}" data-mid="${m.id}" data-own="${isOut}" data-content="${safeContent}">
      ${!isOut?(showAva?`<div class="ava-wrap">${ava(name,'sm',m.from_user)}</div>`:`<div class="msg-ava-spacer"></div>`):''}
      <div>
        ${showLbl&&!isOut?`<div class="sender-lbl">${esc(name)}</div>`:''}
        <div class="bubble ${isOut?'out':'in'}">
          ${renderBubbleContent(m)}
          <div class="msg-time">${fmtTime(m.created_at)}${isOut?`<span class="ticks${m.read?' read':''}">✓✓</span>`:''}</div>
        </div>
      </div>
    </div>`;
  }
  return html;
}
function renderBubbleContent(m){
  const c=m.content;
  if(c.startsWith('[voice]'))return renderVoiceBubble(c,m.id);
  if(c.startsWith('[img]'))return renderImgBubble(c.slice(5));
  if(c.startsWith('[file:'))return renderFileBubble(c);
  return esc(c);
}
function renderVoiceBubble(content,id){
  const b64=content.slice(7),sid='vp-'+id.replace(/-/g,'');
  return `<div class="voice-msg"><button class="voice-play-btn" id="${sid}" data-src="${b64}" onclick="playVoice('${sid}')">▶</button><div class="voice-waveform">${Array.from({length:8},(_,i)=>`<div class="voice-bar paused" id="${sid}-b${i}"></div>`).join('')}</div><span class="voice-duration" id="${sid}-dur">0:00</span></div>`;
}
function renderImgBubble(src){return `<div class="msg-img-wrap"><img src="${src}" loading="lazy" alt="Image" style="cursor:pointer" onclick="window.open('${src.slice(0,300).replace(/'/g,'%27')}','_blank')" onerror="this.style.display='none'"></div>`;}
function renderFileBubble(content){
  const inner=content.slice(6),bracket=inner.indexOf(']'),meta=inner.slice(0,bracket),data=inner.slice(bracket+1),parts=meta.split('|'),fname=parts[0]||'file',fsize=parts[1]||'';
  return `<a class="msg-file-card" href="${data}" download="${esc(fname)}" onclick="event.stopPropagation()"><span class="file-icon">${fileIcon(fname)}</span><div class="file-meta"><div class="file-name">${esc(fname)}</div>${fsize?`<div class="file-size">${fsize}</div>`:''}</div></a>`;
}

function refreshMsgs(){
  const area=$('msgs');
  if(!area||!CHAT){refreshConvList();return;}
  const msgs=(messages[CHAT]||[]).filter(m=>m.from_user===ME.username||!isBlocked(m.from_user));
  const rendered=area.querySelectorAll('[data-mid]');
  const renderedIds=[...rendered].map(el=>el.dataset.mid);
  const msgIds=msgs.map(m=>m.id);
  // If same set of messages, just patch ticks in-place — no re-render, no flash
  if(renderedIds.length===msgs.length&&renderedIds.every((id,i)=>id===msgIds[i])){
    rendered.forEach(row=>{
      const msg=msgs.find(m=>m.id===row.dataset.mid);
      if(msg&&row.dataset.own==='true'){
        const ticks=row.querySelector('.ticks');
        if(ticks)ticks.className='ticks'+(msg.read?' read':'');
      }
    });
    refreshConvList();bindMsgRows();return;
  }
  // New or removed messages — re-render but preserve scroll position
  const wasNearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<120;
  const prevScroll=area.scrollTop;
  area.innerHTML=renderMsgList(msgs);
  area.scrollTop=wasNearBottom?area.scrollHeight:prevScroll;
  refreshConvList();bindMsgRows();
}
function refreshConvList(){
  const cl=$('conv-list');if(!cl)return;
  const scrollTop=cl.scrollTop;
  const tmp=document.createElement('div');tmp.innerHTML=renderConvPanel();
  const nl=tmp.querySelector('#conv-list');
  if(nl){cl.innerHTML=nl.innerHTML;cl.scrollTop=scrollTop;bindConvItems();}
}

/* ════════════════ CONTEXT MENU ═══════════════════════════ */
function closeCtxMenu(){if(ctxMenu){ctxMenu.remove();ctxMenu=null;}}
function showMsgMenu(e,msgId,isOwn,rawContent){
  e.preventDefault();closeCtxMenu();document.getElementById('epicker')?.remove();
  const menu=document.createElement('div');menu.className='ctx-menu';ctxMenu=menu;
  const isVoice=rawContent.startsWith('[voice]'),isImg=rawContent.startsWith('[img]'),isFile=rawContent.startsWith('[file:'),isText=!isVoice&&!isImg&&!isFile;
  const items=[];
  if(isText)items.push({icon:'📋',label:'Copy',action:()=>navigator.clipboard.writeText(rawContent).then(()=>toast('Copied','📋'))});
  items.push({icon:'↗️',label:'Forward',action:()=>openForwardModal(rawContent)});
  if(isOwn){items.push({sep:true});items.push({icon:'🗑️',label:'Delete',cls:'danger',action:()=>deleteMsg(msgId)});}
  items.forEach(item=>{
    if(item.sep){const sep=document.createElement('div');sep.className='ctx-sep';menu.appendChild(sep);return;}
    const btn=document.createElement('button');btn.className='ctx-item'+(item.cls?' '+item.cls:'');
    btn.innerHTML=`<span>${item.icon}</span><span>${item.label}</span>`;
    btn.onclick=()=>{closeCtxMenu();item.action();};menu.appendChild(btn);
  });
  document.body.appendChild(menu);
  const vw=window.innerWidth,vh=window.innerHeight,mw=menu.offsetWidth||170,mh=menu.offsetHeight||120;
  let x=e.clientX,y=e.clientY;if(x+mw>vw)x=vw-mw-8;if(y+mh>vh)y=vh-mh-8;if(x<8)x=8;if(y<8)y=8;
  menu.style.left=x+'px';menu.style.top=y+'px';
  setTimeout(()=>document.addEventListener('click',closeCtxMenu,{once:true}),10);
}
async function deleteMsg(msgId){
  const {error}=await SB.from('messages').delete().eq('id',msgId).eq('from_user',ME.username);
  if(!error){if(messages[CHAT])messages[CHAT]=messages[CHAT].filter(m=>m.id!==msgId);refreshMsgs();toast('Message deleted','🗑️');}
  else toast('Could not delete','❌');
}
function openForwardModal(content){
  const other=friends.filter(f=>f.username!==CHAT);if(!other.length){toast('No other friends to forward to','😅');return;}
  const div=document.createElement('div');div.className='overlay';div.id='overlay';
  div.innerHTML=`<div class="modal"><h3>↗️ Forward Message</h3><p>Choose who to forward this to:</p>
    <div class="fwd-friend-list">${other.map(f=>`<button class="fwd-friend" data-username="${f.username}">${ava(f.display_name,'sm',f.username)}<span>${esc(f.display_name)}</span></button>`).join('')}</div>
    <div class="modal-row"><button class="btn-sec" id="fwd-cancel">Cancel</button></div></div>`;
  document.body.appendChild(div);
  $('fwd-cancel').onclick=()=>div.remove();
  div.addEventListener('click',e=>{if(e.target===div)div.remove();});
  div.querySelectorAll('.fwd-friend').forEach(btn=>{btn.addEventListener('click',async()=>{div.remove();const to=btn.dataset.username;await SB.from('messages').insert({from_user:ME.username,to_user:to,content,read:false});toast(`Forwarded to ${to}`,'↗️');});});
}
/* ════════════════ USER PROFILE PANEL ══════════════════════ */
function showUserProfile(username) {
  document.getElementById('user-profile-panel')?.remove();
  const fr = friends.find(f => f.username === username);
  if (!fr) return;
  const online = isOnline(username);
  const msgs = messages[username] || [];
  const mediaItems = msgs.filter(m => m.content.startsWith('[img]')).slice(-12);
  const mediaGrid = mediaItems.length
    ? `<div class="prof-media-grid">${mediaItems.map(m=>{
        const src = m.content.slice(5);
        return `<div class="prof-media-thumb" onclick="window.open('${src.slice(0,300).replace(/'/g,'%27')}','_blank')"><img src="${src}" loading="lazy" alt="media"></div>`;
      }).join('')}</div>`
    : `<div class="prof-media-empty">No media shared yet</div>`;

  const panel = document.createElement('div');
  panel.id = 'user-profile-panel';
  panel.className = 'user-prof-panel';
  panel.innerHTML = `
    <div class="prof-header-bar">
      <button class="prof-close-btn" id="prof-close">✕</button>
      <span class="prof-header-title">Contact Info</span>
    </div>
    <div class="prof-scroll">
      <div class="prof-hero">
        <div class="prof-ava-wrap">
          ${ava(fr.display_name, 'xl', fr.username)}
        </div>
        <div class="prof-name">${esc(fr.display_name)}</div>
        <div class="prof-username">@${esc(fr.username)}</div>
        <div class="prof-status-badge ${online?'online':'offline'}">${online?'● Online':'● Offline'}</div>
      </div>
      <div class="prof-section">
        <div class="prof-section-title">MEDIA SHARED</div>
        ${mediaGrid}
      </div>
      <div class="prof-section prof-actions">
        ${isBlocked(username)
          ? `<button class="prof-action-btn" id="prof-block-btn" style="background:var(--accent-lo);color:var(--accent)"><span>✅</span> Unblock ${esc(fr.display_name)}</button>`
          : `<button class="prof-action-btn danger" id="prof-block-btn"><span>🚫</span> Block ${esc(fr.display_name)}</button>`
        }
      </div>
    </div>`;

  const chatPanel = document.querySelector('.chat-panel');
  if (chatPanel) chatPanel.appendChild(panel);
  else document.body.appendChild(panel);

  requestAnimationFrame(() => panel.classList.add('open'));

  $('prof-close').onclick = () => { panel.classList.remove('open'); setTimeout(()=>panel.remove(), 280); };
  $('prof-block-btn').onclick = () => {
    if (isBlocked(username)) confirmUnblock(username, fr.display_name, panel);
    else confirmBlock(username, fr.display_name, panel);
  };
}

function confirmBlock(username, displayName, panel) {
  const div = document.createElement('div');
  div.className = 'overlay'; div.id = 'block-confirm-overlay';
  div.innerHTML = `<div class="modal">
    <h3>🚫 Block ${esc(displayName)}?</h3>
    <p>Their messages will be hidden from you, and yours won't be visible to them. They stay in your friends list. You can unblock them anytime from their profile.</p>
    <div class="modal-row">
      <button class="btn-sec" id="block-cancel">Cancel</button>
      <button class="btn-acc" style="background:var(--red)" id="block-confirm">Block</button>
    </div>
  </div>`;
  document.body.appendChild(div);
  $('block-cancel').onclick = () => div.remove();
  div.addEventListener('click', e => { if(e.target===div) div.remove(); });
  $('block-confirm').onclick = () => {
    div.remove();
    panel.classList.remove('open');
    setTimeout(() => panel.remove(), 280);
    doBlockUser(username);
    toast(`@${username} has been blocked`, '🚫');
    renderApp();
  };
}

function confirmUnblock(username, displayName, panel) {
  const div = document.createElement('div');
  div.className = 'overlay'; div.id = 'block-confirm-overlay';
  div.innerHTML = `<div class="modal">
    <h3>✅ Unblock ${esc(displayName)}?</h3>
    <p>You'll be able to see each other's messages again.</p>
    <div class="modal-row">
      <button class="btn-sec" id="block-cancel">Cancel</button>
      <button class="btn-acc" id="block-confirm">Unblock</button>
    </div>
  </div>`;
  document.body.appendChild(div);
  $('block-cancel').onclick = () => div.remove();
  div.addEventListener('click', e => { if(e.target===div) div.remove(); });
  $('block-confirm').onclick = () => {
    div.remove();
    panel.classList.remove('open');
    setTimeout(() => panel.remove(), 280);
    doUnblockUser(username);
    toast(`@${username} has been unblocked`, '✅');
    renderApp();
  };
}

function bindMsgRows(){
  document.querySelectorAll('.msg-row[data-mid]').forEach(row=>{
    const msgId=row.dataset.mid,isOwn=row.dataset.own==='true';
    const rawContent=row.dataset.content.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
    row.addEventListener('contextmenu',e=>showMsgMenu(e,msgId,isOwn,rawContent));
    let lpt=null;
    row.addEventListener('touchstart',e=>{lpt=setTimeout(()=>{const t=e.touches[0];showMsgMenu({preventDefault:()=>{},clientX:t.clientX,clientY:t.clientY},msgId,isOwn,rawContent);},600);},{passive:true});
    row.addEventListener('touchend',()=>clearTimeout(lpt));row.addEventListener('touchmove',()=>clearTimeout(lpt));
  });
}

/* ════════════════ VOICE ════════════════════════════════════ */
function getSupportedMimeType(){return['audio/webm;codecs=opus','audio/webm','audio/ogg;codecs=opus','audio/mp4'].find(t=>MediaRecorder.isTypeSupported(t))||'';}
async function startRecording(){
  try{
    const constraints={audio:SETTINGS.micId?{deviceId:{exact:SETTINGS.micId}}:true};
    const stream=await navigator.mediaDevices.getUserMedia(constraints);
    audioChunks=[];recSeconds=0;
    mediaRecorder=new MediaRecorder(stream,{mimeType:getSupportedMimeType()});
    mediaRecorder.ondataavailable=e=>{if(e.data.size>0)audioChunks.push(e.data);};
    mediaRecorder.start(100);
    const inputBox=$('input-box');
    if(inputBox){
      inputBox.innerHTML=`<div class="recording-indicator"><div class="rec-dot"></div><span class="rec-timer" id="rec-timer">0:00</span><span style="flex:1;font-size:12px;color:var(--t3)">Recording…</span><button class="rec-cancel" id="rec-cancel">✕ Cancel</button></div><button class="voice-rec-btn recording" id="voice-btn" title="Stop">⏹</button>`;
      $('rec-cancel').onclick=cancelRecording;$('voice-btn').onclick=stopRecording;
    }
    recInterval=setInterval(()=>{recSeconds++;const t=$('rec-timer');if(t)t.textContent=fmtDuration(recSeconds);if(recSeconds>=120)stopRecording();},1000);
  }catch(err){toast('Microphone access denied','🚫');}
}
function cancelRecording(){
  clearInterval(recInterval);isStoppingRecording=false;
  if(mediaRecorder&&mediaRecorder.state!=='inactive'){mediaRecorder.stream.getTracks().forEach(t=>t.stop());mediaRecorder.stop();}
  mediaRecorder=null;audioChunks=[];restoreInputBox();
}
async function stopRecording(){
  if(isStoppingRecording)return;
  isStoppingRecording=true;
  clearInterval(recInterval);
  if(!mediaRecorder||audioChunks.length===0){cancelRecording();return;}
  await new Promise(resolve=>{mediaRecorder.onstop=resolve;mediaRecorder.stream.getTracks().forEach(t=>t.stop());if(mediaRecorder.state!=='inactive')mediaRecorder.stop();});
  const blob=new Blob(audioChunks,{type:mediaRecorder.mimeType||'audio/webm'});audioChunks=[];mediaRecorder=null;
  isStoppingRecording=false;
  const reader=new FileReader();reader.onloadend=()=>{showVoicePreview(reader.result);};reader.readAsDataURL(blob);
}
function showVoicePreview(dataUrl){
  voicePreviewDataUrl=dataUrl;
  const inputBox=$('input-box');if(!inputBox)return;
  if(voicePreviewAudio){voicePreviewAudio.pause();voicePreviewAudio=null;}
  const audio=new Audio(dataUrl);voicePreviewAudio=audio;
  if(SETTINGS.speakerId&&audio.setSinkId)audio.setSinkId(SETTINGS.speakerId).catch(()=>{});
  inputBox.innerHTML=`<button class="vp-discard" id="vp-discard" title="Discard">✕</button>
    <button class="vp-play-btn" id="vp-play">▶</button>
    <div class="vp-progress">
      <input type="range" class="vp-seek" id="vp-seek" min="0" max="100" value="0" step="0.1">
      <div class="vp-times"><span id="vp-current">0:00</span><span id="vp-total">0:00</span></div>
    </div>
    <button class="vp-send-btn" id="vp-send" title="Send">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
    </button>`;
  let seeking=false;
  audio.onloadedmetadata=()=>{
    const dur=isFinite(audio.duration)?audio.duration:0;
    const durEl=$('vp-total');if(durEl)durEl.textContent=fmtDuration(Math.round(dur));
    const seek=$('vp-seek');if(seek)seek.max=dur||100;
  };
  audio.ontimeupdate=()=>{
    if(seeking)return;
    const curEl=$('vp-current');if(curEl)curEl.textContent=fmtDuration(Math.round(audio.currentTime));
    const seek=$('vp-seek');if(seek)seek.value=audio.currentTime;
  };
  audio.onplay=()=>{const btn=$('vp-play');if(btn)btn.textContent='⏸';};
  audio.onpause=audio.onended=()=>{const btn=$('vp-play');if(btn)btn.textContent='▶';};
  $('vp-play').onclick=()=>{if(audio.paused)audio.play().catch(()=>{});else audio.pause();};
  const seekEl=$('vp-seek');
  seekEl.addEventListener('mousedown',()=>{seeking=true;});
  seekEl.addEventListener('touchstart',()=>{seeking=true;},{passive:true});
  seekEl.addEventListener('input',()=>{audio.currentTime=parseFloat(seekEl.value);const curEl=$('vp-current');if(curEl)curEl.textContent=fmtDuration(Math.round(audio.currentTime));});
  seekEl.addEventListener('mouseup',()=>{seeking=false;});
  seekEl.addEventListener('touchend',()=>{seeking=false;},{passive:true});
  $('vp-discard').onclick=()=>{audio.pause();voicePreviewAudio=null;voicePreviewDataUrl=null;restoreInputBox();};
  $('vp-send').onclick=async()=>{
    audio.pause();voicePreviewAudio=null;
    const url=voicePreviewDataUrl;voicePreviewDataUrl=null;
    restoreInputBox();await sendContent('[voice]'+url);
  };
}
function playVoice(sid){
  const btn=document.getElementById(sid);if(!btn)return;
  const b64=btn.dataset.src,bars=Array.from({length:8},(_,i)=>document.getElementById(`${sid}-b${i}`)),durEl=document.getElementById(`${sid}-dur`);
  if(currentAudio&&!currentAudio.paused){currentAudio.pause();currentAudio=null;bars.forEach(b=>b?.classList.add('paused'));btn.textContent='▶';return;}
  const audio=new Audio(b64);currentAudio=audio;
  if(SETTINGS.speakerId&&audio.setSinkId)audio.setSinkId(SETTINGS.speakerId).catch(()=>{});
  audio.onloadedmetadata=()=>{if(durEl)durEl.textContent=fmtDuration(Math.round(audio.duration));};
  audio.ontimeupdate=()=>{if(durEl)durEl.textContent=fmtDuration(Math.round(audio.currentTime));};
  audio.onplay=()=>{btn.textContent='⏸';bars.forEach(b=>b?.classList.remove('paused'));};
  audio.onpause=audio.onended=()=>{btn.textContent='▶';bars.forEach(b=>b?.classList.add('paused'));currentAudio=null;};
  audio.play().catch(()=>toast('Could not play audio','❌'));
}

/* ════════════════ FILES ════════════════════════════════════ */
function openAttachMenu(){
  document.getElementById('attach-menu')?.remove();document.getElementById('epicker')?.remove();
  const menu=document.createElement('div');menu.id='attach-menu';menu.className='attach-menu';
  [{icon:'🖼️',label:'Photo or Video',action:()=>{menu.remove();$('img-input')?.click();}},
   {icon:'📄',label:'Document',action:()=>{menu.remove();$('file-input')?.click();}}]
  .forEach(item=>{const btn=document.createElement('button');btn.className='attach-item';btn.innerHTML=`<span class="attach-icon">${item.icon}</span><span>${item.label}</span>`;btn.onclick=item.action;menu.appendChild(btn);});
  document.querySelector('.chat-panel')?.appendChild(menu);
  setTimeout(()=>document.addEventListener('click',()=>menu.remove(),{once:true}),10);
}
async function handleFileInput(files,isImage){
  for(const file of Array.from(files)){
    if(file.size>MAX_FILE_BYTES){toast(`${file.name} is too large (max 600KB)`,'⚠️');continue;}
    const reader=new FileReader();
    reader.onloadend=async()=>{
      const b64=reader.result;let content;
      if(isImage||file.type.startsWith('image/')||file.type.startsWith('video/')){content='[img]'+b64;}
      else{content=`[file:${file.name}|${fmtBytes(file.size)}]${b64}`;}
      await sendContent(content);
    };
    reader.readAsDataURL(file);
  }
}

/* ════════════════ SEND ════════════════════════════════════ */
async function sendContent(content){
  if(!CHAT)return;
  if(isBlocked(CHAT)){toast('You have blocked this person','🚫');return;}
  const {data,error}=await SB.from('messages').insert({from_user:ME.username,to_user:CHAT,content,read:false}).select().single();
  if(!error&&data){if(!messages[CHAT])messages[CHAT]=[];messages[CHAT].push(data);refreshMsgs();}
  else if(error)toast('Send failed: '+error.message,'❌');
}
async function sendMsg(){
  const ta=$('msg-ta');if(!ta||!CHAT)return;
  const txt=ta.value.trim();if(!txt)return;
  ta.value='';ta.style.height='auto';
  await sendContent(txt);
}

/* ════════════════ FRIENDS ════════════════════════════════ */
async function acceptFriend(fromUser){await SB.from('friendships').update({status:'accepted'}).eq('from_user',fromUser).eq('to_user',ME.username);toast(`You and @${fromUser} are now friends! 🎉`,'🎉');await loadData();await loadProfilePics();renderApp();}
async function declineFriend(reqId){await SB.from('friendships').delete().eq('id',reqId);requests=requests.filter(r=>r.id!==reqId);renderApp();}
function openAddFriend(){
  const div=document.createElement('div');div.className='overlay';div.id='overlay';
  div.innerHTML=`<div class="modal"><h3>Add Friend</h3><p>Enter their exact username.</p><div id="mmsg"></div><div class="f-group"><label>Username</label><input id="m-u" placeholder="e.g. alex123" autocomplete="off"/></div><div class="modal-row"><button class="btn-sec" id="m-cancel">Cancel</button><button class="btn-acc" id="m-send">Send Request</button></div></div>`;
  document.body.appendChild(div);$('m-u').focus();
  $('m-cancel').onclick=()=>div.remove();div.addEventListener('click',e=>{if(e.target===div)div.remove();});
  $('m-u').addEventListener('keydown',e=>{if(e.key==='Enter')doSendReq();});$('m-send').onclick=doSendReq;
}
async function doSendReq(){
  const t=$('m-u')?.value.trim().toLowerCase();
  const mm=(html,cls)=>{const el=$('mmsg');if(el)el.innerHTML=`<div class="alert ${cls}">${html}</div>`;};
  if(!t){mm('Enter a username','err');return;}if(t===ME.username){mm("You can't add yourself 😅",'err');return;}
  const btn=$('m-send');btn.disabled=true;btn.textContent='Searching…';
  const {data:prof}=await SB.from('profiles').select('username').eq('username',t).single();
  if(!prof){mm('User not found','err');btn.disabled=false;btn.textContent='Send Request';return;}
  if(friends.find(f=>f.username===t)){mm('Already friends!','err');btn.disabled=false;btn.textContent='Send Request';return;}
  // Check for ANY existing row (any status) to avoid duplicate key constraint error
  const {data:ex}=await SB.from('friendships').select('id,status').or(`and(from_user.eq.${ME.username},to_user.eq.${t}),and(from_user.eq.${t},to_user.eq.${ME.username})`).maybeSingle();
  if(ex){
    const msg=ex.status==='pending'?'Request already pending':'Already connected';
    mm(msg,'err');btn.disabled=false;btn.textContent='Send Request';return;
  }
  const {error}=await SB.from('friendships').insert({from_user:ME.username,to_user:t,status:'pending'});
  if(error){mm('Error: '+error.message,'err');btn.disabled=false;btn.textContent='Send Request';return;}
  $('overlay')?.remove();requests.push({from_user:ME.username,to_user:t,status:'pending'});
  toast(`Request sent to @${t}!`,'📨');renderApp();
}

/* ════════════════ SETTINGS BINDINGS ════════════════════════ */
async function loadAudioDevices(){
  try{
    await navigator.mediaDevices.getUserMedia({audio:true}).then(s=>s.getTracks().forEach(t=>t.stop())).catch(()=>{});
    const devices=await navigator.mediaDevices.enumerateDevices();
    const mics=devices.filter(d=>d.kind==='audioinput'),speakers=devices.filter(d=>d.kind==='audiooutput');
    if(!SETTINGS.micId&&mics.length){const def=mics.find(d=>d.deviceId==='default')||mics[0];SETTINGS.micId=def.deviceId;saveSettings();}
    if(!SETTINGS.speakerId&&speakers.length){const def=speakers.find(d=>d.deviceId==='default')||speakers[0];SETTINGS.speakerId=def.deviceId;saveSettings();}
    const micSel=$('set-mic'),spkSel=$('set-speaker');
    if(micSel)mics.forEach(d=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Microphone ${mics.indexOf(d)+1}`;o.selected=d.deviceId===SETTINGS.micId;micSel.appendChild(o);});
    if(spkSel)speakers.forEach(d=>{const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||`Speaker ${speakers.indexOf(d)+1}`;o.selected=d.deviceId===SETTINGS.speakerId;spkSel.appendChild(o);});
  }catch(e){}
}
function bindSettingsPanel(){
  $('set-theme')?.addEventListener('change',e=>{SETTINGS.theme=e.target.value;saveSettings();toast('Theme updated','🎨');});
  $('set-mic')?.addEventListener('change',e=>{SETTINGS.micId=e.target.value;saveSettings();});
  $('set-speaker')?.addEventListener('change',e=>{SETTINGS.speakerId=e.target.value;saveSettings();});
  $('set-notif')?.addEventListener('change',e=>{SETTINGS.notifSound=e.target.checked;saveSettings();});
  document.querySelectorAll('.swatch').forEach(el=>{el.addEventListener('click',()=>{SETTINGS.accent=el.dataset.color;saveSettings();document.querySelectorAll('.swatch').forEach(s=>s.classList.toggle('active',s===el));toast('Accent colour updated','🎨');});});
  loadAudioDevices();
}

/* ════════════════ BINDINGS ════════════════════════════════ */
function bindApp(){
  $('btn-logout')?.addEventListener('click',()=>{ME=null;CHAT=null;TAB='chats';Q='';localStorage.removeItem('nx_session');if(realtimeSub)SB.removeChannel(realtimeSub);stopPresence();showAuth();});
  $('btn-edit-avatar')?.addEventListener('click',openAvatarEditor);
  $('t-chats')?.addEventListener('click',()=>{TAB='chats';renderApp();});
  $('t-friends')?.addEventListener('click',()=>{TAB='friends';renderApp();});
  $('t-settings')?.addEventListener('click',()=>{TAB='settings';renderApp();});
  $('btn-add-fr')?.addEventListener('click',openAddFriend);
  $('q-in')?.addEventListener('input',e=>{Q=e.target.value;refreshConvList();});
  $('btn-back')?.addEventListener('click',()=>{CHAT=null;document.querySelector('.shell')?.classList.remove('chat-active');renderApp();});
  $('btn-profile-dots')?.addEventListener('click',()=>{ if(CHAT) showUserProfile(CHAT); });
  bindConvItems();bindFriendActions();bindChatInput();
  if(TAB==='settings')bindSettingsPanel();
  const area=$('msgs');if(area)setTimeout(()=>area.scrollTop=area.scrollHeight,30);
  bindMsgRows();
}
function bindConvItems(){document.querySelectorAll('.conv-item[data-fr]').forEach(el=>el.addEventListener('click',async()=>{CHAT=el.dataset.fr;await loadMessages(CHAT);if(isMobile())document.querySelector('.shell')?.classList.add('chat-active');renderApp();}));}
function bindFriendActions(){
  document.querySelectorAll('[data-accept]').forEach(el=>el.addEventListener('click',()=>acceptFriend(el.dataset.accept)));
  document.querySelectorAll('[data-decline]').forEach(el=>el.addEventListener('click',()=>declineFriend(el.dataset.decline)));
  document.querySelectorAll('[data-chat]').forEach(el=>el.addEventListener('click',async()=>{CHAT=el.dataset.chat;TAB='chats';await loadMessages(CHAT);if(isMobile())document.querySelector('.shell')?.classList.add('chat-active');renderApp();}));
}
function restoreInputBox(){
  const fr=friends.find(f=>f.username===CHAT);if(!fr)return;const inputBox=$('input-box');if(!inputBox)return;
  inputBox.innerHTML=`<button class="ia-btn" id="attach-btn" title="Attach file">📎</button><textarea class="msg-ta" id="msg-ta" placeholder="Message ${esc(fr.display_name)}…" rows="1"></textarea><div class="ia"><button class="ia-btn" id="emoji-btn" title="Emoji"><img src="emoji.png" class="ia-img" alt="emoji"></button><button class="voice-rec-btn" id="voice-btn" title="Record voice message"><img src="mic.png" class="ia-img" alt="mic"></button><button class="send-btn" id="send-btn" title="Send"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg></button></div>`;
  bindChatInput();
}
function bindChatInput(){
  const ta=$('msg-ta');if(!ta)return;
  ta.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();}});
  ta.addEventListener('input',()=>{ta.style.height='auto';ta.style.height=Math.min(ta.scrollHeight,120)+'px';});
  ta.focus();
  $('send-btn')?.addEventListener('click',sendMsg);
  $('attach-btn')?.addEventListener('click',e=>{e.stopPropagation();openAttachMenu();});
  $('file-input')?.addEventListener('change',e=>{handleFileInput(e.target.files,false);e.target.value='';});
  $('img-input')?.addEventListener('change',e=>{handleFileInput(e.target.files,true);e.target.value='';});
  const vb=$('voice-btn');
  if(vb){
    vb.addEventListener('click',()=>{if(mediaRecorder&&mediaRecorder.state==='recording')stopRecording();else if(!mediaRecorder)startRecording();});
    vb.addEventListener('touchstart',e=>{e.preventDefault();startRecording();},{passive:false});
    vb.addEventListener('touchend',e=>{e.preventDefault();if(mediaRecorder)stopRecording();},{passive:false});
  }
  $('emoji-btn')?.addEventListener('click',e=>{
    e.stopPropagation();document.getElementById('epicker')?.remove();document.getElementById('attach-menu')?.remove();
    const pick=document.createElement('div');pick.id='epicker';pick.className='epicker';
    EMOJIS.forEach(em=>{
      const b=document.createElement('button');b.className='e-btn';b.textContent=em;
      b.addEventListener('click',e2=>{e2.stopPropagation();const t2=$('msg-ta');if(t2){const s=t2.selectionStart,en=t2.selectionEnd;t2.value=t2.value.slice(0,s)+em+t2.value.slice(en);t2.selectionStart=t2.selectionEnd=s+em.length;t2.focus();t2.dispatchEvent(new Event('input'));}pick.remove();});
      pick.appendChild(b);
    });
    document.body.appendChild(pick);
    const rect=e.target.getBoundingClientRect(),pw=Math.min(290,window.innerWidth-24);
    let left=rect.left-pw/2+rect.width/2;left=Math.max(12,Math.min(left,window.innerWidth-pw-12));
    pick.style.left=left+'px';pick.style.top=Math.max(8,rect.top-Math.min(220,window.innerHeight*0.4)-8)+'px';pick.style.width=pw+'px';
    setTimeout(()=>document.addEventListener('click',()=>pick.remove(),{once:true}),10);
  });
}

/* ════════════════ BOOT ════════════════════════════════════ */
async function boot(){
  try{
    loadSettings();
    let url=SUPABASE_URL.trim(),key=SUPABASE_KEY.trim();
    if(!url||!key){const saved=JSON.parse(localStorage.getItem(CFG_KEY)||'null');if(saved){url=saved.url;key=saved.key;}}
    if(!url||!key){showSetup();return;}
    SB=supabase.createClient(url,key);
    const {error}=await SB.from('profiles').select('id').limit(1);
    if(error){showSetup();return;}
    const sess=JSON.parse(localStorage.getItem('nx_session')||'null');
    if(sess){
      const {data:prof}=await SB.from('profiles').select('*').eq('username',sess.username).single();
      if(prof){ME=prof;if(ME.avatar_url)profilePics[ME.username]=ME.avatar_url;startApp();return;}
    }
    showAuth();
  }catch(e){
    console.error('Boot error:',e);
    showAuth();
  }
}

boot();
