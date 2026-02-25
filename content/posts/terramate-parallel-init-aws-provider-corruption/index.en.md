---
title: "Fixing AWS Provider Corruption During Parallel terraform init in Terramate"
date: 2026-01-27T15:30:00+09:00
description: "When running parallel terraform init across Terramate stacks, the AWS Provider binary can get corrupted. Here's why it happens and how to fix it."
keywords: ["Terramate", "Terraform", "AWS Provider", "parallel execution", "plugin cache", "troubleshooting"]
categories: ["Troubleshooting"]
tags: ["Terramate", "Terraform", "AWS", "DevOps"]
showHero: true
heroStyle: "background"
---

> TL;DR -- Parallel `terraform init` in Terramate can corrupt the AWS Provider (~300MB binary) due to race conditions. The fix is threefold: separate `--enable-sharing` from init commands, use a global plugin cache, and set `TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE=true`.

## The Problem

In a project where I manage multiple stacks with Terramate, running `terraform init` in parallel would cause subsequent `terraform plan` to fail with this error:

```
Error: Failed to load plugin schemas

Error while loading schemas for plugin components: Failed to obtain provider schema:
Could not load the schema for provider registry.terraform.io/hashicorp/aws:
failed to instantiate provider "registry.terraform.io/hashicorp/aws" to obtain schema:
Unrecognized remote plugin message:
Failed to read any lines from plugin's stdout
```

The curious thing was:
- **Sequential init** -- worked fine
- **Parallel init** -- Provider corrupted

## Root Cause Analysis

### 1. The `--enable-sharing` Option

Terramate's output sharing feature (`--enable-sharing --mock-on-fail`) was included in the init command. This option is for sharing outputs between stacks, but **it's unnecessary during the init phase**.

```makefile
# The problematic setup
TM_OPTS := --enable-sharing --mock-on-fail ...
terramate run --tags=$(TAGS) $(TM_OPTS) -- terraform init
```

### 2. Plugin Cache Race Condition

When multiple stacks download the same Provider simultaneously, files can get corrupted. The **AWS Provider is ~300MB**, which makes race conditions especially likely.

## The Fix

### 1. Separate Sharing Options from init

```makefile
# Updated Makefile
TM_COMMON := $(if $(filter P,$(MAKECMDGOALS)),$(if $(PNUM),-j $(PNUM),--parallel),) \
  $(if $(filter C,$(MAKECMDGOALS)),--changed,)
TM_OPTS := --enable-sharing --mock-on-fail $(TM_COMMON)

# init uses TM_COMMON only
init:
    terramate run --tags=$(TAGS) $(TM_COMMON) -- terraform init $(INIT_OPTS)

# plan/apply uses TM_OPTS (includes sharing)
plan:
    terramate run --tags=$(TAGS) $(TM_OPTS) -- terraform plan
```

### 2. Set Up a Global Plugin Cache

Add a global cache to `~/.terraformrc` so the Provider is downloaded once and shared across all projects.

```hcl
# ~/.terraformrc
plugin_cache_dir = "$HOME/.terraform.d/plugin-cache"
```

```bash
# Create the cache directory
mkdir -p ~/.terraform.d/plugin-cache
```

### 3. Ignore Lock File Checksum Mismatches

When using a cache, checksum mismatch errors can occur. Add this environment variable to your Terramate config:

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

## Final Configuration

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

| Problem | Solution |
|---------|----------|
| Unnecessary `--enable-sharing` in init | Separate options for init vs. plan/apply |
| Provider corruption during parallel downloads | Use a global plugin cache |
| Cache checksum mismatches | `TF_PLUGIN_CACHE_MAY_BREAK_DEPENDENCY_LOCK_FILE=true` |

With this setup, `make init dev P 5` (parallel init with 5 workers) runs without issues.
