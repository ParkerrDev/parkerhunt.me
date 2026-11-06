+++
title = "inkling"
description = "Fish-like inline autosuggestions for bash, written in Rust. The command you most likely mean here appears dim after the cursor, in whatever case you type it, and readline is left alone."
date = 2026-10-11
updated = 2026-11-06
weight = 5
[extra]
kind = "SHELL"
card_image = "/imgs/project-cards/opt/inkling-5b28d725.webp"
accent = "#292153"
accent_ink = "#ffffff"
repo_url = "https://github.com/ParkerrDev/inkling"
tagline = "Fish-like suggestions for bash, with readline left alone."
+++

## Overview

As you type at a bash prompt, the rest of the command you most likely mean
appears dim after the cursor, and Right arrow takes it. Everything else you type
just types.

The usual way to get this in bash, ble.sh, replaces readline with a line editor
written in bash, which is why it is slow. inkling leaves readline alone: it runs
the shell inside a pseudo-terminal it owns, asks readline itself what is in the
line, and draws the suggestion next to what the shell draws. A key and its
suggestion are on the screen as soon as bash's own echo of the key would be,
however long the history.

## What it suggests

The suggestion is the command you most likely mean here: from what you run in
this directory, in this project and after the command you just ran, among those
whose paths are there. With nothing in the history, a program's or a file's name
is finished instead. Replayed over its owner's own history, the very command is
suggested after one character 64% of the time, against 52% for fish's rule.

Case is no bother. A letter typed in lower case fits a command that has it in
upper case, so `cd ~/dev/gith` finishes as `cd ~/Dev/GitHub/`, and taking the
suggestion puts the case of the line right. A capital typed is kept. Typed all
in lower case, the replay still has the very command after one character 63% of
the time.
