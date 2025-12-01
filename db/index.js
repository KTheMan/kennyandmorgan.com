const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../config');
const runMigrations = require('./migrations');

let dbInstance;

function ensureDataDirectory(dbPath) {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true });
}

function getDb() {
    if (dbInstance) {
        return dbInstance;
    }

    const dbPath = config.database.path;
    ensureDataDirectory(dbPath);

    dbInstance = new Database(dbPath, { fileMustExist: false });
    dbInstance.pragma('journal_mode = WAL');
    runMigrations(dbInstance);

    return dbInstance;
}

module.exports = {
    getDb
};
