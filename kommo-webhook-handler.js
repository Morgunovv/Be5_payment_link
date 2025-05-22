const axios = require('axios');
const fs = require('fs');
const path = require('path');
const KommoAPI = require('./kommo-api');

class KommoWebhookHandler {
    constructor(options = {}) {
        this.token = options.token || process.env.KOMMO_API_TOKEN;
        this.subdomain = options.subdomain || process.env.KOMMO_SUBDOMAIN;
        this.webhooksDir = options.webhooksDir || path.join(__dirname, 'webhooks');
        // Initialize services
        this.paymentService = options.paymentService || new (require('./tbc-payment-service'))();
        this.kommoApi = options.kommoApi || new KommoAPI(this.token, this.subdomain);

        // Создаем директорию для вебхуков если не существует
        if (!fs.existsSync(this.webhooksDir)) {
            fs.mkdirSync(this.webhooksDir, { recursive: true });
        }
    }

    async processWebhook(webhookData) {
        console.log('\n==== KOMMO WEBHOOK PROCESSING STARTED ====');
        const timestamp = new Date().toISOString();
        console.log(`Processing started at: ${timestamp}`);
        console.log('=== RAW WEBHOOK DATA ===');
        console.log('Headers:', JSON.stringify(webhookData.headers, null, 2));
        console.log('Raw Body:', webhookData.rawBody || 'Empty');

        // Если тело пришло в формате form-urlencoded, парсим его
        if (webhookData.headers['content-type']?.includes('application/x-www-form-urlencoded')
            && typeof webhookData.rawBody === 'string') {
            const parsed = {};
            webhookData.rawBody.split('&').forEach(pair => {
                const [key, value] = pair.split('=');
                parsed[key] = decodeURIComponent(value);
            });
            webhookData.body = parsed;
        }

        console.log('Parsed Body:', JSON.stringify(webhookData.body, null, 2));

        const saveTimestamp = timestamp.replace(/:/g, '-');
        const webhookFile = path.join(this.webhooksDir, `kommo-${saveTimestamp}.json`);

        try {
            // Save raw webhook data with additional metadata
            const fullWebhookData = {
                timestamp,
                headers: webhookData.headers,
                body: webhookData.body,
                rawBody: webhookData.rawBody, // Add raw body for debugging
                receivedAt: new Date().toISOString()
            };

            fs.writeFileSync(webhookFile, JSON.stringify(fullWebhookData, null, 2));
            console.log('=== WEBHOOK SAVED ===');
            console.log(`File: ${path.basename(webhookFile)}`);
            console.log(`Path: ${webhookFile}`);
            console.log('=====================');

            // Extract lead ID from different webhook formats
            console.log('Extracting lead ID from webhook data...');
            console.log('Full webhook body:', JSON.stringify(webhookData.body, null, 2));
            console.log('Raw webhook body:', webhookData.rawBody);

            const leadId = this.extractLeadId(webhookData.body);
            console.log(`Extracted lead ID: ${leadId || 'Not found'}`);

            if (!leadId) {
                console.warn('No lead ID found in webhook data. Creating fallback payment link');
                console.log('Webhook body:', JSON.stringify(webhookData.body, null, 2));
                console.log('Raw webhook body:', webhookData.rawBody);

                const paymentResult = await this.paymentService.createPaymentLink({
                    amount: 0,
                    description: 'Payment for unknown deal',
                    callback_url: `${process.env.BASE_URL}/payment-callback`
                });

                console.log('Fallback payment link created:', paymentResult.checkout_url);
                console.log('Note: Cannot add Kommo note without lead ID');

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

            // Add payment link note to the lead
            try {
                const noteText = `✅ Payment Link Created\n\n` +
                    `Amount: ${paymentAmount} GEL\n` +
                    `Payment URL: ${paymentResult.checkout_url}\n\n` +
                    `Click to pay: ${paymentResult.checkout_url}`;

                await this.kommoApi.createNote(leadId, noteText);
                console.log('Payment link note added to the lead');
            } catch (noteError) {
                console.error('Failed to add payment link note:', noteError.message);
            }

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

                // Try to add note about error
                if (leadId) { // Only add error note if we have a valid lead ID
                    try {
                        const noteText = `⚠️ Payment Link (Error)\n\n` +
                            `Error: ${error.message}\n` +
                            `Payment URL: ${paymentResult.checkout_url}\n\n` +
                            `Click to pay: ${paymentResult.checkout_url}`;

                        await this.kommoApi.createNote(leadId, noteText);
                        console.log('Error note added');
                    } catch (noteError) {
                        console.error('Failed to add error note:', noteError.message);
                    }
                } else {
                    console.log('Skipping error note - no valid lead ID');
                }

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
            // Попробуем разные варианты парсинга URL-encoded данных
            const params = new URLSearchParams(webhookBody);

            // Вариант 1: leads[add][0][id]
            let leadId = params.get('leads[add][0][id]');
            if (leadId) return parseInt(leadId);

            // Вариант 2: leads%5Badd%5D%5B0%5D%5Bid%5D (URL-encoded)
            leadId = params.get('leads%5Badd%5D%5B0%5D%5Bid%5D');
            if (leadId) return parseInt(leadId);

            // Вариант 3: leads_add_0_id (альтернативный формат)
            leadId = params.get('leads_add_0_id');
            if (leadId) return parseInt(leadId);
        }

        // Дополнительные проверки
        const leadId = this.findLeadIdInObject(webhookBody?.leads);
        if (leadId) return leadId;

        console.error('Lead ID not found in webhook:', JSON.stringify(webhookBody, null, 2));
        return null;
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

    verifySignature(rawBody, signature) {
        // TODO: Implement proper signature verification
        // For now just log and return true
        console.log('Webhook signature verification:', signature);
        return true;
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
