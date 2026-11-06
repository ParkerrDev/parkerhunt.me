+++
title = "Trees of Doom"
description = "Ninjatown: Trees of Doom, rebuilt for current iOS and for the browser. Its source was deleted in 2019, so the game is ported class by class from the native library in its Android build, to Swift and SpriteKit and then to TypeScript and WebGL 2."
date = 2026-09-22
updated = 2026-10-27
weight = 3
[extra]
kind = "GAME PORT"
card_image = "/imgs/project-cards/opt/treesofdoom-9bf2cd78.webp"
accent = "#1bb1f2"
accent_ink = "#111112"
website_url = "https://treesofdoom.netlify.app"
tagline = "A 32-bit iPhone game, rebuilt for today's iOS and the web."
+++

## Overview

Ninjatown: Trees of Doom is an iPhone game whose last source repository was
deleted in December 2019, which left it unable to keep up with iOS: the App
Store copy is a 32-bit binary, and iOS has run only 64-bit apps since iOS 11.

The Android build of the same version ships the game in a native library that is
not encrypted and keeps its C++ symbol names. This project ports that code,
class by class and function by function, to a new SpriteKit app in Swift for
current iOS, and from there to TypeScript and WebGL 2 for browsers. Both play
from the game's original data files.

Every format those files use, from the texture archives to the level chunks, the
UI layouts and the bitmap fonts, was worked out from the files themselves, and
both ports are checked against frames of the original running in the Android
emulator.
