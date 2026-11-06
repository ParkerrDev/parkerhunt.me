+++
title = "pacrid"
description = "A pacman hook for Arch Linux that finds the configuration, caches and data a removed package leaves behind, asks before removing them, and can put them back."
date = 2026-05-26
updated = 2026-10-11
weight = 7
[extra]
kind = "PACKAGE CLEANUP"
card_image = "/imgs/project-cards/opt/pacrid-86030bb9.webp"
accent = "#0d314b"
accent_ink = "#ffffff"
repo_url = "https://github.com/ParkerrDev/pacrid"
tagline = "pacman removes packages. pacrid removes the mess they leave behind."
+++

## Overview

When pacman removes a package it deletes the package's own files and leaves
everything the program wrote in your home directory: `~/.config/steam`,
`~/.cache/discord`, `~/.local/share/kiwix-desktop`. pacrid is a pacman hook that
runs after every removal, finds what the package left behind, and asks you about
it in the middle of the transaction. It works with pacman and with any wrapper
over it, such as paru or yay.

## Finding what was left

Two scanners look for each removed package. One reads a database of the paths
hundreds of programs are known to leave, built into the binary from the
xdg-unused-data project. The other tries the package's name and its variants in
the standard XDG directories and the usual places under `/etc` and `/var`.

Nothing is touched for a program that is still installed some other way, as a
Flatpak or an AppImage: if its executable is still on `PATH`, every finding for
it is dropped. Each finding gets a confidence from its evidence, and at the
default threshold only High is ticked. Anything over 1 GB is Low, whatever the
evidence, but it is still shown.

## Removing it safely

Files are moved, not erased: from the hook into a quarantine, and by hand to the
trash. Every removal is written to a journal before any file is moved, so
`pacrid undo` can put a batch back even after a crash. With no terminal to ask,
from cron or a graphical package manager, pacrid removes only what is at your
threshold and never holds up the transaction.
