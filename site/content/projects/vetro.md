+++
title = "Vetro"
description = "Real liquid glass for Omarchy: the bar, the menu, the panels, the notifications, the lock screen and your windows. Your theme stays yours."
date = 2026-10-24
updated = 2026-10-28
weight = 3
[extra]
kind = "LINUX DESKTOP"
brand_manual = true
card_image = "/imgs/project-cards/opt/vetro-0b2c1376.webp"
brand_image = "/imgs/project-brand/vetro-mark-bf9e42d2.svg"
accent = "#3a71c2"
accent_ink = "#ffffff"
repo_url = "https://github.com/ParkerrDev/vetro"
tagline = "Liquid glass for Omarchy."
+++

## Overview

Omarchy's floating parts are flat see-through rectangles over a blur. Hyprland can
blur what is behind a surface, but it cannot bend it: no refraction, no lit edge,
nothing that reads as glass. Vetro makes them glass. Each pane bends the light at
its edge, lights a rim that follows its own corners and frosts what is behind it.

It lies over your theme instead of replacing it, and `vetro off` gives you Omarchy
back as it was.

{{ img(src="/imgs/project-shots/vetro-3e7e2c9d.webp", alt="The Omarchy desktop with Vetro on: the calendar panel, the bar and two windows in liquid glass over a nebula wallpaper") }}

## What turns to glass

The bar, with every one of Omarchy's own widgets and a workspace selector that
glides from number to number as a drop of glass. The menu and app launcher. The
calendar and the other panels. Notifications, served by Vetro's own daemon. The
volume display, the lock screen, and see-through windows such as the terminal.

Genie, jelly and wobble animations are there to switch on, and the Vetro Glass app
tunes all of it by hand, with presets.

## How it is built

The glass is drawn by a Hyprland plugin, a fork of
[hyprglass](https://github.com/hyprnux/hyprglass), with its shading, tuning and
motion in Rust and its hooks into Hyprland in C++. The rest is a set of Omarchy
shell plugins, which began with
[HyprPerks](https://github.com/hyprwm/hyprperks-dotfiles).

## Keeping a plugin from taking the desktop down

A compositor plugin runs inside the compositor, so most of the work is in what
happens when something does not line up:

- **A plugin has to match its compositor exactly.** A list of pins says which engine
  commit is built for which Hyprland, and a pin is added only once that pair has
  been built and seen working.
- **The engine is loaded from outside, never by Hyprland's config.** Hyprland reads
  its config again each time a plugin loads, so a config that loads one loops and
  freezes the screen.
- **The glass is optional at every step.** With no engine, an engine built for
  another Hyprland, or one that refuses its settings, every pane has plain blur and
  nothing errors.
