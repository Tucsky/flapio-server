var fs = require('fs');
exports.ext = JSON.parse(fs.readFileSync('config.json', 'UTF-8'));