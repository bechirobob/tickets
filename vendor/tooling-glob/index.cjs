'use strict';
module.exports = require('./adapter-factory.cjs')(require('glob').globSync);
