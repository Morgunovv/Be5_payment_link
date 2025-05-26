'use strict';

const { Model } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    class PaymentDealRelation extends Model {
        static associate(models) {
            // associations can be defined here
        }
    }
    PaymentDealRelation.init({
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
            defaultValue: DataTypes.NOW
        }
    }, {
        sequelize,
        modelName: 'PaymentDealRelation',
        tableName: 'payment_deal_relations',
        timestamps: false
    });
    return PaymentDealRelation;
};
