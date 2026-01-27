---
title: "AWS Credentials 보안 강화: 평문 키 제거하고 1Password로 관리하기"
date: 2026-01-27T16:30:00+09:00
description: "~/.aws/credentials에 평문으로 저장된 AWS Access Key를 제거하고, 1Password credential_process를 사용해 보안을 강화하는 방법을 알아봅니다."
keywords: ["AWS", "1Password", "credential_process", "보안", "DevOps", "AWS Vault"]
categories: ["AWS"]
tags: ["AWS", "1Password", "Security", "DevOps", "credential_process"]
showHero: true
heroStyle: "background"
---

## 문제 인식

어느 날 `~/.aws/credentials` 파일을 열어보니...

```ini
[dev]
aws_access_key_id=AKIA...
aws_secret_access_key=wCnJ...

[prd]
aws_access_key_id=AKIA...
aws_secret_access_key=CYCd...
```

평문으로 저장된 AWS Access Key들이 눈에 들어왔습니다. 만약 노트북을 분실하거나 악성 소프트웨어가 이 파일을 읽는다면? 생각만 해도 아찔합니다.

## 해결 방법 탐색

### 1. AWS SSO (IAM Identity Center) - 첫 번째 시도

가장 이상적인 방법은 AWS SSO입니다. 임시 자격증명을 사용하고, MFA도 통합되어 있죠.

```bash
aws sso login --profile dev
```

**하지만 문제가 있었습니다.**

```bash
aws sso-admin list-instances
# { "Instances": [] }
```

Organization의 Management Account가 MSP 회사 소유였습니다. IAM Identity Center는 Management Account에서만 활성화할 수 있어서, 직접 설정이 불가능했습니다.

> 참고: 계정 인스턴스(Account Instance)도 있지만, 이건 AWS 관리형 앱(Amazon Q, QuickSight 등) 접근용이지 **AWS CLI/Terraform 인증에는 사용할 수 없습니다.**

### 2. AWS Vault - 두 번째 후보

```bash
brew install aws-vault
aws-vault add dev
```

AWS Vault는 credentials를 macOS Keychain에 암호화 저장하고, STS 임시 토큰을 발급받아 사용합니다. 좋은 선택이었지만...

```
aws-vault이(가) 'aws-vault' 키체인을 사용하고자 합니다.
키체인 암호를 입력하십시오.
```

예전에 설정한 키체인 암호를 까먹었습니다. 😅

### 3. 1Password - 최종 선택

이미 1Password를 사용하고 있었고, AWS credentials 관리도 가능하다는 걸 알게 되었습니다.

## 방법 비교

| 방법 | 보안 | 편의성 | 설정 복잡도 | 비고 |
|------|------|--------|------------|------|
| 평문 credentials | ⭐ | ⭐⭐⭐⭐⭐ | ⭐ | 위험함 |
| AWS SSO | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | Management Account 필요 |
| AWS Vault | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐ | 별도 키체인 관리 |
| 1Password | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | 이미 사용 중이면 최적 |

## 1Password 설정 과정

### Step 1: 1Password CLI 설치

```bash
brew install 1password-cli

# 설치 확인
op --version
```

### Step 2: AWS credentials를 1Password에 저장

```bash
op plugin init aws
```

이 명령어를 실행하면 인터랙티브하게 진행됩니다:

1. **Import into 1Password...** 선택
2. `~/.aws/credentials`에서 profile 선택 (예: dev)
3. 저장할 vault 선택
4. **Prompt me for each new terminal session** 선택 (여러 profile 사용 시 추천)

dev, prd 등 모든 profile에 대해 반복합니다.

### Step 3: credential_process 설정

1Password에 저장된 credentials를 AWS CLI/Terraform이 사용하려면 `~/.aws/config`에 `credential_process`를 설정해야 합니다.

먼저 1Password item ID를 확인합니다:

```bash
op item list --format json | jq '.[] | select(.title | contains("AWS")) | {title, id, vault: .vault.name}'
```

```json
{
  "title": "AWS Access Key (dev)",
  "id": "abc123...",
  "vault": "Work"
}
```

그리고 `~/.aws/config`를 수정합니다:

```ini
[profile dev]
region = ap-northeast-2
output = json
credential_process = sh -c 'echo "{\"Version\":1,\"AccessKeyId\":\"$(op read "op://Work/abc123.../access key id" --no-newline)\",\"SecretAccessKey\":\"$(op read "op://Work/abc123.../secret access key" --no-newline)\"}"'

[profile prd]
region = ap-northeast-2
output = json
credential_process = sh -c 'echo "{\"Version\":1,\"AccessKeyId\":\"$(op read "op://Work/def456.../access key id" --no-newline)\",\"SecretAccessKey\":\"$(op read "op://Work/def456.../secret access key" --no-newline)\"}"'
```

**주의:** `op read`에서 괄호가 포함된 item 이름은 지원하지 않습니다. item ID를 사용하세요!

### Step 4: 평문 credentials 제거

```bash
# 백업
cp ~/.aws/credentials ~/.aws/credentials.backup

# credentials 파일 비우기
echo "# Credentials managed by 1Password" > ~/.aws/credentials
```

### Step 5: 테스트

```bash
# AWS CLI
aws sts get-caller-identity --profile dev

# Terraform
terraform plan
```

1Password가 잠금 해제되어 있으면 자동으로 credentials를 제공합니다.

## 동작 원리

```
┌─────────────────┐     ┌───────────────────┐     ┌─────────────┐
│ AWS CLI/        │────▶│ credential_process │────▶│ 1Password   │
│ Terraform       │     │ (op read)          │     │ (암호화 저장)│
└─────────────────┘     └───────────────────┘     └─────────────┘
                                 │
                                 ▼
                        ┌───────────────────┐
                        │ JSON 출력          │
                        │ {                  │
                        │   "Version": 1,    │
                        │   "AccessKeyId"... │
                        │ }                  │
                        └───────────────────┘
```

1. AWS CLI나 Terraform이 credentials 필요
2. `credential_process` 실행
3. `op read`가 1Password에서 값 조회
4. JSON 형식으로 반환
5. AWS SDK가 사용

## 보안 강화 포인트

### Before
- `~/.aws/credentials`에 평문 저장
- 파일 읽기 권한만 있으면 탈취 가능
- 노트북 분실 시 즉시 노출

### After
- 1Password에 암호화 저장
- 1Password 마스터 패스워드 필요
- 1Password 잠기면 AWS 접근 불가
- Touch ID / Face ID 연동 가능

## 추가 팁

### Terraform provider에 profile 설정

```hcl
provider "aws" {
  region  = "ap-northeast-2"
  profile = "dev"  # credential_process 자동 사용
}
```

### 여러 profile 사용 시

`credential_process`는 profile별로 설정하므로, Terraform에서 profile만 지정하면 자동으로 해당 1Password item에서 credentials를 가져옵니다.

## 정리

| 구분 | 변경 전 | 변경 후 |
|------|--------|--------|
| credentials 저장 | `~/.aws/credentials` (평문) | 1Password (암호화) |
| 인증 방식 | 직접 파일 읽기 | credential_process |
| 보안 수준 | 낮음 | 높음 |
| 편의성 | 높음 | 동일 (1Password 잠금 해제 시) |

AWS SSO를 사용할 수 없는 환경이라면, 1Password `credential_process`는 훌륭한 대안입니다. 이미 1Password를 사용하고 있다면 더욱 추천합니다!
