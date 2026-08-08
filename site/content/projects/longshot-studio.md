+++
title = "Longshot"
description = "A studio and a cinema with nobody in between. Develop, write, board, frame and cut a film in the browser, then release it the same week — no distributor, no green-light committee."
date = 2026-08-07
updated = 2026-08-08
weight = 1
[extra]
card_image = "/imgs/project-cards/opt/longshot.webp"
website_url = "https://longshot.studio"
mirror_url = "https://longshot-studio.netlify.app/"
accent = "#fd5200"
accent_ink = "#111112"
tagline = "A studio and a cinema with nobody in between."
stack = ["Cloudflare Workers", "D1", "R2", "Workers AI", "Hono", "React + Vite"]
+++

## Overview

Making a film has never been cheaper. Getting *permission* to make one has never
been harder — rights clearance, guild paperwork, distribution deals, festival
calendars, insurance. The constraint on cinema has not been talent or tools for
about fifteen years. It has been permission.

Longshot removes it. One continuous product takes an idea through development,
screenplay, shot list and frames, and then releases the result to an audience in
the same place it was made.

## The bet

Two costs collapsed at once, and nobody had connected them:

- **Production.** A feature that cost $5–50M is now roughly **$1,400** of
  inference.
- **Distribution.** Zero-egress object storage holds a feature for about **nine
  cents a month** and serves it to a million people for nothing. The bandwidth
  bill that killed every previous "YouTube for X" no longer exists.

Together: one person can make and release a feature for less than a laptop
costs.

## Two ideas worth understanding

**No product code names a vendor.** Every generative capability is a routing
decision — modality, minimum quality, a hard cost ceiling, a preference — and
the registry picks a provider, enforces the budget and fails over. Swapping
model vendors is a config change, not a rewrite.

**Money is a ledger, not a counter.** Credits move through reserve → run →
settle with compare-and-swap and idempotency keys, so unused holds refund and a
failed generation refunds in full rather than silently charging for nothing.

## Status

The pipeline is verified end to end in production on the free tier: signup
through development, scene breakdown, an eight-shot list covering 38 seconds,
and a 1024×576 still — twelve credits, about a penny of retail value, with the
ledger settling correctly throughout. The Studio and the API are live; the
catalog schema exists and its interface does not yet.
