const express = require('express');
const KommoWebhookHandler = require('./kommo-webhook-handler');

function createKommoWebhookRouter(options = {}) {
    const router = express.Router();
    const handler = new KommoWebhookHandler(options);

    // Middleware для логирования входящих запросов
    router.use((req, res, next) => {
        console.log('Received Kommo webhook:', {
            method: req.method,
            path: req.path,
            headers: req.headers,
            body: req.body
        });
        next();
    });

    // Обработчик POST запросов
    router.post('/', async (req, res) => {
        try {
            const result = await handler.processWebhook({
                headers: req.headers,
                body: req.body
            });

            if (result.success) {
                res.status(200).json({
                    status: 'success',
                    message: 'Webhook processed successfully',
                    leadId: result.leadId,
                    webhookFile: result.webhookFile
                });
            } else {
                res.status(400).json({
                    status: 'error',
                    message: 'Failed to process webhook',
                    error: result.error,
                    webhookFile: result.webhookFile
                });
            }
        } catch (error) {
            console.error('Unexpected error:', error);
            res.status(500).json({
                status: 'error',
                message: 'Internal server error',
                error: error.message
            });
        }
    });

    return router;
}

module.exports = {
    createKommoWebhookRouter
};
