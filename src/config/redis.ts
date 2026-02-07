import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
});

redis.on('connect', () => {
    console.log('✅ Redis connected successfully');
});

redis.on('error', (error) => {
    console.error('❌ Redis connection error:', error.message);
});

redis.on('close', () => {
    console.log('Redis connection closed');
});

export async function connectRedis(): Promise<void> {
    try {
        await redis.connect();
    } catch (error) {
        // May already be connected
        if ((error as Error).message !== 'Redis is already connecting/connected') {
            throw error;
        }
    }
}

export async function disconnectRedis(): Promise<void> {
    await redis.quit();
}

// Bull queue Redis configuration
export const bullRedisConfig = {
    redis: {
        host: new URL(redisUrl).hostname || 'localhost',
        port: parseInt(new URL(redisUrl).port || '6379', 10),
    },
};
