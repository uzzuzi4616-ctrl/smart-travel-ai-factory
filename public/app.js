'use strict';
const $=id=>document.getElementById(id);
const categories=['해외여행','항공권·교통','호텔·리조트','테마파크','글로벌 이벤트','여행 할인정보','컨퍼런스','마라톤 대회','경기 일정','국내 웨딩홀','신혼여행'];
const names=['트립닷컴 항공권','트립닷컴 호텔·리조트','클룩 입장권·체험','웨딩홀 상담','웨딩박람회','기타 제휴'];
const matches={
 '해외여행':[0,1,2],'항공권·교통':[0,1],'호텔·리조트':[1],'테마파크':[2,0,1],
 '글로벌 이벤트':[0,1,2],'여행 할인정보':[0,1,2],'컨퍼런스':[1,0],
 '마라톤 대회':[1,0],'경기 일정':[0,1,2],'국내 웨딩홀':[3,4],
 '신혼여행':[1,0,2,3]
};
let result=null;let html='';
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function safeUrl(s){try{const u=new URL(s);return ['https:','http:'].includes(u.protocol)?u.href:null}catch{return null}}
function cleanHtml(input){const doc=new DOMParser().parseFromString(input,'text/html');const allowed=new Set(['H2','H3','P','UL','OL','LI','STRONG','EM','B','I','BLOCKQUOTE','TABLE','THEAD','TBODY','TR','TH','TD','A','BR']);const walk=node=>{for(const child of [...node.children]){if(!allowed.has(child.tagName)){const frag=doc.createDocumentFragment();while(child.firstChild)frag.appendChild(child.firstChild);child.replaceWith(frag);walk(node)}else{for(const attr of [...child.attributes])child.removeAttribute(attr.name);walk(child)}}};walk(doc.body);return doc.body.innerHTML}
function readLinks(){try{return JSON.parse(localStorage.getItem('travel-affiliates')||'{}')}catch{return {}}}
function linkSection(cat){const links=readLinks();const items=(matches[cat]||[]).map(i=>{const url=safeUrl(links[i]||'');return url?`<li><a href="${escapeHtml(url)}" target="_blank" rel="nofollow sponsored noopener noreferrer">${escapeHtml(names[i])} 상품·예약 정보 확인 →</a></li>`:''}).filter(Boolean);return items.length?`<h2>관련 예약·제휴 링크</h2><ul>${items.join('')}</ul>`:''}
function compose(){if(!result)return '';const disclosure='<p><strong>광고 안내:</strong> 이 포스팅에는 제휴 링크가 포함될 수 있으며, 이를 통해 일정 수수료를 제공받을 수 있습니다.</p>';const links=linkSection($('category').value);return (links?disclosure:'')+cleanHtml(result.html)+links}
function render(){if(!result)return;html=compose();$('preview').innerHTML=html;$('meta').textContent=`제목: ${result.title} | 태그: ${result.tags.join(', ')}`;$('copy').disabled=false;$('download').disabled=false}
const rows=$('affiliateRows');names.forEach((name,i)=>{const wrap=document.createElement('div');wrap.className='affiliate-row';const label=document.createElement('label');label.textContent=name;const input=document.createElement('input');input.type='url';input.placeholder='https://... 승인된 제휴 링크';input.id='affiliate'+i;input.value=readLinks()[i]||'';label.append(input);wrap.append(label);rows.append(wrap)});
$('saveLinks').onclick=()=>{const links={};for(let i=0;i<names.length;i++){const value=$('affiliate'+i).value.trim();if(value&&!safeUrl(value)){alert(`${names[i]} URL은 http:// 또는 https://로 시작해야 합니다.`);return}links[i]=value}localStorage.setItem('travel-affiliates',JSON.stringify(links));render();alert('제휴 링크가 이 브라우저에 저장되었습니다.')};
$('category').addEventListener('change',render);
$('generate').onclick=async()=>{const topic=$('topic').value.trim();const token=$('token').value.trim();if(topic.length<3)return alert('글 주제를 3자 이상 입력하세요.');if(!token)return alert('관리자 비밀번호를 입력하세요.');$('generate').disabled=true;$('status').textContent='AI가 초안을 작성 중입니다. 잠시 기다려 주세요.';try{const response=await fetch('/api/generate',{method:'POST',headers:{'Content-Type':'application/json','x-admin-token':token},body:JSON.stringify({topic,category:$('category').value,sourceText:$('source').value,tone:$('tone').value,length:$('length').value})});const data=await response.json();if(!response.ok)throw new Error(data.error||'생성 실패');result=data;render();$('status').textContent='초안이 생성되었습니다. 사실관계와 링크를 확인한 뒤 게시하세요.'}catch(e){$('status').textContent='오류: '+e.message}finally{$('generate').disabled=false}};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText(html);alert('HTML 본문이 복사되었습니다. 티스토리 글쓰기의 HTML 모드에 붙여넣으세요.')}catch{alert('복사에 실패했습니다. HTTPS에서 접속했는지 확인해 주세요.')}};
$('download').onclick=()=>{const file=new Blob(['<!doctype html><html lang="ko"><meta charset="utf-8"><title>'+escapeHtml(result.title)+'</title><body>'+html+'</body></html>'],{type:'text/html;charset=utf-8'});const url=URL.createObjectURL(file);const a=document.createElement('a');a.href=url;a.download='travel-post.html';a.click();URL.revokeObjectURL(url)};
