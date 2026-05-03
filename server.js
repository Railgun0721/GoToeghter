const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = 3000;

const ACTIVITIES_FILE = path.join(__dirname, 'activities.json');
const USERS_FILE = path.join(__dirname, 'users.json');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

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

// 登录/注册
app.post('/api/auth/login', (req, res) => {
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
      token: user.token
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

// ---------- 启动 ----------
app.listen(PORT, () => {
  console.log(`搭子行网站已启动：http://localhost:${PORT}`);
});