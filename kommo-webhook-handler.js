const axios = require('axios');
const fs = require('fs');
const path = require('path');

class KommoWebhookHandler {
    constructor(options = {}) {
        this.token = options.token || process.env.KOMMO_API_TOKEN;
        this.subdomain = options.subdomain || process.env.KOMMO_SUBDOMAIN;
        this.webhooksDir = options.webhooksDir || path.join(__dirname, 'webhooks');
        this.paymentService = options.paymentService || require('./tbc-payment-service');

        // Создаем директорию для вебхуков если не существует
        if (!fs.existsSync(this.webhooksDir)) {
            fs.mkdirSync(this.webhooksDir, { recursive: true });
        }
    }

    async processWebhook(webhookData) {
        console.log('\n==== KOMMO WEBHOOK PROCESSING STARTED ====');
        const timestamp = new Date().toISOString();
        console.log(`Processing started at: ${timestamp}`);

        const saveTimestamp = timestamp.replace(/:/g, '-');
        const webhookFile = path.join(this.webhooksDir, `kommo-${saveTimestamp}.json`);

        try {
            // Save raw webhook data with additional metadata
            const fullWebhookData = {
                timestamp,
                headers: webhookData.headers,
                body: webhookData.body,
                receivedAt: new Date().toISOString()
            };

            fs.writeFileSync(webhookFile, JSON.stringify(fullWebhookData, null, 2));
            console.log(`Webhook data saved to: ${webhookFile}`);

            // Extract lead ID from different webhook formats
            console.log('Extracting lead ID from webhook data...');
            const leadId = this.extractLeadId(webhookData.body);
            console.log(`Extracted lead ID: ${leadId || 'Not found'}`);

            if (!leadId) {
                console.warn('No lead ID found in webhook data. Creating payment link with minimal data.');
                const paymentResult = await this.paymentService.createPaymentLink({
                    amount: 0,
                    description: 'Payment for unknown deal',
                    callback_url: `${process.env.BASE_URL}/payment-callback`
                });

                return {
                    success: true,
                    leadId: null,
                    paymentUrl: paymentResult.checkout_url,
                    webhookFile,
                    message: 'Payment link created without lead ID'
                };
            }

            // Get deal data from Kommo API
            console.log(`Fetching deal data for lead ID: ${leadId}`);
            const dealData = await this.getDealData(leadId);
            console.log('Deal data fetched successfully');

            // Create payment link
            const paymentAmount = dealData.lead.price || 0;
            const paymentDescription = `Payment for deal #${leadId}`;
            console.log(`Creating payment link for amount: ${paymentAmount}`);

            const paymentResult = await this.paymentService.createPaymentLink({
                amount: paymentAmount,
                description: paymentDescription,
                callback_url: `${process.env.BASE_URL}/payment-callback`
            });

            console.log('Payment link created successfully');
            console.log('==== KOMMO WEBHOOK PROCESSING COMPLETED ====\n');

            return {
                success: true,
                leadId,
                dealData,
                paymentUrl: paymentResult.checkout_url,
                webhookFile
            };
        } catch (error) {
            console.error('Webhook processing error:', error);

            // Even in case of error, try to create a basic payment link
            try {
                const paymentResult = await this.paymentService.createPaymentLink({
                    amount: 0,
                    description: 'Payment for deal (error occurred)',
                    callback_url: `${process.env.BASE_URL}/payment-callback`
                });

                return {
                    success: false,
                    error: error.message,
                    paymentUrl: paymentResult.checkout_url,
                    webhookFile,
                    message: 'Error occurred but basic payment link was created'
                };
            } catch (paymentError) {
                console.error('Failed to create fallback payment link:', paymentError);
                return {
                    success: false,
                    error: error.message,
                    webhookFile,
                    paymentError: paymentError.message
                };
            }
        }
    }

    extractLeadId(webhookBody) {
        // Try different possible paths for lead ID
        return webhookBody?.leads?.add?.[0]?.id ||
            webhookBody?._embedded?.leads?.[0]?.id ||
            this.findLeadIdInObject(webhookBody?.leads);
    }

    findLeadIdInObject(leadsObj) {
        if (!leadsObj) return null;

        for (const key in leadsObj) {
            if (Array.isArray(leadsObj[key])) {
                for (const item of leadsObj[key]) {
                    if (item.id) return item.id;
                }
            }
        }
        return null;
    }

    async getDealData(leadId) {
        if (!this.token || !this.subdomain) {
            console.error('Kommo API credentials not configured');
            throw new Error('Kommo API credentials not configured');
        }

        const baseUrl = `https://${this.subdomain}.kommo.com/api/v4`;
        console.log(`Attempting to fetch deal ${leadId} from ${baseUrl}`);
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.token}`
        };

        // Get lead data
        const leadResponse = await axios.get(`${baseUrl}/leads/${leadId}`, { headers });
        const lead = leadResponse.data;

        // Get related contacts and companies
        const [contacts, companies] = await Promise.all([
            this.getRelatedEntities(lead._embedded?.contacts, 'contacts', headers),
            this.getRelatedEntities(lead._embedded?.companies, 'companies', headers)
        ]);

        return {
            lead,
            contacts,
            companies
        };
    }

    async getRelatedEntities(entities, entityType, headers) {
        if (!entities || !entities.length) return [];

        return Promise.all(
            entities.map(entity =>
                axios.get(`${baseUrl}/${entityType}/${entity.id}`, { headers })
                    .then(res => res.data)
                    .catch(err => {
                        console.error(`Error fetching ${entityType} ${entity.id}:`, err);
                        return null;
                    })
            )
        ).then(results => results.filter(Boolean));
    }
}

module.exports = KommoWebhookHandler;
