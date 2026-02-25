---
title: "Working Around the Codex Login localhost:1455 Callback Error in WSL"
date: 2026-02-14T10:48:00+09:00
description: "When the Codex login callback to localhost:1455 fails with a 400 error in VS Code on WSL, manually hitting the callback endpoint from the WSL terminal can complete the login flow."
keywords: ["WSL", "Codex", "VS Code", "localhost", "1455", "login", "troubleshooting"]
categories: ["Troubleshooting"]
tags: ["WSL", "Codex", "VS Code", "OAuth", "Login Error"]
showHero: true
heroStyle: "background"
---

> TL;DR -- In WSL + VS Code, the Codex OAuth callback to `localhost:1455` can fail visually in the browser while the backend partially processes it. Curling the callback and success endpoints from the WSL terminal can unblock the login flow.

While setting up Codex in a WSL environment, I got stuck at the VS Code login step. Here's what happened and how I got past it.

In short, when the browser opened the callback URL, `localhost:1455` returned a 400-level error with a "cannot connect to server" message. But when I hit the callback/success endpoints directly from the WSL terminal, the login flow continued normally.

## The Situation

- Attempting Codex login in a WSL + VS Code environment
- Browser navigates to a URL like `http://localhost:1455/auth/callback?...`
- The page shows an error (400-level) and login appears to have failed

In my case, I saw the browser error screen and assumed it was a complete failure. Turns out, checking the local callback server state directly was the key.

## What I Did to Fix It

I ran these commands from the WSL terminal to hit the callback URL and success endpoint:

```bash
# Mask the actual code/state values -- don't share these publicly
curl -v "http://localhost:1455/auth/callback?code=<AUTH_CODE>&scope=openid+profile+email+offline_access&state=<STATE>"

curl -v "http://localhost:1455/success"
```

In my environment, after these requests the login flow resumed, and VS Code showed the authenticated state.

## Why This Worked

The exact internals may vary by environment, but my guess is one of these:

- A port-forwarding timing issue between the browser and WSL
- The callback was delivered but the UI update was delayed or dropped
- The auth completion page failed to render, but the backend processing partially completed

So it's worth keeping in mind that "browser error screen" and "authentication flow failure" are not necessarily the same thing.

## Checklist When You Hit the Same Symptom

1. Verify that a listener is actually running on `localhost:1455`
2. Do not share the `code`/`state` values from the callback URL externally
3. Try hitting the callback/success endpoints from the WSL terminal
4. After that, re-check the authentication status in VS Code

## Final Thoughts

In the WSL + VS Code combo, an auth callback can visually appear to fail while the actual processing state is different. If you run into a similar symptom, checking the callback endpoint locally is a surprisingly practical workaround.
