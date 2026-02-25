---
title: "Auto-Switching AWS Profiles in Terramate"
date: 2026-01-27T17:30:00+09:00
description: "How to automatically switch between AWS accounts (dev/prd) in a Terramate + Terraform setup without manually setting AWS_PROFILE every time."
keywords: ["Terramate", "Terraform", "AWS", "Profile", "Multi-Account", "IaC"]
categories: ["Terraform"]
tags: ["Terramate", "Terraform", "AWS", "DevOps", "IaC"]
showHero: true
heroStyle: "background"
---

> TL;DR -- In a multi-account AWS setup with Terramate, you can eliminate the need to prefix every command with `AWS_PROFILE=xxx` by adding `profile = global.environment` to three places: the AWS provider, the S3 backend, and any aliased providers. The environment name maps directly to your AWS CLI profile.

## The Problem

In a multi-account AWS environment with Terramate, I had to prepend the environment variable every time:

```bash
# Dev environment
AWS_PROFILE=dev make plan dev:vpc

# Production environment
AWS_PROFILE=prd make plan prd:vpc
```

Typing `AWS_PROFILE=xxx` every time is tedious, and there's always the risk of accidentally running something against the wrong account.

## The Solution

Add `profile` settings to both the Terraform AWS provider and the S3 backend.

### 1. Add profile to the Provider

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
      profile = global.environment  # "dev" or "prd"
    }
  }
}
```

### 2. Add profile to the Backend (important!)

Setting only the provider isn't enough. The S3 backend also needs AWS credentials, so it needs a profile too:

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
        profile = global.environment  # don't forget this one!
      }
    }
  }
}
```

### 3. Per-Environment Config

Define `environment` in each environment's `config.tm.hcl`:

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

### 4. AWS Credentials Setup

Configure per-profile credentials in `~/.aws/config` and `~/.aws/credentials`. There are several options depending on your credential management approach.

#### Option 1: AWS IAM Identity Center (SSO) - Recommended

Centralized authentication via AWS Organizations. Log in through a browser and temporary credentials are issued automatically.

```ini
# ~/.aws/config
[profile dev]
sso_session = my-sso
sso_account_id = 111111111111
sso_role_name = AdministratorAccess
region = ap-northeast-2

[profile prd]
sso_session = my-sso
sso_account_id = 222222222222
sso_role_name = AdministratorAccess
region = ap-northeast-2

[sso-session my-sso]
sso_start_url = https://my-org.awsapps.com/start
sso_region = ap-northeast-2
sso_registration_scopes = sso:account:access
```

```bash
# Login (opens browser)
aws sso login --profile dev
```

#### Option 2: AWS Vault - Encrypted Local Credentials

[AWS Vault](https://github.com/99designs/aws-vault) stores credentials encrypted in the OS keychain (macOS Keychain, Windows Credential Manager, etc.). More secure than plaintext credential files.

```bash
# Install (macOS)
brew install aws-vault

# Add profiles (encrypted in keychain)
aws-vault add dev
aws-vault add prd

# Usage
aws-vault exec dev -- terraform plan
```

A wrapper script may be needed when using this with Terramate.

#### Option 3: 1Password Shell Plugin

Store AWS credentials in [1Password](https://1password.com/) and inject them automatically via the Shell Plugin. Useful for team-wide secret sharing.

```bash
# After installing 1Password CLI
eval $(op signin)

# ~/.aws/config
[profile dev]
credential_process = op run --env-file=~/.aws/1p-env -- aws configure export-credentials --profile dev
```

#### Option 4: Static Credentials (not recommended)

The simplest approach, but not recommended for security reasons. Only use for test environments.

```ini
# ~/.aws/credentials
[dev]
aws_access_key_id = AKIA...
aws_secret_access_key = ...

[prd]
aws_access_key_id = AKIA...
aws_secret_access_key = ...
```

#### Which Option Should You Pick?

| Method | Security | Convenience | Best For |
|--------|----------|-------------|----------|
| SSO | High | Medium | Teams using AWS Organizations |
| AWS Vault | High | Medium | Individuals/small teams with IAM Users |
| 1Password | High | High | Teams already using 1Password |
| Static | Low | High | Local testing only |

## After Applying

```bash
# Now just this is enough
make plan dev:vpc   # automatically uses the dev profile
make plan prd:vpc   # automatically uses the prd profile

# No more AWS_PREFIX in the Makefile
# AWS_PREFIX = $(if $(filter prd,$(ENV)),AWS_PROFILE=prd ,)  # commented out
```

## Gotchas

### Backend Changes Require -reconfigure

When the backend configuration changes, you need `terraform init -reconfigure`:

```bash
make init dev:vpc R   # R = -reconfigure option
```

### Aliased Providers Need It Too

If you have aliased providers (e.g., for ECR Public), add profile there as well:

```hcl
provider "aws" {
  region  = "us-east-1"
  alias   = "virginia"
  profile = global.environment  # don't forget this!
}
```

## Summary

| Configuration | profile Needed? |
|---------------|-----------------|
| AWS Provider | Yes |
| S3 Backend | Yes |
| Aliased Provider | Yes |

Add `profile = global.environment` to all three places, and AWS accounts switch automatically per environment. No more forgetting to set `AWS_PROFILE=prd`.
