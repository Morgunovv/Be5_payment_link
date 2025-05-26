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

            // Создаем платежную ссылку с полным логированием
            const paymentRequest = {
                amount: totalAmount,
                description: `Payment for ${companyName} (deal #${leadId})`,
                callback_url: `${process.env.BASE_URL}/payment-callback`,
                order_id: `deal_${leadId}` // Используем реальный ID сделки вместо timestamp
            };

            console.log('Creating payment link with request:', JSON.stringify(paymentRequest, null, 2));
            const paymentResult = await this.paymentService.createPaymentLink(paymentRequest);
            console.log('Payment API response:', JSON.stringify(paymentResult, null, 2));

            // Добавляем заметку и сохраняем payment_id в поле 980416
            if (this.token && this.subdomain) {
                try {
                    const noteText = `Payment Link Created\n\n` +
                        `Payment URL: ${paymentResult.checkout_url}\n` +
                        `Payment ID: ${paymentResult.payment_id}`;

                    // Создаем заметку
                    await this.kommoApi.createNote(leadId, noteText);

                    // Проверяем существование поля 980726 в сделке
                    const customFieldExists = leadData.custom_fields_values?.some(f => f.field_id === 980726);
                    if (!customFieldExists) {
                        console.error(`Custom field 980726 not found in deal ${leadId}. Cannot save payment_id.`);
                        throw new Error(`Payment ID field (980726) not found in deal ${leadId}`);
                    }

                    // Обновляем поле сделки с payment_id с улучшенным логированием
                    try {
                        console.log(`Attempting to save payment_id ${paymentResult.payment_id} to deal ${leadId} field 980726`);
                        const updateResult = await this.kommoApi.updateLeadCustomField(
                            leadId,
                            980726,
                            paymentResult.payment_id.toString()
                        );

                        // Проверяем, что поле действительно обновилось
                        const updatedLead = await this.kommoApi.getLead(leadId);
                        const savedPaymentId = updatedLead.custom_fields_values?.find(f => f.field_id === 980726)?.values[0]?.value;

                        if (savedPaymentId !== paymentResult.payment_id.toString()) {
                            throw new Error(`Payment ID was not saved correctly. Expected: ${paymentResult.payment_id}, Actual: ${savedPaymentId}`);
                        }

                        console.log('Field update verified successfully:', JSON.stringify(updateResult, null, 2));
                        console.log(`Successfully saved payment_id to deal ${leadId}`);
                    } catch (fieldError) {
                        console.error('Failed to update custom field:', fieldError);
                        // Retry after 5 seconds
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        try {
                            console.log('Retrying field update...');
                            const retryResult = await this.kommoApi.updateLeadCustomField(
                                leadId,
                                980726,
                                paymentResult.payment_id.toString()
                            );

                            // Проверяем результат повторной попытки
                            const retryLead = await this.kommoApi.getLead(leadId);
                            const retryPaymentId = retryLead.custom_fields_values?.find(f => f.field_id === 980726)?.values[0]?.value;

                            if (retryPaymentId !== paymentResult.payment_id.toString()) {
                                throw new Error(`Payment ID was not saved correctly on retry. Expected: ${paymentResult.payment_id}, Actual: ${retryPaymentId}`);
                            }

                            console.log('Successfully updated field on retry:', JSON.stringify(retryResult, null, 2));
                        } catch (retryError) {
                            console.error('Failed to update field on retry:', retryError);
                            throw retryError;
                        }
                    }
                } catch (error) {
                    console.error('Failed to update deal:', error);
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
        console.log('==== PAYMENT CALLBACK DETAILS ====');
        console.log('Full payment data:', JSON.stringify(paymentData, null, 2));

        try {
            // Validate payment data
            if (!paymentData || !paymentData.payment_id) {
                throw new Error('Invalid payment data - missing payment_id');
            }

            // Log all status fields for debugging
            console.log('Payment status fields:', {
                status: paymentData.status,
                response_status: paymentData.response_status,
                order_status: paymentData.order_status
            });

            // Process if any status field indicates success
            const isSuccess = paymentData.response_status === 'success' ||
                paymentData.order_status === 'approved' ||
                paymentData.status === 'success';

            if (!isSuccess) {
                console.log('Payment not successful, status fields:', {
                    status: paymentData.status,
                    response_status: paymentData.response_status,
                    order_status: paymentData.order_status
                });
                return {
                    success: false,
                    error: `Payment not successful. Status: ${paymentData.status || 'undefined'}, Response: ${paymentData.response_status || 'undefined'}, Order: ${paymentData.order_status || 'undefined'}`
                };
            }

            let leadId = null;
            const paymentId = paymentData.payment_id.toString();

            // 1. Try to find deal by payment_id in custom field 980726
            console.log(`Searching deal with payment_id ${paymentId} in field 980726`);
            const deals = await this.kommoApi.searchDealsByCustomField(980726, paymentId);

            if (deals.length > 0) {
                leadId = deals[0].id;
                console.log(`Found deal ${leadId} by payment_id ${paymentId}`);
            }

            // 2. Try to extract from order_id if not found
            if (!leadId && paymentData.order_id?.startsWith('deal_')) {
                leadId = parseInt(paymentData.order_id.split('_')[1]);
                console.log(`Extracted leadId ${leadId} from order_id`);
            }

            if (!leadId) {
                throw new Error(`No lead found for payment ${paymentId}`);
            }

            // Get full deal data
            const leadData = await this.kommoApi.getLead(leadId);
            console.log('Deal data before update:', JSON.stringify(leadData, null, 2));

            // Create payment note
            const noteText = `Payment successful\n` +
                `Amount: ${paymentData.actual_amount / 100} ${paymentData.currency}\n` +
                `Transaction ID: ${paymentId}\n` +
                `Card: ${paymentData.masked_card || 'N/A'}\n` +
                `Date: ${new Date().toISOString()}`;

            const noteResult = await this.kommoApi.createNote(leadId, noteText);
            console.log('Success note added to deal', leadId, 'Note ID:', noteResult.id);

            // Update deal status to WON (142)
            await this.kommoApi.updateLeadStatus(leadId, 'won');
            console.log(`Deal ${leadId} status updated to WON`);

            // Verify status update
            const updatedLead = await this.kommoApi.getLead(leadId);
            if (updatedLead.status_id !== 142) {
                throw new Error(`Failed to update deal status to WON. Current status: ${updatedLead.status_id}`);
            }

            return {
                success: true,
                leadId,
                paymentId,
                amount: paymentData.actual_amount,
                currency: paymentData.currency
            };
        } catch (error) {
            console.error('==== PAYMENT PROCESSING ERROR ====');
            console.error('Error details:', {
                message: error.message,
                stack: error.stack,
                paymentData: paymentData
            });

            return {
                success: false,
                error: error.message,
                paymentId: paymentData?.payment_id,
                leadId: leadId || null
            };
        }
    }
}

module.exports = KommoWebhookHandler;
