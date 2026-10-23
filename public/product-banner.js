/* Shared global banner: standalone, no app dependencies, safe on all product pages. */
(function(){
  'use strict';
  if(document.getElementById('staf-global-banner'))return;
  if(sessionStorage.getItem('stafBannerDismissedV50')==='1')return;
  function mount(){
    if(!document.body||document.getElementById('staf-global-banner'))return;
    const banner=document.createElement('header');
    banner.id='staf-global-banner';
    banner.setAttribute('role','banner');
    banner.innerHTML='<div><a class="staf-brand" href="/" aria-label="SMART TRAVEL AI FACTORY global home">✈ SMART TRAVEL<br><b>AI FACTORY</b></a><div class="staf-description">Create travel content, shorts, card news, scripts &amp; music with AI.</div></div><nav class="staf-actions" aria-label="Global navigation"><a class="staf-pill optional" href="/#tools">AI Tools</a><a class="staf-pill optional" href="/#pricing">Pricing</a><a class="staf-pill" href="/">🌍 Global Home</a><a class="staf-pill primary" href="/studio.html">Open Studio →</a><button type="button" class="staf-dismiss" aria-label="배너 닫기" title="배너 닫기">×</button></nav>';
    document.body.insertBefore(banner,document.body.firstChild);
    document.documentElement.classList.add('staf-banner-open');
    document.body.classList.add('staf-banner-open');
    banner.querySelector('.staf-dismiss').addEventListener('click',function(){
      sessionStorage.setItem('stafBannerDismissedV50','1');
      banner.remove();document.documentElement.classList.remove('staf-banner-open');document.body.classList.remove('staf-banner-open');
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
})();
