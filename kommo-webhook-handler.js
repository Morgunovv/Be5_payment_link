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
            // Если тело пришло в формате form-urlencoded, парсим его
            if (webhookData.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
                console.log('Parsing form-urlencoded body');

                if (typeof webhookData.rawBody === 'string') {
                    try {
                        const parsed = {};
                        const params = new URLSearchParams(webhookData.rawBody);

                        // Логируем все параметры для диагностики
                        console.log('Raw URL params:', Array.from(params.entries()));

                        for (const [key, value] of params.entries()) {
                            parsed[key] = value;
                            // Специальная обработка для [object Object]
                            if (key.includes('[object Object]')) {
                                try {
                                    const jsonValue = JSON.parse(value);
                                    Object.assign(parsed, jsonValue);
                                } catch (e) {
                                    console.log('Failed to parse [object Object] value');
                                }
                            }
                        }
                        webhookData.body = parsed;
                    } catch (e) {
                        console.error('Error parsing form-urlencoded:', e);
                        webhookData.body = { error: 'Failed to parse form data' };
                    }
                } else {
                    console.log('rawBody is not a string:', typeof webhookData.rawBody);
                }
            }

            // Сохраняем сырые данные вебхука
            const saveTimestamp = timestamp.replace(/:/g, '-');
            const webhookFile = path.join(this.webhooksDir, `kommo-${saveTimestamp}.json`);
            fs.writeFileSync(webhookFile, JSON.stringify(webhookData, null, 2));
            console.log('Webhook data saved to:', webhookFile);

            // Извлекаем lead ID
            const leadId = this.extractLeadId(webhookData.body);
            console.log(`Extracted lead ID: ${leadId || 'Not found'}`);

            if (!leadId) {
                return await this.createFallbackPayment();
            }

            // Создаем платежную ссылку
            const paymentResult = await this.paymentService.createPaymentLink({
                amount: 0,
                description: `Payment for deal #${leadId}`,
                callback_url: `${process.env.BASE_URL}/payment-callback`
            });

            // Добавляем заметку в Kommo
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

        // Проверяем все возможные варианты структуры leads
        if (webhookBody?.leads) {
            const leadsObj = webhookBody.leads;
            for (const key in leadsObj) {
                if (Array.isArray(leadsObj[key]) && leadsObj[key].length > 0 && leadsObj[key][0].id) {
                    return leadsObj[key][0].id;
                }
            }
        }

        // Проверяем альтернативные форматы
        const leadId = webhookBody?.lead_id ||
            webhookBody?.id ||
            webhookBody?.lead?.id;

        if (leadId) return parseInt(leadId);

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
