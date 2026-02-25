---
title: "Managing IaC with Terramate: The Beauty of Simplicity"
date: 2025-02-04T16:31:25+09:00
description: "Why I chose Terramate over Terragrunt, and how to use it in practice. A walkthrough of building a DRY Terraform project structure using globals and generate_hcl, with real examples."
keywords: ["Terramate tutorial", "Terramate vs Terragrunt", "Terraform DRY", "Terramate globals", "Terramate generate_hcl", "IaC code management", "Terraform project structure"]
categories: ["Terraform"]
tags: ["IaC", "Terramate", "AWS", "DevOps", "Terraform", "Terragrunt"]
showHero: true
heroStyle: "background"
---

> TL;DR -- Terramate is a simpler alternative to Terragrunt for managing multi-environment Terraform projects. It uses plain HCL, has a gentle learning curve, and its globals + generate_hcl combo keeps things DRY without the complexity overhead.

Hey there! Today I want to introduce a tool I recently discovered and have come to love: Terramate.
I'll walk through the pain points I had managing IaC, why I picked Terramate over the alternatives, and how to actually use it -- step by step.

## It Started with These Frustrations

![Frustration image](https://velog.velcdn.com/images/b100to/post/521693e8-f0c8-40f1-b920-56f1f0b7ddfa/image.png)

When I first started managing infrastructure with Terraform, things were fine.
But as projects grew, familiar frustrations started piling up:

"Wait, I wrote this exact same code last week..."
"New team members are spending way too long understanding the project structure..."
"This is getting harder and harder to maintain..."

I wanted to follow the DRY (Don't Repeat Yourself) principle and build a structure that new team members could pick up quickly.

## Popularity by GitHub Stars

![](https://velog.velcdn.com/images/b100to/post/2775a0d2-0da2-4837-93a0-dc27d43cdae9/image.png)

Terragrunt has been around since 2017 and has over 8,000 GitHub stars as a mature project. Terramate is relatively newer, having started in 2022, but it's been growing fast and has collected over 3,000 stars.

Of course, star counts don't directly reflect tool quality. But the growth trajectory shows that Terramate is getting more and more attention from developers. The steep climb over the past two years is particularly noteworthy.

## Terragrunt? Hmm... Isn't There Something Simpler?

I initially considered Terragrunt. Lots of companies use it and it's feature-rich.
But for someone encountering it for the first time, the learning curve was steep.
Configuration files are complex, and there's a lot of new syntax to absorb.

### Terramate vs Terragrunt Comparison

| Feature | Terramate | Terragrunt |
|---------|-----------|------------|
| Config file syntax | HCL (same as Terraform) | HCL (with custom extensions) |
| Learning curve | Low | Medium to High |
| Feature complexity | Simple and intuitive | Rich and complex |
| Variable management | Simplified via globals blocks | inputs blocks with multiple patterns |
| Code generation | Native support | Limited support |
| Module caching | Built-in | Requires separate config |
| Community size | Growing | Large established community |
| Documentation | Clean and intuitive | Extensive and detailed |

**"Simple is Best."**

I believe complex tools ultimately hurt productivity.
Then I found Terramate, and it was love at first sight.

## Terramate: The Beauty of Simplicity

Terramate is a tool for managing Terraform projects.
Its biggest strength is **simplicity**.

### Installation

Installing Terramate locally is straightforward:

```bash
# macOS
brew install terramate

# Linux
curl -sL https://github.com/terramate-io/terramate/releases/latest/download/terramate_Linux_x86_64.tar.gz |
```

### Real Project Structure Example

Let me walk through a real AWS infrastructure project. Here's the directory layout:

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

### 1. Define Global Configuration

First, define defaults shared across all environments:

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

### 2. Per-Environment Configuration

Define settings specific to each environment:

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

### 3. Stack Configuration

Define the network and web-app stacks:

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

### 4. Write Terraform Modules

Build the Terraform modules that each stack references:

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

### 5. Running It

```bash
# Initialize all stacks
terramate run terraform init

# Plan only the dev network stack
terramate run --target="/dev/network" terraform plan

# Apply all prod stacks
terramate run --filter="+/prod/**" terraform apply
```

## Key Advantages

1. **Simplified Variable Management**
   - The globals block lets you manage variables hierarchically.
   - Per-environment overrides are straightforward.

2. **Automated Code Generation**
   - The generate_hcl block automates repetitive config file creation.
   - Provider and backend settings can be managed centrally.

3. **Stack Dependency Management**
   - The deps setting lets you define clear execution order between stacks.
   - Module reusability is improved.

## Wrapping Up

Terramate embodies the philosophy that "less is more."
It has all the features you need while stripping away unnecessary complexity.
The ability to dramatically reduce onboarding time for new team members is especially appealing.

Infrastructure code management will only become more important going forward.
With a tool like Terramate, you can reduce complexity and boost productivity at the same time.

## References

- [Terramate Official Docs](https://terramate.io/docs)
- [GitHub Repository](https://github.com/terramate-io/terramate)
- [Terramate Quickstart AWS](https://github.com/terramate-io/terramate-quickstart-aws)
