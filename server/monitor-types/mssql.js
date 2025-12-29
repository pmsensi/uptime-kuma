const { MonitorType } = require("./monitor-type");
const { log, UP } = require("../../src/util");
const dayjs = require("dayjs");
const mssql = require("mssql");
const { ConditionVariable } = require("../monitor-conditions/variables");
const { defaultStringOperators } = require("../monitor-conditions/operators");
const { ConditionExpressionGroup } = require("../monitor-conditions/expression");
const { evaluateExpressionGroup } = require("../monitor-conditions/evaluator");

class MssqlMonitorType extends MonitorType {
    name = "sqlserver";

    supportsConditions = true;
    conditionVariables = [
        new ConditionVariable("result", defaultStringOperators),
    ];

    /**
     * @inheritdoc
     */
    async check(monitor, heartbeat, _server) {
        let startTime = dayjs().valueOf();

        let query = monitor.databaseQuery;
        // No query provided by user, use SELECT 1
        if (!query || (typeof query === "string" && query.trim() === "")) {
            query = "SELECT 1";
        }

        let result = await this.mssqlQuery(monitor.databaseConnectionString, query)
            .catch(error => {
                log.error("sqlserver", "Database query failed:", error.message);
                throw new Error(`Database connection/query failed: ${error.message}`);
            }).finally(() => {
                heartbeat.ping = dayjs().valueOf() - startTime;
            });

        const conditions = ConditionExpressionGroup.fromMonitor(monitor);
        let conditionsResult = true;
        const handleConditions = (data) => conditions ? evaluateExpressionGroup(conditions, data) : true;

        // Since result is now a single value, pass it directly to conditions
        conditionsResult = handleConditions({ result: String(result) });

        if (!conditionsResult) {
            throw new Error(`Query result did not meet the specified conditions (${result})`);
        }

        heartbeat.msg = "";
        heartbeat.status = UP;
    }

    /**
     * Run a query on MSSQL server
     * @param {string} connectionString The database connection string
     * @param {string} query The query to validate the database with
     * @returns {Promise<any>} Single value from the first column of the first row
     * @remarks Based on https://www.npmjs.com/package/mssql
     */
    async mssqlQuery(connectionString, query) {
        return new Promise(async (resolve, reject) => {
            try {
                mssql.on('error', err => {
                    log.debug("sqlserver", "Error caught in the error event handler.");
                    reject(err);
                });

                const pool = await mssql.connect(connectionString);
                const result = await pool.request().query(query);
                
                // Check if we have results
                if (!result.recordset || result.recordset.length === 0) {
                    reject(new Error("Query returned no results"));
                    return;
                }

                // Check if we have multiple rows
                if (result.recordset.length > 1) {
                    reject(new Error("Multiple values were found, expected only one value"));
                    return;
                }

                const firstRow = result.recordset[0];
                const columnNames = Object.keys(firstRow);

                // Check if we have multiple columns
                if (columnNames.length > 1) {
                    reject(new Error("Multiple columns were found, expected only one value"));
                    return;
                }

                // Return the single value from the first (and only) column
                const singleValue = firstRow[columnNames[0]];
                resolve(singleValue);
            } catch (err) {
                log.debug("sqlserver", "Error caught in the query execution.");
                reject(err);
            }
        });
    }
}

module.exports = {
    MssqlMonitorType,
};