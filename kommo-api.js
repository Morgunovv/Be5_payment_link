const axios = require('axios');
const dotenv = require('dotenv');
const path = require('path');
const FormData = require('form-data');
const fs = require('fs');

// Load environment variables
dotenv.config();

class KommoAPI {
    constructor(token, subdomain) {
        this.token = token || process.env.KOMMO_API_TOKEN;
        this.subdomain = subdomain || process.env.KOMMO_SUBDOMAIN || 'exceltic';
        this.baseUrl = `https://${this.subdomain}.kommo.com/api/v4`;
    }

    getHeaders() {
        console.log('Using token:', this.token ? '***REDACTED***' : 'NOT SET');
        console.log('Using subdomain:', this.subdomain);
        return {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json'
        };
    }

    async getLead(leadId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/leads/${leadId}`,
                { headers: this.getHeaders() }
            );
            return response.data;
        } catch (error) {
            console.error(`Error getting lead ${leadId}:`, error.message);
            throw error;
        }
    }

    async getContact(contactId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/contacts/${contactId}`,
                { headers: this.getHeaders() }
            );
            return response.data;
        } catch (error) {
            console.error(`Error getting contact ${contactId}:`, error.message);
            throw error;
        }
    }

    async getCompany(companyId) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/companies/${companyId}`,
                { headers: this.getHeaders() }
            );
            return response.data;
        } catch (error) {
            console.error(`Error getting company ${companyId}:`, error.message);
            throw error;
        }
    }

    async getInvoiceData(leadId) {
        try {
            const leadData = await this.getLead(leadId);
            const contacts = await this.getLeadContacts(leadId);
            const companies = await this.getLeadCompanies(leadId);

            return {
                lead: leadData,
                contacts: contacts,
                companies: companies
            };
        } catch (error) {
            console.error(`Error getting invoice data for lead ${leadId}:`, error.message);
            throw error;
        }
    }
}

module.exports = KommoAPI;
