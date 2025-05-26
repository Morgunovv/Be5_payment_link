const { Sequelize } = require('sequelize');

const sequelize = new Sequelize({
    database: 'railway',
    username: 'postgres',
    password: 'dsjVErAhgfGUQvXQyMbHDjmUtXJTGViQ',
    host: 'maglev.proxy.rlwy.net',
    port: 48985,
    dialect: 'postgres',
    logging: console.log
});

async function checkDatabase() {
    try {
        console.log('Testing database connection...');
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');

        console.log('\nChecking payment_deal_relations table:');
        const [results] = await sequelize.query('SELECT * FROM payment_deal_relations LIMIT 5');
        console.log('Found records:', results.length);
        console.log(results);

        console.log('\nChecking table structure:');
        const [columns] = await sequelize.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'payment_deal_relations'
        `);
        console.log(columns);
    } catch (error) {
        console.error('Database check failed:', error);
    } finally {
        await sequelize.close();
    }
}

checkDatabase();
