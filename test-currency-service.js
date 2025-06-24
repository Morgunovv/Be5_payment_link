const currencyService = require('./services/currency-service');

async function testCurrencyService() {
    try {
        console.log('Testing currency service...');
        const rate = await currencyService.getGelToUsdRate();
        console.log(`Current GEL/USD rate: ${rate}`);
    } catch (error) {
        console.error('Test failed:', error.message);
    }
}

testCurrencyService();
