"use strict";

const options = require("./options");
const panel = require("./panel");
const styleDrilldown = require("./styleDrilldown");

module.exports = {
  ...options,
  ...panel,
  ...styleDrilldown,
};
