---
title: "Terramate에서 AWS Profile 자동 전환하기"
date: 2026-01-27T17:30:00+09:00
description: "Terramate + Terraform 환경에서 AWS_PROFILE 환경변수 없이 환경별(dev/prd) AWS 계정을 자동 전환하는 방법을 알아봅니다."
keywords: ["Terramate", "Terraform", "AWS", "Profile", "Multi-Account", "IaC"]
categories: ["Terraform"]
tags: ["Terramate", "Terraform", "AWS", "DevOps", "IaC"]
showHero: true
heroStyle: "background"
---

## 문제 상황

멀티 계정 AWS 환경에서 Terramate를 사용할 때, 매번 이렇게 환경변수를 붙여야 했습니다:

```bash
# 개발 환경
AWS_PROFILE=dev make plan dev:vpc

# 운영 환경
AWS_PROFILE=prd make plan prd:vpc
```

매번 `AWS_PROFILE=xxx`를 붙이는 건 귀찮고, 실수로 잘못된 계정에 적용할 위험도 있죠.

## 해결 방법

Terraform의 AWS provider와 S3 backend 모두에 `profile` 설정을 추가하면 됩니다.

### 1. Provider에 profile 추가

```hcl
# 01_imports/providers/providers.tm.hcl

generate_hcl "_terramate_generated_providers.tf" {
  content {
    terraform {
      required_version = "1.x.x"
      required_providers {
        aws = {
          source  = "hashicorp/aws"
          version = "~> 6.0"
        }
      }
    }

    provider "aws" {
      region  = global.region
      profile = global.environment  # dev 또는 prd
    }
  }
}
```

### 2. Backend에도 profile 추가 (중요!)

Provider만 설정하면 안 됩니다. S3 backend도 AWS 자격증명이 필요하기 때문에 여기도 profile을 추가해야 합니다:

```hcl
# 01_imports/backend.tm.hcl

generate_hcl "_terramate_generated_backend.tf" {
  content {
    terraform {
      backend "s3" {
        region  = global.region
        bucket  = "my-tfstate-${global.environment}"
        key     = "path/to/terraform.tfstate"
        encrypt = true
        profile = global.environment  # 이것도 필수!
      }
    }
  }
}
```

### 3. 환경별 config 설정

각 환경의 `config.tm.hcl`에서 `environment`를 정의합니다:

```hcl
# stacks/dev/config.tm.hcl
globals {
  environment = "dev"
  region      = "ap-northeast-2"
}

# stacks/prd/config.tm.hcl
globals {
  environment = "prd"
  region      = "ap-northeast-2"
}
```

### 4. AWS Credentials 설정

`~/.aws/credentials`에 환경별 프로필을 설정합니다:

```ini
[dev]
aws_access_key_id = AKIA...
aws_secret_access_key = ...

[prd]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

## 적용 후

```bash
# 이제 이렇게만 하면 됨
make plan dev:vpc   # 자동으로 dev 프로필 사용
make plan prd:vpc   # 자동으로 prd 프로필 사용

# Makefile의 AWS_PREFIX도 필요 없음
# AWS_PREFIX = $(if $(filter prd,$(ENV)),AWS_PROFILE=prd ,)  # 주석 처리
```

## 주의사항

### Backend 변경 시 -reconfigure 필요

backend 설정이 바뀌면 `terraform init -reconfigure`가 필요합니다:

```bash
make init dev:vpc R   # R = -reconfigure 옵션
```

### Aliased Provider도 설정 필요

ECR Public 등을 위한 aliased provider가 있다면 거기도 profile을 추가해야 합니다:

```hcl
provider "aws" {
  region  = "us-east-1"
  alias   = "virginia"
  profile = global.environment  # 잊지 말 것!
}
```

## 정리

| 설정 위치 | profile 필요 여부 |
|----------|------------------|
| AWS Provider | O |
| S3 Backend | O |
| Aliased Provider | O |

세 곳 모두에 `profile = global.environment`를 추가하면, 환경변수 없이 환경별 AWS 계정이 자동 전환됩니다. 더 이상 `AWS_PROFILE=prd`를 까먹을 일이 없어요!
