// A Mongoose global plugin (applied once, in lib/db.js, before any model is
// compiled) that times every query and aggregate call on every model —
// diagnostic only, adds a pre/post hook pair, never touches the query
// itself or its results.
const { recordQueryTiming } = require("./perfMonitor");

const QUERY_OPS = [
  "find",
  "findOne",
  "findOneAndUpdate",
  "findOneAndDelete",
  "findOneAndRemove",
  "updateOne",
  "updateMany",
  "deleteOne",
  "deleteMany",
  "countDocuments",
  "distinct",
];

function mongoTimingPlugin(schema) {
  schema.pre(QUERY_OPS, function preTiming() {
    this._perfStart = process.hrtime.bigint();
  });
  schema.post(QUERY_OPS, function postTiming() {
    if (!this._perfStart) return;
    const durationMs = Number(process.hrtime.bigint() - this._perfStart) / 1e6;
    recordQueryTiming(this.model?.modelName || "Unknown", this.op || "query", durationMs);
  });

  schema.pre("aggregate", function preAggTiming() {
    this._perfStart = process.hrtime.bigint();
  });
  schema.post("aggregate", function postAggTiming() {
    if (!this._perfStart) return;
    const durationMs = Number(process.hrtime.bigint() - this._perfStart) / 1e6;
    recordQueryTiming(this._model?.modelName || "Unknown", "aggregate", durationMs);
  });

  // Document-level middleware, not query middleware — covers .save() and,
  // since Model.create() calls .save() on each document internally, bulk
  // creates too (each document logged individually).
  schema.pre("save", function preSaveTiming() {
    this._perfStart = process.hrtime.bigint();
  });
  schema.post("save", function postSaveTiming() {
    if (!this._perfStart) return;
    const durationMs = Number(process.hrtime.bigint() - this._perfStart) / 1e6;
    recordQueryTiming(this.constructor?.modelName || "Unknown", "save", durationMs);
  });
}

module.exports = mongoTimingPlugin;
