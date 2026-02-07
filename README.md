# Telegram Bot Relay System

A professional middleware server for multiple Telegram bots to chat with each other using AI-powered responses.

## Features

- 🤖 Register multiple Telegram bots with unique AI personalities
- 💬 Automated message relay between bots in groups
- 🧠 Google Gemini AI powered intelligent responses
- ⏱️ Natural 3-5 second delay between messages
- 🔄 Round-robin bot selection for responses
- 📊 Rate limiting (1 msg/sec per bot)
- 🐳 Docker deployment ready

## Quick Start

### Prerequisites

- Node.js 20+
- PostgreSQL
- Redis
- Telegram Bot tokens (from @BotFather)
- Google Gemini API key

### Local Development

1. **Clone and install:**
   ```bash
   cd botai
   npm install
   ```

2. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your credentials
   ```

3. **Setup database:**
   ```bash
   npx prisma migrate dev
   npx prisma generate
   ```

4. **Run development server:**
   ```bash
   npm run dev
   ```

### Docker Deployment

1. **Configure environment:**
   ```bash
   export OPENAI_API_KEY=sk-your-key
   export WEBHOOK_DOMAIN=https://yourdomain.com
   export POSTGRES_PASSWORD=secure-password
   ```

2. **Start services:**
   ```bash
   docker-compose up -d
   ```

3. **Run migrations:**
   ```bash
   docker-compose exec app npx prisma migrate deploy
   ```

## API Endpoints

### Register a Bot
```bash
POST /api/bots
{
  "token": "123456:ABC-DEF...",
  "personality": "friendly and witty assistant",
  "groupId": "-1001234567890"
}
```

### List All Bots
```bash
GET /api/bots
```

### Delete a Bot
```bash
DELETE /api/bots/:id
```

### Toggle Bot Active Status
```bash
PATCH /api/bots/:id/toggle
```

## How It Works

1. Register 2+ bots with different personalities for the same group
2. Add all bots to a Telegram group
3. Send a message in the group
4. The system automatically:
   - Receives message via webhook
   - Stores in database
   - Selects next bot (round-robin)
   - Generates AI response with bot's personality
   - Sends response after 3-5 second delay
   - Cycle continues!

## Environment Variables

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `REDIS_URL` | Redis connection string |
| `GEMINI_API_KEY` | Google Gemini API key |
| `WEBHOOK_DOMAIN` | Your server's public URL |
| `PORT` | Server port (default: 3000) |

## License

MIT
