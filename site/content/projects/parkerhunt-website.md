+++
title = "parkerhunt.me"
description = "A fast, static personal site built with Zola, featuring blog posts, projects, and resume. Designed in Figma and deployed with custom SCSS styling."
date = 2026-03-28
+++

## Overview

My personal website serves as a portfolio, blog, and information hub. Built with a focus on performance, simplicity, and maintainability using static site generation and modern web standards.

## Design & Philosophy

**Performance First**
- Static Site Generation: All content is pre-built at compile time, eliminating runtime processing overhead
- No database required—pure HTML, CSS, and JavaScript at runtime
- Lightning-fast page loads with zero backend dependencies
- Rust-based tooling via Zola for reliability and speed

**Content Organization**
- Markdown-based blog posts and project pages for easy authoring
- Hierarchical content structure with sections and templates
- RSS feed support for syndication
- Semantic HTML5 markup for accessibility and SEO

## Technology Stack

**Static Site Generator**
- Zola: A fast, Rust-based static site generator
- No templating complexity—Zola handles all builds
- Automatic content processing and asset optimization

**Styling**
- Hand-coded SCSS with no bloat
- SASS variables for theming and consistency
- Mobile-first responsive design
- Custom animations and transitions

**Frontend**
- Vanilla JavaScript for interactivity
- Progressive enhancement approach
- Lightweight scroll effects and UI behaviors
- No framework overhead

**Design**
- High-fidelity mockups and component systems in Figma
- Design-to-code workflow ensuring pixel-perfect implementation

## Features

- **Project Showcase**: Filterable project cards with detailed case studies
- **Blog Posts**: Time-ordered articles with RSS syndication
- **Resume Integration**: Academic background and skills
- **About Page**: Personal information and background
- **Responsive Design**: Flawless experience across all devices
- **Dark Mode**: Automatic theme switching based on system preference
- **SEO Optimized**: Proper semantic markup and metadata

## Architecture

The site uses a modular template structure:
- `base.html`: Root layout for home page
- `alt-base.html`: Content pages with back navigation
- `projects.html` / `project-page.html`: Project section and detail pages
- `blogs.html` / `blog-page.html`: Blog listing and article pages

All styling is compiled from SCSS into optimized CSS at build time.

## Deployment

- Built and deployed via static hosting (Netlify/GitHub Pages ready)
- Automatic rebuilds on content changes
- Zero cold starts—instant page delivery
- Global CDN support for fast worldwide access

## Impact

The site balances aesthetic design with technical performance. It demonstrates:
- Full-stack understanding from design to deployment
- Modern web standards and best practices
- Optimization mindset (performance, accessibility, SEO)
- Practical experience with static site generation

Visitors experience sub-100ms page loads and smooth interactions, creating a polished first impression.

## Technologies

Zola, SCSS, HTML5, JavaScript, Figma, Git, Static Site Generation
