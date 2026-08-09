const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
const { nanoid } = require('nanoid');

dotenv.config();

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '200kb' }));
app.use(express.urlencoded({ extended: true }));

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_THIS_SECRET_IN_PRODUCTION';
const ROLE_LIMITS = { user: 100, reseller: 200, vip: 600, admin: 999999 };
let mongoPromise;

function env(name, fallback = '') { return process.env[name] || fallback; }
function ipOf(req) { return String(req.headers['x-forwarded-for'] || req.ip || 'unknown').split(',')[0].trim(); }
function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
function phone(v) { return String(v || '').replace(/[^0-9]/g, ''); }
function otp() { return String(Math.floor(100000 + Math.random() * 900000)); }
function dayKey() { return new Date().toISOString().slice(0, 10); }
function limitFor(u) { return Number.isFinite(u?.dailyLimit) ? u.dailyLimit : (ROLE_LIMITS[u?.role] || 100); }
function tokenFor(u) { return jwt.sign({ id: String(u._id), role: u.role, username: u.username }, JWT_SECRET, { expiresIn: '7d' }); }
function auth(req, res, next) {
  const raw = req.headers.authorization || '';
  const t = raw.startsWith('Bearer ') ? raw.slice(7) : req.headers['x-auth-token'];
  if (!t) return res.status(401).json({ status:false, message:'Belum login' });
  try { req.user = jwt.verify(t, JWT_SECRET); next(); } catch { return res.status(401).json({ status:false, message:'Session tidak valid' }); }
}
async function db() {
  if (!env('MONGODB_URI')) throw new Error('MONGODB_URI belum diisi');
  if (!mongoPromise) mongoPromise = new MongoClient(env('MONGODB_URI')).connect();
  const c = await mongoPromise;
  return c.db(env('MONGODB_DB', 'xspedia'));
}
async function notifyTelegram(event, data = {}) {
  const token = env('TELEGRAM_BOT_TOKEN'), owner = env('TELEGRAM_OWNER_ID');
  if (!token || !owner) return { skipped:true };
  const text = [
    `XS-Pedia • ${event}`,
    `Waktu: ${new Date().toLocaleString('id-ID')}`,
    data.username && `Username: ${data.username}`,
    data.email && `Email: ${data.email}`,
    data.phone && `No: ${data.phone}`,
    data.role && `Role: ${data.role}`,
    data.ip && `IP: ${data.ip}`,
    data.txId && `TX: ${data.txId}`
  ].filter(Boolean).join('\n');
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ chat_id:owner, text }) });
    return await r.json();
  } catch (e) { return { status:false, error:e.message }; }
}
async function sendFonnte(target, message) {
  const token = env('FONNTE_TOKEN');
  if (!token) return { skipped:true };
  const form = new FormData(); form.append('target', target); form.append('message', message); form.append('countryCode','62');
  try { const r = await fetch('https://api.fonnte.com/send', { method:'POST', headers:{Authorization:token}, body:form }); return await r.json(); }
  catch (e) { return { status:false, error:e.message }; }
}
async function upstream(pathname, params, key) {
  const base = env('XSPEDIA_BASE_URL','https://api.xs-pedia.my.id').replace(/\/$/,'');
  const url = new URL(base + pathname);
  Object.entries(params || {}).forEach(([k,v]) => { if (v !== undefined && v !== null) url.searchParams.set(k,String(v)); });
  if (key) url.searchParams.set('apikey', key);
  const r = await fetch(url);
  const data = await r.json().catch(()=>({}));
  return { url:url.toString(), ok:r.ok, data };
}
function apiKeyFor(user) {
  if (user.role === 'vip' && user.customApiKey) return user.customApiKey;
  if (user.role === 'reseller' && env('ROLE_RESELLER_API_KEY')) return env('ROLE_RESELLER_API_KEY');
  return env('ROLE_USER_API_KEY', env('UPSTREAM_API_KEY_FREE','free'));
}
async function consumeQuota(database, user, req, action='api') {
  if (user.role === 'admin') return { allowed:true, count:0, limit:999999 };
  const ip = ipOf(req);
  const blacklist = await database.collection('blacklist').findOne({ ip, active:true });
  if (blacklist) return { allowed:false, code:403, message:'IP kamu masuk blacklist' };
  const key = `${String(user._id)}:${dayKey()}`;
  const r = await database.collection('usage').findOneAndUpdate({ key }, { $inc:{ count:1 }, $set:{ userId:user._id, role:user.role, ip, updatedAt:new Date() }, $setOnInsert:{ day:dayKey() } }, { upsert:true, returnDocument:'after' });
  const count = r.value?.count || r.count || 0;
  const limit = limitFor(user);
  if (count > limit) { await database.collection('usage').updateOne({key},{$inc:{count:-1}}); return { allowed:false, code:429, message:`Limit ${limit} request/hari tercapai`, count:limit, limit }; }
  const txId = `tx_${nanoid(10)}`;
  await database.collection('transactions').insertOne({ txId, userId:user._id, username:user.username, role:user.role, action, ip, createdAt:new Date(), status:'pending' });
  return { allowed:true, count, limit, txId };
}
async function getUser(database, id) { try { return await database.collection('users').findOne({_id:new ObjectId(id)}); } catch { return null; } }

app.get('/api/status', async (req,res)=>res.json({status:true,source:'xs-pedia',message:'API panel aktif',limits:ROLE_LIMITS}));

app.post('/api/register', async (req,res)=>{
  try {
    const database = await db();
    const username = String(req.body.username||'').trim(); const email = normalizeEmail(req.body.email); const ph = phone(req.body.phone); const password = String(req.body.password||''); const avatar = String(req.body.avatar||'').trim();
    if (!username || !email || !ph || password.length < 6) return res.status(400).json({status:false,message:'Data register belum lengkap / password minimal 6 karakter'});
    if (await database.collection('users').findOne({$or:[{username},{email},{phone:ph}]})) return res.status(409).json({status:false,message:'Username, email, atau nomor sudah terdaftar'});
    const user = { username,email,phone:ph,passwordHash:await bcrypt.hash(password,10),avatar:avatar||'',role:'user',dailyLimit:100,emailVerified:false,createdAt:new Date() };
    const ins = await database.collection('users').insertOne(user); user._id=ins.insertedId;
    const key = apiKeyFor(user); let send = null;
    try { send = await upstream('/am/send',{email},key); } catch(e) { send={ok:false,error:e.message}; }
    await database.collection('verification').insertOne({ userId:user._id,email,createdAt:new Date(),send:send?.data||null });
    await notifyTelegram('REGISTER', {username,email,phone:ph,role:'user',ip:ipOf(req)});
    res.json({status:true,message:'Registrasi berhasil. Cek email dan folder Spam.',step:2,user:{id:String(user._id),username,email,role:'user',avatar},verification:send?.data||null});
  } catch(e) { res.status(500).json({status:false,message:e.message}); }
});

app.post('/api/verify-email', async (req,res)=>{
  try {
    const database=await db(); const email=normalizeEmail(req.body.email); const link=String(req.body.link||''); if(!email||!link) return res.status(400).json({status:false,message:'Email dan link wajib diisi'});
    const user=await database.collection('users').findOne({email}); if(!user) return res.status(404).json({status:false,message:'Akun tidak ditemukan'});
    const result=await upstream('/am/verify',{email,link},apiKeyFor(user));
    const success = Boolean(result.data?.status && (result.data?.data?.type==='success' || /berhasil|success|aktif/i.test(result.data?.message||'')));
    if(success) await database.collection('users').updateOne({_id:user._id},{$set:{emailVerified:true,emailVerifiedAt:new Date()}});
    res.json({status:success,message:success?'Email berhasil diverifikasi.':'Verifikasi belum berhasil.',data:result.data});
  } catch(e){res.status(500).json({status:false,message:e.message});}
});

app.post('/api/login', async (req,res)=>{
  try { const database=await db(); const identity=String(req.body.username||'').trim(); const password=String(req.body.password||''); const user=await database.collection('users').findOne({$or:[{username:identity},{email:normalizeEmail(identity)}]}); if(!user||!(await bcrypt.compare(password,user.passwordHash))) return res.status(401).json({status:false,message:'Username/email atau password salah'}); const ip=ipOf(req); const bl=await database.collection('blacklist').findOne({ip,active:true}); if(bl) return res.status(403).json({status:false,message:'IP kamu diblokir'}); await notifyTelegram('LOGIN',{username:user.username,email:user.email,role:user.role,ip}); const token=tokenFor(user); res.json({status:true,message:'Login berhasil',token,user:{id:String(user._id),username:user.username,email:user.email,phone:user.phone,role:user.role,dailyLimit:limitFor(user),avatar:user.avatar||'',emailVerified:!!user.emailVerified}}); }
  catch(e){res.status(500).json({status:false,message:e.message});}
});

app.post('/api/forgot-password', async (req,res)=>{
  try { const database=await db(); const ph=phone(req.body.phone); const user=await database.collection('users').findOne({phone:ph}); if(!user) return res.status(404).json({status:false,message:'Nomor tidak ditemukan'}); const code=otp(); await database.collection('passwordOtps').deleteMany({phone:ph}); await database.collection('passwordOtps').insertOne({phone:ph,userId:user._id,code,expiresAt:new Date(Date.now()+10*60*1000),createdAt:new Date()}); const sent=await sendFonnte(ph,`Kode OTP XS-Pedia: ${code}\nBerlaku 10 menit. Jangan berikan kode kepada siapa pun.`); res.json({status:true,message:'OTP dikirim ke WhatsApp',retryAfter:30,provider:sent?.status===false?'error':'ok'}); }
  catch(e){res.status(500).json({status:false,message:e.message});}
});
app.post('/api/verify-otp', async (req,res)=>{
  try { const database=await db(); const ph=phone(req.body.phone), code=String(req.body.code||''); const row=await database.collection('passwordOtps').findOne({phone:ph,code,expiresAt:{$gt:new Date()}}); if(!row) return res.status(400).json({status:false,message:'OTP salah atau kedaluwarsa'}); const resetToken=jwt.sign({id:String(row.userId),purpose:'reset'},JWT_SECRET,{expiresIn:'10m'}); res.json({status:true,message:'OTP benar',resetToken}); }
  catch(e){res.status(500).json({status:false,message:e.message});}
});
app.post('/api/reset-password', async(req,res)=>{ try { const p=jwt.verify(String(req.body.resetToken||''),JWT_SECRET); if(p.purpose!=='reset') throw new Error('Token reset tidak valid'); const password=String(req.body.password||''); if(password.length<6)return res.status(400).json({status:false,message:'Password minimal 6 karakter'}); const database=await db(); await database.collection('users').updateOne({_id:new ObjectId(p.id)},{$set:{passwordHash:await bcrypt.hash(password,10)}}); res.json({status:true,message:'Password berhasil diubah'}); }catch(e){res.status(400).json({status:false,message:'Token reset tidak valid/kedaluwarsa'});} });

app.get('/api/profile',auth,async(req,res)=>{try{const database=await db();const u=await getUser(database,req.user.id);if(!u)return res.status(404).json({status:false,message:'User tidak ditemukan'});res.json({status:true,user:{id:String(u._id),username:u.username,email:u.email,phone:u.phone,role:u.role,dailyLimit:limitFor(u),avatar:u.avatar||'',emailVerified:!!u.emailVerified}})}catch(e){res.status(500).json({status:false,message:e.message})}});

app.post('/api/upstream',auth,async(req,res)=>{
  try { const database=await db(); const u=await getUser(database,req.user.id); if(!u)return res.status(404).json({status:false,message:'User tidak ditemukan'}); const quota=await consumeQuota(database,u,req,'upstream'); if(!quota.allowed)return res.status(quota.code||429).json({status:false,message:quota.message,limit:quota.limit,count:quota.count});
    const pathname=String(req.body.endpoint||''); const allowed=['/am/send','/am/verify']; if(!allowed.includes(pathname)) return res.status(400).json({status:false,message:'Endpoint belum di-whitelist di panel'});
    const params={...(req.body.params||{})}; const result=await upstream(pathname,params,apiKeyFor(u)); await database.collection('transactions').updateOne({txId:quota.txId},{$set:{status:result.ok?'success':'failed',response:result.data}}); await notifyTelegram('API_REQUEST',{username:u.username,email:u.email,role:u.role,ip:ipOf(req),txId:quota.txId}); res.json({status:true,txId:quota.txId,quota:{count:quota.count,limit:quota.limit},result:result.data});
  } catch(e){res.status(500).json({status:false,message:e.message});}
});

app.get('/api/admin/users',auth,async(req,res)=>{try{if(req.user.role!=='admin')return res.status(403).json({status:false,message:'Admin only'});const database=await db();const users=await database.collection('users').find({}, {projection:{passwordHash:0}}).sort({createdAt:-1}).limit(500).toArray();res.json({status:true,users:users.map(u=>({...u,id:String(u._id),_id:undefined,dailyLimit:limitFor(u)}))})}catch(e){res.status(500).json({status:false,message:e.message})}});
app.patch('/api/admin/users/:id',auth,async(req,res)=>{try{if(req.user.role!=='admin')return res.status(403).json({status:false,message:'Admin only'});const database=await db();const set={}; if(req.body.username!==undefined)set.username=String(req.body.username).trim(); if(req.body.email!==undefined)set.email=normalizeEmail(req.body.email); if(req.body.role!==undefined && ['user','reseller','vip','admin'].includes(req.body.role)){set.role=req.body.role;if(req.body.dailyLimit===undefined)set.dailyLimit=ROLE_LIMITS[req.body.role]} if(req.body.dailyLimit!==undefined)set.dailyLimit=Math.max(0,Number(req.body.dailyLimit)); if(req.body.avatar!==undefined)set.avatar=String(req.body.avatar); if(req.body.password)set.passwordHash=await bcrypt.hash(String(req.body.password),10); if(req.body.customApiKey!==undefined)set.customApiKey=String(req.body.customApiKey); await database.collection('users').updateOne({_id:new ObjectId(req.params.id)},{$set:set});res.json({status:true,message:'User diperbarui'})}catch(e){res.status(500).json({status:false,message:e.message})}});
app.post('/api/admin/blacklist',auth,async(req,res)=>{try{if(req.user.role!=='admin')return res.status(403).json({status:false,message:'Admin only'});const database=await db();const ip=ipOf({headers:{'x-forwarded-for':req.body.ip}});await database.collection('blacklist').updateOne({ip},{$set:{ip,active:true,reason:String(req.body.reason||'spam'),createdAt:new Date()}},{upsert:true});res.json({status:true,message:'IP diblacklist'})}catch(e){res.status(500).json({status:false,message:e.message})}});
app.delete('/api/admin/transactions/:txId',auth,async(req,res)=>{try{if(req.user.role!=='admin')return res.status(403).json({status:false,message:'Admin only'});const database=await db();await database.collection('transactions').deleteOne({txId:req.params.txId});res.json({status:true,message:'Transaksi dihapus dari panel'})}catch(e){res.status(500).json({status:false,message:e.message})}});

app.get('/api/admin/bootstrap',async(req,res)=>{res.json({status:true,message:'Buat admin pertama lewat ADMIN_USERNAME dan ADMIN_PASSWORD di Environment Variables lalu restart server.'})});

async function ensureAdmin(){
  if(!env('MONGODB_URI') || !env('ADMIN_USERNAME') || !env('ADMIN_PASSWORD')) return;
  const database=await db(); const username=env('ADMIN_USERNAME'); const existing=await database.collection('users').findOne({username});
  if(!existing){await database.collection('users').insertOne({username,email:normalizeEmail(env('ADMIN_EMAIL','admin@local')),phone:phone(env('ADMIN_PHONE','620000000000')),passwordHash:await bcrypt.hash(env('ADMIN_PASSWORD'),10),role:'admin',dailyLimit:999999,avatar:'',emailVerified:true,createdAt:new Date()});}
}

// Static UI. env.js hanya berisi konfigurasi publik, tidak ada secret.
app.use(express.static(__dirname, { index:'index.html' }));

// Vercel memakai module export; Railway menjalankan listen di bawah.
if (require.main === module) {
  ensureAdmin().catch(e=>console.error('Mongo init:',e.message));
  app.listen(PORT,()=>console.log(`XS-Pedia running on ${PORT}`));
}
module.exports = app;
