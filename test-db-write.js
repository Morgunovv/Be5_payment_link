const { Sequelize, DataTypes } = require('sequelize');
require('dotenv').config();

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
const TestModel = sequelize.define('TestModel', {
    test_field: {
        type: DataTypes.STRING,
        allowNull: false
    }
}, {
    tableName: 'test_table',
    timestamps: false
});

async function testWrite() {
    try {
        // Создаем таблицу если ее нет
        await TestModel.sync({ force: true });
        console.log('Table created successfully');

        // Тестовая запись
        const testRecord = await TestModel.create({
            test_field: 'test_value_' + Date.now()
        });
        console.log('Record created:', testRecord.toJSON());

        // Проверяем что запись сохранилась
        const foundRecord = await TestModel.findOne({
            where: { id: testRecord.id }
        });
        console.log('Found record:', foundRecord ? foundRecord.toJSON() : 'Not found');

        return {
            success: true,
            record: foundRecord
        };
    } catch (error) {
        console.error('Test failed:', error);
        return {
            success: false,
            error: error.message
        };
    } finally {
        await sequelize.close();
    }
}

testWrite();
