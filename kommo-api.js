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
        this.subdomain = subdomain || process.env.KOMMO_SUBDOMAIN;
        if (!this.subdomain) {
            throw new Error('KOMMO_SUBDOMAIN is not defined in environment variables');
        }
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

    /**
     * Create a note for a lead
     * @param {string} leadId - ID of the lead
     * @param {string} text - Note text
     * @returns {Promise<Object>} - Note creation result
     */
    async updateLeadCustomField(leadId, fieldId, value) {
        try {
            const url = `${this.baseUrl}/leads/custom_fields/${fieldId}`;
            const requestData = {
                entity_type: 'leads',
                id: parseInt(leadId, 10),
                values: [{ value: value }]
            };

            console.log('Updating custom field:', {
                url,
                leadId,
                fieldId,
                value,
                headers: this.getHeaders()
            });

            const response = await axios.patch(
                url,
                requestData,
                {
                    headers: {
                        ...this.getHeaders(),
                        'Accept': 'application/hal+json'
                    }
                }
            );

            console.log('Custom field update response:', {
                status: response.status,
                data: response.data
            });

            return response.data;
        } catch (error) {
            console.error(`Error updating field ${fieldId} for lead ${leadId}:`, error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', error.response.data);
            }
            throw error;
        }
    }

    async searchDealsByCustomField(fieldId, value) {
        try {
            const response = await axios.get(
                `${this.baseUrl}/leads`,
                {
                    headers: this.getHeaders(),
                    params: {
                        'filter[custom_fields_values][field_id]': fieldId,
                        'filter[custom_fields_values][values][0][value]': value
                    }
                }
            );
            return response.data._embedded?.leads || [];
        } catch (error) {
            console.error(`Error searching deals by field ${fieldId}:`, error.message);
            throw error;
        }
    }

    async updateLeadStatus(leadId, status) {
        try {
            const statusId = status === 'paid' ? 84002755 : 84002756; // Пример ID статусов
            const requestData = {
                update: [{
                    id: parseInt(leadId, 10),
                    status_id: statusId
                }]
            };

            const response = await axios.patch(
                `${this.baseUrl}/leads`,
                requestData,
                { headers: this.getHeaders() }
            );
            return response.data;
        } catch (error) {
            console.error(`Error updating status for lead ${leadId}:`, error.message);
            throw error;
        }
    }

    async createNote(leadId, text) {
        try {
            const requestData = {
                add: {
                    entity_id: parseInt(leadId, 10),
                    entity_type: 'leads',
                    note_type: 'common',
                    params: {
                        text: text
                    }
                }
            };

            const response = await axios.post(
                `${this.baseUrl}/leads/notes`,
                requestData,
                { headers: this.getHeaders() }
            );

            const noteId = response.data._embedded?.notes?.[0]?.id;
            if (!noteId) {
                throw new Error('Failed to get note ID from response');
            }

            return {
                success: true,
                noteId: noteId,
                response: response.data
            };
        } catch (error) {
            console.error(`Error creating note for lead ${leadId}:`, error.message);
            if (error.response) {
                console.error('Response status:', error.response.status);
                console.error('Response data:', error.response.data);
            }
            throw error;
        }
    }
}

module.exports = KommoAPI;
