require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const crypto = require('crypto');
const { createKommoWebhookRouter } = require('./kommo-webhook-router');

const app = express();

// Log environment variables for debugging
console.log('Environment Variables:', {
    KOMMO_API_TOKEN: process.env.KOMMO_API_TOKEN ? '***REDACTED***' : 'NOT SET',
    KOMMO_SUBDOMAIN: process.env.KOMMO_SUBDOMAIN || 'NOT SET',
    NODE_ENV: process.env.NODE_ENV || 'development'
});
const PORT = process.env.PORT || 3000;

// Improved JSON parsing with error handling
app.use(express.json({
    verify: (req, res, buf) => {
        try {
            JSON.parse(buf.toString());
        } catch (e) {
            throw new Error('Invalid JSON');
        }
    }
}));

// Error handling middleware
app.use((err, req, res, next) => {
    if (err.message === 'Invalid JSON') {
        return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    next(err);
});

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

const TbcPaymentService = require('./tbc-payment-service');
let tbcPaymentService;
try {
    tbcPaymentService = new TbcPaymentService();
    console.log('TBC Payment Service initialized successfully');
} catch (error) {
    console.error('Failed to initialize TBC Payment Service:', error.message);
    console.warn('Payment functionality will be disabled');
    tbcPaymentService = null;
}

// Route to create a payment
app.post('/create-payment', async (req, res) => {
    if (!tbcPaymentService) {
        return res.status(503).json({
            error: 'Payment service unavailable',
            details: 'TBC API credentials not configured'
        });
    }
    try {
        const paymentData = req.body;
        const result = await tbcPaymentService.createPayment(paymentData);
        res.json({
            ...result,
            paymentLink: tbcPaymentService.generatePaymentLink(result.id)
        });
    } catch (error) {
        console.error('Payment creation error:', {
            message: error.message,
            response: error.response?.data,
            stack: error.stack
        });
        res.status(500).json({
            error: 'Payment creation failed',
            details: error.response?.data || error.message
        });
    }
});


// Route to create an invoice
app.post('/create-invoice', async (req, res) => {
    if (!tbcPaymentService) {
        return res.status(503).json({
            error: 'Payment service unavailable',
            details: 'TBC API credentials not configured'
        });
    }
    try {
        const invoiceData = req.body;
        const result = await tbcPaymentService.createInvoice(invoiceData);
        res.json({
            ...result,
            paymentLink: tbcPaymentService.generatePaymentLink(result.id)
        });
    } catch (error) {
        console.error('Invoice creation error:', {
            message: error.message,
            response: error.response?.data,
            stack: error.stack
        });
        res.status(500).json({
            error: 'Invoice creation failed',
            details: error.response?.data || error.message
        });
    }
});

// Route to get payment status by payment ID
app.get('/payment-status/:id', async (req, res) => {
    if (!tbcPaymentService) {
        return res.status(503).json({
            error: 'Payment service unavailable',
            details: 'TBC API credentials not configured'
        });
    }
    try {
        const paymentId = req.params.id;
        const status = await tbcPaymentService.getPaymentStatus(paymentId);
        res.json(status);
    } catch (error) {
        console.error('Payment status error:', {
            message: error.message,
            response: error.response?.data,
            stack: error.stack
        });
        res.status(500).json({
            error: 'Failed to fetch payment status',
            details: error.response?.data || error.message
        });
    }
});

// Route to cancel a payment by payment ID
app.post('/cancel-payment/:id', async (req, res) => {
    try {
        const paymentId = req.params.id;
        const result = await tbcPaymentService.cancelPayment(paymentId);
        res.json(result);
    } catch (error) {
        console.error('Payment cancellation error:', {
            message: error.message,
            response: error.response?.data,
            stack: error.stack
        });
        res.status(500).json({
            error: 'Failed to cancel payment',
            details: error.response?.data || error.message
        });
    }
});

// Kommo webhooks route
app.use('/kommo-webhooks', createKommoWebhookRouter());

// Test route to get deal data
app.get('/test-deal/:id', async (req, res) => {
    try {
        const dealId = req.params.id;
        const handler = new (require('./kommo-webhook-handler'))();
        const result = await handler.getDealData(dealId);
        res.json(result);
    } catch (error) {
        console.error('Error getting deal data:', error);
        res.status(500).json({ error: error.message });
    }
});

// Route to handle callback notifications from TBC
app.post('/callback', async (req, res) => {
    try {
        const callbackData = req.body;
        console.log('Received payment callback:', callbackData);

        // Verify callback signature if needed
        // Process payment status update
        // Example: update database with payment status

        res.status(200).json({ status: 'Callback processed' });
    } catch (error) {
        console.error('Callback processing error:', {
            message: error.message,
            data: req.body,
            stack: error.stack
        });
        res.status(500).json({ error: 'Callback processing failed' });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
