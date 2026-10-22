'use strict';
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: 3101 });
console.log('mock onebot on 3101');
wss.on('connection', (ws) => {
  console.log('client connected');
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(String(raw)); } catch { return; }
    const reply = (data) => ws.send(JSON.stringify({ status: 'ok', retcode: 0, data, echo: msg.echo }));
    if (msg.action === 'get_login_info') reply({ user_id: 10001, nickname: '小号' });
    else if (msg.action === 'get_group_list') reply([{ group_id: 123456, group_name: '测试通知群', member_count: 3 }]);
    else if (msg.action === 'get_friend_list') reply([{ user_id: 20002, nickname: '好友A' }]);
    else reply({});
  });
  setTimeout(() => {
    ws.send(JSON.stringify({
      post_type: 'message',
      message_type: 'group',
      group_id: 123456,
      user_id: 20002,
      message: [{ type: 'text', data: { text: '明天下午3点开会' } }],
      sender: { card: '同学A', nickname: 'A' },
      time: Math.floor(Date.now() / 1000),
      message_id: 880001
    }));
  }, 1200);
});
