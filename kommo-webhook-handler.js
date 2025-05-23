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
            console.log('Lead data:', JSON.stringify(leadData, null, 2));

            // Извлекаем суммы из полей (умножаем на 100 для перевода в копейки/центы)
            const salesValue = Math.round(parseFloat(leadData.price || 0) * 100);
            const customFieldValue = Math.round(parseFloat(leadData.custom_fields_values?.find(f => f.field_id === 888918)?.values[0]?.value || 0) * 100);
            const totalAmount = salesValue + customFieldValue;

            // Получаем название компании (из встроенных компаний или кастомных полей)
            let companyName = 'Unknown Company';

            // Проверяем встроенные компании
            if (leadData._embedded?.companies?.length > 0) {
                companyName = leadData._embedded.companies[0].name;
                console.log('Got company name from embedded companies:', companyName);
            }
            // Проверяем кастомные поля
            else {
                const companyField = leadData.custom_fields_values?.find(f =>
                    [889650, 'name'].includes(f.field_id?.toString()));
                if (companyField?.values?.[0]?.value) {
                    companyName = companyField.values[0].value;
                    console.log('Got company name from custom field:', companyName);
                }
            }

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
            if (paymentData.status === 'success') {
                // Получаем leadId из order_id если не пришел в paymentData
                const leadId = paymentData.leadId ||
                    (paymentData.order_id?.startsWith('deal_') ?
                        parseInt(paymentData.order_id.split('_')[1]) : null);

                if (leadId) {
                    console.log(`Creating success note for deal ${leadId}`);
                    const noteText = `Payment successful\n` +
                        `Amount: ${paymentData.actual_amount / 100} ${paymentData.currency}\n` +
                        `Transaction ID: ${paymentData.payment_id}`;

                    try {
                        const noteResult = await this.kommoApi.createNote(leadId, noteText);
                        console.log('Success note added to deal', leadId, 'Note ID:', noteResult.id);
                    } catch (noteError) {
                        console.error('Failed to create payment note:', noteError.response?.data || noteError.message);
                        // Попробуем еще раз через 5 секунд
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        try {
                            const retryResult = await this.kommoApi.createNote(leadId, noteText);
                            console.log('Successfully added note on retry:', retryResult.id);
                        } catch (retryError) {
                            console.error('Failed to create note on retry:', retryError.message);
                        }
                    }
                } else {
                    console.warn('No leadId found in payment callback');
                }
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
