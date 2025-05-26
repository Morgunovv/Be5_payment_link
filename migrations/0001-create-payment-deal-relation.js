'use strict';

module.exports = {
    async up(queryInterface, Sequelize) {
        await queryInterface.createTable('payment_deal_relations', {
            payment_id: {
                type: Sequelize.STRING,
                primaryKey: true,
                allowNull: false
            },
            deal_id: {
                type: Sequelize.INTEGER,
                allowNull: false
            },
            created_at: {
                type: Sequelize.DATE,
                defaultValue: Sequelize.fn('now')
            }
        });

        await queryInterface.addIndex('payment_deal_relations', ['deal_id']);
        await queryInterface.addIndex('payment_deal_relations', ['created_at']);
    },

    async down(queryInterface) {
        await queryInterface.dropTable('payment_deal_relations');
    }
};
