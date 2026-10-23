/* V44: Play the user's video with the currently selected title/caption/frame overlay. */
(()=>{'use strict';
const $=id=>document.getElementById(id);
const phone=$('phone'), file=$('previewFile'), video=$('videoPreview'), youtube=$('youtubePreview');
if(!phone||!file||!video)return;
const toolbar=document.querySelector('.preview-source');
const play=document.createElement('button');play.type='button';play.id='playComposedPreview';play.textContent='▶ 내 영상 + 템플릿 재생';play.title='선택한 영상 위에 현재 템플릿의 제목·자막·테두리를 표시합니다';
if(toolbar)toolbar.insertBefore(play,toolbar.firstChild);
const state=document.createElement('div');state.id='composedPreviewState';state.setAttribute('role','status');state.textContent='내 영상 파일을 선택하면 제목·자막·테두리를 입힌 상태로 재생합니다.';
if(toolbar)toolbar.insertAdjacentElement('afterend',state);
let currentFile=null;
file.addEventListener('change',()=>{currentFile=file.files?.[0]||null;if(currentFile){state.textContent='✓ '+currentFile.name+' — 템플릿 합성 미리보기 준비 완료';setTimeout(()=>{if(!video.hidden)video.play().catch(()=>{});},80)}},true);
function playComposed(){
  if(!video.hidden&&video.src){
    phone.classList.add('media-playing','composed-playing');
    video.play().then(()=>{state.textContent='▶ 내 영상과 선택한 템플릿을 함께 재생 중입니다.'}).catch(()=>{state.textContent='영상의 재생 버튼을 눌러 주세요.'});return;
  }
  if(currentFile){file.dispatchEvent(new Event('change',{bubbles:true}));return;}
  if(!youtube.hidden){state.textContent='유튜브 링크 영상은 임베드 위에 템플릿을 표시합니다. MP4 합성 저장은 원본 파일이 필요합니다.';return;}
  state.textContent='먼저 MP4 등 내 영상 파일을 선택해 주세요.';file.click();
}
play.addEventListener('click',playComposed);
video.addEventListener('play',()=>{phone.classList.add('media-playing','composed-playing');state.textContent='▶ 영상 재생 중 — 템플릿 제목·자막·테두리 적용';});
video.addEventListener('pause',()=>{if(!video.ended&&!video.hidden)state.textContent='⏸ 일시정지 — 재생 버튼을 누르면 템플릿과 함께 계속 재생됩니다.'});
video.addEventListener('ended',()=>{state.textContent='✓ 재생 완료. 다시 재생할 수 있습니다.'});
const observer=new MutationObserver(()=>{if(video.hidden)phone.classList.remove('composed-playing')});observer.observe(video,{attributes:true,attributeFilter:['hidden']});
})();
