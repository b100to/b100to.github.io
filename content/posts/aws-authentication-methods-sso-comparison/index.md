---
title: "AWS 인증 방식 비교: Access Key부터 SSO, Authentik까지"
date: 2026-01-27T16:50:00+09:00
description: "AWS CLI/Terraform 인증 방식을 비교하고, 팀 규모에 따른 최적의 인증 전략을 알아봅니다. Access Key, AWS SSO, AssumeRole, 그리고 Authentik/Keycloak까지."
keywords: ["AWS", "SSO", "Authentik", "Keycloak", "OIDC", "SAML", "인증", "DevOps"]
categories: ["AWS"]
tags: ["AWS", "SSO", "Authentik", "Security", "DevOps", "OIDC"]
showHero: true
heroStyle: "background"
---

## 발단: Access Key 없이 AWS 인증할 수 없을까?

AWS CLI나 Terraform을 사용할 때 가장 흔한 인증 방식은 Access Key입니다. 하지만 평문으로 저장된 키는 보안 위험이 있죠.

```ini
# ~/.aws/credentials - 누군가 이 파일을 읽으면?
[default]
aws_access_key_id=AKIA...
aws_secret_access_key=wCnJ...
```

그래서 "Access Key 없이 인증하는 방법이 없을까?" 라는 질문을 하게 됩니다.

## AWS 인증 방식 비교

### 1. 평문 Access Key

```ini
# ~/.aws/credentials
[dev]
aws_access_key_id=AKIA...
aws_secret_access_key=...
```

- **장점**: 설정 간단
- **단점**: 파일 읽기 권한만 있으면 탈취 가능
- **Access Key 필요**: ✅ 필요

### 2. 1Password / AWS Vault

```ini
# ~/.aws/config
[profile dev]
credential_process = sh -c 'op read "op://Vault/item/..."'
```

- **장점**: 암호화 저장, 마스터 패스워드/생체인증 필요
- **단점**: Access Key 자체는 여전히 존재
- **Access Key 필요**: ✅ 필요 (암호화 저장)

### 3. AssumeRole + MFA

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/admin \
  --serial-number arn:aws:iam::123456789012:mfa/mydevice \
  --token-code 123456
```

- **장점**: 임시 토큰 사용, MFA 강제 가능
- **단점**: AssumeRole 호출 자체에 Access Key 필요
- **Access Key 필요**: ✅ 필요 (API 호출 서명용)

### 4. AWS SSO (IAM Identity Center)

```bash
aws sso login --profile dev
# 브라우저 열림 → 로그인 → 임시 토큰 발급
```

- **장점**: Access Key 불필요, 브라우저 기반 OAuth 인증
- **단점**: Management Account 권한 필요
- **Access Key 필요**: ❌ 불필요

### 5. Keycloak / Authentik (자체 IdP)

```bash
saml2aws login
# 브라우저 열림 → IdP 로그인 → SAML 인증 → 임시 토큰
```

- **장점**: Access Key 불필요, 자체 운영 가능
- **단점**: IdP 인프라 운영 필요
- **Access Key 필요**: ❌ 불필요

## 왜 SSO만 Access Key가 필요 없을까?

핵심은 **인증 방식의 차이**입니다.

```
Access Key 방식:
  API 호출 → Access Key로 서명 → AWS 검증

SSO/IdP 방식:
  브라우저 로그인 → IdP가 인증 확인 → AWS에 "이 사람 인증됨" 전달 → 임시 토큰 발급
```

SSO는 **OAuth/OIDC 기반**이라 브라우저에서 IdP(Identity Provider)에 로그인하고, IdP가 AWS에 인증 정보를 전달합니다. Access Key로 서명하는 과정 자체가 없습니다.

## AWS SSO를 못 쓰는 상황

AWS SSO(IAM Identity Center)가 가장 이상적이지만, 못 쓰는 경우가 있습니다:

```bash
aws sso-admin list-instances
# { "Instances": [] }
```

**MSP나 파트너사가 Organization을 관리하는 경우**, Management Account 접근 권한이 없어서 IAM Identity Center를 활성화할 수 없습니다.

> 참고: Account Instance라는 것도 있지만, 이건 Amazon Q, QuickSight 같은 **AWS 관리형 앱 전용**이라 CLI/Terraform 인증에는 사용할 수 없습니다.

## 대안: 자체 IdP (Keycloak / Authentik)

AWS SSO를 못 쓴다면, **자체 IdP를 운영**하는 방법이 있습니다.

### Keycloak vs Authentik

| 항목 | Keycloak | Authentik |
|-----|----------|-----------|
| **언어** | Java (무거움) | Python/Go (가벼움) |
| **리소스** | 1GB+ RAM | 512MB 가능 |
| **성숙도** | 10년+ (Red Hat) | 4년+ |
| **UI** | 복잡함 | 직관적, 모던 |
| **AWS 연동 문서** | 풍부함 | 적음 |

**Authentik**: 소규모 팀, 가벼운 운영, 모던 UI 원할 때
**Keycloak**: 엔터프라이즈, 레퍼런스 중요할 때

### 연동 방식

```
                      ┌── OIDC ──→ ArgoCD
Authentik/Keycloak ───┼── OIDC ──→ Grafana
        (IdP)         ├── SAML ──→ AWS Console/CLI
                      └── OIDC ──→ 내부 어드민
```

Authentik/Keycloak은 **OIDC와 SAML 모두 지원**해서, 서비스마다 다른 프로토콜을 사용해도 됩니다.

## 팀 규모별 권장 전략

### 1인 운영

```
추천: 1Password credential_process

이유:
- IdP 운영 오버헤드 >> 얻는 이점
- 1Password로 이미 충분한 보안
- 추가 인프라 불필요
```

### 2-5명 개발팀

```
추천: 1Password 또는 Authentik 검토 시작

고려사항:
- 온보딩/오프보딩 빈도
- ArgoCD, Grafana 등 내부 서비스 수
- 운영 리소스 여유
```

### 5명+ 또는 비개발자 포함 30명+

```
추천: Authentik/Keycloak 도입

이유:
- SSO로 로그인 단순화
- 퇴사자 한 번에 차단
- MFA 전사 적용
- 감사 로그 통합
```

## 실제 도입 시 고려사항

### Authentik 권장 구성

```yaml
# EKS에 배포 시
namespace: authentik
replicas:
  server: 2      # HA 필수
  worker: 1
postgresql:
  enabled: false  # RDS 사용 권장
redis:
  enabled: true
ingress:
  enabled: true
  host: auth.company.com
```

### 연동 우선순위

```
1. Authentik 설치 & 기본 설정
2. Grafana OIDC 연동 (가장 쉬움)
3. ArgoCD OIDC 연동
4. 내부 어드민 연동 (OIDC 또는 SAML)
5. AWS SAML 연동 (CLI용 - saml2aws 사용)
```

### 주의점

- **Authentik 다운 = 모든 서비스 로그인 불가** → HA 필수
- 초기 설정 1-2일 소요
- 내부 어드민이 OIDC/SAML 미지원 시 개발 공수 필요

## 정리

| 상황 | 권장 방식 |
|-----|----------|
| AWS SSO 가능 | AWS SSO (가장 이상적) |
| SSO 불가 + 1인 운영 | 1Password credential_process |
| SSO 불가 + 5명+ 팀 | Authentik 도입 검토 |
| SSO 불가 + 30명+ 조직 | Authentik/Keycloak 필수 |

Access Key 자체를 없애려면 **SSO 또는 자체 IdP**가 필요합니다. 팀 규모와 운영 리소스에 맞춰 선택하면 됩니다.

  