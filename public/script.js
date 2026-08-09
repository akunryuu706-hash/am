
const API = '/api';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => Array.from(root.querySelectorAll(s));

const toast = (msg) => {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
};

const token = () => localStorage.getItem('xspedia_token') || '';
const user = () => { try { return JSON.parse(localStorage.getItem('xspedia_user') || 'null'); } catch { return null; } };
const setSession = (payload) => { if (payload?.token) localStorage.setItem('xspedia_token', payload.token); if (payload?.user) localStorage.setItem('xspedia_user', JSON.stringify(payload.user)); };

const authHeaders = (json=true) => ({
  ...(json ? {'content-type':'application/json'} : {}),
  ...(token() ? {Authorization:`Bearer ${token()}`} : {})
});

async function api(path, data, method='POST'){
  const res = await fetch(API + path, { method, headers: authHeaders(true), body: data ? JSON.stringify(data) : undefined });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(payload.message || 'Request gagal');
  return payload;
}

function safeAvatar(url){ return String(url || '').replaceAll('"','').trim(); }

function renderMiniUser(el){
  if (!el) return;
  const u = user();
  if (!u) {
    el.innerHTML = `<div class="avatar">?</div><div><b>Belum login</b><div class="muted">Masuk untuk akses panel.</div></div>`;
    return;
  }
  const avatar = safeAvatar(u.avatar);
  el.innerHTML = `
    <div class="avatar">${avatar ? `<img src="${avatar}" alt="avatar">` : 'U'}</div>
    <div>
      <b>${u.username || 'User'}</b>
      <div class="muted">${u.email || ''}<br>Role: ${u.role || 'user'} • Limit: ${u.dailyLimit || 100}/hari</div>
    </div>
  `;
}

function activateNav(){
  const p = location.pathname.split('/').pop() || 'index.html';
  $$(`.navlinks a`).forEach(a => {
    const href = a.getAttribute('href') || '';
    if (href === p || (p === '' && href === 'index.html')) a.classList.add('active');
  });
}

function bindAuthStatus(){
  const badge = $('#authStatus');
  if (!badge) return;
  const u = user();
  badge.innerHTML = u ? `<b>${u.username}</b> · ${u.role || 'user'}` : `Guest`;
}

function bindLogout(){
  const btn = $('#logoutBtn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    localStorage.removeItem('xspedia_token');
    localStorage.removeItem('xspedia_user');
    toast('Logout berhasil');
    bindAuthStatus();
    renderMiniUser($('#profileView'));
    if ($('#meBox')) $('#meBox').innerHTML = '<div class="muted">Belum login.</div>';
  });
}

function bindRegister(){
  const form = $('#registerForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form));
      const res = await api('/register', data);
      setSession({ user: res.user });
      renderMiniUser($('#profileView'));
      $('#verifyEmailBox')?.classList.remove('hidden');
      $('#verifyEmail') && ($('#verifyEmail').value = res.user.email || data.email || '');
      toast('✓ Registrasi sukses. Cek email dan Spam.');
      form.reset();
      bindAuthStatus();
    } catch (err) { toast(err.message); }
  });

  const verifyForm = $('#verifyEmailForm');
  if (verifyForm){
    verifyForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const data = Object.fromEntries(new FormData(verifyForm));
        const res = await api('/verify-email', data);
        toast(res.message || 'Verifikasi selesai');
        if (res.status) $('#verifyEmailBox')?.classList.add('hidden');
      } catch (err) { toast(err.message); }
    });
  }
}

function bindLogin(){
  const form = $('#loginForm');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form));
      const res = await api('/login', data);
      setSession(res);
      bindAuthStatus();
      renderMiniUser($('#profileView'));
      toast('✓ Login berhasil');
      setTimeout(() => location.href = 'dashboard.html', 700);
    } catch (err) { toast(err.message); }
  });
}

function bindForgot(){
  const form = $('#forgotForm');
  const verifyBtn = $('#verifyOtp');
  const resetForm = $('#resetForm');
  if (!form) return;

  let timer = null;
  let sec = 0;

  const tick = () => {
    const el = $('#countdown');
    if (!el) return;
    if (sec <= 0) {
      el.textContent = 'Boleh meminta kode lagi';
      clearInterval(timer);
      timer = null;
      return;
    }
    el.textContent = `Kirim ulang dalam ${sec} detik`;
    sec -= 1;
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(form));
      const res = await api('/forgot-password', data);
      $('#otpBox')?.classList.remove('hidden');
      $('#otpPhone') && ($('#otpPhone').value = data.phone || '');
      sec = Number(res.retryAfter || 30);
      clearInterval(timer);
      timer = setInterval(tick, 1000);
      tick();
      toast('✓ OTP dikirim ke WhatsApp');
    } catch (err) { toast(err.message); }
  });

  verifyBtn?.addEventListener('click', async () => {
    try {
      const data = { phone: $('#otpPhone')?.value || '', code: $('#otp')?.value || '' };
      const res = await api('/verify-otp', data);
      $('#resetBox')?.classList.remove('hidden');
      $('#resetToken') && ($('#resetToken').value = res.resetToken || '');
      toast('✓ OTP valid');
    } catch (err) { toast(err.message); }
  });

  resetForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(resetForm));
      const res = await api('/reset-password', data);
      toast(res.message || 'Password diubah');
      resetForm.reset();
      $('#resetBox')?.classList.add('hidden');
      $('#otpBox')?.classList.add('hidden');
    } catch (err) { toast(err.message); }
  });
}

function bindProfile(){
  const box = $('#profileView');
  if (!box) return;
  renderMiniUser(box);

  const info = $('#profileInfo');
  const u = user();
  if (info) {
    info.innerHTML = u ? `
      <div class="info"><div class="kpi">${u.role || 'user'}</div><div class="muted">Akses akun dan dashboard dengan tampilan yang sama.</div></div>
      <div class="info"><div class="kpi">${u.dailyLimit || 100}/hari</div><div class="muted">Limit harian sesuai role.</div></div>
      <div class="info"><div class="kpi">${u.emailVerified ? 'Verified' : 'Pending'}</div><div class="muted">Status email verifikasi.</div></div>
    ` : `<div class="muted">Belum login.</div>`;
  }
}

async function loadMe(){
  const box = $('#meBox');
  if (!box) return;
  const u = user();
  if (!u) { box.innerHTML = `<div class="muted">Silakan login dulu.</div>`; return; }
  box.innerHTML = `<div class="muted">Memuat data...</div>`;
  try {
    const res = await fetch('/api/profile', { headers: authHeaders(false) });
    const payload = await res.json();
    if (!res.ok) throw new Error(payload.message || 'Gagal ambil profile');
    const d = payload.user;
    box.innerHTML = `
      <div class="profile-box">
        <div class="avatar">${d.avatar ? `<img src="${safeAvatar(d.avatar)}" alt="avatar">` : 'U'}</div>
        <div>
          <h3 style="margin:0 0 6px">${d.username}</h3>
          <div class="muted">${d.email}<br>${d.phone}<br>Role: ${d.role} • Limit: ${d.dailyLimit}/hari</div>
        </div>
      </div>
    `;
  } catch (err) { box.innerHTML = `<div class="muted">${err.message}</div>`; }
}

function bindDashboard(){
  const box = $('#dashboardRole');
  if (box){
    const u = user();
    if (!u) {
      box.innerHTML = `<div class="muted">Login dulu untuk lihat dashboard.</div>`;
    } else {
      box.innerHTML = `
        <div class="grid-3">
          <div class="info"><div class="big">${u.dailyLimit || 100}</div><div class="muted">limit / hari</div></div>
          <div class="info"><div class="big">${u.role || 'user'}</div><div class="muted">role aktif</div></div>
          <div class="info"><div class="big">${u.emailVerified ? 'OK' : 'NO'}</div><div class="muted">status email</div></div>
        </div>
      `;
    }
  }

  const form = $('#requestForm');
  if (form){
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try{
        const data = Object.fromEntries(new FormData(form));
        data.params = {};
        try { data.params = data.paramsJson ? JSON.parse(data.paramsJson) : {}; } catch { throw new Error('params JSON tidak valid'); }
        delete data.paramsJson;
        const res = await api('/upstream', data);
        $('#requestResult').textContent = JSON.stringify(res, null, 2);
        toast('✓ Request terkirim');
      } catch(err){ toast(err.message); }
    });
  }
}

function bindDocs(){
  const out = $('#docsJson');
  if (!out) return;
  out.textContent = JSON.stringify({
    auth: 'Authorization: Bearer <token>',
    endpoints: {
      status: 'GET /api/status',
      register: 'POST /api/register',
      login: 'POST /api/login',
      forgotPassword: 'POST /api/forgot-password',
      verifyOtp: 'POST /api/verify-otp',
      resetPassword: 'POST /api/reset-password',
      profile: 'GET /api/profile',
      upstream: 'POST /api/upstream',
      adminUsers: 'GET /api/admin/users',
      updateUser: 'PATCH /api/admin/users/:id',
      blacklist: 'POST /api/admin/blacklist',
      deleteTransaction: 'DELETE /api/admin/transactions/:txId'
    },
    limits: { user:100, reseller:200, vip:600 },
    sampleRegister: {
      username: 'demo',
      email: 'demo@email.com',
      phone: '62812xxxxxxx',
      password: '123456',
      avatar: 'https://...'
    }
  }, null, 2);
}

function bindAdmin(){
  const loadBtn = $('#adminLoad');
  const usersBox = $('#usersResult');
  const updateForm = $('#adminUpdate');
  const blacklistForm = $('#blacklistForm');
  const txForm = $('#txDeleteForm');

  async function loadUsers(){
    if (!usersBox) return;
    try{
      const res = await fetch('/api/admin/users', { headers: authHeaders(false) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || 'Gagal load user');
      usersBox.textContent = JSON.stringify(payload.users, null, 2);
      toast('Data user dimuat');
    } catch(err){ toast(err.message); }
  }

  loadBtn?.addEventListener('click', loadUsers);

  updateForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try{
      const d = Object.fromEntries(new FormData(updateForm));
      const id = d.id; delete d.id;
      if (d.dailyLimit !== '') d.dailyLimit = Number(d.dailyLimit); else delete d.dailyLimit;
      const res = await fetch('/api/admin/users/' + id, { method:'PATCH', headers: authHeaders(true), body: JSON.stringify(d) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || 'Gagal update user');
      toast(payload.message || 'User diperbarui');
      await loadUsers();
    } catch(err){ toast(err.message); }
  });

  blacklistForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try{
      const d = Object.fromEntries(new FormData(blacklistForm));
      const res = await api('/admin/blacklist', d);
      toast(res.message || 'IP diblacklist');
    } catch(err){ toast(err.message); }
  });

  txForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try{
      const d = Object.fromEntries(new FormData(txForm));
      const res = await fetch('/api/admin/transactions/' + d.txId, { method:'DELETE', headers: authHeaders(false) });
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.message || 'Gagal hapus transaksi');
      toast(payload.message || 'Transaksi dihapus');
    } catch(err){ toast(err.message); }
  });

  if ($('#adminNotice')) {
    const u = user();
    $('#adminNotice').textContent = u?.role === 'admin' ? 'Mode admin aktif.' : 'Login sebagai admin untuk mengelola user.';
  }

  loadUsers?.();
}

function bindPageSpecific(){
  bindRegister();
  bindLogin();
  bindForgot();
  bindProfile();
  bindDashboard();
  bindDocs();
  bindAdmin();
  bindLogout();
  bindAuthStatus();
  activateNav();
  loadMe();
  renderMiniUser($('#profileView'));
}

document.addEventListener('DOMContentLoaded', bindPageSpecific);
