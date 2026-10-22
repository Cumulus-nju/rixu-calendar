'use strict';
const http = require('http');
const server = http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(404); res.end(); return; }
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    console.log('API_CALL', req.url, body.slice(0, 220));
    const payload = {
      choices: [{
        message: {
          content: JSON.stringify({
            title: 'AI 测试讲座',
            start: '2026-10-24T14:30',
            end: '2026-10-24T16:00',
            allDay: false,
            location: '图书馆报告厅',
            note: '主讲人：王教授',
            confidence: 0.95
          })
        }
      }]
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
});
server.listen(4010, '127.0.0.1', () => console.log('mock AI on 4010'));
