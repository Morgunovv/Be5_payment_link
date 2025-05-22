const axios = require('axios');
const fs = require('fs');
const path = require('path');

class KommoWebhookHandler {
    constructor(options = {}) {
        this.token = options.token || process.env.KOMMO_API_TOKEN;
        this.subdomain = options.subdomain || process.env.KOMMO_SUBDOMAIN;
        this.webhooksDir = options.webhooksDir || path.join(__dirname, 'webhooks');
        this.initWebhooksDir();
    }

    initWebhooksDir() {
        if (!fs.existsSync(this.webhooksDir)) {
            fs.mkdirSync(this.webhooksDir, { recursive: true });
        }
    }

    async processWebhook(webhookData) {
        const timestamp = new Date().toISOString();
        const saveTimestamp = timestamp.replace(/:/g, '-');
        const webhookFile = path.join(this.webhooksDir, `kommo-${saveTimestamp}.json`);

        try {
            // Save raw webhook data
            fs.writeFileSync(webhookFile, JSON.stringify(webhookData, null, 2));

            // Extract lead ID from different webhook formats
            const leadId = this.extractLeadId(webhookData.body);

            if (!leadId) {
                throw new Error('No lead ID found in webhook data');
            }

            // Get deal data from Kommo API
            const dealData = await this.getDealData(leadId);

            return {
                success: true,
                leadId,
                dealData,
                webhookFile
            };
        } catch (error) {
            console.error('Webhook processing error:', error);
            return {
                success: false,
                error: error.message,
                webhookFile
            };
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
