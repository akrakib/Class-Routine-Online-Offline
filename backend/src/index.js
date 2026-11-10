const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fail = (message, status = 400) => json({ error: message }, status);
const encoder = new TextEncoder();
const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
const hex = bytes => [...new Uint8Array(bytes)].map(x => x.toString(16).padStart(2, '0')).join('');
async function sha256(value) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
async function verifyPassword(password, salt, expected) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: Uint8Array.from(atob(salt), c => c.charCodeAt(0)), iterations: 310000, hash: 'SHA-256' }, key, 256);
  const actual = b64url(bits);
  return actual === expected;
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = new Set([env.APP_ORIGIN, ...(env.ALLOWED_ORIGINS || '').split(',').map(x => x.trim()).filter(Boolean)]);
  const headers = { 'Vary': 'Origin' };
  if (origin && allowed.has(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers['Access-Control-Allow-Credentials'] = 'true'; }
  headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS';
  headers['Access-Control-Allow-Headers'] = 'Content-Type, If-None-Match';
  headers['Access-Control-Expose-Headers'] = 'ETag';
  return headers;
}
function withCors(response, request, env) { const h = new Headers(response.headers); for (const [k,v] of Object.entries(corsHeaders(request, env))) h.set(k,v); return new Response(response.body,{status:response.status,headers:h}); }
async function bodyJson(request) { try { return await request.json(); } catch { return null; } }
function validText(v, max=160) { return typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max; }
function cookie(request, name) { const raw = request.headers.get('Cookie') || ''; const item = raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'=')); return item ? item.slice(name.length+1) : ''; }
async function adminSession(request, env) {
  const token = cookie(request, 'cr_admin'); if (!token) return null;
  const hash = await sha256(token);
  return env.DB.prepare(`SELECT s.admin_id, u.username FROM admin_sessions s JOIN admin_users u ON u.id=s.admin_id WHERE s.token_hash=? AND s.expires_at > datetime('now')`).bind(hash).first();
}
async function authRateLimit(request, env) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown'; const key = await sha256(ip);
  const row = await env.DB.prepare('SELECT attempts, window_started_at, blocked_until FROM auth_attempts WHERE ip_key=?').bind(key).first();
  const now = Math.floor(Date.now()/1000);
  if (row && row.blocked_until > now) return { blocked: true, key, now };
  if (!row || now-row.window_started_at > 900) await env.DB.prepare('INSERT OR REPLACE INTO auth_attempts(ip_key,attempts,window_started_at,blocked_until) VALUES(?,0,?,0)').bind(key,now).run();
  return { blocked: false, key, now };
}
async function login(request, env) {
  const rate = await authRateLimit(request,env); if (rate.blocked) return fail('Too many login attempts. Try again later.',429);
  const data = await bodyJson(request); if (!data || !validText(data.username,80) || typeof data.password !== 'string' || data.password.length < 1 || data.password.length > 256) return fail('Invalid login details.');
  const user = await env.DB.prepare('SELECT id, username, password_hash, password_salt FROM admin_users WHERE username=?').bind(data.username.trim()).first();
  const ok = !!user && await verifyPassword(data.password,user.password_salt,user.password_hash);
  if (!ok) {
    const row = await env.DB.prepare('SELECT attempts,window_started_at FROM auth_attempts WHERE ip_key=?').bind(rate.key).first();
    const attempts = (row?.attempts || 0)+1; const blocked = attempts >= 6 ? rate.now+900 : 0;
    await env.DB.prepare('INSERT OR REPLACE INTO auth_attempts(ip_key,attempts,window_started_at,blocked_until) VALUES(?,?,?,?)').bind(rate.key,attempts,row?.window_started_at || rate.now,blocked).run();
    return fail('Username or password is incorrect.',401);
  }
  await env.DB.prepare('DELETE FROM auth_attempts WHERE ip_key=?').bind(rate.key).run();
  await env.DB.prepare("DELETE FROM admin_sessions WHERE expires_at <= datetime('now')").run();
  const token = b64url(crypto.getRandomValues(new Uint8Array(32))); const tokenHash = await sha256(token);
  const ttl = Math.max(1,Math.min(24,Number(env.SESSION_TTL_HOURS || 12)));
  await env.DB.prepare("INSERT INTO admin_sessions(token_hash,admin_id,expires_at) VALUES(?,?,datetime('now',?))").bind(tokenHash,user.id,`+${ttl} hours`).run();
  await env.DB.prepare("UPDATE admin_users SET last_login_at=datetime('now') WHERE id=?").bind(user.id).run();
  return json({ok:true,username:user.username},200,{'Set-Cookie':`cr_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${ttl*3600}`});
}
async function publicRoutine(request,env,url) {
  const group = url.searchParams.get('group'); if (!['A','B'].includes(group)) return fail('Unknown group.');
  const data = await env.DB.prepare(`SELECT c.id,c.day_index,c.start_time,c.end_time,s.id subject_id,s.name subject,s.code,s.color,t.name teacher,t.phone,r.name room
    FROM routine_classes c JOIN student_groups g ON g.id=c.group_id JOIN semesters sem ON sem.id=g.semester_id
    JOIN subjects s ON s.id=c.subject_id LEFT JOIN teachers t ON t.id=c.teacher_id LEFT JOIN rooms r ON r.id=c.room_id
    WHERE sem.name='4th Semester' AND g.name=? AND g.active=1 AND sem.active=1 AND s.active=1 AND c.published=1
    ORDER BY c.day_index,c.start_time`).bind(group).all();
  const gid = await env.DB.prepare("SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name=?").bind(group).first();
  const announcements = gid ? await env.DB.prepare("SELECT id,title,body,event_date,priority,updated_at FROM announcements WHERE published=1 AND (group_id IS NULL OR group_id=?) AND (event_date IS NULL OR event_date >= date('now','-1 day')) ORDER BY event_date, id DESC LIMIT 50").bind(gid.id).all() : {results:[]};
  const meta = await env.DB.prepare('SELECT value FROM app_meta WHERE key=?').bind('last_published_'+group).first();
  const lastPublishedAt=meta?.value||null;
  const announcementVersion=(announcements.results||[]).map(a=>[a.id,a.title,a.body,a.event_date,a.priority,a.updated_at].join(':')).sort().join('|');
  const etag='"'+await sha256(group+'|'+String(lastPublishedAt)+'|'+(data.results||[]).length+'|'+announcementVersion)+'"';
  if(request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers:{'ETag':etag,'Cache-Control':'no-store'}});
  return json({semester:'4th Semester',group,classes:data.results||[],announcements:announcements.results||[],lastPublishedAt,serverTime:new Date().toISOString()},200,{'ETag':etag});
}
async function adminApi(request,env,url,session) {
  if (!session) return fail('Authentication required.',401);
  if (url.pathname==='/api/admin/me' && request.method==='GET') return json({ok:true,username:session.username});
  if (url.pathname==='/api/admin/logout' && request.method==='POST') {
    const token=cookie(request,'cr_admin'); if(token) await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await sha256(token)).run();
    return json({ok:true},200,{'Set-Cookie':'cr_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'});
  }
  if (url.pathname==='/api/admin/routine' && request.method==='GET') {
    const group=url.searchParams.get('group'); if(!['A','B'].includes(group)) return fail('Unknown group.');
    const result=await env.DB.prepare(`SELECT c.id,c.day_index,c.start_time,c.end_time,s.name subject,s.code,t.name teacher,t.phone,r.name room,s.color
      FROM routine_classes c JOIN student_groups g ON g.id=c.group_id JOIN semesters sem ON sem.id=g.semester_id JOIN subjects s ON s.id=c.subject_id
      LEFT JOIN teachers t ON t.id=c.teacher_id LEFT JOIN rooms r ON r.id=c.room_id WHERE sem.name='4th Semester' AND g.name=? ORDER BY c.day_index,c.start_time`).bind(group).all();
    const published=await env.DB.prepare('SELECT value FROM app_meta WHERE key=?').bind('last_published_'+group).first();
    return json({classes:result.results||[],lastPublishedAt:published?.value||null});
  }
  if (url.pathname==='/api/admin/routine' && request.method==='POST') {
    const data=await bodyJson(request); if(!data||!['A','B'].includes(data.group)||!validText(data.subject,120)||!Number.isInteger(data.dayIndex)||data.dayIndex<0||data.dayIndex>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.startTime||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(data.endTime||'')||data.startTime>=data.endTime) return fail('Please check the class fields.');
    const gid=await env.DB.prepare("SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name=?").bind(data.group).first();
    const conflict=await env.DB.prepare('SELECT c.id,s.name FROM routine_classes c JOIN subjects s ON s.id=c.subject_id WHERE c.group_id=? AND c.day_index=? AND c.start_time < ? AND c.end_time > ?').bind(gid.id,data.dayIndex,data.endTime,data.startTime).first();if(conflict)return fail('This time overlaps another class: '+conflict.name+'.');
    let subj=await env.DB.prepare('SELECT id FROM subjects WHERE group_id=? AND name=? AND code=?').bind(gid.id,data.subject.trim(),String(data.code||'').slice(0,30)).first();
    if(!subj){const created=await env.DB.prepare('INSERT INTO subjects(group_id,name,code,color) VALUES(?,?,?,?)').bind(gid.id,data.subject.trim(),String(data.code||'').slice(0,30),/^#[0-9a-fA-F]{6}$/.test(data.color||'')?data.color:'#1D5FA8').run();subj={id:created.meta.last_row_id};}
    let teacherId=null,roomId=null;
    if(validText(data.teacher,120)){let t=await env.DB.prepare('SELECT id FROM teachers WHERE name=? AND phone=?').bind(data.teacher.trim(),String(data.phone||'').slice(0,30)).first();if(!t){const created=await env.DB.prepare('INSERT INTO teachers(name,phone) VALUES(?,?)').bind(data.teacher.trim(),String(data.phone||'').slice(0,30)).run();t={id:created.meta.last_row_id};}teacherId=t.id;}
    if(validText(data.room,40)){await env.DB.prepare('INSERT OR IGNORE INTO rooms(name) VALUES(?)').bind(data.room.trim()).run();const r=await env.DB.prepare('SELECT id FROM rooms WHERE name=?').bind(data.room.trim()).first();roomId=r.id;}
    const cls=await env.DB.prepare('INSERT INTO routine_classes(group_id,subject_id,teacher_id,room_id,day_index,start_time,end_time,published) VALUES(?,?,?,?,?,?,?,0)').bind(gid.id,subj.id,teacherId,roomId,data.dayIndex,data.startTime,data.endTime).run();
    return json({ok:true,id:cls.meta.last_row_id},201);
  }
  const match=url.pathname.match(/^\/api\/admin\/routine\/(\d+)$/);
  if(match && request.method==='PUT'){
    const id=Number(match[1]),d=await bodyJson(request);
    if(!d||!validText(d.subject,120)||!Number.isInteger(d.dayIndex)||d.dayIndex<0||d.dayIndex>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.startTime||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(d.endTime||'')||d.startTime>=d.endTime)return fail('Please check the class fields.');
    const current=await env.DB.prepare('SELECT c.id,c.group_id,c.subject_id FROM routine_classes c WHERE c.id=?').bind(id).first();if(!current)return fail('Class not found.',404);
    const conflict=await env.DB.prepare('SELECT c.id,s.name FROM routine_classes c JOIN subjects s ON s.id=c.subject_id WHERE c.group_id=? AND c.day_index=? AND c.id<>? AND c.start_time < ? AND c.end_time > ?').bind(current.group_id,d.dayIndex,id,d.endTime,d.startTime).first();if(conflict)return fail('This time overlaps another class: '+conflict.name+'.');
    await env.DB.prepare('UPDATE subjects SET name=?,code=?,color=? WHERE id=?').bind(d.subject.trim(),String(d.code||'').slice(0,30),/^#[0-9a-fA-F]{6}$/.test(d.color||'')?d.color:'#1D5FA8',current.subject_id).run();
    let teacherId=null,roomId=null;
    if(validText(d.teacher,120)){const old=await env.DB.prepare('SELECT teacher_id FROM routine_classes WHERE id=?').bind(id).first();if(old.teacher_id){await env.DB.prepare('UPDATE teachers SET name=?,phone=? WHERE id=?').bind(d.teacher.trim(),String(d.phone||'').slice(0,30),old.teacher_id).run();teacherId=old.teacher_id}else{const t=await env.DB.prepare('INSERT INTO teachers(name,phone) VALUES(?,?)').bind(d.teacher.trim(),String(d.phone||'').slice(0,30)).run();teacherId=t.meta.last_row_id;}}
    if(validText(d.room,40)){await env.DB.prepare('INSERT OR IGNORE INTO rooms(name) VALUES(?)').bind(d.room.trim()).run();roomId=(await env.DB.prepare('SELECT id FROM rooms WHERE name=?').bind(d.room.trim()).first()).id;}
    await env.DB.prepare("UPDATE routine_classes SET teacher_id=?,room_id=?,day_index=?,start_time=?,end_time=?,published=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").bind(teacherId,roomId,d.dayIndex,d.startTime,d.endTime,id).run();return json({ok:true});
  }
  if(match && request.method==='DELETE'){await env.DB.prepare('DELETE FROM routine_classes WHERE id=?').bind(Number(match[1])).run();return json({ok:true});}
  if(url.pathname==='/api/admin/publish'&&request.method==='POST'){
    const data=await bodyJson(request);if(!data||!['A','B'].includes(data.group))return fail('Choose a group.');
    const gid=await env.DB.prepare("SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name=?").bind(data.group).first();
    await env.DB.prepare('UPDATE routine_classes SET published=0 WHERE group_id=?').bind(gid.id).run();
    await env.DB.prepare('UPDATE routine_classes SET published=1,updated_at=CURRENT_TIMESTAMP WHERE group_id=?').bind(gid.id).run();
    const stamp=new Date().toISOString();await env.DB.prepare('UPDATE app_meta SET value=? WHERE key=?').bind(stamp,'last_published_'+data.group).run();
    return json({ok:true,lastPublishedAt:stamp});
  }
  if(url.pathname==='/api/admin/announcements'&&request.method==='GET')return json(await env.DB.prepare('SELECT a.*,g.name group_name FROM announcements a LEFT JOIN student_groups g ON g.id=a.group_id ORDER BY a.id DESC LIMIT 100').all());
  if(url.pathname==='/api/admin/announcements'&&request.method==='POST'){
    const d=await bodyJson(request);if(!d||!validText(d.title,160)||!validText(d.body,2000)||!['','A','B',undefined].includes(d.group)||(d.date&&!/^\d{4}-\d{2}-\d{2}$/.test(d.date)))return fail('Announcement title, body, group, or date is invalid.');
    let gid=null;if(d.group==='A'||d.group==='B'){const g=await env.DB.prepare("SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name=?").bind(d.group).first();gid=g?.id||null;}
    await env.DB.prepare('INSERT INTO announcements(group_id,title,body,event_date,priority,published) VALUES(?,?,?,?,?,?)').bind(gid,d.title.trim(),d.body.trim(),d.date||null,['low','medium','high'].includes(d.priority)?d.priority:'medium',d.published?1:0).run();return json({ok:true},201);
  }
  const ann=url.pathname.match(/^\/api\/admin\/announcements\/(\d+)$/);
  if(ann&&request.method==='PUT'){
    const d=await bodyJson(request);if(!d||!validText(d.title,160)||!validText(d.body,2000)||!['','A','B',undefined].includes(d.group)||(d.date&&!/^\d{4}-\d{2}-\d{2}$/.test(d.date)))return fail('Announcement title, body, group, or date is invalid.');
    let gid=null;if(d.group==='A'||d.group==='B'){const g=await env.DB.prepare("SELECT g.id FROM student_groups g JOIN semesters s ON s.id=g.semester_id WHERE s.name='4th Semester' AND g.name=?").bind(d.group).first();gid=g?.id||null;}
    await env.DB.prepare('UPDATE announcements SET group_id=?,title=?,body=?,event_date=?,priority=?,published=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(gid,d.title.trim(),d.body.trim(),d.date||null,['low','medium','high'].includes(d.priority)?d.priority:'medium',d.published?1:0,Number(ann[1])).run();return json({ok:true});
  }
  if(ann&&request.method==='DELETE'){await env.DB.prepare('DELETE FROM announcements WHERE id=?').bind(Number(ann[1])).run();return json({ok:true});}
  return fail('Not found.',404);
}
export default {
 async fetch(request,env) {
  const url=new URL(request.url); if(request.method==='OPTIONS')return withCors(new Response(null,{status:204}),request,env);
  let response;
  try {
   if(url.pathname==='/api/health'&&request.method==='GET')response=json({ok:true,service:'class-routine-api',version:'2.0.0'});
   else if(url.pathname==='/api/routine'&&request.method==='GET')response=await publicRoutine(request,env,url);
   else if(url.pathname==='/api/admin/login'&&request.method==='POST')response=await login(request,env);
   else if(url.pathname.startsWith('/api/admin/'))response=await adminApi(request,env,url,await adminSession(request,env));
   else response=await env.ASSETS.fetch(request);
  } catch(e) { console.error('request failed',e); response=fail('Internal server error.',500); }
  return withCors(response,request,env);
 }
};
