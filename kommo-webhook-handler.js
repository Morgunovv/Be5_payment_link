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

    async processWebhook(webhookBody) {
        console.log('\n==== KOMMO WEBHOOK PROCESSING STARTED ====');
        const timestamp = new Date().toISOString();
        console.log(`Processing started at: ${timestamp}`);

        try {
            // Получаем данные из тела запроса
            const webhookData = {
                body: webhookBody,
                headers: {}
            };
            console.log('Full webhook data:', JSON.stringify(webhookData, null, 2));
            console.log('Body type:', typeof webhookData.body);
            console.log('Headers:', webhookData.headers);

            if (webhookData.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
                console.log('Parsing form-urlencoded body');

                try {
                    let rawBodyStr;
                    if (typeof webhookData.rawBody === 'string') {
                        rawBodyStr = webhookData.rawBody;
                    } else if (Buffer.isBuffer(webhookData.rawBody)) {
                        rawBodyStr = webhookData.rawBody.toString('utf8');
                    } else if (typeof webhookData.rawBody === 'object') {
                        // Попробуем преобразовать объект в строку
                        rawBodyStr = Object.entries(webhookData.rawBody)
                            .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
                            .join('&');
                    } else {
                        rawBodyStr = String(webhookData.rawBody);
                    }

                    console.log('Raw body string:', rawBodyStr);

                    const parsed = {};
                    const params = new URLSearchParams(rawBodyStr);

                    // Логируем все параметры для диагностики
                    console.log('Parsed URL params:', Array.from(params.entries()));

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

            // Получаем данные сделки из Kommo
            const leadData = await this.kommoApi.getLead(leadId);

            // Извлекаем суммы из полей (умножаем на 100 для перевода в копейки/центы)
            const salesValue = Math.round(parseFloat(leadData.price || 0) * 100);
            const customFieldValue = Math.round(parseFloat(leadData.custom_fields_values?.find(f => f.field_id === 888918)?.values[0]?.value || 0) * 100);
            const totalAmount = salesValue + customFieldValue;

            // Получаем название компании (из поля компании или из поля сделки 889650)
            const companyName = leadData._embedded?.companies?.[0]?.name ||
                leadData.custom_fields_values?.find(f => f.field_id === 889650)?.values[0]?.value ||
                'Unknown Company';

            // Создаем платежную ссылку
            const paymentResult = await this.paymentService.createPaymentLink({
                amount: totalAmount,
                description: `Payment for ${companyName} (deal #${leadId})`,
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
        console.log('Searching for lead ID in:', JSON.stringify(webhookBody, null, 2));

        // Проверяем разные уровни вложенности
        const dataToCheck = [
            webhookBody, // Проверяем корневой уровень
            webhookBody?.body, // Проверяем вложенный body
            webhookBody?.data, // Проверяем вложенный data
            webhookBody?.result // Проверяем вложенный result
        ].filter(Boolean);

        // Проверяем все возможные пути к lead ID для каждого уровня
        const possiblePaths = [
            'leads.add[0].id',
            'leads.status[0].id',
            '_embedded.leads[0].id',
            'lead_id',
            'id',
            'lead.id'
        ];

        for (const data of dataToCheck) {
            for (const path of possiblePaths) {
                try {
                    const value = path.split('.').reduce((obj, key) => {
                        const arrayMatch = key.match(/(\w+)\[(\d+)\]/);
                        if (arrayMatch) {
                            const arrKey = arrayMatch[1];
                            const arrIndex = arrayMatch[2];
                            return obj?.[arrKey]?.[arrIndex];
                        }
                        return obj?.[key];
                    }, data);

                    if (value) {
                        console.log(`Found lead ID in path '${path}': ${value}`);
                        return parseInt(value);
                    }
                } catch (e) {
                    console.log(`Error checking path '${path}':`, e.message);
                }
            }

            // Дополнительная проверка для вложенных leads
            if (data?.leads) {
                console.log('Checking nested leads structure');
                const leadsObj = data.leads;
                for (const key in leadsObj) {
                    if (Array.isArray(leadsObj[key]) && leadsObj[key].length > 0) {
                        const firstItem = leadsObj[key][0];
                        if (firstItem.id) {
                            console.log(`Found lead ID in leads.${key}[0].id: ${firstItem.id}`);
                            return parseInt(firstItem.id);
                        }
                    }
                }
            }
        }

        // Если ничего не нашли, проверяем сырые данные
        if (webhookBody?.rawBody) {
            try {
                const rawStr = typeof webhookBody.rawBody === 'string' ? webhookBody.rawBody :
                    Buffer.isBuffer(webhookBody.rawBody) ? webhookBody.rawBody.toString() :
                        JSON.stringify(webhookBody.rawBody);

                // Ищем ID в сырых данных
                const idMatch = rawStr.match(/leads%5Badd%5D%5B0%5D%5Bid%5D=(\d+)/) ||
                    rawStr.match(/leads\[add\]\[0\]\[id\]=(\d+)/) ||
                    rawStr.match(/id=(\d+)/);

                if (idMatch && idMatch[1]) {
                    console.log(`Found lead ID in raw body: ${idMatch[1]}`);
                    return parseInt(idMatch[1]);
                }
            } catch (e) {
                console.log('Error parsing raw body:', e.message);
            }
        }

        console.warn('No lead ID found in webhook data');
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

    async processPaymentCallback(paymentData) {
        console.log('Payment callback received:', paymentData);

        try {
            if (paymentData.status === 'success' && paymentData.leadId) {
                await this.kommoApi.createNote(
                    paymentData.leadId,
                    'Payed successfully'
                );
                console.log('Success note added to deal', paymentData.leadId);
            }
            return { success: true };
        } catch (error) {
            console.error('Payment callback processing error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = KommoWebhookHandler;
