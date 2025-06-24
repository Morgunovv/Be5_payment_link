const axios = require('axios');
const NodeCache = require('node-cache');

// Кэш курса на 1 час
const currencyCache = new NodeCache({ stdTTL: 3600 });

class CurrencyService {
    constructor() {
        this.apiUrl = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json';
    }

    async getGelToUsdRate() {
        // Проверяем кэш
        const cachedRate = currencyCache.get('gel_usd_rate');
        if (cachedRate) {
            return cachedRate;
        }

        try {
            const response = await axios.get(this.apiUrl);

            // Находим USD в ответе API
            const currencies = response.data[0]?.currencies;
            const usdRate = currencies?.find(c => c.code === 'USD')?.rate;

            if (!usdRate) {
                throw new Error('USD rate not found in API response');
            }

            // Сохраняем в кэш и возвращаем
            currencyCache.set('gel_usd_rate', usdRate);
            return usdRate;

        } catch (error) {
            console.error('Error fetching currency rate:', error.message);
            throw error;
        }
    }
}

module.exports = new CurrencyService();
