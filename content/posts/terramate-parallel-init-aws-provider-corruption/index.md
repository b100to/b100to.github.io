---
title: "Terramate 병렬 terraform init 시 AWS Provider 손상 문제 해결"
date: 2026-01-27T15:30:00+09:00
description: "Terramate로 여러 스택을 병렬 init할 때 AWS Provider가 손상되는 문제의 원인과 해결 방법을 정리했습니다."
keywords: ["Terramate", "Terraform", "AWS Provider", "병렬 실행", "plugin cache", "트러블슈팅"]
categories: ["Troubleshooting"]
tags: ["Terramate", "Terraform", "AWS", "DevOps"]
showHero: true
heroStyle: "background"
---

## 문제 상황

Terramate로 여러 스택을 관리하는 프로젝트에서, 병렬로 `terraform init`을 실행하면 이후 `terraform plan` 시 다음과 같은 에러가 발생했습니다.

```
Error: Failed to load plugin schemas

Error while loading schemas for plugin components: Failed to obtain provider schema:
Could not load the schema for provider registry.terraform.io/hashicorp/aws:
failed to instantiate provider "registry.terraform.io/hashicorp/aws" to obtain schema:
Unrecognized remote plugin message:
Failed to read any lines from plugin's stdout
```

신기하게도:
- **개별 init** → 정상 작동
- **병렬 init** → Provider 손상

## 원인 분석

### 1. `--enable-sharing` 옵션

Terramate의 output sharing 기능(`--enable-sharing --mock-on-fail`)이 init에 포함되어 있었습니다. 이 옵션은 스택 간 output을 공유하기 위한 것인데, **init 단계에서는 불필요**합니다.

```makefile
# 문제가 된 설정
TM_OPTS := --enable-sharing --mock-on-fail ...
terramate run --tags=$(TAGS) $(TM_OPTS) -- terraform init
```

### 2. Plugin Cache Race Condition

병렬로 여러 스택이 동시에 같은 Provider를 다운로드하면 파일이 손상될 수 있습니다. 특히 **AWS Provider는 크기가 ~300MB**로 커서 race condition 발생 확률이 높습니다.

## 해결 방법

### 1. init에서 sharing 옵션 분리

```makefile
# 수정된 Makefile
TM_COMMON := $(if $(filter P,$(MAKECMDGOALS)),$(if $(PNUM),-j $(PNUM),--parallel),) \
  $(if $(filter C,$(MAKECMDGOALS)),--changed,)
TM_OPTS := --enable-sharing --mock-on-fail $(TM_COMMON)

# init은 TM_COMMON만 사용
init:
    terramate run --tags=$(TAGS) $(TM_COMMON) -- terraform init $(INIT_OPTS)

# plan/apply는 TM_OPTS 사용 (sharing 포함)
plan:
    terramate run --tags=$(TAGS) $(TM_OPTS) -- terraform plan
```

### 2. 글로벌 Plugin Cache 설정

`~/.terraformrc`에 글로벌 캐시를 설정하면 Provider를 한 번만 다운로드하고 모든 프로젝트에서 공유합니다.

```hcl
# ~/.terraformrc
plugin_cache_dir = "$HOME/.terraform.d/plugin-cache"
```

```bash
# 캐시 디렉토리 생성
mkdir -p ~/.terraform.d/plugin-cache
```

### 3. Lock 파일 체크섬 무시 설정

캐시 사용 시 체크섬 불일치 에러가 발생할 수 있습니다. Terramate 설정에 환경변수를 추가합니다.

```hcl
# terramate.tm.hcl
terramate {
  config {
    run {
      env {
        TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE = "true"
      }
    }
  }
}
```

## 최종 설정

### ~/.terraformrc
```hcl
plugin_cache_dir = "$HOME/.terraform.d/plugin-cache"
```

### terramate.tm.hcl
```hcl
terramate {
  config {
    run {
      env {
        TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE = "true"
      }
    }
  }
}
```

### Makefile
```makefile
TM_COMMON := $(if $(filter P,$(MAKECMDGOALS)),$(if $(PNUM),-j $(PNUM),--parallel),) \
  $(if $(filter C,$(MAKECMDGOALS)),--changed,)
TM_OPTS := --enable-sharing --mock-on-fail $(TM_COMMON)

init:
    terramate run --tags=$(TAGS) $(TM_COMMON) -- terraform init $(INIT_OPTS)

plan:
    terramate run --tags=$(TAGS) $(TM_OPTS) -- terraform plan
```

## TL;DR

| 문제 | 해결책 |
|-----|-------|
| init에 불필요한 `--enable-sharing` | init과 plan/apply 옵션 분리 |
| 병렬 다운로드 시 Provider 손상 | 글로벌 plugin cache 사용 |
| 캐시 체크섬 불일치 | `TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE=true` |

이 설정으로 `make init dev P 5`처럼 병렬 init이 정상 작동합니다.
