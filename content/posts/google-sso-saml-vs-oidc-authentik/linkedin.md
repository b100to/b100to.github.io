# LinkedIn 포스트용

https://b100to.github.io/posts/google-sso-saml-vs-oidc-authentik/

TL;DR: Google Cloud Console은 OAuth/OIDC, Workspace Admin은 SAML 앱을 만드는 곳이다. SSO 허브를 두면 Google OAuth 하나로 모든 내부 도구의 SSO를 통합할 수 있다.

---

내부 도구에 SSO를 붙이다 보면 Google 설정이 두 곳에서 나와서 헷갈린다.

정리하면 간단하다: Cloud Console은 OAuth/OIDC, Workspace Admin은 SAML. 프로토콜이 다르니 만드는 곳이 다른 것이다.

그리고 각 도구마다 Google SSO를 붙이기보다 SSO 허브(Authentik 등)를 두면 Google OAuth 클라이언트 하나로 ArgoCD, Grafana, Airflow, AWS Console까지 통합 관리가 가능하다. SaaS의 경우 SAML SSO가 Enterprise 플랜 전용인 경우가 많으니 플랜 확인 먼저 하는 게 좋다.

---

https://b100to.github.io/posts/google-sso-saml-vs-oidc-authentik/

TL;DR: Google Cloud Console is for OAuth/OIDC apps, Workspace Admin is for SAML apps. An SSO hub lets you unify all internal tools with a single Google OAuth client.

Setting up SSO for internal tools can get confusing when Google has two different consoles. The rule is simple: Cloud Console for OAuth/OIDC, Workspace Admin for SAML - different protocols, different places.

Rather than connecting Google SSO to each tool individually, using an SSO hub like Authentik lets you manage ArgoCD, Grafana, Airflow, and even AWS Console with just one Google OAuth client. One gotcha: many SaaS products gate SAML SSO behind Enterprise plans, so check your plan first.

#DevOps #SSO #SAML #OIDC #Authentik #GoogleWorkspace #InfrastructureAsCode
