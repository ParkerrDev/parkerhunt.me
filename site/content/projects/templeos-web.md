+++
title = "TempleOS Web"
description = "The complete, unmodified TempleOS V5.03 booting in a browser tab in about four seconds, running on an x86-64 emulator written in HolyC and compiled to WebAssembly."
date = 2026-08-09
updated = 2026-08-09
weight = 2
[extra]
brand_manual = true
card_image = "/imgs/project-cards/opt/templeos.webp"
brand_image = "/imgs/project-brand/templeos-web.webp"
accent = "#0000ab"
accent_ink = "#ffffff"
website_url = "https://templeosweb.netlify.app"
repo_url = "https://github.com/ParkerrDev/TempleOS-Web"
tagline = "The real 64-bit OS, in a browser tab."
+++

## Overview

Not a reimplementation and not a screenshot: the actual TempleOS kernel, its HolyC
JIT, its graphics, its games. It resumes from a RAM snapshot of the booted desktop,
so the machine is up in roughly four seconds, and the 3D games run at the 30 fps
they were designed for.

## Why it had to be emulated

TempleOS is 64-bit only and is its own self-hosting compiler, so there is no
cross-compiling it to WebAssembly. HEMU takes the other road, and takes it in
TempleOS's own language: an x86-64 emulator written in HolyC, about 1,300 lines,
compiled to WASM by a from-scratch HolyC compiler written for this project. It
emulates only the hardware TempleOS actually touches, which is a short list:
PIC, PIT, HPET, PS/2, ATA and the VGA DAC.

## Where the speed comes from

Three layers, and the first is the joke that works:

- **An x86-64 to WASM block JIT** that compiles hot guest code to native WebAssembly
  at runtime. It is the same trick TempleOS's own JIT plays, one level up.
- **High-level emulation of the hottest render routines**, the window compositor blit
  and the games' span fillers, each shadow-verified bit-exact against the emulated
  version before it is allowed to take over.
- **A worker engine**, so the emulator never runs on the main thread.

The guest clock is paced to real time, and keystroke timing feeds the OS's God
apps with real entropy, which is what TSC sampling did on the hardware Terry wrote
it for.

## What you can do in it

Write and run HolyC in an in-page editor, compiled natively to WASM rather than
emulated. Export a snapshot of the whole running OS and reload it later to resume
exactly where you were, or export the C: disk with your files on it. Pause the
machine, guest clock included. Draw a God word from the oracle, with entropy from
your own typing.

TempleOS is public domain. It was written by Terry A. Davis.
