const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const ACTIVITIES_FILE = path.join(__dirname, 'activities.json');
const USERS_FILE = path.join(__dirname, 'users.json');
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dzh-admin-2026';

// ---------- 简易限流器 ----------
const rateLimitStore = {};
function rateLimit(key, windowMs = 60000, max = 60) {
  const now = Date.now();
  if (!rateLimitStore[key]) rateLimitStore[key] = { count: 0, resetAt: now + windowMs };
  const record = rateLimitStore[key];
  if (now > record.resetAt) { record.count = 0; record.resetAt = now + windowMs; }
  record.count++;
  return record.count <= max;
}
// 定期清理过期记录
setInterval(() => {
  const now = Date.now();
  for (const key in rateLimitStore) {
    if (rateLimitStore[key].resetAt < now) delete rateLimitStore[key];
  }
}, 60000);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 全局限流中间件 ----------
app.use('/api/', (req, res, next) => {
  if (!rateLimit(req.ip || 'unknown', 60000, 120)) {
    return res.status(429).json({ success: false, message: '请求过于频繁，请稍后再试' });
  }
  next();
});

// ---------- 初始化数据文件 ----------
function initActivities() {
  if (!fs.existsSync(ACTIVITIES_FILE)) {
    const seed = [
      {
        id: '1',
        title: '青云山徒步',
        type: '徒步',
        date: '2026/07/12 07:30',
        location: '青云山区',
        maxParticipants: 6,
        currentParticipants: 4,
        participants: [],
        description: '一起徒步青云山，感受自然风光'
      }
    ];
    fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(seed, null, 2), 'utf-8');
    return seed;
  }
  return JSON.parse(fs.readFileSync(ACTIVITIES_FILE, 'utf-8'));
}

function loadUsers() {
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, '{}', 'utf-8');
    return {};
  }
  return JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8'));
}

let activities = initActivities();
let users = loadUsers();

// 验证码临时存储（内存中，重启丢失）
const verificationCodes = {};

function saveActivities() {
  fs.writeFileSync(ACTIVITIES_FILE, JSON.stringify(activities, null, 2), 'utf-8');
}

function saveUsers() {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf-8');
}

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// ---------- 认证中间件 ----------
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, message: '请先登录' });
  }

  const user = Object.values(users).find(u => u.token === token);
  if (!user) {
    return res.status(401).json({ success: false, message: '登录已过期，请重新登录' });
  }

  if (user.banned) {
    return res.status(403).json({ success: false, message: '你的账号已被封禁，请联系管理员' });
  }

  req.user = user;
  next();
}

// ---------- 认证 API ----------
// 发送验证码
app.post('/api/auth/send-code', (req, res) => {
  const { phone } = req.body;
  if (!phone || !/^\d{11}$/.test(phone)) {
    return res.json({ success: false, message: '请输入正确的11位手机号' });
  }

  // 模拟发送验证码，固定为 1234
  const code = '1234';
  verificationCodes[phone] = {
    code,
    expires: Date.now() + 5 * 60 * 1000 // 5分钟有效
  };

  console.log(`[验证码] 手机号 ${phone} 的验证码：${code}`);
  res.json({ success: true, message: '验证码已发送', debugCode: code });
});

// 登录/注册（限流：每手机号每分钟5次）
app.post('/api/auth/login', (req, res) => {
  if (!rateLimit('login:' + (req.body.phone || req.ip), 60000, 5)) {
    return res.status(429).json({ success: false, message: '登录尝试过于频繁，请稍后再试' });
  }
  const { phone, code } = req.body;
  if (!phone || !code) {
    return res.json({ success: false, message: '手机号和验证码不能为空' });
  }

  const record = verificationCodes[phone];
  if (!record) {
    return res.json({ success: false, message: '请先获取验证码' });
  }

  if (Date.now() > record.expires) {
    delete verificationCodes[phone];
    return res.json({ success: false, message: '验证码已过期，请重新获取' });
  }

  if (record.code !== code) {
    return res.json({ success: false, message: '验证码错误' });
  }

  // 验证成功，删除验证码
  delete verificationCodes[phone];

  // 查找或创建用户
  let user = users[phone];
  if (!user) {
    user = {
      phone,
      token: generateToken(),
      nickname: '用户' + phone.slice(-4),
      createdAt: new Date().toISOString()
    };
    users[phone] = user;
    saveUsers();
    console.log(`[注册] 新用户：${phone}`);
  } else {
    // 刷新 token
    user.token = generateToken();
    saveUsers();
    console.log(`[登录] 用户：${phone}`);
  }

  res.json({
    success: true,
    message: '登录成功',
    data: {
      phone: user.phone,
      nickname: user.nickname,
      token: user.token,
      createdAt: user.createdAt
    }
  });
});

// 获取当前用户信息
app.get('/api/auth/me', authMiddleware, (req, res) => {
  res.json({
    success: true,
    data: {
      phone: req.user.phone,
      nickname: req.user.nickname,
      createdAt: req.user.createdAt
    }
  });
});

// 登出
app.post('/api/auth/logout', authMiddleware, (req, res) => {
  req.user.token = generateToken();
  saveUsers();
  res.json({ success: true, message: '已退出登录' });
});

// ---------- 学号收集（保留） ----------
app.post('/submit-student-id', (req, res) => {
  const studentId = req.body.studentId;
  if (!studentId) {
    return res.json({ success: false, message: '学号不能为空' });
  }

  fs.appendFile('students.txt', studentId + '\n', (err) => {
    if (err) {
      console.error('保存失败：', err);
      return res.json({ success: false, message: '服务器出错，请稍后再试' });
    }
    console.log(`收到学号：${studentId}`);
    res.json({ success: true, message: '登记成功！我们会在上线时通知你。' });
  });
});

// ---------- 活动 API ----------
// 公开接口
app.get('/api/activities', (_req, res) => {
  res.json({ success: true, data: activities });
});

app.get('/api/activities/:id', (req, res) => {
  const act = activities.find(a => a.id === req.params.id);
  if (!act) {
    return res.status(404).json({ success: false, message: '活动不存在' });
  }
  res.json({ success: true, data: act });
});

// 需要登录的接口
app.post('/api/activities', authMiddleware, (req, res) => {
  const { title, type, date, location, maxParticipants, description } = req.body;
  if (!title || !type || !date || !location) {
    return res.status(400).json({ success: false, message: '请填写完整的活动信息（标题、类型、日期、地点为必填）' });
  }

  const newAct = {
    id: String(Date.now()),
    title,
    type,
    date,
    location,
    maxParticipants: parseInt(maxParticipants, 10) || 10,
    currentParticipants: 0,
    participants: [],
    description: description || '',
    creator: req.user.phone
  };

  activities.push(newAct);
  saveActivities();
  console.log(`新活动创建：${title}（by ${req.user.phone}）`);
  res.json({ success: true, data: newAct, message: '活动发布成功！' });
});

app.post('/api/activities/:id/join', authMiddleware, (req, res) => {
  const act = activities.find(a => a.id === req.params.id);
  if (!act) {
    return res.status(404).json({ success: false, message: '活动不存在' });
  }

  if (act.currentParticipants >= act.maxParticipants) {
    return res.status(400).json({ success: false, message: '活动已满员' });
  }

  // 检查是否已加入
  if (act.participants.includes(req.user.phone)) {
    return res.status(400).json({ success: false, message: '你已经加入了这个活动' });
  }

  act.currentParticipants += 1;
  act.participants.push(req.user.phone);
  saveActivities();
  res.json({ success: true, data: act, message: '加入成功！' });
});

// 退出活动
app.post('/api/activities/:id/leave', authMiddleware, (req, res) => {
  const act = activities.find(a => a.id === req.params.id);
  if (!act) {
    return res.status(404).json({ success: false, message: '活动不存在' });
  }

  const pIdx = act.participants.indexOf(req.user.phone);
  if (pIdx === -1) {
    return res.status(400).json({ success: false, message: '你还没有加入这个活动' });
  }

  if (act.creator === req.user.phone) {
    return res.status(400).json({ success: false, message: '活动创建者不能退出活动' });
  }

  act.participants.splice(pIdx, 1);
  act.currentParticipants = Math.max(0, act.currentParticipants - 1);
  saveActivities();
  res.json({ success: true, data: act, message: '已退出活动' });
});

app.delete('/api/activities/:id', authMiddleware, (req, res) => {
  const idx = activities.findIndex(a => a.id === req.params.id);
  if (idx === -1) {
    return res.status(404).json({ success: false, message: '活动不存在' });
  }

  const act = activities[idx];
  if (act.creator && act.creator !== req.user.phone) {
    return res.status(403).json({ success: false, message: '只能删除自己创建的活动' });
  }

  const removed = activities.splice(idx, 1)[0];
  saveActivities();
  console.log(`活动已删除：${removed.title}（by ${req.user.phone}）`);
  res.json({ success: true, message: '活动已删除' });
});

// ---------- 管理员 API ----------
let adminTokens = [];

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (!password || password !== ADMIN_SECRET) {
    return res.status(401).json({ success: false, message: '管理员密码错误' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  adminTokens.push(token);
  res.json({ success: true, data: { token }, message: '管理员登录成功' });
});

function adminMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '') || req.headers['x-admin-token'] || req.query.token;
  if (!token || !adminTokens.includes(token)) {
    return res.status(401).json({ success: false, message: '请先登录管理后台' });
  }
  next();
}

// 管理员直接创建活动
app.post('/api/admin/activities', adminMiddleware, (req, res) => {
  const { title, type, date, location, maxParticipants, description } = req.body;
  if (!title || !type || !date || !location) {
    return res.status(400).json({ success: false, message: '请填写完整的活动信息（标题、类型、日期、地点为必填）' });
  }

  const newAct = {
    id: String(Date.now()),
    title,
    type,
    date,
    location,
    maxParticipants: parseInt(maxParticipants, 10) || 10,
    currentParticipants: 0,
    participants: [],
    description: description || '',
    creator: 'admin'
  };

  activities.push(newAct);
  saveActivities();
  console.log(`[管理员] 新活动创建：${title}`);
  res.json({ success: true, data: newAct, message: '活动发布成功！' });
});

app.get('/api/admin/stats', adminMiddleware, (_req, res) => {
  const totalActivities = activities.length;
  const totalUsers = Object.keys(users).length;
  const totalParticipants = activities.reduce((sum, a) => sum + a.currentParticipants, 0);
  const recentActivities = activities.slice(-5).reverse();
  res.json({ success: true, data: { totalActivities, totalUsers, totalParticipants, recentActivities } });
});

app.put('/api/admin/activities/:id', adminMiddleware, (req, res) => {
  const idx = activities.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: '活动不存在' });
  const { title, type, date, location, maxParticipants, description } = req.body;
  if (title) activities[idx].title = title;
  if (type) activities[idx].type = type;
  if (date) activities[idx].date = date;
  if (location) activities[idx].location = location;
  if (maxParticipants) activities[idx].maxParticipants = parseInt(maxParticipants, 10);
  if (description !== undefined) activities[idx].description = description;
  saveActivities();
  res.json({ success: true, data: activities[idx], message: '活动已更新' });
});

app.delete('/api/admin/activities/:id', adminMiddleware, (req, res) => {
  const idx = activities.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: '活动不存在' });
  const removed = activities.splice(idx, 1)[0];
  saveActivities();
  res.json({ success: true, message: '活动已删除', data: removed });
});

app.get('/api/admin/users', adminMiddleware, (_req, res) => {
  const userList = Object.entries(users).map(([phone, u]) => ({
    phone,
    nickname: u.nickname,
    createdAt: u.createdAt,
    banned: !!u.banned
  }));
  res.json({ success: true, data: userList });
});

app.put('/api/admin/users/:phone', adminMiddleware, (req, res) => {
  const user = users[req.params.phone];
  if (!user) return res.status(404).json({ success: false, message: '用户不存在' });
  user.banned = !user.banned;
  saveUsers();
  res.json({ success: true, data: user, message: user.banned ? '用户已封禁' : '用户已解封' });
});

// ---------- 学号管理 API ----------
app.get('/api/admin/students', adminMiddleware, (_req, res) => {
  try {
    if (!fs.existsSync('students.txt')) {
      return res.json({ success: true, data: [] });
    }
    const content = fs.readFileSync('students.txt', 'utf-8').trim();
    const ids = content ? content.split('\n').filter(Boolean) : [];
    res.json({ success: true, data: ids });
  } catch (err) {
    res.json({ success: true, data: [] });
  }
});

app.delete('/api/admin/students', adminMiddleware, (_req, res) => {
  fs.writeFileSync('students.txt', '', 'utf-8');
  res.json({ success: true, message: '学号列表已清空' });
});

// ---------- 系统公告 API ----------
const ANNOUNCEMENTS_FILE = path.join(__dirname, 'announcements.json');

function loadAnnouncements() {
  if (!fs.existsSync(ANNOUNCEMENTS_FILE)) {
    fs.writeFileSync(ANNOUNCEMENTS_FILE, '[]', 'utf-8');
    return [];
  }
  return JSON.parse(fs.readFileSync(ANNOUNCEMENTS_FILE, 'utf-8'));
}

app.get('/api/announcements', (_req, res) => {
  const list = loadAnnouncements();
  res.json({ success: true, data: list.filter(a => a.visible) });
});

app.post('/api/admin/announcements', adminMiddleware, (req, res) => {
  const { title, content } = req.body;
  if (!title || !content) {
    return res.status(400).json({ success: false, message: '标题和内容不能为空' });
  }
  const list = loadAnnouncements();
  const item = {
    id: String(Date.now()),
    title,
    content,
    visible: true,
    createdAt: new Date().toISOString()
  };
  list.push(item);
  fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  res.json({ success: true, data: item, message: '公告发布成功' });
});

app.delete('/api/admin/announcements/:id', adminMiddleware, (req, res) => {
  const list = loadAnnouncements();
  const idx = list.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: '公告不存在' });
  list.splice(idx, 1);
  fs.writeFileSync(ANNOUNCEMENTS_FILE, JSON.stringify(list, null, 2), 'utf-8');
  res.json({ success: true, message: '公告已删除' });
});

// ---------- 数据导出 API ----------
app.get('/api/admin/export/users', adminMiddleware, (_req, res) => {
  const userList = Object.entries(users).map(([phone, u]) => ({
    phone,
    nickname: u.nickname,
    createdAt: u.createdAt,
    banned: u.banned ? '是' : '否'
  }));
  // BOM for Excel UTF-8
  let csv = '\uFEFF手机号,昵称,注册时间,是否封禁\n';
  userList.forEach(u => {
    csv += `${u.phone},${u.nickname},${u.createdAt || ''},${u.banned}\n`;
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=users_export.csv');
  res.send(csv);
});

app.get('/api/admin/export/activities', adminMiddleware, (_req, res) => {
  let csv = '\uFEFF标题,类型,日期,地点,最大人数,当前人数,创建者,描述\n';
  activities.forEach(a => {
    csv += `${a.title},${a.type},${a.date},${a.location},${a.maxParticipants},${a.currentParticipants},${a.creator || ''},${(a.description || '').replace(/,/g, '，')}\n`;
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename=activities_export.csv');
  res.send(csv);
});

// ---------- 活动类型统计 API ----------
app.get('/api/admin/stats/types', adminMiddleware, (_req, res) => {
  const typeCount = {};
  activities.forEach(a => {
    typeCount[a.type] = (typeCount[a.type] || 0) + 1;
  });
  res.json({ success: true, data: typeCount });
});

// ---------- 用户详情 API ----------
app.get('/api/admin/users/:phone/activities', adminMiddleware, (req, res) => {
  const phone = req.params.phone;
  const userActs = activities.filter(a =>
    a.creator === phone || (a.participants && a.participants.includes(phone))
  );
  res.json({ success: true, data: userActs });
});

// ---------- 404 处理 ----------
app.use((_req, res) => {
  res.status(404).json({ success: false, message: '接口不存在' });
});

// ---------- 全局错误处理 ----------
app.use((err, _req, res, _next) => {
  console.error('服务器错误：', err);
  res.status(500).json({ success: false, message: '服务器内部错误，请稍后再试' });
});

// ---------- 启动 ----------
app.listen(PORT, () => {
  console.log(`搭子行网站已启动：http://localhost:${PORT}`);
});
