const { Sequelize, DataTypes } = require('sequelize');

// Подключение к базе данных
const sequelize = new Sequelize({
    database: 'railway',
    username: 'postgres',
    password: 'dsjVErAhgfGUQvXQyMbHDjmUtXJTGViQ',
    host: 'maglev.proxy.rlwy.net',
    port: 48985,
    dialect: 'postgres',
    logging: console.log
});

// Модель для тестирования
const PaymentDealRelation = sequelize.define('PaymentDealRelation', {
    payment_id: {
        type: DataTypes.STRING,
        primaryKey: true
    },
    deal_id: {
        type: DataTypes.INTEGER,
        allowNull: false
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: Sequelize.NOW
    }
}, {
    tableName: 'payment_deal_relations',
    timestamps: false
});

async function testInsert() {
    try {
        const testData = {
            payment_id: 'test_payment_' + Date.now(),
            deal_id: Math.floor(Math.random() * 10000)
        };

        console.log('Inserting test record:', testData);

        const result = await PaymentDealRelation.create(testData);
        console.log('Insert result:', result.toJSON());

        // Проверим что запись сохранилась
        const found = await PaymentDealRelation.findOne({
            where: { payment_id: testData.payment_id }
        });
        console.log('Found record:', found ? found.toJSON() : 'Not found');

        return {
            success: true,
            record: found
        };
    } catch (error) {
        console.error('Insert failed:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        await sequelize.close();
    }
}

testInsert();
