const KommoAPI = require('./kommo-api');
const TbcPaymentService = require('./tbc-payment-service');
const dotenv = require('dotenv');
dotenv.config();

async function testKommoAPI(leadId) {
    const paymentService = new TbcPaymentService();
    let companyData = null;
    try {
        const api = new KommoAPI();
        console.log('Fetching lead data...');
        const leadData = await api.getLead(leadId);
        console.log('Lead Data:', JSON.stringify(leadData, null, 2));

        if (leadData._embedded?.contacts) {
            console.log('\nFetching contact details...');
            const contactId = leadData._embedded.contacts[0].id;
            const contactData = await api.getContact(contactId);
            console.log('Contact Data:', JSON.stringify(contactData, null, 2));
        }

        if (leadData._embedded?.companies) {
            console.log('\nFetching company details...');
            const companyId = leadData._embedded.companies[0].id;
            companyData = await api.getCompany(companyId);
            console.log('Company Data:', JSON.stringify(companyData, null, 2));
        }

        console.log('\nCreating payment link...');

        // Calculate total amount with fallbacks
        const baseAmount = leadData.price || 0;
        const additionalAmount = parseInt(
            leadData.custom_fields_values?.find(f => f.field_id === 888918)?.values[0]?.value || 0
        );
        const totalAmount = (baseAmount + additionalAmount) * 100; // Convert to cents

        // Get company name with fallback
        let companyName = 'Unknown Company';
        if (companyData && companyData.name) {
            companyName = companyData.name;
        } else if (leadData._embedded?.companies?.[0]?.name) {
            companyName = leadData._embedded.companies[0].name;
        }

        const paymentRequest = {
            amount: totalAmount,
            description: `Payment for ${companyName} (deal #${leadId})`,
            callback_url: `${process.env.BASE_URL}/payment-callback`,
            order_id: `deal_${leadId}`
        };

        const paymentResult = await paymentService.createPaymentLink(paymentRequest);
        console.log('Payment Link:', paymentResult.checkout_url);
        console.log('Payment ID:', paymentResult.payment_id);

        // Add note with payment link to Kommo
        await api.createNote(leadId, `Payment link created: ${paymentResult.checkout_url}`);

        // Update payment ID custom field (as text)
        await api.updateLeadCustomField(leadId, 980726, paymentResult.payment_id.toString(), 'text');

        console.log('\nTest completed successfully');
        return paymentResult;
    } catch (error) {
        console.error('API Test Error:', error);
        throw error;
    }
}

testKommoAPI(3249152)
    .then(result => console.log('Payment Link Created:', result.checkout_url))
    .catch(err => console.error('Test Failed:', err));
