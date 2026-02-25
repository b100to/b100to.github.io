---
title: "Securing AWS Credentials: Ditching Plaintext Keys with 1Password"
date: 2026-01-27T16:30:00+09:00
description: "How to remove plaintext AWS Access Keys from ~/.aws/credentials and manage them securely using 1Password's credential_process."
keywords: ["AWS", "1Password", "credential_process", "security", "DevOps", "AWS Vault"]
categories: ["AWS"]
tags: ["AWS", "1Password", "Security", "DevOps", "credential_process"]
showHero: true
heroStyle: "background"
---

> TL;DR -- Stop storing AWS Access Keys in plaintext. Use 1Password's credential_process to serve credentials on demand, encrypted and protected by biometrics. If you already use 1Password, setup takes about 10 minutes.

## Realizing the Problem

One day I opened `~/.aws/credentials` and saw this:

```ini
[dev]
aws_access_key_id=AKIA...
aws_secret_access_key=wCnJ...

[prd]
aws_access_key_id=AKIA...
aws_secret_access_key=CYCd...
```

Plaintext AWS Access Keys, just sitting there. What if I lost my laptop? What if malware read this file? Not a pleasant thought.

## Exploring Options

### 1. AWS SSO (IAM Identity Center) - First Attempt

The most ideal approach is AWS SSO. It uses temporary credentials and has built-in MFA.

```bash
aws sso login --profile dev
```

**But there was a problem.**

```bash
aws sso-admin list-instances
# { "Instances": [] }
```

The Organization's Management Account was owned by an external partner. Since IAM Identity Center can only be enabled from the Management Account, I couldn't set it up myself.

> Note: There's also Account Instance, but that's only for AWS-managed apps (Amazon Q, QuickSight, etc.) -- **it can't be used for AWS CLI/Terraform authentication.**

### 2. AWS Vault - Second Candidate

```bash
brew install aws-vault
aws-vault add dev
```

AWS Vault encrypts credentials in the macOS Keychain and issues STS temporary tokens. A solid option, but...

```
aws-vault wants to use the 'aws-vault' keychain.
Please enter the keychain password.
```

I'd forgotten the keychain password I set up ages ago. Oops.

### 3. 1Password - The Winner

I was already using 1Password, and discovered it can manage AWS credentials too.

## Method Comparison

| Method | Security | Convenience | Setup Complexity | Notes |
|--------|----------|-------------|-----------------|-------|
| Plaintext credentials | Low | Very High | Very Low | Dangerous |
| AWS SSO | Very High | High | Medium | Requires Management Account |
| AWS Vault | High | Medium | Low | Separate keychain management |
| 1Password | High | High | Low | Ideal if already using it |

## Setting Up 1Password

### Step 1: Install the 1Password CLI

```bash
brew install 1password-cli

# Verify installation
op --version
```

### Step 2: Store AWS Credentials in 1Password

```bash
op plugin init aws
```

This runs interactively:

1. Select **Import into 1Password...**
2. Choose a profile from `~/.aws/credentials` (e.g., dev)
3. Select a vault
4. Choose **Prompt me for each new terminal session** (recommended for multiple profiles)

Repeat for all profiles (dev, prd, etc.).

### Step 3: Configure credential_process

To let the AWS CLI/Terraform use credentials stored in 1Password, add `credential_process` to `~/.aws/config`.

First, find the 1Password item IDs:

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

Then update `~/.aws/config`:

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

**Note:** `op read` doesn't support item names with parentheses. Use the item ID instead!

### Step 4: Remove Plaintext Credentials

```bash
# Backup first
cp ~/.aws/credentials ~/.aws/credentials.backup

# Clear the credentials file
echo "# Credentials managed by 1Password" > ~/.aws/credentials
```

### Step 5: Test

```bash
# AWS CLI
aws sts get-caller-identity --profile dev

# Terraform
terraform plan
```

When 1Password is unlocked, credentials are provided automatically.

## How It Works

```
+------------------+     +--------------------+     +--------------+
| AWS CLI/         |---->| credential_process |---->| 1Password    |
| Terraform        |     | (op read)          |     | (encrypted)  |
+------------------+     +--------------------+     +--------------+
                                 |
                                 v
                        +--------------------+
                        | JSON output        |
                        | {                  |
                        |   "Version": 1,    |
                        |   "AccessKeyId"... |
                        | }                  |
                        +--------------------+
```

1. AWS CLI or Terraform needs credentials
2. `credential_process` executes
3. `op read` retrieves values from 1Password
4. Returns them in JSON format
5. AWS SDK uses them

## Security Improvements

### Before
- Plaintext in `~/.aws/credentials`
- Anyone with file read access can steal them
- Immediate exposure if laptop is lost

### After
- Encrypted in 1Password
- Requires 1Password master password
- AWS access blocked when 1Password is locked
- Touch ID / Face ID integration possible

## Additional Tips

### Terraform Provider Profile Setup

```hcl
provider "aws" {
  region  = "ap-northeast-2"
  profile = "dev"  # automatically uses credential_process
}
```

### Multiple Profiles

Since `credential_process` is configured per profile, just specifying the profile in Terraform automatically pulls credentials from the corresponding 1Password item.

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| Credential storage | `~/.aws/credentials` (plaintext) | 1Password (encrypted) |
| Auth method | Direct file read | credential_process |
| Security level | Low | High |
| Convenience | High | Same (when 1Password is unlocked) |

If you can't use AWS SSO, 1Password `credential_process` is an excellent alternative. Especially if you're already a 1Password user, this is a no-brainer.
