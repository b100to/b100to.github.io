---
title: "Terramate로 IaC 관리하기: 심플함의 미학"
date: 2025-02-04T16:31:25+09:00
description: "Terramate로 IaC 관리하기: 심플함의 미학"
categories: ["Terraform"]
tags: ["IaC", "Terramate", "AWS", "DevOps", "Terraform", "Terragrunt"]
showHero: true
heroStyle: "background"
---

안녕하세요! 오늘은 제가 최근에 발견한 꿀툴을 하나 소개해드리려고 합니다. 바로 Terramate입니다.
IaC(Infrastructure as Code)를 관리하면서 겪었던 고민들과 그 해결책으로 Terramate를 선택하게 된 이유, 그리고 실제 사용법까지 차근차근 설명해드리도록 하겠습니다.

## 시작은 이런 고민에서였습니다

![고민 이미지](https://velog.velcdn.com/images/b100to/post/521693e8-f0c8-40f1-b920-56f1f0b7ddfa/image.png)

처음 테라폼으로 인프라를 관리하기 시작했을 때만 해도 별 생각이 없었습니다.
하지만 시간이 지나고 프로젝트가 커지면서 이런 고민들이 하나둘씩 쌓이기 시작했죠.

"어... 이 코드 저번에도 썼는데..."
"새로 온 팀원이 이 구조를 이해하는데 시간이 너무 오래 걸리네..."
"이거 유지보수하기가 점점 힘들어지는데..."

DRY(Don't Repeat Yourself) 원칙을 지키면서 코드를 관리하고 싶었고,
새로운 팀원들도 쉽게 이해할 수 있는 구조가 필요했습니다.

## GitHub Stars로 보는 인기도

![](https://velog.velcdn.com/images/b100to/post/2775a0d2-0da2-4837-93a0-dc27d43cdae9/image.png)

Terragrunt는 2017년부터 시작되어 현재 8,000개 이상의 GitHub 스타를 보유하고 있는 성숙한 프로젝트입니다. 반면 Terramate는 비교적 최근인 2022년에 시작되었지만, 빠른 속도로 성장하여 현재 3,000개 이상의 스타를 받았습니다.

물론 GitHub 스타 수가 도구의 품질을 직접적으로 반영하지는 않습니다. 하지만 이러한 성장세는 Terramate가 개발자들 사이에서 점점 더 많은 관심을 받고 있다는 것을 보여줍니다. 특히 최근 2년간의 가파른 상승세는 주목할 만합니다.


## Terragrunt? 음... 좀 더 심플한게 없을까?

처음에는 Terragrunt를 고려했습니다. 많은 기업들이 사용하고 있고,
기능도 강력하죠. 하지만 처음 접하는 사람에게는 진입 장벽이 꽤 높았습니다.
설정 파일의 복잡도도 높고, 새로운 문법도 많이 익혀야 했죠.

### Terramate vs Terragrunt 비교

| 특징 | Terramate | Terragrunt |
|------|-----------|------------|
| 설정 파일 문법 | HCL (테라폼과 동일) | HCL (독자적인 확장 문법 포함) |
| 학습 곡선 | 낮음 | 중간~높음 |
| 기능 복잡도 | 단순하고 직관적 | 다양하고 복잡한 기능 제공 |
| 변수 관리 | globals 블록으로 단순화 | inputs 블록과 여러 관리 방식 존재 |
| 코드 생성 | 네이티브 지원 | 제한적 지원 |
| 모듈 캐싱 | 기본 지원 | 별도 설정 필요 |
| 커뮤니티 크기 | 성장 중 | 큰 커뮤니티 보유 |
| 문서화 | 깔끔하고 직관적 | 방대하고 상세함 |

**"Simple is Best"**

복잡한 도구는 결국 생산성 저하로 이어진다고 생각했습니다.
그러던 중 Terramate를 발견했고, 첫눈에 반했습니다.

## Terramate: 심플함의 미학

Terramate는 테라폼 프로젝트를 관리하기 위한 도구입니다.
가장 큰 장점은 바로 **단순함**입니다.

### 설치방법

로컬 환경에 Terramate를 설치하는 방법은 매우 간단합니다:

```bash
# macOS
brew install terramate

# Linux
curl -sL https://github.com/terramate-io/terramate/releases/latest/download/terramate_Linux_x86_64.tar.gz |
```

### 실제 프로젝트 구성 예시

실제 AWS 인프라를 관리하는 프로젝트를 예시로 설명하겠습니다. 다음과 같은 디렉토리 구조로 구성합니다:

```
.
├── config/
│   ├── defaults.tm.hcl
│   ├── dev.tm.hcl
│   └── prod.tm.hcl
├── modules/
│   ├── network/
│   │   ├── main.tf
│   │   ├── outputs.tf
│   │   └── variables.tf
│   └── web-app/
│       ├── main.tf
│       ├── outputs.tf
│       └── variables.tf
└── stacks/
    ├── dev/
    │   ├── network/
    │   │   └── terramate.tm.hcl
    │   └── web-app/
    │       └── terramate.tm.hcl
    └── prod/
        ├── network/
        │   └── terramate.tm.hcl
        └── web-app/
            └── terramate.tm.hcl
```

### 1. 전역 설정 정의

먼저 모든 환경에서 공통으로 사용할 기본 설정을 정의합니다:

```hcl
# config/defaults.tm.hcl
globals {
  project     = "demo-app"
  aws_region  = "ap-northeast-2"
  company     = "acme"
  tags = {
    ManagedBy = "terramate"
    Project   = global.project
  }
}
```

### 2. 환경별 설정

각 환경에 맞는 특정 설정을 정의합니다:

```hcl
# config/dev.tm.hcl
globals {
  environment = "dev"
  vpc_cidr    = "10.0.0.0/16"
  private_subnets = [
    "10.0.1.0/24",
    "10.0.2.0/24"
  ]
  public_subnets = [
    "10.0.101.0/24",
    "10.0.102.0/24"
  ]
  instance_type = "t3.micro"
  asg_min_size  = 1
  asg_max_size  = 2
}
```

```hcl
# config/prod.tm.hcl
globals {
  environment = "prod"
  vpc_cidr    = "172.16.0.0/16"
  private_subnets = [
    "172.16.1.0/24",
    "172.16.2.0/24",
    "172.16.3.0/24"
  ]
  public_subnets = [
    "172.16.101.0/24",
    "172.16.102.0/24",
    "172.16.103.0/24"
  ]
  instance_type = "t3.large"
  asg_min_size  = 2
  asg_max_size  = 6
}
```

### 3. 스택 구성

network와 web-app 스택을 각각 정의합니다:

```hcl
# stacks/dev/network/terramate.tm.hcl
stack {
  name        = "network-${global.environment}"
  description = "Network infrastructure for ${global.environment}"
  source      = "../../../modules/network"
}

globals {
  stack_name = "network-${global.environment}"
}

generate_hcl "terraform.tf" {
  content {
    terraform {
      required_version = ">= 1.0.0"

      backend "s3" {
        bucket = "${global.company}-${global.environment}-terraform-state"
        key    = "${global.stack_name}/terraform.tfstate"
        region = global.aws_region
      }
    }
  }
}

generate_hcl "provider.tf" {
  content {
    provider "aws" {
      region = global.aws_region

      default_tags {
        tags = global.tags
      }
    }
  }
}
```

### 4. 테라폼 모듈 작성

각 스택에서 사용할 테라폼 모듈을 구성합니다:

```hcl
# modules/network/main.tf
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"

  name = "${var.environment}-vpc"
  cidr = var.vpc_cidr

  azs             = data.aws_availability_zones.available.names
  private_subnets = var.private_subnets
  public_subnets  = var.public_subnets

  enable_nat_gateway = true
  single_nat_gateway = var.environment != "prod"

  tags = {
    Environment = var.environment
  }
}
```

### 5. 실행 방법

```bash
# 모든 스택 초기화
terramate run terraform init

# 개발 환경의 네트워크 스택만 계획
terramate run --target="/dev/network" terraform plan

# 프로덕션 환경의 모든 스택 적용
terramate run --filter="+/prod/**" terraform apply
```

## 주요 장점

1. **변수 관리의 단순화**
   - globals 블록을 통해 계층적으로 변수를 관리할 수 있습니다.
   - 환경별로 다른 설정을 쉽게 적용할 수 있습니다.

2. **코드 생성 자동화**
   - generate_hcl 블록으로 반복적인 설정 파일 생성을 자동화합니다.
   - provider, backend 설정 등을 중앙에서 관리할 수 있습니다.

3. **스택 간 의존성 관리**
   - deps 설정으로 스택 간의 실행 순서를 명확하게 정의할 수 있습니다.
   - 모듈 재사용성을 높일 수 있습니다.

## 마치며

Terramate는 "적은 것이 더 많은 것"이라는 철학을 잘 보여주는 도구입니다.
필요한 기능은 모두 갖추고 있으면서도, 불필요한 복잡성은 제거했습니다.
특히 새로운 팀원들의 온보딩 시간을 크게 줄일 수 있다는 점이 매력적입니다.

앞으로도 인프라 코드의 관리는 더욱 중요해질 것입니다.
이때 Terramate같은 도구가 있다면, 복잡성은 줄이고 생산성은 높일 수 있을 것입니다.

## 참고 문헌

- [Terramate 공식 문서](https://terramate.io/docs)
- [Github Repository](https://github.com/terramate-io/terramate)
- [Terramate Quickstart AWS](https://github.com/terramate-io/terramate-quickstart-aws)
