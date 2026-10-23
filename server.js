import crypto from 'node:crypto';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createWriteStream} from 'node:fs';
import {pipeline} from 'node:stream/promises';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const port=Number(process.env.PORT||3000);
const membersFile=path.join(root,'members.local.json');
const sessions=new Map();
const licensesFile=path.join(root,'licenses.local.json');
async function licenses(){try{return JSON.parse(await fs.readFile(licensesFile,'utf8'))}catch(e){if(e.code==='ENOENT')return [];throw e}}
async function saveLicenses(rows){await fs.writeFile(licensesFile,JSON.stringify(rows,null,2),{mode:0o600});}
function bearer(req){return String(req.headers.authorization||'').replace(/^Bearer\s+/i,'')}
function session(req){const v=sessions.get(bearer(req));return v&&v.expires>Date.now()?v:null}
function licenseStatus(row){return row?{id:row.id,expiresAt:row.expiresAt,active:new Date(row.expiresAt).getTime()>Date.now(),assignedTo:row.assignedTo||null}:null}

const secureCompare=(a,b)=>{const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
async function members(){try{return JSON.parse(await fs.readFile(membersFile,'utf8'))}catch(e){if(e.code==='ENOENT')return [];throw e}}
function issueSession(role,username){const token=crypto.randomBytes(32).toString('hex');sessions.set(token,{expires:Date.now()+8*3600000,role,username});return token;}
function authorized(token){const sess=sessions.get(String(token||''));if(sess){if(sess.expires>Date.now())return sess.role==='admin'||(sess.role==='member'&&Boolean(sess.licensed&&new Date(sess.licenseExpiresAt).getTime()>Date.now()));sessions.delete(token);}return Boolean(process.env.ADMIN_TOKEN)&&secureCompare(token,process.env.ADMIN_TOKEN)};

const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const readBody=async req=>{let s='';for await(const c of req){s+=c;if(s.length>14000000)throw Error('요청 내용이 너무 깁니다.');}return JSON.parse(s||'{}');};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function render(data,links,images,keywords={}){const title=esc(data.title||'여행 가이드');const sections=Array.isArray(data.sections)?data.sections:[];const cleanUrls=(Array.isArray(images)?images:[]).filter(x=>{if(typeof x!=='string')return false;if(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(x))return x.length<2500000;try{let u=new URL(x);return u.protocol==='https:'}catch{return false}}).slice(0,6);
let html=`<article class="travel-post" style="max-width:800px;margin:auto;color:#1e293b;font-family:Arial,'Noto Sans KR',sans-serif;line-height:1.85"><h1 style="font-size:30px;line-height:1.35">${title}</h1><p style="color:#64748b">${esc(data.intro)}</p>`;
if(cleanUrls[0])html+=`<figure style="margin:20px 0"><img src="${esc(cleanUrls[0])}" alt="${title}" style="width:100%;height:auto;border-radius:14px" loading="lazy"><figcaption style="font-size:12px;color:#64748b">사진 출처 및 사용 권한을 확인하세요.</figcaption></figure>`;
sections.forEach((s,i)=>{html+=`<section style="margin:28px 0"><h2 style="font-size:23px;border-bottom:2px solid #0ea5e9;padding-bottom:8px">${esc(s.heading)}</h2>`;for(const p of (Array.isArray(s.paragraphs)?s.paragraphs:[]))html+=`<p>${esc(p)}</p>`;if(cleanUrls[i+1])html+=`<figure style="margin:22px 0"><img src="${esc(cleanUrls[i+1])}" alt="${esc(s.heading)}" style="width:100%;height:auto;border-radius:12px" loading="lazy"><figcaption style="font-size:12px;color:#64748b">이미지 출처 및 이용 권한을 확인하세요.</figcaption></figure>`;html+='</section>';});
if(cleanUrls.length>sections.length+1){html+='<section><h2>여행 사진 더 보기</h2>';for(const url of cleanUrls.slice(sections.length+1))html+=`<p><img src="${esc(url)}" alt="여행 관련 사진" style="width:100%;height:auto;border-radius:12px" loading="lazy"></p>`;html+='</section>';}
const safeLinks=Object.entries(links||{}).filter(([k,v])=>{try{return new URL(v).protocol==='https:'}catch{return false}});if(safeLinks.length){html+='<section style="padding:18px;border:1px solid #e2e8f0;border-radius:12px"><h2>예약 및 할인 정보</h2><p style="font-size:12px">이 글에는 제휴 링크가 포함될 수 있으며, 구매 시 수수료를 받을 수 있습니다.</p>';for(const [label,url] of safeLinks)html+=`<p><a href="${esc(url)}" target="_blank" rel="sponsored nofollow noopener" style="display:inline-block;background:#0369a1;color:#fff;padding:10px 18px;border-radius:9px;text-decoration:none">${esc(label)} 예약·확인하기 →</a></p>`;html+='</section>';}
const languages=[['ko','🇰🇷 한글'],['en','🇺🇸 English'],['ja','🇯🇵 日本語']];const groups=languages.map(([key,label])=>({label,items:[...new Set((Array.isArray(keywords?.[key])?keywords[key]:[]).filter(x=>typeof x==='string').map(x=>x.trim()).filter(Boolean))].slice(0,20)})).filter(x=>x.items.length);if(groups.length){html+='<section style="margin:28px 0;padding:18px;background:#f8fafc;border-radius:12px"><h2 style="font-size:20px">관련 검색 키워드</h2>';for(const g of groups){html+=`<h3 style="font-size:15px">${esc(g.label)}</h3><p>`;for(const word of g.items)html+=`<span style="display:inline-block;margin:4px;padding:4px 9px;border-radius:20px;background:#e0f2fe;font-size:13px">${esc(word)}</span>`;html+='</p>';}html+='</section>';}
html+=`<p style="font-size:12px;color:#64748b">※ 가격·일정·예약 가능 여부는 방문 전 공식 사이트에서 다시 확인하세요.</p></article>`;return html;}
const assetDir=path.join(os.tmpdir(),'staf-editor-assets');await fs.mkdir(assetDir,{recursive:true});const assetMap=new Map();
async function runFF(args,timeout=180000){return await new Promise((resolve,reject)=>{const proc=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y',...args],{windowsHide:true});let err='',done=false;const timer=setTimeout(()=>proc.kill(),timeout);proc.stderr.on('data',b=>err=(err+b.toString()).slice(-1200));proc.on('error',e=>{if(!done){done=true;clearTimeout(timer);reject(e)}});proc.on('close',code=>{if(!done){done=true;clearTimeout(timer);code===0?resolve():reject(Error(err||'FFmpeg 오류 또는 시간 초과'))}})})}

// Local MusicGen GPU tasks. No external API key is used.
const gpuJobs=new Map();
const gpuDir=path.join(root,'generated-music');
await fs.mkdir(gpuDir,{recursive:true});
function startGpuJob(input){
 const id=crypto.randomUUID();
 const job={id,status:'queued',message:'작업 대기 중',created:Date.now()};gpuJobs.set(id,job);
 const out=path.join(gpuDir,id+'.wav');
 const cfg=path.join(gpuDir,id+'.json');
 (async()=>{
  try{
   await fs.writeFile(cfg,JSON.stringify({output:out,prompt:input.prompt,seconds:input.seconds,engine:"audiocraft-extend"}));
   job.status='running';job.message='GPU 음악 생성 준비 중';
   const python=process.env.PYTHON_GPU|| (process.platform==='win32'?'python':'python3');
   const child=spawn(python,['-X','utf8',path.join(root,'local_musicgen.py'),cfg],{cwd:root,windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONUTF8:'1'}});
   let err='';const stderrDecoder=new TextDecoder('utf-8');const stdoutDecoder=new TextDecoder('utf-8');let timedOut=false;const timer=setTimeout(()=>{timedOut=true;child.kill()},120*60*1000);
   child.stdout.on('data',b=>{job.message=stdoutDecoder.decode(b,{stream:true}).trim().slice(-500)});
   child.stderr.on('data',b=>{err=(err+stderrDecoder.decode(b,{stream:true})).slice(-1800)});
   const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve)});
   clearTimeout(timer);err+=stderrDecoder.decode();
   if(code!==0)throw Error(timedOut?'120분 제한 시간 초과':err.includes('out of memory')?'GPU 메모리가 부족합니다. 5초로 다시 시도하고 다른 GPU 프로그램을 종료하세요.':err||'로컬 AI 실행 실패. Python/GPU 설정을 확인하세요.');
   job.status='done';job.message='WAV 음악 생성 완료';job.url='/api/music/gpu/file/'+id;
  }catch(e){job.status='error';job.message=String(e.message||e).slice(-800)}
  finally{await fs.rm(cfg,{force:true}).catch(()=>{});}
 })();
 return job;
}
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
// v49: local 4-minute arrangement. This does NOT synthesize singing.
if(req.method==='POST'&&u.pathname==='/api/music/arrange/vocal'){
 const token=u.searchParams.get('token')||'';
 if(!authorized(token))return json(res,401,{error:'관리자 인증이 필요합니다.'});
 const ext=String(u.searchParams.get('ext')||'').toLowerCase();
 if(!['wav','mp3','m4a','ogg','flac'].includes(ext))return json(res,400,{error:'WAV, MP3, M4A, OGG, FLAC 파일만 가능합니다.'});
 const id=crypto.randomUUID(),dest=path.join(gpuDir,'vocal-'+id+'.'+ext);
 let size=0;const stream=createWriteStream(dest,{flags:'wx'});
 try{for await(const chunk of req){size+=chunk.length;if(size>80*1024*1024)throw Error('보컬 파일은 최대 80MB입니다.');if(!stream.write(chunk))await new Promise(ok=>stream.once('drain',ok));}await new Promise((ok,no)=>stream.end(e=>e?no(e):ok()));if(size<1000)throw Error('오디오 파일이 너무 작습니다.');return json(res,200,{id,ext,size});}
 catch(e){stream.destroy();await fs.rm(dest,{force:true}).catch(()=>{});return json(res,400,{error:String(e.message||e)})}
}
if(req.method==='POST'&&u.pathname==='/api/music/arrange/create'){
 const b=await readBody(req);if(!authorized(b.token))return json(res,401,{error:'관리자 인증이 필요합니다.'});
 const instrumental=String(b.instrumental||''),vocalId=String(b.vocalId||''),ext=String(b.vocalExt||'');
 if(!/^[a-f0-9-]{36}$/.test(instrumental))return json(res,400,{error:'먼저 GPU 반주 샘플을 생성해 주세요.'});
 const music=path.join(gpuDir,instrumental+'.wav');if(!await fs.stat(music).catch(()=>null))return json(res,404,{error:'반주 파일이 없습니다.'});
 const vocal=vocalId&&/^[a-f0-9-]{36}$/.test(vocalId)&&['wav','mp3','m4a','ogg','flac'].includes(ext)?path.join(gpuDir,'vocal-'+vocalId+'.'+ext):null;
 if(vocal&&!await fs.stat(vocal).catch(()=>null))return json(res,404,{error:'보컬 파일이 없습니다.'});
 const id=crypto.randomUUID(),output=path.join(gpuDir,id+'.wav');
 const job={id,status:'queued',message:'4분 편곡 대기 중',created:Date.now()};gpuJobs.set(id,job);
 (async()=>{try{job.status='running';job.message='FFmpeg로 4분 반주 편곡 및 믹싱 중...';
 // Repeats the short generated instrumental. Vocal must be user supplied.
 const args=['-stream_loop','-1','-i',music];if(vocal)args.push('-i',vocal);
 const filter=vocal?'[0:a]atrim=duration=240,asetpts=PTS-STARTPTS,volume=0.55[inst];[1:a]apad,atrim=duration=240,asetpts=PTS-STARTPTS,volume=1.0[vox];[inst][vox]amix=inputs=2:duration=first:dropout_transition=0,afade=t=in:st=0:d=2,afade=t=out:st=235:d=5[a]':'[0:a]atrim=duration=240,asetpts=PTS-STARTPTS,afade=t=in:st=0:d=2,afade=t=out:st=235:d=5[a]';
 await runFF([...args,'-filter_complex',filter,'-map','[a]','-ar','32000','-ac','2','-c:a','pcm_s16le','-t','240',output],240000);
 job.status='done';job.message=vocal?'4분 반주+업로드 보컬 믹싱 완료':'4분 반주 반복 편곡 완료 (보컬 없음)';job.url='/api/music/gpu/file/'+id;
 }catch(e){job.status='error';job.message='편곡 실패: '+String(e.message||e)} })();
 return json(res,202,job);
}
if(req.method==='POST'&&u.pathname==='/api/music/gpu/create'){
 const b=await readBody(req);
 if(!authorized(b.token))return json(res,401,{error:'관리자 토큰이 필요합니다.'});
 if([...gpuJobs.values()].some(j=>j.status==='running'||j.status==='queued'))return json(res,429,{error:'이미 GPU 음악 생성 중입니다. 완료 후 다시 시도하세요.'});
 const prompt=String(b.prompt||'').trim().slice(0,500);
 if(prompt.length<5)return json(res,400,{error:'음악 스타일을 5글자 이상 입력해 주세요.'});
 const seconds=Math.min(240,Math.max(5,Math.round(Number(b.seconds)||30)));
 return json(res,202,startGpuJob({prompt,seconds}));
}
if(req.method==='GET'&&u.pathname.startsWith('/api/music/gpu/status/')){
 const id=u.pathname.split('/').pop(),job=gpuJobs.get(id);
 return job?json(res,200,job):json(res,404,{error:'작업을 찾을 수 없습니다.'});
}
if(req.method==='GET'&&u.pathname==='/api/music/gpu/files'){
 const files=(await fs.readdir(gpuDir,{withFileTypes:true})).filter(f=>f.isFile()&&/^[a-f0-9-]{36}\.wav$/i.test(f.name));
 const items=await Promise.all(files.map(async f=>{const st=await fs.stat(path.join(gpuDir,f.name));return {id:f.name.slice(0,-4),url:'/api/music/gpu/file/'+f.name.slice(0,-4),created:st.mtimeMs,size:st.size}}));
 return json(res,200,{items:items.sort((a,b)=>b.created-a.created).slice(0,100)});
}
if((req.method==='GET'||req.method==='HEAD')&&u.pathname.startsWith('/api/music/gpu/file/')){
 const id=u.pathname.split('/').pop();
 if(!/^[a-f0-9-]{36}$/i.test(id))return json(res,400,{error:'잘못된 파일 주소입니다.'});
 const file=path.join(gpuDir,id+'.wav');const st=await fs.stat(file).catch(()=>null);
 if(!st)return json(res,404,{error:'음악 파일이 없습니다. GPU 생성이 완료되어야 재생됩니다.'});
 res.writeHead(200,{'Content-Type':'audio/wav','Accept-Ranges':'none','Content-Length':st.size,'Cache-Control':'no-store','Content-Disposition':u.searchParams.has('download')?'attachment; filename="local-gpu-music.wav"':'inline; filename="local-gpu-music.wav"'});
 if(req.method==='HEAD')return res.end();
 return pipeline((await import('node:fs')).createReadStream(file),res);
}
// Serve only explicitly approved front-end assets from /public.
if(req.method==='GET' && /^\/[a-zA-Z0-9_-]+\.(?:css|js)$/.test(u.pathname)){
 const file=u.pathname.slice(1);
 const allowed=new Set(['style.css','workspace-dark.css','factory-dark-v37.css','dark-fix-v38.css','factory-dark-v39.css','language-pack.css','language-pack.js','app.js','v16-addon.js']);
 if(allowed.has(file)){
  const content=await fs.readFile(path.join(root,'public',file));
  res.writeHead(200,{'Content-Type':file.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(content);return;
 }
}
if(req.method==='POST'&&u.pathname==='/api/music/lyrics'){
 const b=await readBody(req);
 if(!authorized(b.token))return json(res,401,{error:'관리자 토큰이 올바르지 않습니다. .env의 ADMIN_TOKEN을 확인하세요.'});
 if(!process.env.OPENAI_API_KEY||process.env.OPENAI_API_KEY==='put_your_api_key_here')return json(res,503,{error:'.env에 OPENAI_API_KEY를 설정해야 합니다.'});
 const title=String(b.title||'').slice(0,100),style=String(b.style||'').slice(0,1000),genre=String(b.genre||'Lo-fi').slice(0,50),voice=String(b.voice||'여성 보컬').slice(0,50),language=String(b.language||'English').slice(0,50),duration=String(b.duration||'4분').slice(0,20);
 if(!title.trim()&&!style.trim())return json(res,400,{error:'곡 제목 또는 스타일을 입력하세요.'});
 const prompt=`Create original complete song lyrics only (no commentary). Title: ${title}. Style: ${style}. Genre: ${genre}. Vocal: ${voice}. Language: ${language}. Target duration: ${duration}. Use [Intro], [Verse 1], [Pre-Chorus], [Chorus], [Verse 2], [Bridge], [Final Chorus], [Outro]. Do not reproduce existing copyrighted lyrics.`;
 const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',messages:[{role:'user',content:prompt}],temperature:0.8,max_tokens:1800})});
 const data=await r.json();if(!r.ok)return json(res,r.status,{error:data.error?.message||'OpenAI 요청 실패'});
 return json(res,200,{lyrics:data.choices?.[0]?.message?.content||''});
}
if(req.method==='GET'&&u.pathname==='/music-ai'){const content=await fs.readFile(path.join(root,'public','music-ai.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(content);return;}
if(req.method==='GET'&&u.pathname==='/script-ai'){const content=await fs.readFile(path.join(root,'public','script-ai.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(content);return;}
if(req.method==='GET'&&u.pathname==='/library'){const content=await fs.readFile(path.join(root,'public','library.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(content);return;}
if(req.method==='GET'&&u.pathname==='/video-editor'){const content=await fs.readFile(path.join(root,'public','video-editor.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(content);return;}
if(req.method==='GET'&&u.pathname==='/'){const content=await fs.readFile(path.join(root,'public','index.html'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});res.end(content);return;}
 if(req.method==='GET'&&u.pathname==='/v16-addon.js'){const content=await fs.readFile(path.join(root,'public','v16-addon.js'));res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});res.end(content);return;}
if(req.method==='POST'&&u.pathname==='/api/auth/login'){
 const b=await readBody(req);const username=String(b.username||'').trim();const password=String(b.password||'');
 if(!username){if(!process.env.ADMIN_TOKEN||!secureCompare(password,process.env.ADMIN_TOKEN))return json(res,401,{error:'관리자 비밀번호가 올바르지 않습니다.'});return json(res,200,{token:issueSession('admin','admin'),role:'admin'});}
 const user=(await members()).find(x=>x.username===username);if(!user)return json(res,401,{error:'아이디 또는 비밀번호가 올바르지 않습니다.'});
 const hash=crypto.scryptSync(password,Buffer.from(user.salt,'hex'),64);if(!secureCompare(hash.toString('hex'),user.hash))return json(res,401,{error:'아이디 또는 비밀번호가 올바르지 않습니다.'});
 const allLicenses=await licenses();const license=allLicenses.find(x=>x.assignedTo===username&&new Date(x.expiresAt).getTime()>Date.now());const token=issueSession('member',username);if(license){sessions.get(token).licensed=true;sessions.get(token).licenseExpiresAt=license.expiresAt;}return json(res,200,{token,role:'member',license:licenseStatus(license)});
}
if(req.method==='POST'&&u.pathname==='/api/auth/signup'){
 const b=await readBody(req);const username=String(b.username||'').trim();const password=String(b.password||'');
 if(!/^[a-zA-Z0-9_-]{3,30}$/.test(username))return json(res,400,{error:'아이디는 영문·숫자·_·- 조합 3~30자여야 합니다.'});
 if(password.length<8||password.length>128)return json(res,400,{error:'비밀번호는 8~128자여야 합니다.'});
 const all=await members();if(all.some(x=>x.username===username))return json(res,409,{error:'이미 사용 중인 아이디입니다.'});
 const salt=crypto.randomBytes(16);const hash=crypto.scryptSync(password,salt,64);
 all.push({username,salt:salt.toString('hex'),hash:hash.toString('hex')});await fs.writeFile(membersFile,JSON.stringify(all,null,2),{mode:0o600});return json(res,201,{ok:true});
}
if(req.method==='GET'&&u.pathname==='/api/license/status'){
 const ss=session(req);if(!ss)return json(res,401,{error:'로그인이 필요합니다.'});
 const rows=await licenses();const lic=ss.role==='admin'?null:rows.find(x=>x.assignedTo===ss.username&&new Date(x.expiresAt).getTime()>Date.now());
 if(ss.role==='member'){ss.licensed=Boolean(lic);ss.licenseExpiresAt=lic?.expiresAt||null;}
 return json(res,200,{role:ss.role,username:ss.username,license:licenseStatus(lic),admin: ss.role==='admin'});
}
if(req.method==='POST'&&u.pathname==='/api/license/activate'){
 const ss=session(req);if(!ss)return json(res,401,{error:'로그인이 필요합니다.'});if(ss.role!=='member')return json(res,400,{error:'관리자에게 라이선스 등록은 필요하지 않습니다.'});
 const b=await readBody(req);const hash=crypto.createHash('sha256').update(String(b.key||'').trim().toUpperCase()).digest('hex');
 const rows=await licenses();const lic=rows.find(x=>x.hash===hash);
 if(!lic||new Date(lic.expiresAt).getTime()<=Date.now())return json(res,400,{error:'유효하지 않거나 만료된 라이선스입니다.'});
 if(lic.assignedTo&&lic.assignedTo!==ss.username)return json(res,409,{error:'이미 다른 회원에게 등록된 라이선스입니다.'});
 lic.assignedTo=ss.username;await saveLicenses(rows);ss.licensed=true;ss.licenseExpiresAt=lic.expiresAt;
 return json(res,200,{license:licenseStatus(lic)});
}
if(req.method==='GET'&&u.pathname==='/api/admin/licenses'){
 const ss=session(req);if(!ss||ss.role!=='admin')return json(res,403,{error:'관리자 전용 기능입니다.'});
 return json(res,200,{licenses:(await licenses()).map(licenseStatus)});
}
if(req.method==='POST'&&u.pathname==='/api/admin/licenses'){
 const ss=session(req);if(!ss||ss.role!=='admin')return json(res,403,{error:'관리자 전용 기능입니다.'});
 const b=await readBody(req);const days=Number(b.days);if(!Number.isInteger(days)||days<1||days>3650)return json(res,400,{error:'유효기간은 1~3650일입니다.'});
 const key='STAF-'+Array.from({length:4},()=>crypto.randomBytes(3).toString('hex').toUpperCase()).join('-');
 const row={id:crypto.randomUUID(),hash:crypto.createHash('sha256').update(key).digest('hex'),expiresAt:new Date(Date.now()+days*86400000).toISOString(),assignedTo:null,createdAt:new Date().toISOString()};
 const rows=await licenses();rows.push(row);await saveLicenses(rows);return json(res,201,{key,license:licenseStatus(row),note:'키 원문은 지금 한 번만 표시됩니다. 안전한 곳에 보관하세요.'});
}
if(req.method==='DELETE'&&u.pathname.startsWith('/api/admin/licenses/')){
 const ss=session(req);if(!ss||ss.role!=='admin')return json(res,403,{error:'관리자 전용 기능입니다.'});
 const id=decodeURIComponent(u.pathname.split('/').pop());const rows=await licenses();const found=rows.find(x=>x.id===id);if(!found)return json(res,404,{error:'라이선스를 찾을 수 없습니다.'});
 await saveLicenses(rows.filter(x=>x.id!==id));for(const sess of sessions.values())if(sess.username===found.assignedTo){sess.licensed=false;sess.licenseExpiresAt=null;}return json(res,200,{ok:true});
}
// v19 local media assets (short-lived, per-process). Do not expose this server publicly without authentication.
if(req.method==='POST'&&u.pathname==='/api/video/asset'){
 const kind=u.searchParams.get('kind');if(!['music','voice'].includes(kind))return json(res,400,{error:'잘못된 오디오 종류'});
 const size=Number(req.headers['content-length']);if(!size||size>40*1024*1024)return json(res,413,{error:'오디오는 40MB 이하만 지원합니다.'});
 const id=crypto.randomUUID(),filename=path.join(assetDir,id+'.audio');await pipeline(req,createWriteStream(filename));assetMap.set(id,{filename,kind,created:Date.now()});return json(res,200,{id});
}
if(req.method==='POST'&&u.pathname==='/api/video/translate'){
 const b=await readBody(req);if(!process.env.OPENAI_API_KEY)return json(res,503,{error:'OPENAI_API_KEY 설정이 필요합니다.'});
 const language=['English','Japanese','Korean','Chinese','Spanish','French'].includes(b.language)?b.language:'English';
 const lines=(Array.isArray(b.segments)?b.segments:[]).slice(0,120).map(x=>String(x.text||'').slice(0,300));if(!lines.length)return json(res,400,{error:'번역할 자막이 없습니다.'});
 const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',response_format:{type:'json_object'},messages:[{role:'user',content:'Translate each subtitle to '+language+'. Preserve order and count, natural short captions. Return JSON {"lines":["..."]}. Input: '+JSON.stringify(lines)}]})});const d=await r.json();if(!r.ok)return json(res,r.status,{error:d.error?.message||'번역 실패'});let obj;try{obj=JSON.parse(d.choices[0].message.content)}catch{return json(res,502,{error:'번역 형식 오류'})}if(!Array.isArray(obj.lines)||obj.lines.length!==lines.length)return json(res,502,{error:'번역 자막 개수가 일치하지 않습니다.'});return json(res,200,{lines:obj.lines.map(x=>String(x).slice(0,400))});
}
if(req.method==='POST'&&u.pathname==='/api/video/tts'){
 const b=await readBody(req);if(!process.env.OPENAI_API_KEY)return json(res,503,{error:'OPENAI_API_KEY 설정이 필요합니다.'});const input=String(b.text||'').trim().slice(0,3000);if(!input)return json(res,400,{error:'음성으로 만들 문장을 입력하세요.'});
 const voice=['alloy','ash','ballad','coral','echo','fable','nova','onyx','sage','shimmer'].includes(b.voice)?b.voice:'nova';const r=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},body:JSON.stringify({model:'tts-1',voice,input,response_format:'mp3'})});if(!r.ok){let d={};try{d=await r.json()}catch{}return json(res,r.status,{error:d.error?.message||'AI 목소리 생성 실패'})}const buf=Buffer.from(await r.arrayBuffer());if(buf.length>15*1024*1024)return json(res,413,{error:'생성된 음성 파일이 너무 큽니다.'});res.writeHead(200,{'Content-Type':'audio/mpeg','Cache-Control':'no-store'});res.end(buf);return;
}
if(req.method==='POST'&&u.pathname==='/api/video/compose'){
 const size=Number(req.headers['content-length']);if(!size||size>600*1024*1024)return json(res,413,{error:'600MB 이하 MP4만 지원합니다.'});
 let config;try{config=JSON.parse(Buffer.from(String(req.headers['x-edit-config']||''),'base64').toString('utf8'))}catch{return json(res,400,{error:'편집 설정 오류'})}
 const clips=Array.isArray(config.clips)?config.clips.slice(0,15):[];if(!clips.length)return json(res,400,{error:'편집 구간을 추가해 주세요.'});let total=0;
 for(const c of clips){c.start=Number(c.start);c.end=Number(c.end);if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start||c.end-c.start>180)return json(res,400,{error:'구간 시간 오류'});total+=c.end-c.start}if(total>300)return json(res,400,{error:'총 편집 길이는 최대 300초입니다.'});
 const ratio=config.ratio==='original'?'original':'vertical';const music=assetMap.get(config.musicId),voice=assetMap.get(config.voiceId);const dir=await fs.mkdtemp(path.join(os.tmpdir(),'staf-compose-'));const input=path.join(dir,'input.mp4'),output=path.join(dir,'output.mp4');
 try{await pipeline(req,createWriteStream(input));const parts=[];
 for(let i=0;i<clips.length;i++){const c=clips[i],out=path.join(dir,'clip'+i+'.mp4');const vf=ratio==='vertical'?'scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1':'scale=trunc(iw/2)*2:trunc(ih/2)*2';const args=['-ss',String(c.start),'-i',input,'-t',String(c.end-c.start),'-vf',vf,'-c:v','libx264','-preset','veryfast','-crf','25','-pix_fmt','yuv420p','-an',out];await runFF(args,180000);parts.push(out)}
 const concat=path.join(dir,'concat.txt');await fs.writeFile(concat,parts.map(f=>"file '"+f.replace(/'/g,"'\\''")+"'").join('\n'));
 const joined=path.join(dir,'joined.mp4');await runFF(['-f','concat','-safe','0','-i',concat,'-c','copy',joined],90000);
 let current=joined;
 const captions=Array.isArray(config.captions)?config.captions.slice(0,150):[];if(captions.length){const ass=path.join(dir,'captions.ass');const fontSize=Math.min(72,Math.max(18,Number(config.fontSize)||42));const assTime=t=>{const v=Math.max(0,Number(t)||0),h=Math.floor(v/3600),m=Math.floor(v%3600/60),ss=(v%60).toFixed(2).padStart(5,'0');return `${h}:${String(m).padStart(2,'0')}:${ss}`};let content=`[Script Info]\nScriptType: v4.00+\nPlayResX: 720\nPlayResY: 1280\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,-1,0,0,0,100,100,0,0,1,3,1,2,30,30,100,1\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;for(const c of captions){const a=Number(c.start),b=Number(c.end);if(!Number.isFinite(a)||!Number.isFinite(b)||a<0||b<=a||a>total)continue;const tx=String(c.text||'').slice(0,220).replace(/[{}]/g,'').replace(/\r?\n/g,'\\N');content+=`Dialogue: 0,${assTime(a)},${assTime(Math.min(b,total))},Default,,0,0,0,,${tx}\n`;}await fs.writeFile(ass,content);const subtitled=path.join(dir,'subtitled.mp4');const escaped=ass.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");await runFF(['-i',current,'-vf',"ass='"+escaped+"'",'-c:v','libx264','-preset','veryfast','-crf','25','-an',subtitled],180000);current=subtitled;}
 const audioInputs=[];if(music&&music.kind==='music'&&Date.now()-music.created<3600000)audioInputs.push({file:music.filename,volume:Math.min(1,Math.max(0,Number(config.musicVolume)||0.25))});if(voice&&voice.kind==='voice'&&Date.now()-voice.created<3600000)audioInputs.push({file:voice.filename,volume:Math.min(2,Math.max(0,Number(config.voiceVolume)||1))});
 if(audioInputs.length){const args=['-i',current];for(const a of audioInputs)args.push('-stream_loop','-1','-i',a.file);const filters=audioInputs.map((a,i)=>{const r=i===0&&music?config.musicRange:config.voiceRange;const st=Math.max(0,Math.min(total,Number(r?.start)||0));const en=Math.max(st,Math.min(total,Number(r?.end)||total));const dur=Math.max(.01,en-st);return `[${i+1}:a]volume=${a.volume},atrim=duration=${dur.toFixed(2)},asetpts=PTS-STARTPTS,adelay=${Math.round(st*1000)}:all=1[a${i}]`}).join(';');const mix=audioInputs.map((_,i)=>`[a${i}]`).join('')+`amix=inputs=${audioInputs.length}:duration=longest:dropout_transition=0[aout]`;await runFF([...args,'-filter_complex',filters+';'+mix,'-map','0:v','-map','[aout]','-c:v','copy','-c:a','aac','-b:a','160k','-t',String(total),'-movflags','+faststart',output],180000)}else await runFF(['-i',current,'-c','copy','-movflags','+faststart',output],90000);
 const st=await fs.stat(output);res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':st.size,'Content-Disposition':'attachment; filename="smart-ai-edited.mp4"','Cache-Control':'no-store'});await pipeline((await import('node:fs')).createReadStream(output),res);
 }catch(e){if(!res.headersSent)return json(res,500,{error:'영상 합성 실패: '+e.message.slice(0,350)})}finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{})}return;
}
if(req.method==='POST'&&u.pathname==='/api/video/transcribe'){
 const size=Number(req.headers['content-length']);if(!size||size>100*1024*1024)return json(res,413,{error:'음성 인식은 100MB 이하 MP4만 지원합니다.'});
 if(!process.env.OPENAI_API_KEY)return json(res,503,{error:'서버 .env에 OPENAI_API_KEY가 필요합니다.'});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'staf-asr-'));
 try{
  const input=path.join(dir,'input.mp4'),audio=path.join(dir,'speech.mp3');await pipeline(req,createWriteStream(input));
  const run=await new Promise(resolve=>{const proc=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-y','-i',input,'-vn','-ac','1','-ar','16000','-b:a','32k',audio],{windowsHide:true});let err='';proc.stderr.on('data',b=>err=(err+b.toString()).slice(-500));proc.on('error',e=>resolve(e.message));proc.on('close',c=>resolve(c===0?null:err||'오디오 추출 실패'));});
  if(run)return json(res,500,{error:'오디오 추출 실패: '+run});
  const audioBuf=await fs.readFile(audio);if(audioBuf.length>25*1024*1024)return json(res,413,{error:'음성 추출 파일이 25MB를 초과했습니다. 짧은 영상을 사용하세요.'});
  const form=new FormData();form.append('file',new Blob([audioBuf],{type:'audio/mpeg'}),'speech.mp3');form.append('model','whisper-1');form.append('response_format','verbose_json');form.append('timestamp_granularities[]','segment');
  const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY},body:form});const data=await r.json();if(!r.ok)return json(res,r.status,{error:data.error?.message||'음성 인식 실패'});
  return json(res,200,{text:data.text||'',segments:(data.segments||[]).map(x=>({start:x.start,end:x.end,text:x.text})).slice(0,300)});
 }finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{})}
}
if(req.method==='POST'&&u.pathname==='/api/video/trim'){
 const start=Number(u.searchParams.get('start')),end=Number(u.searchParams.get('end'));
 const ratio=u.searchParams.get('ratio')==='original'?'original':'vertical';
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end-start>180)return json(res,400,{error:'시작·종료 시간 또는 최대 180초 제한을 확인하세요.'});
 const size=Number(req.headers['content-length']);if(!Number.isFinite(size)||size<=0||size>600*1024*1024)return json(res,413,{error:'600MB 이하 MP4 파일만 지원합니다.'});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'staf-video-'));
 const input=path.join(dir,'input.mp4'),output=path.join(dir,'output.mp4');
 try{
  await pipeline(req,createWriteStream(input));
  const caption=String(u.searchParams.get('caption')||'').slice(0,220);const fontSize=Math.min(76,Math.max(20,Number(u.searchParams.get('fontSize'))||42));
   const vf=[];if(ratio==='vertical')vf.push('scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1');
   if(caption.trim()){
     const captionPath=path.join(dir,'caption.txt');await fs.writeFile(captionPath,caption,'utf8');
     const safe=captionPath.replace(/\\/g,'/').replace(/:/g,'\\:').replace(/'/g,"\\'");
     vf.push("drawtext=textfile='"+safe+"':fontcolor=white:fontsize="+fontSize+":borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.78");
   }
   const filter=vf.length?['-vf',vf.join(',')]:[];
  const args=['-hide_banner','-loglevel','error','-nostdin','-y','-ss',String(start),'-i',input,'-t',String(end-start),...filter,'-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',output];
  const result=await new Promise(resolve=>{const proc=spawn(process.env.FFMPEG_PATH||'ffmpeg',args,{windowsHide:true});let errors='';let done=false;const timer=setTimeout(()=>{proc.kill();},240000);proc.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-2000)});proc.on('error',e=>{if(!done){done=true;clearTimeout(timer);resolve({ok:false,error:e.message})}});proc.on('close',code=>{if(!done){done=true;clearTimeout(timer);resolve({ok:code===0,error:errors||'FFmpeg 변환 실패'})}})});
  if(!result.ok)return json(res,500,{error:'영상 변환 실패: '+result.error.slice(0,250)+' (FFmpeg 설치 여부를 확인하세요.)'});
  const stat=await fs.stat(output);res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':stat.size,'Content-Disposition':'attachment; filename="travel-shorts.mp4"','Cache-Control':'no-store'});
  const stream=(await import('node:fs')).createReadStream(output);await pipeline(stream,res);
 }finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}return;
}
if(req.method==='GET'&&u.pathname==='/api/version')return json(res,200,{version:'19.0',keywordApi:true});
if(req.method==='POST'&&u.pathname==='/api/render'){const b=await readBody(req);if(!authorized(b.token))return json(res,401,{error:'관리자 비밀번호가 올바르지 않습니다.'});return json(res,200,{html:render(b.data||{},b.links||{},b.images||[],b.keywords||{})});}

if(req.method==='POST'&&u.pathname==='/api/topics'){
 const b=await readBody(req);if(!authorized(b.token))return json(res,401,{error:'관리자 비밀번호가 올바르지 않습니다.'});
 if(!process.env.OPENAI_API_KEY)return json(res,503,{error:'OPENAI_API_KEY가 설정되지 않았습니다.'});
 const category=String(b.category||'호텔·리조트').slice(0,80),seed=String(b.seed||'').slice(0,250);
 const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',response_format:{type:'json_object'},messages:[{role:'user',content:`여행 블로그 카테고리: ${category}. 추가 관심 주제: ${seed||'없음'}. 한국어 SEO 블로그 제목을 5개 추천. 검색량/순위를 확인한 척 하지 말고 검증되지 않은 1위, 최저가, 확정 일정 등의 표현 금지. JSON만 반환: {"titles":["제목1","제목2","제목3","제목4","제목5"]}`}],temperature:0.7})});
 const out=await response.json();if(!response.ok)return json(res,response.status,{error:out.error?.message||'제목 추천 실패'});
 let parsed;try{parsed=JSON.parse(out.choices?.[0]?.message?.content||'{}')}catch{return json(res,502,{error:'제목 추천 응답 해석 실패'})}
 return json(res,200,{titles:(Array.isArray(parsed.titles)?parsed.titles:[]).filter(x=>typeof x==='string').slice(0,5)});
}
if(req.method==='POST'&&u.pathname==='/api/research'){
 const b=await readBody(req);if(!authorized(b.token))return json(res,401,{error:'관리자 비밀번호가 올바르지 않습니다.'});
 if(!process.env.OPENAI_API_KEY)return json(res,503,{error:'OPENAI_API_KEY가 설정되지 않았습니다.'});
 const topic=String(b.topic||'').trim().slice(0,300);if(!topic)return json(res,400,{error:'글 주제를 먼저 입력하세요.'});
 // Web search is explicitly enabled here; do not mislabel ungrounded model text as verified.
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.RESEARCH_MODEL||'gpt-4.1-mini',tools:[{type:'web_search_preview'}],tool_choice:'required',input:`아래 여행 블로그 주제에 대해 웹에서 출처를 찾아 조사하세요: ${topic}. 카테고리: ${String(b.category||'여행').slice(0,80)}. 출처에서 확인할 수 있는 사실만 한국어로 6~10개 항목으로 간결히 정리하세요. 공식 출처 우선. 가격, 영업시간, 객실 재고 등은 시점이 변할 수 있으므로 확정하지 마세요. 검증하지 못한 사항은 별도 '추가 확인 필요'로 적으세요. 웹 검색 인용이 있는 내용만 쓰세요.`,max_output_tokens:1400})});
 const out=await response.json();if(!response.ok)return json(res,response.status,{error:out.error?.message||'웹 자료 조사 요청 실패. 모델 또는 웹 검색 API 지원 여부를 확인하세요.'});
 const messages=(out.output||[]).filter(x=>x.type==='message');const chunks=messages.flatMap(m=>(m.content||[]).filter(x=>x.type==='output_text'));const report=chunks.map(x=>x.text||'').join('\n').trim();
 const sources=[];for(const c of chunks)for(const a of (c.annotations||[])){const u=a.url||a.url_citation?.url;if(u&&/^https:\/\//i.test(u)&&!sources.some(x=>x.url===u))sources.push({url:u,title:String(a.title||a.url_citation?.title||u).slice(0,180)});}
 if(!sources.length)return json(res,422,{error:'출처 링크를 확인하지 못해 검증된 자료로 자동 적용하지 않았습니다. 직접 공식 출처를 확인해 입력하세요.'});
 return json(res,200,{report:report.slice(0,10000),sources:sources.slice(0,12),note:'웹 검색 출처가 있는 AI 조사 초안입니다. 공식 사이트에서 핵심 사실을 최종 확인하세요.'});
}
if(req.method==='POST'&&u.pathname==='/api/keywords'){const b=await readBody(req);if(!authorized(b.token))return json(res,401,{error:'관리자 비밀번호가 올바르지 않습니다.'});if(!process.env.OPENAI_API_KEY||process.env.OPENAI_API_KEY==='put_your_api_key_here')return json(res,503,{error:'서버 .env에 OPENAI_API_KEY를 설정해 주세요.'});const topic=String(b.topic||'').trim().slice(0,300);if(!topic)return json(res,400,{error:'글 주제를 입력하세요.'});const selected=[...new Set(Array.isArray(b.languages)?b.languages:[])].filter(x=>['ko','en','ja'].includes(x));if(!selected.length)return json(res,400,{error:'언어를 하나 이상 선택하세요.'});const prompt=`여행 블로그 SEO 키워드를 작성하세요. 주제: ${topic}. 카테고리: ${String(b.category||'여행').slice(0,100)}. 요청 언어: ${selected.join(', ')}. 언어별 20개 이내의 자연스럽고 실제 주제와 관련된 검색어를 생성하세요. 한국어 ko, 영어 en, 일본어 ja. 근거 없는 호텔 가격, 할인율, 순위, 확정 행사 일정 등은 쓰지 마세요. 번역투를 피하고 현지 검색 표현을 사용하세요. JSON 객체만 반환: {"ko":["..."],"en":["..."],"ja":["..."]}. 요청하지 않은 언어는 빈 배열.`;const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',messages:[{role:'user',content:prompt}],response_format:{type:'json_object'},temperature:0.4})});const out=await response.json();if(!response.ok)return json(res,response.status,{error:out.error?.message||'OpenAI 키워드 요청 실패'});let parsed;try{parsed=JSON.parse(out.choices?.[0]?.message?.content||'{}')}catch{return json(res,502,{error:'키워드 응답 형식 오류'})}const result={ko:[],en:[],ja:[]};for(const lang of selected)result[lang]=[...new Set((Array.isArray(parsed[lang])?parsed[lang]:[]).filter(x=>typeof x==='string').map(x=>x.trim().slice(0,100)).filter(Boolean))].slice(0,20);return json(res,200,{keywords:result});}
if(req.method==='POST'&&u.pathname==='/api/generate'){const b=await readBody(req);if(!process.env.OPENAI_API_KEY||process.env.OPENAI_API_KEY==='put_your_api_key_here')return json(res,503,{error:'서버 .env에 OPENAI_API_KEY를 설정해 주세요.'});if(!authorized(b.token))return json(res,401,{error:'관리자 비밀번호가 올바르지 않습니다.'});if(!String(b.topic||'').trim())return json(res,400,{error:'글 주제를 입력하세요.'});const prompt=`한국어 여행·행사 블로그 글을 작성하세요. 주제: ${String(b.topic).slice(0,300)}. 카테고리: ${String(b.category||'여행').slice(0,100)}. 확인된 참고자료: ${String(b.facts||'없음').slice(0,11000)}. 자료에 없는 호텔명, 요금, 일정, 장소, 평점, 순위, 등록 링크를 사실인 것처럼 만들어내지 마세요. 확인 불가 사항은 검증 필요하다고 적으세요. 깔끔한 여행 블로그 형식. 반드시 JSON 객체만 반환: {"title":"...","intro":"...","sections":[{"heading":"...","paragraphs":["...","..."]}],"tags":["...","..."]}. 섹션 4~6개, 각 2~3문단. HTML/마크다운 금지.`;
const response=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',messages:[{role:'user',content:prompt}],response_format:{type:'json_object'},temperature:0.5})});const out=await response.json();if(!response.ok)return json(res,response.status,{error:out.error?.message||'OpenAI 요청 실패'});let content;try{content=JSON.parse(out.choices?.[0]?.message?.content||'{}')}catch{return json(res,502,{error:'AI 응답 형식이 올바르지 않습니다.'})}return json(res,200,{data:content,html:render(content,b.links,b.images,b.keywords||{})});}
// MP4 export prerequisites: browser can show this status before recording.
if(req.method==='GET'&&u.pathname==='/api/shorts/export-status'){
 const result=await new Promise(resolve=>{
  const p=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-version'],{windowsHide:true});
  let out='',done=false;
  const timer=setTimeout(()=>{p.kill();if(!done){done=true;resolve({ok:false,error:'FFmpeg 확인 시간 초과'})}},7000);
  p.stdout.on('data',b=>out=(out+b.toString()).slice(0,300));
  p.on('error',e=>{if(!done){done=true;clearTimeout(timer);resolve({ok:false,error:e.code==='ENOENT'?'FFmpeg 실행 파일을 찾지 못했습니다. 설치 후 PATH 설정이 필요합니다.':e.message})}});
  p.on('close',code=>{if(!done){done=true;clearTimeout(timer);resolve({ok:code===0,version:out.split('\n')[0]||'',error:code===0?'':'FFmpeg 실행 오류'})}});
 });
 return json(res,result.ok?200:503,result);
}
// Convert a locally created WebM composition to downloadable MP4 with FFmpeg.
if(req.method==='POST'&&u.pathname==='/api/shorts/export-mp4'){
 const limit=180*1024*1024;
 const declared=Number(req.headers['content-length']||0);
 if(declared>limit)return json(res,413,{error:'영상이 너무 큽니다 (최대 180MB).'});
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'staf-shorts-mp4-'));
 const input=path.join(dir,'composition.webm'),output=path.join(dir,'composition.mp4');
 try{
  let received=0;
  const sink=createWriteStream(input);
  for await(const chunk of req){received+=chunk.length;if(received>limit)throw Error('최대 업로드 크기 180MB를 초과했습니다.');if(!sink.write(chunk))await new Promise(resolve=>sink.once('drain',resolve));}
  await new Promise((resolve,reject)=>sink.end(err=>err?reject(err):resolve()));
  if(received<1000)return json(res,400,{error:'영상 데이터가 비어 있습니다.'});
  const args=['-hide_banner','-loglevel','error','-nostdin','-y','-i',input,'-t','60','-c:v','libx264','-preset','veryfast','-crf','24','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',output];
  const result=await new Promise(resolve=>{const proc=spawn(process.env.FFMPEG_PATH||'ffmpeg',args,{windowsHide:true});let errors='',done=false;const timer=setTimeout(()=>proc.kill(),240000);proc.stderr.on('data',b=>errors=(errors+b.toString()).slice(-1200));proc.on('error',e=>{if(!done){done=true;clearTimeout(timer);resolve({ok:false,error:e.message})}});proc.on('close',code=>{if(!done){done=true;clearTimeout(timer);resolve({ok:code===0,error:errors})}})});
  if(!result.ok)return json(res,500,{error:'MP4 변환 실패: '+(result.error||'FFmpeg 오류')+'. FFmpeg 설치 및 PATH를 확인하세요.'});
  const stat=await fs.stat(output);
  res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':stat.size,'Content-Disposition':'attachment; filename="SMART_TRAVEL_SHORTS.mp4"','Cache-Control':'no-store'});
  await pipeline((await import('node:fs')).createReadStream(output),res);
 }catch(err){if(!res.headersSent)return json(res,500,{error:err.message});}
 finally{await fs.rm(dir,{recursive:true,force:true}).catch(()=>{});}
 return;
}
// Serve browser pages and assets from public/ (GET/HEAD only).
if(req.method==='GET'||req.method==='HEAD'){
  let requested;
  try{requested=decodeURIComponent(u.pathname)}catch{return json(res,400,{error:'잘못된 경로입니다.'})}
  if(requested==='/' )requested='/index.html';
  const publicRoot=path.resolve(root,'public');
  const target=path.resolve(publicRoot,'.'+requested);
  if(target.startsWith(publicRoot+path.sep)){
    const stat=await fs.stat(target).catch(()=>null);
    if(stat?.isFile()){
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.gif':'image/gif','.svg':'image/svg+xml','.ico':'image/x-icon','.mp4':'video/mp4','.webm':'video/webm','.mp3':'audio/mpeg','.wav':'audio/wav','.woff2':'font/woff2'};
      res.writeHead(200,{'Content-Type':mime[path.extname(target).toLowerCase()]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-cache','X-Content-Type-Options':'nosniff'});
      if(req.method==='HEAD')return res.end();
      return pipeline((await import('node:fs')).createReadStream(target),res);
    }
  }
}
json(res,404,{error:'찾을 수 없는 경로입니다.'});}catch(e){json(res,500,{error:e.message||'서버 오류'});}});
server.listen(port,()=>console.log(`SMART AI FACTORY 41.0: http://localhost:${port}`));
