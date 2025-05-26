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

// Enhanced JSON parsing middleware with detailed logging
app.use(express.json({
    verify: (req, res, buf) => {
        const rawBody = buf.toString();
        console.log('Raw JSON body:', rawBody);

        try {
            const parsed = JSON.parse(rawBody);
            console.log('Parsed JSON:', parsed);
            req.rawBody = rawBody; // Save raw body for debugging
            return true;
        } catch (e) {
            console.error('JSON parsing error:', {
                error: e.message,
                stack: e.stack,
                rawBody: rawBody
            });
            throw new Error('Invalid JSON payload');
        }
    },
    limit: '10mb'
}));

// Enhanced form-urlencoded parsing with detailed logging
app.use(express.urlencoded({
    extended: true,
    limit: '10mb',
    verify: (req, res, buf) => {
        const rawBody = buf.toString();
        console.log('Raw form-urlencoded body:', rawBody);
        req.rawBody = rawBody;

        try {
            // Try to parse as JSON if content looks like JSON
            if (rawBody.trim().startsWith('{') || rawBody.trim().startsWith('[')) {
                const parsed = JSON.parse(rawBody);
                console.log('Parsed as JSON:', parsed);
                req.body = parsed;
            }
        } catch (e) {
            console.log('Body is not JSON, parsing as form-urlencoded');
        }
    }
}));

// Enhanced error handling middleware
app.use((err, req, res, next) => {
    console.error('Error middleware caught:', {
        message: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method,
        body: req.body,
        rawBody: req.rawBody
    });

    if (err.message === 'Invalid JSON payload') {
        return res.status(400).json({
            status: 'error',
            error: 'Invalid JSON payload',
            details: process.env.NODE_ENV === 'development' ? {
                message: err.message,
                rawBody: req.rawBody
            } : null
        });
    }

    // Handle other errors
    res.status(500).json({
        status: 'error',
        error: 'Internal server error',
        details: process.env.NODE_ENV === 'development' ? {
            message: err.message,
            stack: err.stack
        } : null
    });
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

// Route to handle payment callback from TBC payment links
app.post('/payment-callback', async (req, res) => {
    try {
        // Log raw request data for debugging
        console.log('==== RAW PAYMENT CALLBACK REQUEST ====');
        console.log('Headers:', req.headers);
        console.log('Raw body:', req.rawBody);

        if (!req.body || Object.keys(req.body).length === 0) {
            throw new Error('Empty payment callback body');
        }

        const callbackData = req.body;
        console.log('==== PAYMENT CALLBACK DETAILS ====');
        console.log('Parsed callback data:', JSON.stringify(callbackData, null, 2));

        const handler = new (require('./kommo-webhook-handler'))();
        const result = await handler.processPaymentCallback(callbackData);

        if (result.success) {
            console.log('==== PAYMENT PROCESSED SUCCESSFULLY ====');
            console.log('Result:', JSON.stringify(result, null, 2));
            res.status(200).json({
                status: 'success',
                paymentId: result.paymentId,
                leadId: result.leadId
            });
        } else {
            console.error('==== PAYMENT PROCESSING FAILED ====');
            console.error('Error:', result.error);
            res.status(400).json({
                status: 'error',
                error: result.error,
                details: result.details || null
            });
        }
    } catch (error) {
        console.error('==== CALLBACK PROCESSING ERROR ====');
        console.error('Error details:', {
            message: error.message,
            stack: error.stack,
            rawBody: req.rawBody,
            parsedBody: req.body
        });
        res.status(500).json({
            status: 'error',
            error: 'Internal server error',
            details: process.env.NODE_ENV === 'development' ? error.message : null
        });
    }
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
