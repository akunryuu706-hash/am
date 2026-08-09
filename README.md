# XS-Pedia Web Panel — HTML + Node

Struktur sengaja dibuat ringkas supaya mudah di-deploy.

```text
xspedia-web/
├── index.html
├── style.css
├── script.js
├── .env
├── server.js
├── package.json
├── vercel.json
├── api/
│   └── index.js
└── README.md
```

## Lokal

```bash
npm install
npm run dev
```

Buka `http://localhost:3000`.

Gunakan file `.env` untuk konfigurasi backend. File ini berisi MongoDB, Fonnte, Telegram, JWT, API key, dan akun admin. Jangan expose `.env` ke browser atau commit ke GitHub.

## Isi `.env`

Salin template berikut dan isi nilainya:

```env
MONGODB_URI=mongodb+srv://USERNAME:PASSWORD@cluster.mongodb.net/?retryWrites=true&w=majority
MONGODB_DB=xspedia
JWT_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_SECRET
FONNTE_TOKEN=YOUR_FONNTE_TOKEN
TELEGRAM_OWNER_ID=YOUR_TELEGRAM_OWNER_ID
TELEGRAM_BOT_TOKEN=YOUR_TELEGRAM_BOT_TOKEN
XSPEDIA_BASE_URL=https://api.xs-pedia.my.id
UPSTREAM_API_KEY_FREE=free
ROLE_USER_API_KEY=free
ROLE_RESELLER_API_KEY=YOUR_RESELLER_API_KEY
ADMIN_USERNAME=admin
ADMIN_PASSWORD=CHANGE_ADMIN_PASSWORD
ADMIN_EMAIL=admin@example.com
ADMIN_PHONE=628000000000
```

## Environment Variables production

```env
MONGODB_URI=mongodb+srv://...
MONGODB_DB=xspedia
JWT_SECRET=ganti-dengan-random-string-panjang
FONNTE_TOKEN=...
TELEGRAM_OWNER_ID=...
TELEGRAM_BOT_TOKEN=...
XSPEDIA_BASE_URL=https://api.xs-pedia.my.id
UPSTREAM_API_KEY_FREE=free
ROLE_USER_API_KEY=free
ROLE_RESELLER_API_KEY=...
ADMIN_USERNAME=admin
ADMIN_PASSWORD=ubah-password-admin
ADMIN_EMAIL=admin@example.com
ADMIN_PHONE=628000000000
```

## Railway

Deploy repository/ZIP ini sebagai Node app. Build command: `npm install`. Start command: `npm start`. Isi Environment Variables di Railway.

## Vercel

Upload repository ini ke Vercel. `vercel.json` mengarahkan `/api/*` ke Node function dan halaman ke `index.html`. Isi Environment Variables di Project Settings.

## Fitur

- Register + foto profile URL
- Login + session JWT
- Verifikasi email 2 tahap melalui endpoint XS-Pedia `/am/send` dan `/am/verify`
- Lupa password: OTP WhatsApp via Fonnte, cooldown 30 detik
- Role user/reseller/vip + limit 100/200/600 per hari
- VIP dapat custom API key server-side
- API key custom tidak pernah dikirim ke browser
- Admin: role, limit, password, username, email, custom API key, blacklist IP, hapus transaksi
- Telegram owner notification untuk register, login, dan request API
- Dokumentasi API di halaman web
- Transaction ID dan quota tracking di MongoDB
- UI komik gradasi hijau responsive

## Catatan API

Endpoint upstream yang disediakan oleh panel mengikuti endpoint yang terlihat dari dokumentasi XS-Pedia yang kamu kirim: `/am/send` dan `/am/verify`. Endpoint lain jangan ditebak/di-hardcode; tambahkan ke whitelist `allowed` di `server.js` setelah kamu punya dokumentasi endpoint resminya.

## Keamanan

Jika pernah membagikan API key/token di screenshot atau URL publik, rotate/regenerate token tersebut sebelum production. Jangan commit `.env` ke GitHub.
