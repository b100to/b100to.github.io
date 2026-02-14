# LinkedIn 포스트용

https://b100to.github.io/posts/wsl-codex-login-localhost-1455/

---

WSL에서 VS Code로 Codex 로그인할 때 `localhost:1455` 콜백 화면이 400 에러로 보여서 실패한 줄 알았던 경험이 있었습니다.  
저는 WSL 터미널에서 콜백/성공 엔드포인트를 직접 확인해보니 로그인 흐름이 정상으로 이어졌습니다.  
브라우저 에러 화면과 실제 인증 처리 상태가 항상 같지는 않다는 점이 핵심이었습니다.  
비슷한 증상이라면 로컬 콜백 상태를 짧게 점검해보는 방법을 추천합니다.

---

While signing into Codex from VS Code on WSL, I hit a 400 error on the `localhost:1455` callback page.  
I verified the callback/success endpoints from the WSL terminal, and the auth flow continued successfully.  
The key lesson: a browser error page does not always mean the OAuth flow fully failed.  
If you see similar behavior, quickly validating the local callback endpoints can help.

#DevOps #WSL #VSCode #OAuth #Troubleshooting
