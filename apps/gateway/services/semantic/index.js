"use strict";

const loader = require("./loader");
const nl2sql = require("./nl2sql");
const validator = require("./validator");

module.exports = {
  ...loader,
  queryDynamic: nl2sql.queryDynamic,
  generateSQL: nl2sql.generateSQL,
  validateSQL: validator.validateSQL,
};
