const fs = require('fs');
const csv = require('fast-csv');
const { validateEmail } = require('./validator');

async function processCsv(filePath) {
  return new Promise((resolve, reject) => {
    const rows = [];
    fs.createReadStream(filePath)
      .pipe(csv.parse({ headers: true }))
      .on('error', error => reject(error))
      .on('data', row => {
        // Validate email formatting immediately
        if (!validateEmail(row.email)) {
          row.status = 'invalid';
        }
        rows.push(row);
      })
      .on('end', () => {
        resolve(rows);
      });
  });
}

async function writeCsv(filePath, data) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(filePath);
    csv
      .write(data, { headers: true })
      .pipe(ws)
      .on('finish', () => resolve())
      .on('error', (err) => reject(err));
  });
}

module.exports = {
  processCsv,
  writeCsv
};
