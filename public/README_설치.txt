V50 설치 안내
1. 기존 public/index.html을 반드시 백업하세요.
2. ZIP 안 public/index.html, studio.html, global-black-design.png 3개를 기존 public 폴더에 복사하세요.
3. 서버를 재시작하고 http://localhost:3000/ 에 접속하세요.
4. 기존 대시보드는 http://localhost:3000/studio.html 에서 열립니다.
5. ?studio=1 이 붙은 주소가 아니라 / 주소로 접속하세요.
6. 새 디자인은 시안 이미지를 사용하며 버튼 일부만 실제 링크입니다. 결제 기능은 구현되지 않았습니다.
7. 만약 / 가 다른 페이지라면 server.js에서 / 라우팅을 점검해야 합니다.
