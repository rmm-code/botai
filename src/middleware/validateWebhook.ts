import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

/**
 * Middleware to validate Telegram webhook requests
 * Verifies that the request is coming from Telegram
 */
export function validateWebhook(req: Request, res: Response, next: NextFunction): void {
    const botToken = req.params.botToken;

    if (!botToken) {
        logger.warn('Webhook request without bot token');
        res.status(400).json({ error: 'Bot token required' });
        return;
    }

    // Telegram sends updates as JSON with specific structure
    if (!req.body || typeof req.body !== 'object') {
        logger.warn('Invalid webhook payload');
        res.status(400).json({ error: 'Invalid payload' });
        return;
    }

    // Check for required Telegram update fields
    const update = req.body;
    if (!update.update_id) {
        logger.warn('Missing update_id in webhook payload');
        res.status(400).json({ error: 'Invalid Telegram update' });
        return;
    }

    // Optionally verify using secret token if configured
    const secretToken = process.env.WEBHOOK_SECRET;
    if (secretToken) {
        const telegramSecret = req.headers['x-telegram-bot-api-secret-token'];
        if (telegramSecret !== secretToken) {
            logger.warn('Invalid webhook secret token');
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
    }

    next();
}

/**
 * Generate a webhook secret token for a bot
 */
export function generateWebhookSecret(botToken: string): string {
    return crypto
        .createHmac('sha256', botToken)
        .update('webhook-secret')
        .digest('hex')
        .substring(0, 32);
}
