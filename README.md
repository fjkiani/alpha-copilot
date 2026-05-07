# Alpha Copilot

Real-time conversation copilot. Listens to your call, streams tactical hints in under 2.5 seconds.

## Requirements

- Chrome or Edge (Web Speech API required)
- Node.js 20+
- OpenRouter API key

## Setup

1. Clone the repo
2. `npm install`
3. Copy `.env.example` to `.env.local` and add your OpenRouter key
4. `npm run dev`
5. Open http://localhost:3000 in Chrome

## Health check

http://localhost:3000/api/health

## Latency targets

| Stage | Target |
|---|---|
| Router (Llama 3B) | < 500ms |
| First token (Qwen) | < 1000ms |
| End-to-end | < 2500ms |
