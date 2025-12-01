#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const config = require('../config');
const { replaceGuestRoster } = require('../db/guestDatabase');

(async function seed() {
    try {
        const sourcePath = process.argv[2]
            ? path.resolve(process.argv[2])
            : path.join(__dirname, '..', 'data', 'guests.sample.json');

        if (!fs.existsSync(sourcePath)) {
            console.error(`Guest seed file not found: ${sourcePath}`);
            process.exit(1);
        }

        const payload = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
        if (!Array.isArray(payload)) {
            console.error('Seed file must export an array of guests.');
            process.exit(1);
        }

        replaceGuestRoster(payload);
        console.log(`Guest roster imported from ${sourcePath}`);
        console.log(`SQLite database location: ${config.database.path}`);
    } catch (error) {
        console.error('Unable to seed guests:', error);
        process.exit(1);
    }
})();
