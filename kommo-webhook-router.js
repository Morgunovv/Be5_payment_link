const express = require('express');
const path = require('path');
const fs = require('fs');
const KommoWebhookHandler = require('./kommo-webhook-handler');

function createKommoWebhookRouter(options = {}) {
    const router = express.Router();
    const handler = new KommoWebhookHandler(options);

    // Middleware для парсинга JSON и form-data
    router.use(express.json({ limit: '10mb' }));
    router.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Обработчик вебхуков
    router.post('/', (req, res) => {
        console.log('\n==== KOMMO WEBHOOK RECEIVED ====');
        const timestamp = new Date().toISOString();

        try {
            // Сохраняем сырые данные вебхука
            const saveTimestamp = timestamp.replace(/:/g, '-');
            const webhookFile = path.join(handler.webhooksDir, `kommo-${saveTimestamp}.json`);

            const webhookData = {
                timestamp,
                headers: req.headers,
                body: req.body
            };

            fs.writeFileSync(webhookFile, JSON.stringify(webhookData, null, 2));
            console.log('Webhook data saved to:', webhookFile);

            // Обрабатываем вебхук с полными данными
            handler.processWebhook({
                body: req.body,
                headers: req.headers,
                rawBody: req.rawBody
            })
                .then(result => {
                    res.status(200).json({
                        status: 'success',
                        message: 'Webhook processed',
                        result
                    });
                })
                .catch(error => {
                    console.error('Webhook processing error:', error);
                    res.status(200).json({
                        status: 'error',
                        message: 'Webhook processing failed',
                        error: error.message
                    });
                });
        } catch (error) {
            console.error('Error processing webhook:', error);
            res.status(200).json({
                status: 'error',
                message: 'Error processing webhook',
                error: error.message
            });
        }
    });

    return router;
}

module.exports = {
    createKommoWebhookRouter
};
