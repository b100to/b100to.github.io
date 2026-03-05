---
title: "Google SSO 앱, 어디서 만들어야 하지? - Cloud Console vs Workspace Admin"
date: 2026-03-05T17:15:00+09:00
description: "Google Cloud Console과 Google Workspace Admin Console에서 SSO 앱을 만드는 차이점, SAML과 OIDC 비교, 그리고 Authentik을 SSO 허브로 활용하는 구조를 정리했다."
keywords: ["Google SSO", "SAML", "OIDC", "OAuth", "Authentik", "SSO Hub", "Google Cloud Console", "Google Workspace Admin"]
categories: ["DevOps"]
tags: ["SSO", "SAML", "OIDC", "Authentik", "Google"]
showHero: true
heroStyle: "background"
---

> **TL;DR**: Google Cloud Console은 OAuth/OIDC 앱, Google Workspace Admin은 SAML 앱을 만드는 곳이다. Authentik 같은 SSO 허브를 쓰면 Google OAuth 하나로 모든 내부 도구의 SSO를 통합할 수 있다.

## 혼란의 시작

내부 도구에 SSO를 붙이다 보면 Google 관련 설정이 두 곳에서 나온다.

- **Google Cloud Console** (`console.cloud.google.com`)
- **Google Workspace Admin Console** (`admin.google.com`)

처음에는 "둘 다 Google인데 뭐가 다르지?" 싶었는데, 역할이 명확히 다르다.

## 핵심 차이

| | Google Cloud Console | Google Workspace Admin |
|---|---|---|
| **URL** | `console.cloud.google.com` | `admin.google.com` |
| **만들 수 있는 앱** | OAuth 2.0 / OIDC 클라이언트 | SAML 앱 |
| **용도** | 외부 앱이 Google 로그인을 사용하도록 | 조직 사용자에게 SAML 기반 SSO 제공 |
| **접근 제어** | API 제어 → 앱 액세스 제어 | 조직 단위(OU)별 앱 사용 설정 |

**간단하게**: OAuth/OIDC 앱을 만들고 싶으면 Cloud Console, SAML 앱을 만들고 싶으면 Workspace Admin이다.

## SAML vs OIDC, 언제 뭘 쓸까

둘 다 SSO 프로토콜인데, 실무에서 체감하는 차이가 있다.

### OIDC (OAuth 2.0 기반)

```
사용자 → 앱 → IdP(인증서버) → 앱 (JWT 토큰 반환)
```

- JSON 기반, 가볍다
- 모던 웹앱/SPA에 잘 맞는다
- 대부분의 자체 호스팅 도구가 지원한다 (ArgoCD, Grafana, Airflow 등)
- **현재 사실상 표준**

### SAML 2.0

```
사용자 → SP(서비스) → IdP(인증서버) → SP (XML assertion 반환)
```

- XML 기반, 무겁다
- 엔터프라이즈 레거시 시스템에서 주로 사용
- AWS Console, VPN 장비 등이 아직 SAML만 지원
- 설정이 복잡하지만 안정적

### 실무 선택 기준

내 경우 이런 기준으로 나눴다:

- **자체 호스팅 도구** (ArgoCD, Grafana, Airflow 등) → **OIDC**
- **AWS Console** → **SAML** (AWS가 OIDC 로그인을 지원하지 않음)
- **VPN** (FortiGate 등) → **SAML** (네트워크 장비는 대부분 SAML)
- **SaaS** → 해당 서비스가 지원하는 방식에 따라

## SSO 허브 구조

여러 도구에 각각 Google SSO를 붙이는 대신, SSO 허브를 두면 관리가 훨씬 편하다.

```
                    ┌─── ArgoCD (OIDC)
                    ├─── Grafana (OIDC)
Google ──OAuth──► SSO Hub ──┤
                (Authentik)  ├─── Airflow (OIDC)
                    ├─── AWS Console (SAML)
                    └─── Kubecost (oauth2-proxy)
```

### 이 구조의 장점

1. **Google Cloud Console에서 OAuth 클라이언트 하나만 관리**하면 된다
2. 각 앱별 인증 설정은 SSO 허브(Authentik)에서 중앙 관리
3. 새 도구 추가 시 Google 쪽은 건드릴 필요 없이 SSO 허브에만 추가
4. 그룹/정책 기반 접근 제어를 한 곳에서 관리 가능

### SSO 미지원 도구는?

Kubecost Free 티어처럼 자체 OIDC를 지원하지 않는 도구는 **oauth2-proxy**를 리버스 프록시로 앞에 두면 된다:

```
사용자 → oauth2-proxy → SSO Hub 인증 → Kubecost
```

## SaaS 도구의 SSO 제약

한 가지 주의할 점이 있다. SaaS 제품의 SAML SSO는 대부분 **상위 플랜에서만 지원**한다.

예를 들어 Datadog의 경우:
- Free/Pro 플랜: SAML SSO **불가** (`saml_can_be_enabled: false`)
- Enterprise 플랜: SAML SSO 지원

API로 확인해보면 바로 알 수 있다:

```json
{
  "settings": {
    "saml": { "enabled": false },
    "saml_can_be_enabled": false
  }
}
```

SSO 통합을 계획할 때 **SaaS 도구의 플랜별 SSO 지원 여부를 먼저 확인**하는 게 좋다. 이걸 모르고 Authentik 쪽 설정을 다 해놨다가 "이 플랜에서는 SAML이 안 된다"는 걸 뒤늦게 알면 시간 낭비가 된다.

이 경우 대안으로:
- SSO 허브 포탈에 **링크만 추가** (즐겨찾기 느낌)
- 또는 해당 SaaS가 자체 지원하는 **Google SSO 직접 연동** 활용

## 서비스 계정 SSO 가입 차단

SSO 허브를 운영하다 보면 서비스 계정(공용 모니터링 계정 등)이 Google SSO로 가입되는 걸 막아야 할 때가 있다.

Authentik의 경우 enrollment flow에 expression policy를 바인딩하면 된다:

```python
BLOCKED_EMAILS = [
    "monitoring-readonly@example.com",
    "shared-dashboard@example.com",
]
email = request.context.get("prompt_data", {}).get("email", "")
if not email:
    email = getattr(request.user, "email", "")
return email.lower() not in [e.lower() for e in BLOCKED_EMAILS]
```

이 정책을 `default-source-enrollment` flow에 바인딩하면, 차단 목록의 이메일은 SSO로 신규 가입이 거부된다.

## 정리

| 하고 싶은 것 | 어디서 | 프로토콜 |
|---|---|---|
| 외부 앱에 Google 로그인 붙이기 | Google Cloud Console | OAuth/OIDC |
| VPN에 Google SSO 붙이기 | Google Workspace Admin | SAML |
| 내부 도구 SSO 통합 | SSO 허브 (Authentik 등) | OIDC (주로) |
| AWS Console SSO | SSO 허브 → AWS | SAML |
| SaaS SSO | 플랜 확인 필수 | SAML (보통) |

SSO 구축 시 "SAML이냐 OIDC냐"보다는 **"SSO 허브를 통해 중앙 관리할 것인가"**가 더 중요한 결정이라고 생각한다. 허브 구조를 잡아놓으면 새 도구 추가가 정말 편해진다.
