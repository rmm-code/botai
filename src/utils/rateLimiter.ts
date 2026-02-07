import { redis } from '../config/redis';
import { logger } from './logger';

interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetIn: number;
}

const RATE_LIMIT_WINDOW = 1000; // 1 second in ms
const MAX_REQUESTS_PER_WINDOW = 1; // 1 message per second per bot

export async function checkRateLimit(botId: string): Promise<RateLimitResult> {
    const key = `ratelimit:bot:${botId}`;
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW;

    try {
        // Remove old entries
        await redis.zremrangebyscore(key, 0, windowStart);

        // Count current requests in window
        const count = await redis.zcard(key);

        if (count >= MAX_REQUESTS_PER_WINDOW) {
            // Get the oldest entry to calculate reset time
            const oldest = await redis.zrange(key, 0, 0, 'WITHSCORES');
            const resetIn = oldest.length >= 2
                ? Math.max(0, RATE_LIMIT_WINDOW - (now - parseInt(oldest[1], 10)))
                : RATE_LIMIT_WINDOW;

            return {
                allowed: false,
                remaining: 0,
                resetIn,
            };
        }

        // Add current request
        await redis.zadd(key, now, `${now}`);
        await redis.expire(key, 2); // Expire after 2 seconds

        return {
            allowed: true,
            remaining: MAX_REQUESTS_PER_WINDOW - count - 1,
            resetIn: 0,
        };
    } catch (error) {
        logger.error(`Rate limit check failed: ${(error as Error).message}`);
        // On error, allow the request but log it
        return { allowed: true, remaining: 0, resetIn: 0 };
    }
}

export async function waitForRateLimit(botId: string): Promise<void> {
    const result = await checkRateLimit(botId);

    if (!result.allowed && result.resetIn > 0) {
        logger.debug(`Rate limited for bot ${botId}, waiting ${result.resetIn}ms`);
        await new Promise(resolve => setTimeout(resolve, result.resetIn));
    }
}
