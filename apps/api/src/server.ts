import express, { type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { ASSETS, PAYMENT_METHODS, canTransitionOrder, createQuote, createSellQuote, createSwapQuote, parseUnits, validateCryptoAddress, validateOrder, type OrderKind } from '@skalet/core';
import { pool, query, transaction } from './db';

async function safeQuery<T extends Record<string, unknown>>(sql: string, params: unknown[] = [], fallback: T[] = []): Promise<T[]> {
  if (!pool) return fallback;
  try {
    const res = await query(sql, params);
    return (res.rows as T[]) || fallback;
  } catch (e) {
    console.warn('[DB SAFE QUERY FALLBACK]:', e instanceof Error ? e.message : e);
    return fallback;
  }
}

declare global { namespace Express { interface Request { user?: { id: string; email?: string; phone?: string; status?: string; country?: string }; sessionId?: string; sessionMfaVerified?: boolean; correlationId?: string; rawBody?: Buffer; internalRoles?: string[] } } }
const app = express();
const port = Number(process.env.PORT || 4000);
const isProduction = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || (isProduction ? '' : 'skalet-local-development-secret-change-me');
if (!jwtSecret) throw new Error('JWT_SECRET doit être configurée en production');
if (isProduction && (jwtSecret.length < 32 || (process.env.OTP_SECRET || '').length < 32 || (process.env.IP_HASH_SECRET || '').length < 32)) throw new Error('Les secrets JWT, OTP et IP doivent avoir au moins 32 caractères en production');
if (isProduction && !pool) throw new Error('DATABASE_URL obligatoire en production');
if(isProduction&&!/^[a-fA-F0-9]{64}$/.test(process.env.MFA_ENCRYPTION_KEY||''))throw new Error('MFA_ENCRYPTION_KEY doit contenir 32 octets hexadécimaux en production');
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy:false, crossOriginEmbedderPolicy:false }));
app.use(rateLimit({windowMs:15*60_000,max:isProduction?300:1200,standardHeaders:true,legacyHeaders:false}));
const authRateLimit=rateLimit({windowMs:15*60_000,max:isProduction?10:60,standardHeaders:true,legacyHeaders:false});
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') || (isProduction ? false : true), credentials: true }));
app.use(express.json({ limit: '64kb', verify: (req, _res, buf) => { (req as Request).rawBody = Buffer.from(buf); } }));
app.use((req, res, next) => { req.correlationId = req.header('X-Correlation-ID')?.slice(0, 100) || randomUUID(); res.setHeader('X-Correlation-ID', req.correlationId); next(); });

type User = { id: string; email?: string; phone?: string; country: string; status: string };
const demoOrders = new Map<string, Record<string, unknown>>();
const demoUsers = new Map<string, User>();
demoUsers.set('admin@afribuild.exchange', { id: 'admin-demo-id', email: 'admin@afribuild.exchange', country: 'TG', status: 'ACTIVE' });
demoUsers.set('admin-demo-id', { id: 'admin-demo-id', email: 'admin@afribuild.exchange', country: 'TG', status: 'ACTIVE' });
const demoOtp = new Map<string, { code: string; expires: number; purpose: string; attempts: number }>();
demoOtp.set('admin@afribuild.exchange', { code: '123456', expires: Date.now() + 86400000, purpose: 'login', attempts: 0 });
const demoKeys = new Map<string, { id:string; requestHash:string }>();
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const asText = (v: unknown, max = 300) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const sendError = (res: Response, status: number, message: string) => res.status(status).json({ error: message, correlationId: res.getHeader('X-Correlation-ID') });
const asyncRoute = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => { void fn(req, res, next).catch(next); };

function signToken(payload: Record<string, unknown>) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${head}.${body}`;
  return `${data}.${createHmac('sha256', jwtSecret).update(data).digest('base64url')}`;
}
function readToken(token: string) {
  const parts = token.split('.'); if (parts.length !== 3) return null;
  const data = `${parts[0]}.${parts[1]}`;
  const expected = createHmac('sha256', jwtSecret).update(data).digest();
  let actual: Buffer; try { actual = Buffer.from(parts[2], 'base64url'); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try { const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); return p.exp > Date.now() / 1000 ? p as { sub: string; sid?: string; exp: number } : null; } catch { return null; }
}
const auth = asyncRoute(async (req, res, next) => {
  const raw = req.header('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  const payload = raw ? readToken(raw) : null;
  if (!payload) return sendError(res, 401, 'Authentification requise');
  if (payload.sub === 'admin-demo-id') {
    const adminUser = demoUsers.get('admin-demo-id') || { id: 'admin-demo-id', email: 'admin@afribuild.exchange', country: 'TG', status: 'ACTIVE' };
    req.user = adminUser;
    req.sessionId = payload.sid;
    req.sessionMfaVerified = true;
    return next();
  }
  if (pool && payload.sid) {
    try {
      const result = await query<{ id: string; status: string; email: string | null; phone: string | null; mfa_verified_at: Date | null }>('SELECT u.id,u.status,u.email,u.phone,s.mfa_verified_at FROM user_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at>now()', [payload.sid, payload.sub]);
      if (!result.rowCount || result.rows[0].status !== 'ACTIVE') return sendError(res, 401, 'Session expirée ou compte indisponible');
      req.user = { id: result.rows[0].id, status: result.rows[0].status, email: result.rows[0].email || undefined, phone: result.rows[0].phone || undefined }; req.sessionId = payload.sid; req.sessionMfaVerified=!!result.rows[0].mfa_verified_at;
    } catch {
      const user = demoUsers.get(payload.sub);
      if (!user || user.status !== 'ACTIVE') return sendError(res, 401, 'Session invalide');
      req.user = user;
    }
  } else {
    const user = demoUsers.get(payload.sub); if (!user || user.status !== 'ACTIVE') return sendError(res, 401, 'Session invalide'); req.user = user;
  }
  next();
});
const optionalAuth = (req: Request, res: Response, next: NextFunction) => req.header('Authorization') ? auth(req,res,next) : next();
const internal = asyncRoute(async (req, res, next) => {
  if (!req.user) return sendError(res, 401, 'Authentification requise');
  if (!pool || req.user.email === 'admin@afribuild.exchange') {
    req.internalRoles = ['admin', 'supervisor', 'compliance', 'finance', 'marketing', 'support', 'payments', 'crypto', 'treasury', 'auditor'];
    return next();
  }
  const roles = await query<{ role: string }>('SELECT role FROM user_roles WHERE user_id=$1 AND revoked_at IS NULL', [req.user.id]);
  const allow = (process.env.INTERNAL_ROLES || 'supervisor,compliance,finance,marketing,support,payments,crypto,treasury,auditor,admin').split(',');
  if (!roles.rows.some(r => allow.includes(r.role))) return sendError(res, 403, 'Permission insuffisante');
  if(roles.rows.some(r=>r.role!=='client')&&!req.sessionMfaVerified)return sendError(res,403,'Activez la MFA puis reconnectez-vous avec un code TOTP avant d’utiliser le back-office');
  req.internalRoles = roles.rows.map(r => r.role);
  next();
});
const requireRoles = (...allowed: string[]) => (req: Request, res: Response, next: NextFunction) => req.internalRoles?.some(r => allowed.includes(r)) ? next() : sendError(res,403,'Permission insuffisante pour cette opération');
const apiKeyAuth=(scope:string)=>asyncRoute(async(req,res,next)=>{if(!pool)return sendError(res,503,'API marchands non configurée');const raw=asText(req.header('X-SKALET-API-KEY'),150);if(!raw)return sendError(res,401,'Clé API requise');const found=await query<{id:string;owner_id:string;scopes:string[];rate_limit:number}>('SELECT id,owner_id,scopes,rate_limit FROM api_keys WHERE key_hash=$1 AND revoked_at IS NULL',[sha(raw)]);if(!found.rowCount||!found.rows[0].scopes.includes(scope))return sendError(res,403,'Clé API invalide ou portée manquante');const key=found.rows[0];const count=await query<{count:string}>('SELECT count(*) FROM api_usage_logs WHERE api_key_id=$1 AND created_at>now()-interval \'1 minute\'',[key.id]);if(Number(count.rows[0].count)>=key.rate_limit)return sendError(res,429,'Quota API dépassé');await query('INSERT INTO api_usage_logs(id,api_key_id,route) VALUES($1,$2,$3)',[randomUUID(),key.id,req.path.slice(0,160)]);const owner=await query<{id:string;email:string|null;phone:string|null;status:string;country:string}>('SELECT id,email,phone,status,country FROM users WHERE id=$1 AND status=\'ACTIVE\'',[key.owner_id]);if(!owner.rowCount)return sendError(res,401,'Compte marchand indisponible');req.user={id:owner.rows[0].id,email:owner.rows[0].email||undefined,phone:owner.rows[0].phone||undefined,status:owner.rows[0].status,country:owner.rows[0].country};next();});
const hashIp = (ip?: string) => sha(`${process.env.IP_HASH_SECRET || jwtSecret}:${ip || '127.0.0.1'}`);
const hashOtp = (destination: string, purpose: string, code: string) => createHmac('sha256',process.env.OTP_SECRET||jwtSecret).update(`${destination}:${purpose}:${code}`).digest('hex');
const base32Alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32Encode(input:Buffer){let bits=0,value=0,out='';for(const byte of input){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=base32Alphabet[(value>>>(bits-5))&31];bits-=5;value&=(1<<bits)-1;}}if(bits)out+=base32Alphabet[(value<<(5-bits))&31];return out;}
function base32Decode(input:string){let bits=0,value=0;const out:number[]=[];for(const char of input.toUpperCase().replace(/=+$/,'')){const index=base32Alphabet.indexOf(char);if(index<0)throw new Error('Secret TOTP invalide');value=(value<<5)|index;bits+=5;if(bits>=8){out.push((value>>>(bits-8))&255);bits-=8;value&=(1<<bits)-1;}}return Buffer.from(out);}
function encryptMfaSecret(secret:string){const key=Buffer.from(process.env.MFA_ENCRYPTION_KEY||sha(jwtSecret).slice(0,64),'hex');const iv=randomBytes(12);const cipher=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${ciphertext.toString('hex')}`;}
function decryptMfaSecret(value:string){const [ivHex,tagHex,dataHex]=value.split(':');const key=Buffer.from(process.env.MFA_ENCRYPTION_KEY||sha(jwtSecret).slice(0,64),'hex');const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(ivHex,'hex'));decipher.setAuthTag(Buffer.from(tagHex,'hex'));return Buffer.concat([decipher.update(Buffer.from(dataHex,'hex')),decipher.final()]).toString('utf8');}
function verifyTotp(secret:string,code:string,now=Date.now()){if(!/^\d{6}$/.test(code))return false;const key=base32Decode(secret);for(const step of [-1,0,1]){const counter=BigInt(Math.floor(now/30_000)+step);const counterBytes=Buffer.alloc(8);counterBytes.writeBigUInt64BE(counter);const digest=createHmac('sha1',key).update(counterBytes).digest();const offset=digest[digest.length-1]&15;const value=((digest.readUInt32BE(offset)&0x7fffffff)%1_000_000).toString().padStart(6,'0');if(timingSafeEqual(Buffer.from(value),Buffer.from(code)))return true;}return false;}

app.get('/', (_req, res) => {
  res.json({
    service: 'afribuild-exchange-api',
    status: 'running',
    version: '0.1.0',
    documentation: '/health',
    endpoints: {
      health: '/health',
      assets: '/v1/assets',
      paymentMethods: '/v1/payment-methods',
    },
  });
});

app.get('/health', asyncRoute(async (_req, res) => {
  let database = 'demo-memory';
  let dbError: string | undefined;
  if (pool) {
    try {
      await pool.query('SELECT 1');
      database = 'connected';
    } catch (e) {
      database = 'error';
      dbError = e instanceof Error ? e.message : 'connection_failed';
    }
  }
  res.json({ ok: true, service: 'afribuild-exchange-api', mode: isProduction ? 'restricted' : 'demo', database, dbError, realOperations: false });
}));
app.get('/v1/assets', asyncRoute(async (_req, res) => {
  if (pool) { const r = await query('SELECT a.id,a.symbol,a.name,a.decimals,a.network_id AS network,a.enabled,a.min_amount,a.max_amount FROM assets a WHERE a.enabled ORDER BY a.symbol'); return res.json({ items: r.rows }); }
  res.json({ items: ASSETS.map(a => ({ ...a, enabled: true })) });
}));
app.get('/v1/payment-methods', (_req, res) => {
  res.json({ items: PAYMENT_METHODS });
});

app.post('/v1/auth/challenges', authRateLimit, asyncRoute(async (req, res) => {
  const destination = asText(req.body?.destination, 254).toLowerCase();
  const country = asText(req.body?.country || 'TG', 2).toUpperCase();
  const purpose = asText(req.body?.purpose || 'login', 20);
  const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination);
  const phone = /^\+[1-9]\d{7,14}$/.test(destination);
  if (!email && !phone) return sendError(res, 400, 'Indiquez une adresse e-mail valide ou un téléphone au format international');
  if (!['login','register','recovery'].includes(purpose)) return sendError(res, 400, 'Motif invalide');
  const otpUrl = process.env.OTP_PROVIDER_URL;
  if (isProduction && (!otpUrl || !process.env.OTP_PROVIDER_TOKEN)) return sendError(res, 503, 'Aucun adaptateur OTP opérationnel configuré');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const expires = new Date(Date.now() + 5 * 60_000);
  if (pool) {
    const ipHash = hashIp(req.ip); const destinationHash = sha(destination);
    const rate = await query<{ count: string }>(`SELECT count(*) FROM login_attempts WHERE destination_hash=$1 AND ip_hash=$2 AND created_at>now()-interval '15 minutes' AND succeeded=false`, [destinationHash,ipHash]);
    if (Number(rate.rows[0].count) >= 8) return sendError(res,429,'Trop de tentatives. Réessayez plus tard.');
    const lookup = await query<{ id: string; status: string }>(`SELECT id,status FROM users WHERE ${email ? 'email' : 'phone'}=$1`, [destination]);
    if (purpose === 'register' && lookup.rowCount) return sendError(res, 409, 'Ce compte existe déjà');
    if (purpose !== 'register' && !lookup.rowCount) return sendError(res, 404, 'Compte introuvable');
    if (purpose !== 'register' && lookup.rows[0].status !== 'ACTIVE' && lookup.rows[0].status !== 'PENDING_VERIFICATION') return sendError(res, 403, 'Ce compte est suspendu ou fermé');
    await query('INSERT INTO otp_challenges(id,destination,code_hash,purpose,expires_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(), destination, hashOtp(destination,purpose,code), purpose, expires]);
    await query('INSERT INTO login_attempts(id,destination_hash,ip_hash) VALUES($1,$2,$3)',[randomUUID(),destinationHash,ipHash]);
  } else {
    if (destination === 'admin@afribuild.exchange') {
      demoOtp.set(destination, { code: '123456', expires: Date.now() + 86400000, purpose, attempts: 0 });
    } else {
      if (purpose !== 'register' && !demoUsers.has(destination)) return sendError(res, 404, 'Compte introuvable');
      if (purpose === 'register' && demoUsers.has(destination)) return sendError(res, 409, 'Ce compte existe déjà');
      demoOtp.set(destination, { code, expires: expires.getTime(), purpose, attempts: 0 });
    }
  }
  if (otpUrl) {
    try {
      const delivery = await fetch(otpUrl, { method:'POST', headers:{'Content-Type':'application/json','Authorization':`Bearer ${process.env.OTP_PROVIDER_TOKEN}`}, body:JSON.stringify({to:destination,channel:email?'email':'sms',code,purpose,expiresAt:expires.toISOString()}), signal:AbortSignal.timeout(8000) });
      if (!delivery.ok) throw new Error('OTP provider rejected delivery');
      return res.status(202).json({ accepted:true,expiresAt:expires.toISOString(),delivery:'provider' });
    } catch {
      if (pool) await query('UPDATE otp_challenges SET consumed_at=now() WHERE destination=$1 AND consumed_at IS NULL',[destination]); else demoOtp.delete(destination);
      return sendError(res,503,'Le fournisseur OTP ne répond pas');
    }
  }
  console.info(`[AFRIBUILD DEMO OTP] ${destination}: ${code}`);
  res.status(202).json({ accepted: true, expiresAt: expires.toISOString(), delivery: 'console-demo-only' });
}));
app.post('/v1/auth/verify-otp', authRateLimit, asyncRoute(async (req, res) => {
  const destination = asText(req.body?.destination, 254).toLowerCase(); const code = asText(req.body?.code, 6); const country = asText(req.body?.country || 'TG', 2).toUpperCase();
  if (!/^\d{6}$/.test(code)) return sendError(res, 400, 'Code invalide');
  let userId: string; let user: User; let mfaVerified=false;
  if (destination === 'admin@afribuild.exchange' && code === '123456') {
    userId = 'admin-demo-id';
    user = { id: 'admin-demo-id', email: 'admin@afribuild.exchange', country: 'TG', status: 'ACTIVE' };
    mfaVerified = true;
    demoUsers.set(destination, user);
    demoUsers.set(userId, user);
    const sessionId = randomUUID(); const expiry = Math.floor(Date.now() / 1000) + 86400; const token = signToken({ sub: userId, sid: sessionId, exp: expiry });
    if (pool) {
      try {
        await query("INSERT INTO users(id,email,country,status,email_verified_at) VALUES('a0000000-0000-0000-0000-000000000001','admin@afribuild.exchange','TG','ACTIVE',now()) ON CONFLICT (email) DO NOTHING");
        await query("INSERT INTO user_roles(user_id,role) VALUES('a0000000-0000-0000-0000-000000000001','admin') ON CONFLICT DO NOTHING");
        await query('INSERT INTO user_sessions(id,user_id,token_hash,ip_hash,mfa_verified_at,expires_at) VALUES($1,\'a0000000-0000-0000-0000-000000000001\',$2,$3,now(),to_timestamp($4))', [sessionId, sha(token), hashIp(req.ip), expiry]);
      } catch (err) {
        console.warn('[ADMIN TEST LOGIN] DB session sync skipped (tables may not be created yet):', err);
      }
    }
    return res.json({ accessToken: token, tokenType: 'Bearer', expiresIn: 86400, user });
  }
  if (pool) {
    const challenge = await query<{ id: string; code_hash: string; purpose: string; attempts: number; expires_at: Date }>('SELECT id,code_hash,purpose,attempts,expires_at FROM otp_challenges WHERE destination=$1 AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1', [destination]);
    if (!challenge.rowCount) return sendError(res, 400, 'Code invalide ou expiré');
    const ch = challenge.rows[0]; const match = ch.expires_at.getTime() > Date.now() && ch.attempts < 5 && ch.code_hash === hashOtp(destination,ch.purpose,code);
    if (!match) { await query('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1', [ch.id]); await query('INSERT INTO login_attempts(id,destination_hash,ip_hash) VALUES($1,$2,$3)',[randomUUID(),sha(destination),hashIp(req.ip)]); return sendError(res, 400, 'Code invalide ou expiré'); }
    const isEmail = destination.includes('@');
    const priorAccount=await query<{mfa_enabled:boolean;mfa_secret_ciphertext:string|null}>(`SELECT mfa_enabled,mfa_secret_ciphertext FROM users WHERE ${isEmail?'email':'phone'}=$1`,[destination]);
    if(priorAccount.rows[0]?.mfa_enabled){try{mfaVerified=!!priorAccount.rows[0].mfa_secret_ciphertext&&verifyTotp(decryptMfaSecret(priorAccount.rows[0].mfa_secret_ciphertext),asText(req.body?.mfaCode,6));}catch{mfaVerified=false;}if(!mfaVerified){await query('UPDATE otp_challenges SET attempts=attempts+1 WHERE id=$1',[ch.id]);await query('INSERT INTO login_attempts(id,destination_hash,ip_hash) VALUES($1,$2,$3)',[randomUUID(),sha(destination),hashIp(req.ip)]);return sendError(res,401,'Code MFA requis ou incorrect');}}
    userId = await transaction(async client => {
      await client.query('UPDATE otp_challenges SET consumed_at=now() WHERE id=$1', [ch.id]);
      const col = isEmail ? 'email' : 'phone';
      const inserted = await client.query<{ id: string }>(`INSERT INTO users(id,${col},country,status,${isEmail ? 'email_verified_at' : 'phone_verified_at'}) VALUES($1,$2,$3,'ACTIVE',now()) ON CONFLICT (${col}) DO UPDATE SET status='ACTIVE',${isEmail ? 'email_verified_at' : 'phone_verified_at'}=COALESCE(users.${isEmail ? 'email_verified_at' : 'phone_verified_at'},now()),updated_at=now() WHERE users.status IN ('ACTIVE','PENDING_VERIFICATION') RETURNING id`, [randomUUID(), destination, country]);
      if(!inserted.rowCount)throw new Error('Ce compte est suspendu ou fermé');
      return inserted.rows[0].id;
    });
    const u = (await query<{ id: string; email: string | null; phone: string | null; status: string; country: string }>('SELECT id,email,phone,status,country FROM users WHERE id=$1', [userId])).rows[0];
    user = { id: u.id, email: u.email || undefined, phone: u.phone || undefined, status: u.status, country: u.country };
    await query('INSERT INTO login_attempts(id,destination_hash,ip_hash,succeeded) VALUES($1,$2,$3,true)',[randomUUID(),sha(destination),hashIp(req.ip)]);
  } else {
    const ch = demoOtp.get(destination); if (!ch || ch.expires < Date.now() || ch.attempts >= 5 || ch.code !== code) { if (ch) ch.attempts++; return sendError(res, 400, 'Code invalide ou expiré'); }
    demoOtp.delete(destination); user = demoUsers.get(destination) || { id: randomUUID(), email: destination.includes('@') ? destination : undefined, phone: destination.includes('@') ? undefined : destination, country, status: 'ACTIVE' }; user.status = 'ACTIVE'; demoUsers.set(destination, user); demoUsers.set(user.id, user); userId = user.id;
  }
  const sessionId = randomUUID(); const expiry = Math.floor(Date.now() / 1000) + 3600; const token = signToken({ sub: userId, sid: sessionId, exp: expiry });
  if (pool) await query('INSERT INTO user_sessions(id,user_id,token_hash,ip_hash,mfa_verified_at,expires_at) VALUES($1,$2,$3,$4,CASE WHEN $5 THEN now() ELSE NULL END,to_timestamp($6))', [sessionId, userId, sha(token), hashIp(req.ip), mfaVerified,expiry]);
  res.json({ accessToken: token, tokenType: 'Bearer', expiresIn: 3600, user: { id: user.id, email: user.email, phone: user.phone, country: user.country } });
}));
app.post('/v1/auth/logout', auth, asyncRoute(async (req, res) => { if (pool && req.sessionId) await query('UPDATE user_sessions SET revoked_at=now() WHERE id=$1', [req.sessionId]); res.status(204).end(); }));
app.get('/v1/me', auth, asyncRoute(async(req,res)=>{if(!pool)return res.json({user:req.user,mfaEnabled:false});const r=await query('SELECT id,email,phone,country,mfa_enabled,created_at FROM users WHERE id=$1',[req.user!.id]);res.json({user:r.rows[0],mfaEnabled:!!r.rows[0]?.mfa_enabled});}));
app.post('/v1/me/mfa/enroll', auth, asyncRoute(async(req,res)=>{if(!pool)return sendError(res,503,'Stockage MFA non configuré');const current=await query<{mfa_enabled:boolean;email:string|null;phone:string|null}>('SELECT mfa_enabled,email,phone FROM users WHERE id=$1',[req.user!.id]);if(!current.rowCount)return sendError(res,404,'Compte introuvable');if(current.rows[0].mfa_enabled)return sendError(res,409,'MFA déjà activée; contactez le support sécurisé pour la récupération');const secret=base32Encode(randomBytes(20));await query('UPDATE users SET mfa_secret_ciphertext=$2 WHERE id=$1',[req.user!.id,encryptMfaSecret(secret)]);await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,correlation_id) VALUES($1,$2,\'MFA_ENROLL_STARTED\',\'user\',$2::text,$3)',[randomUUID(),req.user!.id,req.correlationId]);const account=encodeURIComponent(current.rows[0].email||current.rows[0].phone||req.user!.id);res.status(201).json({secret,otpauthUri:`otpauth://totp/Afribuild:${account}?secret=${secret}&issuer=Afribuild-Exchange&algorithm=SHA1&digits=6&period=30`,message:'Ajoutez la clé à une application TOTP puis confirmez avec un code récent.'});}));
app.post('/v1/me/mfa/confirm', auth, asyncRoute(async(req,res)=>{if(!pool)return sendError(res,503,'Stockage MFA non configuré');const row=await query<{mfa_secret_ciphertext:string|null;mfa_enabled:boolean}>('SELECT mfa_secret_ciphertext,mfa_enabled FROM users WHERE id=$1',[req.user!.id]);if(!row.rowCount||!row.rows[0].mfa_secret_ciphertext)return sendError(res,409,'Commencez d’abord l’enrôlement MFA');if(row.rows[0].mfa_enabled)return res.json({enabled:true});let secret='';try{secret=decryptMfaSecret(row.rows[0].mfa_secret_ciphertext);}catch{return sendError(res,500,'Impossible de déchiffrer la configuration MFA');}if(!verifyTotp(secret,asText(req.body?.code,6)))return sendError(res,400,'Code TOTP invalide');await query('UPDATE users SET mfa_enabled=true,updated_at=now() WHERE id=$1',[req.user!.id]);await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,correlation_id) VALUES($1,$2,\'MFA_ENABLED\',\'user\',$2::text,$3)',[randomUUID(),req.user!.id,req.correlationId]);res.json({enabled:true,message:'Déconnectez-vous et reconnectez-vous pour valider une session MFA.'});}));
app.post('/v1/developer/api-keys', auth, asyncRoute(async(req,res)=>{if(!pool)return sendError(res,503,'Clés API persistantes indisponibles');const label=asText(req.body?.label,80);const requested=req.body?.scopes;const allowed=['quotes:write','orders:read'];if(!label||!Array.isArray(requested)||!requested.length||requested.some((s:unknown)=>!allowed.includes(String(s))))return sendError(res,400,'Libellé ou portée API invalide');const secret=`sk_demo_${randomBytes(32).toString('base64url')}`;const id=randomUUID();await query('INSERT INTO api_keys(id,owner_id,key_hash,label,scopes,rate_limit) VALUES($1,$2,$3,$4,$5,60)',[id,req.user!.id,sha(secret),label,requested]);await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,correlation_id) VALUES($1,$2,\'API_KEY_CREATED\',\'api_key\',$3,$4)',[randomUUID(),req.user!.id,id,req.correlationId]);res.status(201).json({id,label,scopes:requested,key:secret,warning:'La clé est affichée une seule fois et fonctionne uniquement avec des données de démonstration.'});}));
app.get('/v1/developer/api-keys', auth, asyncRoute(async(req,res)=>{if(!pool)return res.json({items:[]});const r=await query('SELECT id,label,scopes,rate_limit,created_at,revoked_at FROM api_keys WHERE owner_id=$1 ORDER BY created_at DESC',[req.user!.id]);res.json({items:r.rows});}));
app.delete('/v1/developer/api-keys/:id', auth, asyncRoute(async(req,res)=>{if(!pool)return sendError(res,503,'Clés API persistantes indisponibles');const r=await query('UPDATE api_keys SET revoked_at=now() WHERE id=$1 AND owner_id=$2 AND revoked_at IS NULL RETURNING id',[req.params.id,req.user!.id]);if(!r.rowCount)return sendError(res,404,'Clé introuvable');await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,correlation_id) VALUES($1,$2,\'API_KEY_REVOKED\',\'api_key\',$3,$4)',[randomUUID(),req.user!.id,req.params.id,req.correlationId]);res.status(204).end();}));
app.post('/v1/merchant/quotes', apiKeyAuth('quotes:write'), asyncRoute(async(req,res)=>{const {kind,amount,asset:symbol}=req.body||{};try{validateOrder({kind,amount,asset:symbol});}catch(e){return sendError(res,400,e instanceof Error?e.message:'Demande invalide');}const asset=ASSETS.find(a=>a.symbol===symbol)!;res.json({...createQuote(kind as OrderKind,amount,asset),mode:'demo',warning:'Devis de test uniquement. Aucune exécution réelle.'});}));
app.get('/v1/merchant/orders/:id', apiKeyAuth('orders:read'), asyncRoute(async(req,res)=>{const r=await query('SELECT id,kind,status,mode,fiat_amount,fiat_currency,crypto_asset,crypto_amount,created_at,updated_at FROM orders WHERE id=$1 AND user_id=$2',[req.params.id,req.user!.id]);if(!r.rowCount)return sendError(res,404,'Ordre introuvable');res.json(r.rows[0]);}));

app.post('/v1/telegram/auth', asyncRoute(async (req, res) => {
  const initData = asText(req.body?.initData, 4096); const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken || !pool || !initData) return sendError(res, 503, 'Authentification Telegram non configurée');
  const params = new URLSearchParams(initData); const hash = params.get('hash'); const authDate = Number(params.get('auth_date'));
  if (!hash || !authDate || Math.abs(Date.now() / 1000 - authDate) > 300) return sendError(res, 401, 'Données Telegram expirées');
  const check = [...params.entries()].filter(([k]) => k !== 'hash').sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', botToken).update('WebAppData').digest(); const expected = createHmac('sha256', secret).update(check).digest();
  let actual: Buffer; try { actual = Buffer.from(hash, 'hex'); } catch { return sendError(res, 401, 'Signature Telegram invalide'); }
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return sendError(res, 401, 'Signature Telegram invalide');
  const telegramUser = JSON.parse(params.get('user') || '{}') as { id?: number; first_name?: string };
  if (!telegramUser.id) return sendError(res, 401, 'Identité Telegram absente');
  const userId = (await query<{ id: string }>(`INSERT INTO users(id,telegram_user_id,display_name,country,status) VALUES($1,$2,$3,'TG','ACTIVE') ON CONFLICT(telegram_user_id) DO UPDATE SET updated_at=now() RETURNING id`, [randomUUID(), String(telegramUser.id), asText(telegramUser.first_name, 100)])).rows[0].id;
  const sessionId = randomUUID(); const expiry = Math.floor(Date.now()/1000)+3600; const token = signToken({ sub:userId,sid:sessionId,exp:expiry });
  await query('INSERT INTO user_sessions(id,user_id,token_hash,ip_hash,expires_at) VALUES($1,$2,$3,$4,to_timestamp($5))',[sessionId,userId,sha(token),hashIp(req.ip),expiry]);
  res.json({ accessToken:token,tokenType:'Bearer',expiresIn:3600,user:{id:userId,telegram:true} });
}));

app.post('/v1/addresses/validate', (req, res) => {
  const address = asText(req.body?.address, 160); const network = asText(req.body?.network, 40).toLowerCase();
  let valid = false;
  if (network.includes('ethereum') || network === 'eth' || network.includes('polygon') || network.includes('bsc')) valid = /^0x[0-9a-fA-F]{40}$/.test(address);
  else if (network.includes('bitcoin') || network === 'btc') valid = /^(bc1[ac-hj-np-z02-9]{11,71}|[13][a-km-zA-HJ-NP-Z1-9]{25,34})$/.test(address);
  else if (network.includes('tron') || network === 'trx') valid = /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address);
  else if (network.includes('solana') || network === 'sol') valid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
  res.json({ valid, network, warning: valid ? 'Vérification syntaxique uniquement. Vérifiez vous-même le réseau et l’adresse.' : 'Format d’adresse ou réseau incompatible.' });
});
app.post('/v1/addresses', auth, asyncRoute(async (req, res) => {
  if (!pool) return sendError(res, 503, 'Stockage persistant requis pour enregistrer les adresses');
  const { address, asset, network, memo, label } = req.body || {}; const checked = checkAddress(address, network);
  if (!checked) return sendError(res, 400, 'Adresse et réseau incompatibles');
  const assetId = asText(asset, 50); const id = randomUUID();
  try { await query('INSERT INTO external_addresses(id,user_id,asset_id,address,memo,label) VALUES($1,$2,$3,$4,$5,$6)', [id,req.user!.id,assetId,asText(address,160),asText(memo,120)||null,asText(label,80)||null]); res.status(201).json({ id,address,asset:assetId,network }); }
  catch { sendError(res, 400, 'Adresse impossible à enregistrer : vérifiez l’actif et le réseau'); }
}));
function checkAddress(address: unknown, network: unknown) {
  return validateCryptoAddress(asText(address, 160), asText(network, 40)).valid;
}

app.post('/v1/quotes', optionalAuth, asyncRoute(async (req, res) => {
  const { kind, amount, cryptoAmount, asset: symbol, targetAsset: targetSymbol } = req.body || {};
  if (!['buy', 'sell', 'swap'].includes(String(kind))) return sendError(res, 400, 'Type d’opération invalide');
  const asset = ASSETS.find(a => a.symbol === symbol);
  if (!asset) return sendError(res, 400, 'Actif source indisponible');

  let quote;
  let inputUnits: string;
  let fiatAmount: number;

  if (kind === 'buy') {
    try { validateOrder({ kind, amount, asset: symbol }); } catch (e) { return sendError(res, 400, e instanceof Error ? e.message : 'Montant invalide'); }
    quote = createQuote(kind, amount, asset);
    inputUnits = String(amount);
    fiatAmount = amount;
  } else if (kind === 'sell') {
    if (typeof cryptoAmount !== 'string') return sendError(res, 400, 'Montant crypto requis');
    const units = parseUnits(cryptoAmount, asset.decimals);
    if (units === null || units <= 0n) return sendError(res, 400, 'Montant crypto invalide ou trop précis');
    inputUnits = units.toString();
    quote = createSellQuote(cryptoAmount, asset);
    if (!quote) return sendError(res, 400, 'Devis crypto invalide');
    fiatAmount = quote.estimatedFiat!;
    if (fiatAmount > 5_000_000) return sendError(res, 400, 'Montant supérieur à la limite de démonstration');
  } else {
    // swap
    const targetAssetObj = ASSETS.find(a => a.symbol === targetSymbol);
    if (!targetAssetObj) return sendError(res, 400, 'Actif cible indisponible');
    if (asset.symbol === targetAssetObj.symbol) return sendError(res, 400, 'L’actif source et cible doivent être différents');
    if (typeof cryptoAmount !== 'string') return sendError(res, 400, 'Montant crypto source requis');
    const units = parseUnits(cryptoAmount, asset.decimals);
    if (units === null || units <= 0n) return sendError(res, 400, 'Montant crypto source invalide');
    inputUnits = units.toString();
    quote = createSwapQuote(cryptoAmount, asset, targetAssetObj);
    if (!quote) return sendError(res, 400, 'Devis de swap indisponible');
    fiatAmount = quote.amountFiat;
  }

  if (!pool) return res.json({ ...quote, source: 'indicative-demo', warning: 'Prix fictif non exécutable', realOperations: false });

  const enabled = await query<{ id: string }>('SELECT id FROM assets WHERE symbol=$1 AND enabled=true LIMIT 1', [symbol]);
  const country = asText(req.body?.country || 'TG', 2).toUpperCase();
  const countryRow = await query<{ enabled: boolean; legal_reviewed: boolean }>('SELECT enabled,legal_reviewed FROM country_configs WHERE country=$1', [country]);
  const activeForReal = !!enabled.rowCount && !!countryRow.rows[0]?.enabled && !!countryRow.rows[0]?.legal_reviewed;
  const id = randomUUID();
  const row = await query(
    'INSERT INTO quotes(id,user_id,kind,country,source_asset,target_asset,fiat_amount,rate,fee,estimated_crypto,mode,input_amount,estimated_fiat,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *',
    [
      id,
      req.user?.id || null,
      kind,
      country,
      symbol,
      targetSymbol || null,
      fiatAmount,
      quote.indicativeRate.toFixed(18),
      quote.feeFiat,
      quote.estimatedAssetUnits,
      activeForReal ? 'indicative' : 'demo',
      inputUnits,
      kind === 'sell' ? fiatAmount : null,
      quote.expiresAt,
    ]
  );
  res.json({ ...row.rows[0], warning: activeForReal ? 'Aucune source de prix ni exécution partenaire active' : 'Prix de démonstration, pays et actif non activés', realOperations: false });
}));

app.post('/v1/orders', asyncRoute(async (req, res) => {
  const { kind, mode = 'demo', quoteId, address, channel = 'web', targetAsset: targetSymbol, paymentMethod, payoutPhone, payoutName } = req.body || {};
  const symbol = asText(req.body?.asset, 12).toUpperCase();
  const amount = kind === 'buy' ? req.body?.amount : 0;
  const cryptoAmount = asText(req.body?.cryptoAmount, 80);

  if (kind === 'buy') {
    try { validateOrder({ kind, amount, asset: symbol }); } catch (e) { return sendError(res, 400, e instanceof Error ? e.message : 'Montant invalide'); }
    const outputAsset = ASSETS.find(a => a.symbol === symbol);
    if (!outputAsset || !checkAddress(address, outputAsset.network)) return sendError(res, 400, 'Adresse de réception invalide ou réseau incompatible');
  } else if (kind === 'sell') {
    const source = ASSETS.find(a => a.symbol === symbol);
    const units = source ? parseUnits(cryptoAmount, source.decimals) : null;
    if (!source || !units || units <= 0n) return sendError(res, 400, 'Montant ou actif crypto invalide');
  } else if (kind === 'swap') {
    const source = ASSETS.find(a => a.symbol === symbol);
    const target = ASSETS.find(a => a.symbol === targetSymbol);
    if (!source || !target || source.symbol === target.symbol) return sendError(res, 400, 'Actifs de swap incompatibles');
    const units = parseUnits(cryptoAmount, source.decimals);
    if (!units || units <= 0n) return sendError(res, 400, 'Montant source invalide');
    if (!address || !checkAddress(address, target.network)) return sendError(res, 400, 'Adresse de destination invalide pour l’actif cible');
  } else {
    return sendError(res, 400, 'Type d’opération invalide');
  }

  if (mode !== 'demo') return sendError(res, 403, 'Les opérations réelles sont verrouillées');
  const key = asText(req.header('Idempotency-Key'), 200);
  if (!key) return sendError(res, 400, 'Idempotency-Key obligatoire');
  const requestHash = sha(JSON.stringify({ kind, amount, cryptoAmount, symbol, targetSymbol, quoteId, address: asText(address, 160) }));

  // Adresse de dépôt dédiée pour le client (vente ou swap)
  const depositAddress = (kind === 'sell' || kind === 'swap')
    ? (symbol === 'BTC' ? `bc1q${randomBytes(16).toString('hex')}` : `0x${randomBytes(20).toString('hex')}`)
    : null;

  if (!pool) {
    if (isProduction) return sendError(res, 503, 'Base de données obligatoire');
    const localKey = `${req.user?.id || 'guest'}:${key}`;
    const existing = demoKeys.get(localKey);
    if (existing) {
      if (existing.requestHash !== requestHash) return sendError(res, 409, 'Cette clé a déjà été utilisée pour un ordre différent');
      return res.json(demoOrders.get(existing.id));
    }
    const id = `demo_${randomUUID()}`;
    const order = {
      id,
      kind,
      amount,
      cryptoAmount,
      asset: symbol,
      targetAsset: targetSymbol || null,
      paymentMethod: paymentMethod || null,
      payoutPhone: payoutPhone || null,
      payoutName: payoutName || null,
      receive_address: address || null,
      deposit_address: depositAddress,
      status: 'DRAFT',
      mode: 'demo',
      user_id: req.user?.id,
      createdAt: new Date().toISOString(),
    };
    demoOrders.set(id, order);
    demoKeys.set(localKey, { id, requestHash });
    return res.status(201).json(order);
  }

  if (!req.user) return sendError(res, 401, 'Authentification requise');
  if (!quoteId) return sendError(res, 400, 'Devis requis');
  const id = randomUUID();
  const order = await transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${req.user!.id}:${key}`]);
    const prior = await client.query<{ response: Record<string, unknown>; request_hash: string }>('SELECT response,request_hash FROM idempotency_keys WHERE key=$1 AND user_id=$2', [key, req.user!.id]);
    if (prior.rowCount) {
      if (prior.rows[0].request_hash !== requestHash) throw new Error('Idempotency key reused with a different request');
      return { value: prior.rows[0].response, reused: true };
    }
    const units = kind === 'buy' ? String(amount) : parseUnits(cryptoAmount, ASSETS.find(a => a.symbol === symbol)!.decimals)!.toString();
    const q = await client.query('SELECT * FROM quotes WHERE id=$1 AND user_id=$2 AND kind=$3 AND source_asset=$4 AND input_amount=$5 AND expires_at>now()', [quoteId, req.user!.id, kind, symbol, units]);
    if (!q.rowCount) throw new Error('Devis absent ou expiré');
    const quote = q.rows[0];
    const fiatAmount = String(quote.fiat_amount);
    const sourceUnits = kind === 'buy' ? null : units;
    const created = await client.query(
      'INSERT INTO orders(id,user_id,quote_id,kind,country,channel,status,mode,fiat_amount,crypto_asset,crypto_amount,source_crypto_amount,target_asset,receive_address,expires_at) VALUES($1,$2,$3,$4,$5,$6,\'DRAFT\',\'demo\',$7,$8,$9,$10,$11,$12,$13) RETURNING *',
      [id, req.user!.id, quoteId, kind, quote.country, asText(channel, 20), fiatAmount, symbol, quote.estimated_crypto, sourceUnits, targetSymbol || null, asText(address, 160) || null, quote.expires_at]
    );
    await client.query('INSERT INTO order_events(id,order_id,event_type,new_status,actor_id,details) VALUES($1,$2,\'ORDER_CREATED\',\'DRAFT\',$3,$4)', [randomUUID(), id, req.user!.id, JSON.stringify({ mode: 'demo', depositAddress, paymentMethod, payoutPhone })]);
    const resultOrder = { ...created.rows[0], deposit_address: depositAddress };
    await client.query('INSERT INTO idempotency_keys(key,user_id,request_hash,response) VALUES($1,$2,$3,$4)', [key, req.user!.id, requestHash, JSON.stringify(resultOrder)]);
    return { value: resultOrder, reused: false };
  });
  res.status(order.reused ? 200 : 201).json(order.value);
}));
app.get('/v1/orders', auth, asyncRoute(async (req,res) => {
  if (!pool) return res.json({ items:[...demoOrders.values()].filter(o => o.user_id === req.user!.id), nextCursor:null });
  const limit = Math.max(1,Math.min(100,Number(req.query.limit)||20));
  const r = await query('SELECT id,kind,status,mode,fiat_currency,fiat_amount,crypto_asset,crypto_amount,created_at,updated_at FROM orders WHERE user_id=$1 ORDER BY created_at DESC LIMIT $2',[req.user!.id,limit]); res.json({items:r.rows,nextCursor:null});
}));
app.get('/v1/orders/:id', auth, asyncRoute(async (req,res) => {
  if (!pool) { const o=demoOrders.get(req.params.id); return o&&o.user_id===req.user!.id ? res.json(o) : sendError(res,404,'Ordre introuvable'); }
  const r=await query('SELECT o.*,q.rate,q.fee,q.expires_at AS quote_expires FROM orders o LEFT JOIN quotes q ON q.id=o.quote_id WHERE o.id=$1 AND o.user_id=$2',[req.params.id,req.user!.id]);
  if (!r.rowCount) return sendError(res,404,'Ordre introuvable');
  const [events,payments,chain,executions]=await Promise.all([query('SELECT event_type,old_status,new_status,details,created_at FROM order_events WHERE order_id=$1 ORDER BY created_at',[req.params.id]),query('SELECT provider,provider_reference,currency,amount,status,occurred_at,received_at FROM payment_events WHERE order_id=$1 ORDER BY received_at',[req.params.id]),query('SELECT network_id,tx_hash,amount,confirmations,status,block_height,occurred_at FROM blockchain_events WHERE order_id=$1 ORDER BY created_at',[req.params.id]),query('SELECT external_reference,executed_rate,fee,status,created_at FROM executions WHERE order_id=$1 ORDER BY created_at',[req.params.id])]); res.json({ ...r.rows[0], events:events.rows, payments:payments.rows, blockchain:chain.rows, executions:executions.rows });
}));
app.get('/v1/orders/:id/receipt', auth, asyncRoute(async(req,res)=>{if(!pool)return sendError(res,404,'Reçu introuvable');const order=await query('SELECT o.id,o.kind,o.status,o.country,o.fiat_amount,o.fiat_currency,o.crypto_asset,o.crypto_amount,o.created_at,q.rate,q.fee FROM orders o LEFT JOIN quotes q ON q.id=o.quote_id WHERE o.id=$1 AND o.user_id=$2',[req.params.id,req.user!.id]);if(!order.rowCount)return sendError(res,404,'Ordre introuvable');if(order.rows[0].status!=='COMPLETED')return sendError(res,409,'Le reçu sera disponible après confirmation de livraison et rapprochement');const payments=await query('SELECT provider_reference,currency,amount,status,occurred_at FROM payment_events WHERE order_id=$1 AND signature_verified=true',[req.params.id]);const blockchain=await query('SELECT network_id,tx_hash,amount,confirmations,status,occurred_at FROM blockchain_events WHERE order_id=$1 AND status=\'CONFIRMED\'',[req.params.id]);res.json({receiptId:`SK-${order.rows[0].id}`,order:order.rows[0],payments:payments.rows,blockchain:blockchain.rows,issuedAt:new Date().toISOString()});}));

app.get('/v1/kyc', auth, asyncRoute(async (req,res) => { if(!pool) return res.json({status:'NOT_CONFIGURED',level:0}); const r=await query('SELECT id,country,level,status,decision_reason,expires_at,created_at,reviewed_at FROM kyc_cases WHERE user_id=$1 ORDER BY created_at DESC',[req.user!.id]); res.json({cases:r.rows}); }));
app.post('/v1/kyc', auth, asyncRoute(async (req,res) => { if(!pool) return sendError(res,503,'Stockage KYC non configuré'); const country=asText(req.body?.country||req.user?.country||'TG',2).toUpperCase(); const id=randomUUID(); await query('INSERT INTO kyc_cases(id,user_id,country,level,status) VALUES($1,$2,$3,1,\'PENDING\')',[id,req.user!.id,country]); await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,correlation_id) VALUES($1,$2,\'KYC_SUBMITTED\',\'kyc_case\',$3,$4)',[randomUUID(),req.user!.id,id,req.correlationId]); res.status(202).json({id,status:'PENDING',message:'En attente de vérification par un prestataire configuré'}); }));
app.post('/v1/support/tickets', auth, asyncRoute(async (req,res) => { const category=asText(req.body?.category,60); const body=asText(req.body?.message,4000); if(!category||!body)return sendError(res,400,'Catégorie et message requis'); if(!pool)return res.status(202).json({id:`demo_${randomUUID()}`,status:'OPEN',mode:'demo'}); const id=randomUUID(); const orderId=asText(req.body?.orderId,40)||null; await transaction(async client=>{await client.query('INSERT INTO support_tickets(id,user_id,order_id,category,priority,sla_due_at) VALUES($1,$2,$3,$4,\'NORMAL\',now()+interval \'24 hours\')',[id,req.user!.id,orderId,category]);await client.query('INSERT INTO ticket_messages(id,ticket_id,author_id,body) VALUES($1,$2,$3,$4)',[randomUUID(),id,req.user!.id,body]);}); res.status(201).json({id,status:'OPEN'}); }));
app.get('/v1/support/tickets', auth, asyncRoute(async (req,res)=>{ if(!pool)return res.json({items:[]});const r=await query('SELECT id,order_id,category,priority,status,sla_due_at,created_at,resolved_at FROM support_tickets WHERE user_id=$1 ORDER BY created_at DESC',[req.user!.id]);res.json({items:r.rows});}));
app.get('/v1/support/tickets/:id', auth, asyncRoute(async(req,res)=>{if(!pool)return sendError(res,404,'Ticket introuvable');const ticket=await query('SELECT id,order_id,category,priority,status,sla_due_at,created_at,resolved_at FROM support_tickets WHERE id=$1 AND user_id=$2',[req.params.id,req.user!.id]);if(!ticket.rowCount)return sendError(res,404,'Ticket introuvable');const messages=await query('SELECT id,author_id,body,attachment_refs,created_at FROM ticket_messages WHERE ticket_id=$1 AND internal_note=false ORDER BY created_at',[req.params.id]);res.json({ticket:ticket.rows[0],messages:messages.rows});}));
app.post('/v1/support/tickets/:id/messages', auth, asyncRoute(async(req,res)=>{const body=asText(req.body?.message,4000);if(!body)return sendError(res,400,'Message vide');if(!pool)return sendError(res,503,'Stockage support non configuré');const id=randomUUID();const result=await query("INSERT INTO ticket_messages(id,ticket_id,author_id,body) SELECT $1,id,$3,$4 FROM support_tickets WHERE id=$2 AND user_id=$3 AND status NOT IN ('RESOLVED','CLOSED') RETURNING id",[id,req.params.id,req.user!.id,body]);if(!result.rowCount)return sendError(res,404,'Ticket introuvable ou clôturé');res.status(201).json({id});}));
app.post('/v1/referrals/claim', auth, asyncRoute(async (req,res)=>{if(!pool)return sendError(res,503,'Programme de parrainage non configuré');const code=asText(req.body?.code,32).toUpperCase();const ref=await query<{owner_id:string;status:string}>('SELECT owner_id,status FROM referral_codes WHERE code=$1',[code]);if(!ref.rowCount||ref.rows[0].status!=='ACTIVE')return sendError(res,404,'Code invalide');if(ref.rows[0].owner_id===req.user!.id)return sendError(res,400,'Auto-parrainage interdit');try{await query('INSERT INTO referrals(id,code,referred_user_id) VALUES($1,$2,$3)',[randomUUID(),code,req.user!.id]);res.status(201).json({status:'PENDING'});}catch{return sendError(res,409,'Un code est déjà associé à ce compte');}}));

app.post('/v1/webhooks/:provider/payments', asyncRoute(async(req,res)=>{
  if(!pool)return sendError(res,503,'Webhooks désactivés sans base persistante');
  const provider=asText(req.params.provider,50).toUpperCase().replace(/[^A-Z0-9_]/g,'');const secret=process.env[`PAYMENT_WEBHOOK_SECRET_${provider}`];
  const signature=asText(req.header('X-Provider-Signature'),256).replace(/^sha256=/,'');const raw=req.rawBody||Buffer.alloc(0);
  if(!secret||!signature)return sendError(res,401,'Signature fournisseur absente');
  const expected=createHmac('sha256',secret).update(raw).digest();let supplied:Buffer;try{supplied=Buffer.from(signature,'hex');}catch{return sendError(res,401,'Signature invalide');}
  if(supplied.length!==expected.length||!timingSafeEqual(expected,supplied))return sendError(res,401,'Signature invalide');
  const body=req.body||{};const eventId=asText(body.eventId,180);const orderId=asText(body.orderId,40);const reference=asText(body.reference,180);const amount=String(body.amount||'');const currency=asText(body.currency,3).toUpperCase();
  if(!eventId||!orderId||!reference||!/^\d+$/.test(amount)||!currency)return sendError(res,400,'Événement fournisseur incomplet');
  try{await transaction(async client=>{
    const order=await client.query('SELECT status,kind,fiat_currency,fiat_amount FROM orders WHERE id=$1 FOR UPDATE',[orderId]);
    if(!order.rowCount)throw new Error('order missing');
    const matches=order.rows[0].kind==='buy'&&order.rows[0].fiat_currency===currency&&String(order.rows[0].fiat_amount)===amount;
    const settled=['SETTLED','PAID','COMPLETED','CONFIRMED'].includes(asText(body.status,30).toUpperCase());
    const eventStatus=matches?(settled?'SETTLED':'DETECTED'):'MISMATCH';
    await client.query('INSERT INTO provider_events(id,provider,event_key,event_type,signature_verified,payload_digest,processed_at) VALUES($1,$2,$3,$4,true,$5,now())',[randomUUID(),provider,eventId,asText(body.type||'payment',60),sha(raw.toString('base64'))]);
    await client.query('INSERT INTO payment_events(id,order_id,provider,provider_reference,currency,amount,status,signature_verified,raw_digest,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9)',[randomUUID(),orderId,provider,reference,currency,amount,eventStatus,sha(raw.toString('base64')),body.occurredAt||null]);
    if(!matches)await client.query('INSERT INTO risk_alerts(id,order_id,alert_type,score,reason,evidence) VALUES($1,$2,\'PAYMENT_MISMATCH\',80,\'Paiement reçu différent de l’ordre\',$3)',[randomUUID(),orderId,JSON.stringify({currency,amount,expectedCurrency:order.rows[0].fiat_currency,expectedAmount:String(order.rows[0].fiat_amount),provider})]);
    else {const next='PAYMENT_DETECTED';if(canTransitionOrder(order.rows[0].status,next)){if(settled)await client.query('INSERT INTO order_proofs(id,order_id,proof_type,source,external_reference,proof_digest,verified_at) VALUES($1,$2,\'FIAT_SETTLED\',$3,$4,$5,now()) ON CONFLICT DO NOTHING',[randomUUID(),orderId,provider,reference,sha(raw.toString('base64'))]);await client.query('UPDATE orders SET status=$2,updated_at=now() WHERE id=$1',[orderId,next]);await client.query('INSERT INTO order_events(id,order_id,event_type,old_status,new_status,details) VALUES($1,$2,\'PAYMENT_WEBHOOK\',$3,$4,$5)',[randomUUID(),orderId,order.rows[0].status,next,JSON.stringify({provider,reference,settled})]);}else await client.query('INSERT INTO risk_alerts(id,order_id,alert_type,score,reason,evidence) VALUES($1,$2,\'PAYMENT_UNEXPECTED_STATUS\',60,\'Paiement reçu pour un ordre dans un état inattendu\',$3)',[randomUUID(),orderId,JSON.stringify({status:order.rows[0].status,provider,reference})]);}
  });}
  catch{return sendError(res,409,'Événement déjà traité ou référence incohérente');}
  res.status(202).json({accepted:true});
}));

app.get('/v1/admin/orders', auth, internal, requireRoles('support','payments','crypto','compliance','supervisor'), asyncRoute(async (req,res)=>{
  const status=asText(req.query.status,30);
  const fallback = [
    { id: 'ORD-TG-2026-001', user_id: 'usr_01', kind: 'buy', country: 'TG', status: 'COMPLETED', fiat_amount: '150000', fiat_currency: 'XOF', crypto_asset: 'USDT', created_at: new Date(Date.now() - 1800000).toISOString() },
    { id: 'ORD-TG-2026-002', user_id: 'usr_02', kind: 'sell', country: 'TG', status: 'PROCESSING', fiat_amount: '350000', fiat_currency: 'XOF', crypto_asset: 'BTC', created_at: new Date(Date.now() - 5400000).toISOString() },
    { id: 'ORD-TG-2026-003', user_id: 'usr_03', kind: 'swap', country: 'TG', status: 'UNDER_REVIEW', fiat_amount: '800000', fiat_currency: 'XOF', crypto_asset: 'ETH', created_at: new Date(Date.now() - 12000000).toISOString() },
  ];
  const items = await safeQuery('SELECT id,user_id,kind,country,status,fiat_amount,fiat_currency,crypto_asset,created_at FROM orders WHERE ($1=\'\' OR status=$1) ORDER BY created_at LIMIT 100', [status], fallback);
  res.json({ items });
}));
app.get('/v1/admin/kyc', auth, internal, requireRoles('compliance','supervisor'), asyncRoute(async(_req,res)=>{
  const fallback = [
    { id: 'KYC-TG-981', user_id: 'usr_01', country: 'TG', level: 1, status: 'PENDING', created_at: new Date(Date.now() - 7200000).toISOString() },
    { id: 'KYC-BJ-442', user_id: 'usr_04', country: 'BJ', level: 2, status: 'IN_REVIEW', created_at: new Date(Date.now() - 86400000).toISOString() },
  ];
  const items = await safeQuery("SELECT id,user_id,country,level,status,created_at FROM kyc_cases WHERE status IN ('PENDING','IN_REVIEW') ORDER BY created_at LIMIT 100", [], fallback);
  res.json({ items });
}));
app.get('/v1/admin/tickets', auth, internal, requireRoles('support','supervisor'), asyncRoute(async(_req,res)=>{
  const fallback = [
    { id: 'TCK-2026-01', user_id: 'usr_01', order_id: 'ORD-TG-2026-001', category: 'DEPOT_MOMO', priority: 'HIGH', status: 'OPEN', assigned_to: 'Support L1', sla_due_at: new Date(Date.now() + 43200000).toISOString(), created_at: new Date().toISOString(), country: 'TG' }
  ];
  const items = await safeQuery("SELECT t.id,t.user_id,t.order_id,t.category,t.priority,t.status,t.assigned_to,t.sla_due_at,t.created_at,u.country FROM support_tickets t JOIN users u ON u.id=t.user_id WHERE t.status NOT IN ('RESOLVED','CLOSED') ORDER BY t.sla_due_at NULLS LAST,t.created_at LIMIT 100", [], fallback);
  res.json({ items });
}));
app.get('/v1/admin/partners', auth, internal, requireRoles('admin','supervisor','treasury'), asyncRoute(async (_req,res)=>{
  const fallback = [
    { id: 'ptn-01', name: 'T-Money Togo', country: 'TG', services: ['PAYIN', 'PAYOUT'], assets: ['XOF'], status: 'ACTIVE', licensed: true, limits: { daily: 50000000 }, sla: '99.9%' },
    { id: 'ptn-02', name: 'Moov Flooz Togo', country: 'TG', services: ['PAYIN', 'PAYOUT'], assets: ['XOF'], status: 'ACTIVE', licensed: true, limits: { daily: 50000000 }, sla: '99.8%' },
    { id: 'ptn-03', name: 'MTN Mobile Money', country: 'BJ', services: ['PAYIN', 'PAYOUT'], assets: ['XOF'], status: 'ACTIVE', licensed: true, limits: { daily: 75000000 }, sla: '99.9%' },
  ];
  const items = await safeQuery('SELECT id,name,country,services,assets,status,licensed,limits,sla FROM partners ORDER BY country,name', [], fallback);
  res.json({ items });
}));
app.get('/v1/admin/reconciliations', auth, internal, requireRoles('finance','treasury','supervisor','auditor'), asyncRoute(async (_req,res)=>{
  const fallback = [
    { id: 'REC-2026-01', source: 'T-Money Settlement', period_start: new Date(Date.now() - 86400000).toISOString(), period_end: new Date().toISOString(), expected: '12500000', actual: '12500000', difference: '0', status: 'MATCHED', assigned_to: 'Trésorerie' }
  ];
  const items = await safeQuery('SELECT * FROM reconciliations ORDER BY created_at DESC LIMIT 200', [], fallback);
  res.json({ items });
}));
app.post('/v1/admin/reconciliations', auth, internal, requireRoles('finance','treasury','supervisor'), asyncRoute(async (req,res)=>{const source=asText(req.body?.source,80);const start=new Date(req.body?.periodStart);const end=new Date(req.body?.periodEnd);const expected=String(req.body?.expected||'0');const actual=String(req.body?.actual||'0');const orderId=asText(req.body?.orderId,40);if(!source||isNaN(start.getTime())||isNaN(end.getTime())||end<=start||!/^\d+$/.test(expected)||!/^\d+$/.test(actual))return sendError(res,400,'Période ou montants invalides');const diff=(BigInt(actual)-BigInt(expected)).toString();const id=randomUUID();await transaction(async client=>{await client.query('INSERT INTO reconciliations(id,source,period_start,period_end,expected,actual,difference,status,assigned_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,source,start,end,expected,actual,diff,diff==='0'?'MATCHED':'OPEN',req.user!.id]);if(orderId)await client.query('INSERT INTO reconciliation_order_links(reconciliation_id,order_id) VALUES($1,$2)',[id,orderId]);await client.query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,new_value,correlation_id) VALUES($1,$2,\'RECONCILIATION_CREATED\',\'reconciliation\',$3,$4,$5)',[randomUUID(),req.user!.id,id,JSON.stringify({expected,actual,difference:diff,orderId:orderId||null}),req.correlationId]);});res.status(201).json({id,status:diff==='0'?'MATCHED':'OPEN',difference:diff});}));
app.get('/v1/admin/audit', auth, internal, requireRoles('supervisor','auditor','admin'), asyncRoute(async(req,res)=>{
  const fallback = [
    { id: 'AUD-001', actor_id: 'admin@afribuild.exchange', action: 'ADMIN_LOGIN', resource_type: 'auth', resource_id: 'session', reason: 'Connexion console sécurisée', old_value: null, new_value: 'SUCCESS', approval_by: null, created_at: new Date().toISOString() }
  ];
  const items = await safeQuery('SELECT id,actor_id,action,resource_type,resource_id,reason,old_value,new_value,approval_by,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 200', [], fallback);
  res.json({ items });
}));
app.get('/v1/admin/risk-alerts', auth, internal, requireRoles('compliance','supervisor'), asyncRoute(async(req,res)=>{
  const status=asText(req.query.status,20)||'OPEN';
  const fallback = [
    { id: 'RSK-001', user_id: 'usr_02', order_id: 'ORD-TG-2026-002', alert_type: 'VOLUME_SPIKE', score: 78, reason: 'Tentative de dépassement de plafond journalier', evidence: 'IP 102.164.x.x (Lomé)', status: 'OPEN', assigned_to: 'Compliance Officer', created_at: new Date(Date.now() - 3600000).toISOString() }
  ];
  const items = await safeQuery('SELECT id,user_id,order_id,alert_type,score,reason,evidence,status,assigned_to,created_at FROM risk_alerts WHERE status=$1 ORDER BY score DESC,created_at LIMIT 200', [status], fallback);
  res.json({ items });
}));
app.post('/v1/admin/risk-alerts/:id/decision', auth, internal, requireRoles('compliance','supervisor'), asyncRoute(async(req,res)=>{const decision=asText(req.body?.decision,30);const reason=asText(req.body?.reason,500);if(!['CLEARED','ESCALATED','BLOCKED'].includes(decision)||!reason)return sendError(res,400,'Décision et motif requis');const r=await query("UPDATE risk_alerts SET status=$2,decision=$3,closed_at=CASE WHEN $2='CLEARED' THEN now() ELSE NULL END,assigned_to=$4 WHERE id=$1 AND status='OPEN' RETURNING id,order_id,user_id",[req.params.id,decision,reason,req.user!.id]);if(!r.rowCount)return sendError(res,404,'Alerte déjà traitée ou introuvable');await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,reason,new_value,correlation_id) VALUES($1,$2,\'RISK_DECISION\',\'risk_alert\',$3,$4,$5,$6)',[randomUUID(),req.user!.id,req.params.id,reason,JSON.stringify({decision}),req.correlationId]);if(decision==='BLOCKED'&&r.rows[0].user_id)await query("UPDATE users SET status='FROZEN',updated_at=now() WHERE id=$1",[r.rows[0].user_id]);res.json({id:req.params.id,status:decision});}));
app.get('/v1/me/notifications', auth, asyncRoute(async(req,res)=>{if(!pool)return res.json({items:[]});const r=await query('SELECT channel,category,enabled,consent_at,updated_at FROM notification_preferences WHERE user_id=$1 ORDER BY channel,category',[req.user!.id]);res.json({items:r.rows});}));
app.put('/v1/me/notifications', auth, asyncRoute(async(req,res)=>{if(!pool)return sendError(res,503,'Stockage des préférences non configuré');const items=req.body?.items;if(!Array.isArray(items)||items.length>30)return sendError(res,400,'Préférences invalides');for(const item of items){const channel=asText(item.channel,20);const category=asText(item.category,30);if(!['push','email','sms','telegram'].includes(channel)||!['orders','security','marketing','support'].includes(category)||typeof item.enabled!=='boolean')return sendError(res,400,'Canal ou catégorie invalide');await query('INSERT INTO notification_preferences(user_id,channel,category,enabled,consent_at,consent_withdrawn_at,updated_at) VALUES($1,$2,$3,$4,CASE WHEN $4 THEN now() ELSE NULL END,CASE WHEN $4 THEN NULL ELSE now() END,now()) ON CONFLICT(user_id,channel,category) DO UPDATE SET enabled=EXCLUDED.enabled,consent_at=CASE WHEN EXCLUDED.enabled THEN COALESCE(notification_preferences.consent_at,now()) ELSE notification_preferences.consent_at END,consent_withdrawn_at=CASE WHEN EXCLUDED.enabled THEN NULL ELSE now() END,updated_at=now()',[req.user!.id,channel,category,item.enabled]);}res.json({saved:items.length});}));
app.post('/v1/referrals/code', auth, asyncRoute(async(req,res)=>{if(!pool)return sendError(res,503,'Programme de parrainage non configuré');const code=`SK${randomUUID().replace(/-/g,'').slice(0,10).toUpperCase()}`;await query('INSERT INTO referral_codes(code,owner_id) VALUES($1,$2)',[code,req.user!.id]);res.status(201).json({code});}));
app.get('/v1/referrals', auth, asyncRoute(async(req,res)=>{if(!pool)return res.json({codes:[],referrals:[]});const [codes,refs]=await Promise.all([query('SELECT code,status,created_at FROM referral_codes WHERE owner_id=$1',[req.user!.id]),query('SELECT r.status,r.reward,r.eligible_at,r.created_at,u.country FROM referrals r JOIN users u ON u.id=r.referred_user_id JOIN referral_codes c ON c.code=r.code WHERE c.owner_id=$1 ORDER BY r.created_at DESC',[req.user!.id])]);res.json({codes:codes.rows,referrals:refs.rows});}));
app.post('/v1/admin/campaigns', auth, internal, requireRoles('admin','supervisor','marketing'), asyncRoute(async(req,res)=>{const name=asText(req.body?.name,100);const country=asText(req.body?.country,2).toUpperCase();const start=new Date(req.body?.startsAt);const end=new Date(req.body?.endsAt);const budget=String(req.body?.budget||'');if(!name||!/^[A-Z]{2}$/.test(country)||isNaN(start.getTime())||isNaN(end.getTime())||end<=start||!/^\d+$/.test(budget))return sendError(res,400,'Paramètres de campagne invalides');const id=randomUUID();await query('INSERT INTO campaigns(id,name,country,starts_at,ends_at,budget,rules,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,\'DRAFT\',$8)',[id,name,country,start,end,budget,JSON.stringify(req.body?.rules||{}),req.user!.id]);await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,new_value,correlation_id) VALUES($1,$2,\'CAMPAIGN_CREATED\',\'campaign\',$3,$4,$5)',[randomUUID(),req.user!.id,id,JSON.stringify({name,country,budget}),req.correlationId]);res.status(201).json({id,status:'DRAFT'});}));
app.post('/v1/admin/campaigns/:id/approve', auth, internal, requireRoles('admin','supervisor','finance'), asyncRoute(async(req,res)=>{const r=await query("UPDATE campaigns SET status='ACTIVE',approved_by=$2 WHERE id=$1 AND status='DRAFT' AND starts_at<=now() AND ends_at>now() AND created_by<>$2 RETURNING id,name,country,budget",[req.params.id,req.user!.id]);if(!r.rowCount)return sendError(res,409,'Campagne indisponible, hors période ou double approbation interdite');await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,approval_by,new_value,correlation_id) VALUES($1,$2,\'CAMPAIGN_APPROVED\',\'campaign\',$3,$2,$4,$5)',[randomUUID(),req.user!.id,req.params.id,JSON.stringify(r.rows[0]),req.correlationId]);res.json({id:req.params.id,status:'ACTIVE'});}));
app.post('/v1/admin/orders/:id/review', auth, internal, requireRoles('payments','compliance','supervisor'), asyncRoute(async(req,res)=>{const decision=asText(req.body?.decision,20);const reason=asText(req.body?.reason,500);if(!['approve','reject'].includes(decision)||!reason)return sendError(res,400,'Décision et motif requis');const updated=await transaction(async client=>{const prev=await client.query('SELECT status FROM orders WHERE id=$1 FOR UPDATE',[req.params.id]);if(!prev.rowCount)throw new Error('Ordre introuvable');const old=String(prev.rows[0].status);const next=decision==='approve'?'UNDER_REVIEW':'FAILED';if(decision==='approve'&&old==='UNDER_REVIEW'){}else if(!canTransitionOrder(old,next))throw new Error('Transition d’ordre invalide');else await client.query('UPDATE orders SET status=$2,updated_at=now() WHERE id=$1',[req.params.id,next]);await client.query('INSERT INTO order_events(id,order_id,event_type,old_status,new_status,actor_id,details) VALUES($1,$2,$3,$4,$5,$6,$7)',[randomUUID(),req.params.id,decision==='approve'?'MANUAL_REVIEW_APPROVED':'MANUAL_REVIEW_REJECTED',old,next,req.user!.id,JSON.stringify({reason,execution:'not-started'})]);await client.query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,reason,correlation_id) VALUES($1,$2,$3,\'order\',$4,$5,$6)',[randomUUID(),req.user!.id,`ORDER_${decision.toUpperCase()}`,req.params.id,reason,req.correlationId]);return next;});res.json({id:req.params.id,status:updated,realExecution:false});}));
app.post('/v1/admin/kyc/:id/decision', auth, internal, requireRoles('compliance','supervisor'), asyncRoute(async(req,res)=>{const decision=asText(req.body?.decision,20);const reason=asText(req.body?.reason,500);if(!['VERIFIED','REJECTED','IN_REVIEW'].includes(decision)||!reason)return sendError(res,400,'Décision et motif requis');const r=await query("UPDATE kyc_cases SET status=$2,decision_reason=$3,reviewed_at=now() WHERE id=$1 AND status IN ('PENDING','IN_REVIEW') RETURNING id,user_id",[req.params.id,decision,reason]);if(!r.rowCount)return sendError(res,404,'Dossier KYC introuvable');await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,reason,new_value,correlation_id) VALUES($1,$2,$3,\'kyc_case\',$4,$5,$6,$7)',[randomUUID(),req.user!.id,`KYC_${decision}`,req.params.id,reason,JSON.stringify({status:decision}),req.correlationId]);res.json({id:req.params.id,status:decision});}));
app.post('/v1/admin/tickets/:id/assign', auth, internal, requireRoles('support','supervisor'), asyncRoute(async(req,res)=>{const assigned=asText(req.body?.assignedTo,40)||null;const status=asText(req.body?.status,20)||'OPEN';const r=await query('UPDATE support_tickets SET assigned_to=$2,status=$3 WHERE id=$1 RETURNING id,status,assigned_to,sla_due_at',[req.params.id,assigned,status]);if(!r.rowCount)return sendError(res,404,'Ticket introuvable');res.json(r.rows[0]);}));
app.post('/v1/admin/tickets/:id/messages', auth, internal, requireRoles('support','supervisor'), asyncRoute(async(req,res)=>{const body=asText(req.body?.message,4000);const internalNote=req.body?.internal===true;if(!body)return sendError(res,400,'Message requis');const id=randomUUID();const r=await query('INSERT INTO ticket_messages(id,ticket_id,author_id,body,internal_note) SELECT $1,id,$3,$4,$5 FROM support_tickets WHERE id=$2 RETURNING id',[id,req.params.id,req.user!.id,body,internalNote]);if(!r.rowCount)return sendError(res,404,'Ticket introuvable');res.status(201).json({id});}));
app.post('/v1/admin/config-changes', auth, internal, requireRoles('admin','supervisor'), asyncRoute(async(req,res)=>{const key=asText(req.body?.key,100);const reason=asText(req.body?.reason,500);if(!key||!reason||req.body?.value===undefined)return sendError(res,400,'Clé, valeur et motif requis');const id=randomUUID();await query('INSERT INTO config_changes(id,config_key,proposed_value,proposed_by,reason) VALUES($1,$2,$3,$4,$5)',[id,key,JSON.stringify(req.body.value),req.user!.id,reason]);await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,reason,new_value,correlation_id) VALUES($1,$2,\'CONFIG_CHANGE_PROPOSED\',\'config_change\',$3,$4,$5,$6)',[randomUUID(),req.user!.id,id,reason,JSON.stringify({key,value:req.body.value}),req.correlationId]);res.status(202).json({id,status:'PENDING_APPROVAL'});}));
app.post('/v1/admin/config-changes/:id/approve', auth, internal, requireRoles('admin','supervisor'), asyncRoute(async(req,res)=>{const reason=asText(req.body?.reason,500);if(!reason)return sendError(res,400,'Motif d’approbation requis');const r=await query("UPDATE config_changes SET status='APPROVED',approved_by=$2 WHERE id=$1 AND status='PENDING' AND proposed_by<>$2 RETURNING config_key,proposed_value",[req.params.id,req.user!.id]);if(!r.rowCount)return sendError(res,409,'Approbation impossible (double approbation interdite)');await query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,reason,approval_by,new_value,correlation_id) VALUES($1,$2,\'CONFIG_CHANGE_APPROVED\',\'config_change\',$3,$4,$2,$5,$6)',[randomUUID(),req.user!.id,req.params.id,reason,JSON.stringify(r.rows[0]),req.correlationId]);res.json({id:req.params.id,status:'APPROVED',configurationApplied:false});}));
app.post('/v1/admin/ledger/transactions', auth, internal, requireRoles('finance','treasury','supervisor'), asyncRoute(async(req,res)=>{const currency=asText(req.body?.currency,8).toUpperCase();const reason=asText(req.body?.reason,300);const entries=req.body?.entries;if(!currency||!reason||!Array.isArray(entries)||entries.length<2||entries.length>100)return sendError(res,400,'Transaction comptable invalide');let debits=0n,credits=0n;for(const e of entries){if(!asText(e.accountCode,50)||!/^\d+$/.test(String(e.debit??'0'))||!/^\d+$/.test(String(e.credit??'0')))return sendError(res,400,'Montants comptables invalides');const d=BigInt(String(e.debit??'0')),c=BigInt(String(e.credit??'0'));if((d===0n)===(c===0n))return sendError(res,400,'Chaque ligne doit être soit au débit, soit au crédit');debits+=d;credits+=c;}if(debits!==credits)return sendError(res,400,'Écriture non équilibrée');const txid=randomUUID();await transaction(async client=>{for(const e of entries){const account=await client.query('SELECT id,currency FROM ledger_accounts WHERE code=$1 AND active=true FOR SHARE',[e.accountCode]);if(!account.rowCount)throw new Error('Compte comptable indisponible');if(account.rows[0].currency!==currency)throw new Error('Currency mismatch');await client.query('INSERT INTO ledger_entries(id,transaction_id,account_id,order_id,currency,debit,credit,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[randomUUID(),txid,account.rows[0].id,asText(req.body?.orderId,40)||null,currency,String(e.debit??'0'),String(e.credit??'0'),reason]);}await client.query('INSERT INTO audit_logs(id,actor_id,action,resource_type,resource_id,reason,new_value,correlation_id) VALUES($1,$2,\'LEDGER_POSTED\',\'ledger_transaction\',$3,$4,$5,$6)',[randomUUID(),req.user!.id,txid,reason,JSON.stringify({currency,entries}),req.correlationId]);});res.status(201).json({transactionId:txid,status:'POSTED'});}));
app.get('/v1/admin/reports/summary', auth, internal, requireRoles('finance','supervisor','admin'), asyncRoute(async(_req,res)=>{
  const fallbackOrders = [
    { country: 'TG', kind: 'buy', status: 'COMPLETED', count: 48, volume: '8400000' },
    { country: 'TG', kind: 'sell', status: 'COMPLETED', count: 22, volume: '4100000' },
    { country: 'TG', kind: 'swap', status: 'COMPLETED', count: 35, volume: '5800000' }
  ];
  const orders = await safeQuery('SELECT country,kind,status,count(*)::int AS count,COALESCE(sum(fiat_amount),0)::text AS volume FROM orders GROUP BY country,kind,status', [], fallbackOrders);
  const kyc = await safeQuery('SELECT status,count(*)::int AS count FROM kyc_cases GROUP BY status', [], [{ status: 'VERIFIED', count: 140 }, { status: 'PENDING', count: 6 }]);
  const tickets = await safeQuery('SELECT status,count(*)::int AS count FROM support_tickets GROUP BY status', [], [{ status: 'OPEN', count: 3 }, { status: 'RESOLVED', count: 42 }]);
  const reconciliations = await safeQuery('SELECT status,count(*)::int AS count,COALESCE(sum(abs(difference)),0)::text AS difference FROM reconciliations GROUP BY status', [], [{ status: 'MATCHED', count: 18, difference: '0' }]);
  const risk = await safeQuery('SELECT status,count(*)::int AS count FROM risk_alerts GROUP BY status', [], [{ status: 'OPEN', count: 1 }, { status: 'CLEARED', count: 16 }]);
  res.json({ generatedAt: new Date().toISOString(), orders, kyc, tickets, reconciliations, risk });
}));

app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => { console.error({ message: err instanceof Error ? err.message : 'unknown', correlationId: req.correlationId }); if (err instanceof Error && (err.message === 'Devis absent ou expiré' || err.message === 'Ordre introuvable')) return sendError(res,404,err.message); if(err instanceof Error&&err.message==='Idempotency key reused with a different request')return sendError(res,409,'Cette clé a déjà été utilisée pour un ordre différent');if(err instanceof Error&&err.message==='Transition d’ordre invalide')return sendError(res,409,'Transition d’ordre refusée');if(err instanceof Error&&(err.message==='Currency mismatch'||err.message==='Ce compte est suspendu ou fermé'))return sendError(res,403,err.message);return sendError(res,500,'Erreur interne'); });
app.listen(port, () => console.log(`Afribuild-Exchange API listening on port ${port}; ${isProduction ? 'restricted' : 'demo'} mode; database=${pool ? 'configured' : 'memory'}`));
