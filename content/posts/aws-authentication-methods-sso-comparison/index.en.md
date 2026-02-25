---
title: "Comparing AWS Authentication Methods: From Access Keys to SSO and Authentik"
date: 2026-01-27T16:50:00+09:00
description: "A comparison of AWS CLI/Terraform authentication methods, and the best auth strategy based on team size. Covering Access Keys, AWS SSO, AssumeRole, and self-hosted IdPs like Authentik and Keycloak."
keywords: ["AWS", "SSO", "Authentik", "Keycloak", "OIDC", "SAML", "authentication", "DevOps"]
categories: ["AWS"]
tags: ["AWS", "SSO", "Authentik", "Security", "DevOps", "OIDC"]
showHero: true
heroStyle: "background"
---

> TL;DR -- If you can use AWS SSO (IAM Identity Center), use it. If you can't (e.g., your Organization's Management Account is controlled by a partner), consider 1Password credential_process for solo ops, or a self-hosted IdP like Authentik for teams of 5+.

## The Trigger: Can I Use AWS Without Access Keys?

The most common way to authenticate with the AWS CLI or Terraform is using Access Keys. But storing them in plaintext is a security risk.

```ini
# ~/.aws/credentials - what if someone reads this file?
[default]
aws_access_key_id=AKIA...
aws_secret_access_key=wCnJ...
```

That's what led me to ask: "Is there a way to authenticate without Access Keys at all?"

## Comparing AWS Authentication Methods

### 1. Plaintext Access Keys

```ini
# ~/.aws/credentials
[dev]
aws_access_key_id=AKIA...
aws_secret_access_key=...
```

- **Pros**: Dead simple to set up
- **Cons**: Anyone with file read access can steal them
- **Access Key required**: Yes

### 2. 1Password / AWS Vault

```ini
# ~/.aws/config
[profile dev]
credential_process = sh -c 'op read "op://Vault/item/..."'
```

- **Pros**: Encrypted storage, requires master password or biometrics
- **Cons**: The Access Key itself still exists
- **Access Key required**: Yes (encrypted storage)

### 3. AssumeRole + MFA

```bash
aws sts assume-role \
  --role-arn arn:aws:iam::123456789012:role/admin \
  --serial-number arn:aws:iam::123456789012:mfa/mydevice \
  --token-code 123456
```

- **Pros**: Uses temporary tokens, can enforce MFA
- **Cons**: The AssumeRole call itself requires an Access Key
- **Access Key required**: Yes (for API request signing)

### 4. AWS SSO (IAM Identity Center)

```bash
aws sso login --profile dev
# Browser opens -> login -> temporary token issued
```

- **Pros**: No Access Key needed, browser-based OAuth authentication
- **Cons**: Requires Management Account access
- **Access Key required**: No

### 5. Keycloak / Authentik (Self-Hosted IdP)

```bash
saml2aws login
# Browser opens -> IdP login -> SAML auth -> temporary token
```

- **Pros**: No Access Key needed, self-hosted and fully under your control
- **Cons**: You have to operate the IdP infrastructure
- **Access Key required**: No

## Why Is SSO the Only One That Doesn't Need Access Keys?

The key difference is in **how authentication works**.

```
Access Key approach:
  API call -> sign with Access Key -> AWS validates

SSO/IdP approach:
  Browser login -> IdP confirms identity -> tells AWS "this person is authenticated" -> temporary token issued
```

SSO is **OAuth/OIDC-based**: you log in to the IdP (Identity Provider) via a browser, and the IdP passes the authentication to AWS. There's no Access Key signing step at all.

## When You Can't Use AWS SSO

AWS SSO (IAM Identity Center) is the ideal solution, but sometimes you just can't use it:

```bash
aws sso-admin list-instances
# { "Instances": [] }
```

**If a managed service provider or partner controls the Organization**, you won't have access to the Management Account, which means you can't enable IAM Identity Center.

> Note: There's also something called Account Instance, but that's only for AWS-managed apps like Amazon Q and QuickSight -- it can't be used for CLI/Terraform authentication.

## Alternative: Self-Hosted IdP (Keycloak / Authentik)

If AWS SSO isn't an option, you can **run your own IdP**.

### Keycloak vs Authentik

| Aspect | Keycloak | Authentik |
|--------|----------|-----------|
| **Language** | Java (heavy) | Python/Go (lightweight) |
| **Resources** | 1GB+ RAM | 512MB possible |
| **Maturity** | 10+ years (Red Hat) | 4+ years |
| **UI** | Complex | Intuitive, modern |
| **AWS integration docs** | Abundant | Limited |

**Authentik**: Best for small teams, lightweight ops, modern UI preference
**Keycloak**: Best for enterprise, when reference material matters

### Integration Options

```
                      +-- OIDC --> ArgoCD
Authentik/Keycloak ---+-- OIDC --> Grafana
        (IdP)         +-- SAML --> AWS Console/CLI
                      +-- OIDC --> Internal admin tools
```

Both Authentik and Keycloak **support OIDC and SAML**, so different services can use different protocols.

## Recommended Strategy by Team Size

### Solo Operator

```
Recommendation: 1Password credential_process

Why:
- IdP operational overhead >> the benefits you'd gain
- 1Password already provides sufficient security
- No additional infrastructure needed
```

### 2-5 Person Dev Team

```
Recommendation: 1Password, or start evaluating Authentik

Consider:
- Onboarding/offboarding frequency
- Number of internal services (ArgoCD, Grafana, etc.)
- Available ops bandwidth
```

### 5+ Developers or 30+ Including Non-Engineers

```
Recommendation: Deploy Authentik/Keycloak

Why:
- SSO simplifies login across all services
- Instantly revoke access when someone leaves
- Enforce MFA organization-wide
- Centralized audit logs
```

## Practical Deployment Considerations

### Recommended Authentik Setup

```yaml
# When deploying on EKS
namespace: authentik
replicas:
  server: 2      # HA is a must
  worker: 1
postgresql:
  enabled: false  # Use a managed database instead
redis:
  enabled: true
ingress:
  enabled: true
  host: auth.example.com
```

### Integration Priority

```
1. Install Authentik & basic setup
2. Grafana OIDC integration (easiest)
3. ArgoCD OIDC integration
4. Internal admin tool integration (OIDC or SAML)
5. AWS SAML integration (for CLI - using saml2aws)
```

### Watch Out For

- **Authentik goes down = nobody can log in to anything** -- HA is essential
- Initial setup takes 1-2 days
- If internal admin tools don't support OIDC/SAML, you'll need dev work

## Summary

| Situation | Recommended Approach |
|-----------|---------------------|
| AWS SSO available | AWS SSO (most ideal) |
| No SSO + solo operator | 1Password credential_process |
| No SSO + 5+ person team | Consider Authentik |
| No SSO + 30+ person org | Authentik/Keycloak is a must |

If you want to eliminate Access Keys entirely, you need **SSO or a self-hosted IdP**. Choose based on your team size and operational capacity.
