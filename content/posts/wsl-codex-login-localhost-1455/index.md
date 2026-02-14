---
title: "WSL에서 Codex 로그인 1455 콜백 에러를 우회한 방법"
date: 2026-02-14T10:48:00+09:00
description: "VS Code에서 Codex 로그인 중 localhost:1455 콜백이 400 에러로 실패할 때, WSL에서 콜백 엔드포인트를 직접 확인해 로그인 완료한 경험을 정리했다."
keywords: ["WSL", "Codex", "VS Code", "localhost", "1455", "login", "troubleshooting"]
categories: ["Troubleshooting"]
tags: ["WSL", "Codex", "VS Code", "OAuth", "로그인오류"]
showHero: true
heroStyle: "background"
---

WSL 환경에서 Codex를 쓰려고 설정하던 중, VS Code 로그인 단계에서 막혔던 경험을 정리해봤다.

요약하면, 브라우저에서 콜백 URL이 열릴 때 `localhost:1455`에서 400 계열 에러가 보였고 "서버에 연결할 수 없다"는 메시지가 나왔다. 이때 WSL 쪽에서 콜백/성공 엔드포인트를 직접 확인해보니 로그인 흐름이 정상으로 넘어갔다.

## 상황

- WSL + VS Code 환경에서 Codex 로그인 시도
- 브라우저가 `http://localhost:1455/auth/callback?...` 형태 URL로 이동
- 페이지는 에러(400 계열)로 보이고 로그인 완료가 안 된 것처럼 보임

내 경우에는 브라우저 에러 화면만 보고 완전히 실패한 줄 알았는데, 로컬 콜백 서버 상태를 직접 확인해보는 게 효과적이었다.

## 내가 했던 확인 방법

아래처럼 WSL 터미널에서 콜백 URL과 success 엔드포인트를 확인했다.

```bash
# 실제 code/state 값은 그대로 공유하지 말고 마스킹 권장
curl -v "http://localhost:1455/auth/callback?code=<AUTH_CODE>&scope=openid+profile+email+offline_access&state=<STATE>"

curl -v "http://localhost:1455/success"
```

내 환경에서는 위 요청 이후 로그인 흐름이 이어졌고, VS Code에서도 사용 가능 상태가 되었다.

## 왜 이 방법이 먹혔을까

정확한 내부 동작은 환경마다 다를 수 있지만, 내 추측으로는 다음 중 하나였다.

- 브라우저와 WSL 로컬 포트 포워딩 타이밍 이슈
- 콜백이 전달됐지만 UI 반영이 늦거나 끊긴 케이스
- 인증 완료 페이지 렌더링은 실패했지만 백엔드 처리는 부분적으로 완료된 케이스

그래서 "브라우저 화면 에러"와 "인증 흐름 실패"를 동일하게 보지 않는 편이 낫겠다고 느꼈다.

## 같은 증상이 있을 때 체크 포인트

1. `localhost:1455` 리스너가 실제로 떠 있는지 확인
2. 콜백 URL의 `code`/`state`를 외부에 공유하지 않기
3. WSL 터미널에서 콜백/성공 엔드포인트를 짧게 확인
4. 완료 후 VS Code 인증 상태를 재확인

## 마무리

WSL + VS Code 조합에서는 인증 콜백이 눈에 보이는 방식으로 실패해도, 실제 처리 상태는 다를 수 있었다. 비슷한 증상을 만나면 콜백 엔드포인트를 로컬에서 한 번 확인해보는 방법이 꽤 실용적일 것 같다.
