# Architecture

Working names: **grok-box**, **askit-box**. Role: **Grok Bot Layer 3** — the sandboxed Linux computer.

## One-pager (L1–L4)

```
┌─────────────────────────────────────────────────────────────┐
│ L1  Client / desktop                                        │
│     Human UI (Win / Mac / Linux). Talks to L2.              │
│     Never SSHes into the box.                               │
└────────────────────────────┴────────────────────────────────┘
                             │
┌────────────────────────────┴────────────────────────────────┐
