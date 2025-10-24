#!/usr/bin/env node
const http = require('http');
const https = require('https');

const url = process.env.BACKEND_URL || 'http://localhost:5000/api/dev/users';

function fetchJson(u) {
  return new Promise((resolve, reject) => {
    const lib = u.startsWith('https') ? https : http;
    const req = lib.get(u, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (err) {
          reject(new Error('Invalid JSON response'));
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

(async function main(){
  try {
    const res = await fetchJson(url);
    console.log(JSON.stringify(res, null, 2));
    process.exit(0);
  } catch (err) {
    console.error('Error fetching users from', url, '\n', err && err.message);
    process.exit(2);
  }
})();
