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
    async getCustomFields(entityType = 'leads') {
        try {
            const response = await axios.get(
                `${this.baseUrl}/${entityType}/custom_fields`,
                { headers: this.getHeaders() }
            );
            return response.data._embedded?.custom_fields || [];
        } catch (error) {
            console.error(`Error getting ${entityType} custom fields:`, error.message);
            throw error;
        }
    }

    async updateLeadCustomField(leadId, fieldId, value) {
        try {
            // Get all custom fields to verify field exists
            const customFields = await this.getCustomFields();
            const targetField = customFields.find(f => f.id === fieldId);

            if (!targetField) {
                throw new Error(`Field ${fieldId} not found in custom fields`);
            }

            console.log('Target field details:', JSON.stringify(targetField, null, 2));

            // Get current lead data to check existing field properties
            const leadData = await this.getLead(leadId);

            // Find existing field to get its properties
            const existingField = leadData.custom_fields_values?.find(f => f.field_id === fieldId);

            // Prepare the field update in minimal format that works
            const requestData = {
                custom_fields_values: [{
                    field_id: fieldId,
                    values: [{
                        value: String(value)
                    }]
                }]
            };

            console.log('Full request data:', JSON.stringify(requestData, null, 2));

            console.log('Updating custom field:', {
                url: `${this.baseUrl}/leads/${leadId}`,
                requestData,
                headers: this.getHeaders()
            });

            const response = await axios.patch(
                `${this.baseUrl}/leads/${leadId}`,
                requestData,
                { headers: this.getHeaders() }
            );

            console.log('Custom field update response:', {
                status: response.status,
                data: response.data
            });

            return response.data._embedded?.leads?.[0];
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
        if (!this.token) {
            throw new Error('KOMMO_API_TOKEN is not set');
        }

        const params = {
            'filter[custom_fields_values][field_id]': fieldId,
            'filter[custom_fields_values][values][0][value]': value
        };

        console.log('Searching deals with params:', JSON.stringify(params, null, 2));

        let retries = 3;
        let lastError = null;

        while (retries > 0) {
            try {
                const response = await axios.get(
                    `${this.baseUrl}/leads`,
                    {
                        headers: this.getHeaders(),
                        params: params,
                        timeout: 10000
                    }
                );

                if (!response.data._embedded?.leads) {
                    console.log('No leads found in response');
                    return [];
                }

                console.log(`Found ${response.data._embedded.leads.length} deals`);
                return response.data._embedded.leads;

            } catch (error) {
                lastError = error;
                retries--;
                console.error(`Error searching deals (${retries} retries left):`, error.message);

                if (error.response) {
                    console.error('Response status:', error.response.status);
                    console.error('Response data:', error.response.data);
                }

                if (retries > 0) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
            }
        }

        throw lastError || new Error('Failed to search deals after retries');
    }

    async updateLeadStatus(leadId, status) {
        try {
            const statusId = status === 'won' ? 142 : 84002756; // WON (142) или другой статус
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
