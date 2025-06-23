const axios = require('axios');
const crypto = require('crypto');

class TbcPaymentService {
    constructor() {
        this.apiBaseUrl = process.env.TBC_API_URL || 'https://pay.flitt.com/api';
        this.apiKey = process.env.TBC_API_KEY;
        this.merchantId = process.env.TBC_MERCHANT_ID;

        if (!this.apiKey || !this.merchantId) {
            throw new Error('TBC API credentials not configured');
        }
    }

    async createPayment(paymentData) {
        try {
            // Generate signature
            // Prepare parameters for signature
            // Include all request parameters in signature
            const params = {
                amount: paymentData.request.amount,
                currency: paymentData.request.currency,
                merchant_id: this.merchantId,
                order_desc: paymentData.request.order_desc,
                order_id: paymentData.request.order_id,
                response_url: paymentData.request.response_url,
                server_callback_url: paymentData.request.server_callback_url,
                version: paymentData.request.version
            };

            // Sort parameters alphabetically by key and filter out empty values
            const sortedKeys = Object.keys(params).sort();
            const sortedValues = sortedKeys
                .map(key => String(params[key])) // Convert all values to strings
                .filter(value => value !== '' && value !== 'null' && value !== 'undefined');

            // Join with | and put secret key first
            const signatureString = [
                process.env.TBC_MERCHANT_SECRET,
                ...sortedValues
            ].join('|');

            console.log('Signature string:', signatureString);

            const signature = crypto.createHash('sha1')
                .update(signatureString, 'utf8') // Explicit utf8 encoding
                .digest('hex')
                .toLowerCase(); // Ensure lowercase

            console.log('Generated signature:', signature);

            // Add signature to request
            paymentData.request.signature = signature;

            console.log('Sending request to TBC API:', {
                url: `${this.apiBaseUrl}/checkout/url`,
                data: paymentData,
                headers: this.getApiHeaders()
            });

            const response = await axios.post(
                `${this.apiBaseUrl}/checkout/url`,
                paymentData,
                { headers: this.getApiHeaders() }
            );

            console.log('TBC API response:', {
                status: response.status,
                data: response.data
            });
            return response.data;
        } catch (error) {
            console.error('Payment creation error:', error.response?.data || error.message);
            throw error;
        }
    }

    async createInvoice(invoiceData) {
        try {
            const response = await axios.post(
                `${this.apiBaseUrl}/invoices`,
                invoiceData,
                { headers: this.getApiHeaders() }
            );
            return response.data;
        } catch (error) {
            console.error('Invoice creation error:', error.response?.data || error.message);
            throw error;
        }
    }

    async getPaymentStatus(paymentId) {
        try {
            const response = await axios.get(
                `${this.apiBaseUrl}/payments/${paymentId}`,
                { headers: this.getApiHeaders() }
            );
            return response.data;
        } catch (error) {
            console.error('Payment status error:', error.response?.data || error.message);
            throw error;
        }
    }

    async cancelPayment(paymentId) {
        try {
            const response = await axios.post(
                `${this.apiBaseUrl}/payments/${paymentId}/cancel`,
                {},
                { headers: this.getApiHeaders() }
            );
            return response.data;
        } catch (error) {
            console.error('Payment cancellation error:', error.response?.data || error.message);
            throw error;
        }
    }

    getApiHeaders() {
        return {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`
        };
    }

    generatePaymentLink(paymentId) {
        return `https://pay.flitt.com/pay/${paymentId}`;
    }

    async createPaymentLink(params) {
        // Calculate amount using formula: (Sale + 985221 + (888918 * 985181) * 1.18)
        const amount = (
            parseFloat(params.Sale || 0) +
            parseFloat(params['985221'] || 0) +
            (parseFloat(params['888918'] || 0) * parseFloat(params['985181'] || 0)) * 1.18
        ).toFixed(2);

        const paymentData = {
            request: {
                amount: amount,
                currency: 'GEL',
                merchant_id: this.merchantId,
                order_desc: params.description,
                order_id: params.order_id || `deal_${params.deal_id || Date.now()}`,
                response_url: "https://be5paymentlink-production.up.railway.app/payment-callback",
                server_callback_url: "https://be5paymentlink-production.up.railway.app/payment-callback",
                version: '1.0'
            }
        };

        const result = await this.createPayment(paymentData);
        return {
            checkout_url: result.response.checkout_url,
            payment_id: result.response.payment_id
        };
    }
}

module.exports = TbcPaymentService;
