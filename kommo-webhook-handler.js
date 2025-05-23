const express = require('express');
const fs = require('fs');
const path = require('path');
const KommoAPI = require('./kommo-api');
const TBCPaymentService = require('./tbc-payment-service');

class KommoWebhookHandler {
    constructor(options = {}) {
        this.token = options.token || process.env.KOMMO_API_TOKEN;
        this.subdomain = options.subdomain || process.env.KOMMO_SUBDOMAIN;
        this.webhooksDir = options.webhooksDir || path.join(__dirname, 'webhooks');
        this.paymentService = options.paymentService || new TBCPaymentService();
        this.kommoApi = options.kommoApi || new KommoAPI(this.token, this.subdomain);

        if (!fs.existsSync(this.webhooksDir)) {
            fs.mkdirSync(this.webhooksDir, { recursive: true });
        }
    }

    async processWebhook(webhookData) {
        console.log('\n==== KOMMO WEBHOOK PROCESSING STARTED ====');
        const timestamp = new Date().toISOString();
        console.log(`Processing started at: ${timestamp}`);

        try {
            // Save raw webhook data
            const saveTimestamp = timestamp.replace(/:/g, '-');
            const webhookFile = path.join(this.webhooksDir, `kommo-${saveTimestamp}.json`);

            const fullWebhookData = {
                timestamp,
                headers: webhookData.headers,
                body: webhookData.body,
                rawBody: webhookData.rawBody,
                receivedAt: new Date().toISOString()
            };

            fs.writeFileSync(webhookFile, JSON.stringify(fullWebhookData, null, 2));
            console.log('Webhook data saved to:', webhookFile);

            // Extract lead ID
            const leadId = this.extractLeadId(webhookData.body);
            console.log(`Extracted lead ID: ${leadId || 'Not found'}`);

            if (!leadId) {
                return await this.createFallbackPayment();
            }

            // Create payment link
            const paymentResult = await this.paymentService.createPaymentLink({
                amount: 0, // Will be updated with actual amount
                description: `Payment for deal #${leadId}`,
                callback_url: `${process.env.BASE_URL}/payment-callback`
            });

            // Add note to Kommo
            if (this.token && this.subdomain) {
                try {
                    const noteText = `Payment Link Created\n\n` +
                        `Payment URL: ${paymentResult.checkout_url}`;
                    await this.kommoApi.createNote(leadId, noteText);
                } catch (noteError) {
                    console.error('Failed to add payment link note:', noteError);
                }
            }

            return {
                success: true,
                leadId,
                paymentUrl: paymentResult.checkout_url,
                webhookFile
            };

        } catch (error) {
            console.error('Webhook processing error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    extractLeadId(webhookBody) {
        // Основные форматы вебхуков Kommo
        if (webhookBody?.leads?.add?.[0]?.id) {
            return webhookBody.leads.add[0].id;
        }
        if (webhookBody?.leads?.status?.[0]?.id) {
            return webhookBody.leads.status[0].id;
        }
        if (webhookBody?._embedded?.leads?.[0]?.id) {
            return webhookBody._embedded.leads[0].id;
        }

        // Обработка некорректного формата form-urlencoded
        if (typeof webhookBody === 'string') {
            try {
                const params = new URLSearchParams(webhookBody);
                let leadId = params.get('leads[add][0][id]') ||
                    params.get('leads%5Badd%5D%5B0%5D%5Bid%5D') ||
                    params.get('leads_add_0_id');
                if (leadId) return parseInt(leadId);
            } catch (e) {
                console.error('Error parsing URL encoded data:', e);
            }
        }

        return null;
    }

    async createFallbackPayment() {
        console.warn('No lead ID found. Creating fallback payment link');
        const paymentResult = await this.paymentService.createPaymentLink({
            amount: 0,
            description: 'Payment for unknown deal',
            callback_url: `${process.env.BASE_URL}/payment-callback`
        });
        return {
            success: true,
            leadId: null,
            paymentUrl: paymentResult.checkout_url,
            message: 'Payment link created without lead ID'
        };
    }
}

module.exports = KommoWebhookHandler;
