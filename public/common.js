/* ========== 搭子行 公共 JS ========== */

// ---------- 类型图标映射 ----------
const DZH_TYPE_ICONS = {
  '徒步':   { icon: 'fa-hiking',          bg: 'linear-gradient(135deg, #e0f2e9, #b8e0ce)', color: '#2d6a4f' },
  '骑行':   { icon: 'fa-bicycle',         bg: 'linear-gradient(135deg, #e8f4f8, #b8dbe8)', color: '#1e5a7a' },
  '露营':   { icon: 'fa-campground',      bg: 'linear-gradient(135deg, #fef3e0, #f5d6a3)', color: '#8b6914' },
  '跑步':   { icon: 'fa-running',         bg: 'linear-gradient(135deg, #ffe0e6, #f5b8c5)', color: '#a0304a' },
  '篮球':   { icon: 'fa-basketball-ball', bg: 'linear-gradient(135deg, #ffe8d6, #f5c4a0)', color: '#c0601e' },
  '足球':   { icon: 'fa-futbol',          bg: 'linear-gradient(135deg, #e0f0e0, #b8d8b8)', color: '#2d5a2d' },
  '羽毛球': { icon: 'fa-baseball-ball',   bg: 'linear-gradient(135deg, #f0f0ff, #d0d0f8)', color: '#4040a0' },
  '桌游':   { icon: 'fa-chess-board',     bg: 'linear-gradient(135deg, #f8e8ff, #e0c0f0)', color: '#6a3d8a' },
  '自习':   { icon: 'fa-book',            bg: 'linear-gradient(135deg, #e8f0f8, #c0d8f0)', color: '#2d4a7a' },
  '聚餐':   { icon: 'fa-utensils',        bg: 'linear-gradient(135deg, #ffe8d0, #f5c8a0)', color: '#b85c1e' },
  '其他':   { icon: 'fa-star',            bg: 'linear-gradient(135deg, #f8f8e8, #e8e8c0)', color: '#6a6a2d' },
};

function dzhGetTypeStyle(type) {
  return DZH_TYPE_ICONS[type] || DZH_TYPE_ICONS['其他'];
}

// ---------- HTML 转义 ----------
function dzhEscapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Toast 通知 ----------
function dzhToast(text, type, duration) {
  type = type || 'info';
  duration = duration || 3000;
  let toast = document.querySelector('.dzh-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'dzh-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = text;
  toast.className = 'dzh-toast ' + type + ' show';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(function() {
    toast.className = 'dzh-toast';
  }, duration);
}

// ---------- 登录状态检查 ----------
function dzhGetUser() {
  var token = localStorage.getItem('token');
  var userStr = localStorage.getItem('user');
  if (!token || !userStr) return null;
  try {
    return { token: token, data: JSON.parse(userStr) };
  } catch (e) {
    return null;
  }
}

function dzhRequireLogin() {
  var auth = dzhGetUser();
  if (!auth) {
    window.location.href = '/login.html';
    return null;
  }
  return auth;
}

// ---------- 退出登录 ----------
async function dzhLogout() {
  if (!confirm('确定要退出登录吗？')) return;
  var token = localStorage.getItem('token');
  try {
    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token }
    });
  } catch (e) {}
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login.html';
}

// ---------- 底部导航初始化 ----------
function dzhInitBottomNav(activeNav) {
  document.querySelectorAll('.bottom-nav .nav-item').forEach(function(item) {
    var nav = item.dataset.nav;
    if (nav === activeNav) {
      item.classList.add('active');
    } else {
      item.classList.remove('active');
    }
    item.addEventListener('click', function() {
      if (nav === 'discover') window.location.href = '/discover.html';
      else if (nav === 'home') window.location.href = '/home.html';
      else if (nav === 'messages') dzhToast('消息功能即将上线 🚀', 'info');
      else if (nav === 'profile') window.location.href = '/profile.html';
    });
  });
}

// ---------- 敏感词实时检测 ----------
// 防抖定时器
var _sensitiveCheckTimer = null;

/**
 * 对输入框内容进行敏感词实时检测
 * @param {string} text - 待检测文本
 * @param {HTMLElement} tipEl - 提示元素
 * @param {HTMLElement} [submitBtn] - 提交按钮（可选，检测到敏感词时禁用）
 * @param {number} [delay=500] - 防抖延迟（毫秒）
 */
function dzhCheckSensitive(text, tipEl, submitBtn, delay) {
  delay = delay || 500;
  clearTimeout(_sensitiveCheckTimer);

  if (!text || !text.trim()) {
    if (tipEl) {
      tipEl.textContent = '';
      tipEl.className = 'sensitive-tip';
    }
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  _sensitiveCheckTimer = setTimeout(async function() {
    try {
      var resp = await fetch('/api/check-sensitive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim() })
      });
      var data = await resp.json();
      if (data.success && data.data.hasSensitive) {
        if (tipEl) {
          tipEl.textContent = '⚠️ 内容包含敏感词，请修改后再提交';
          tipEl.className = 'sensitive-tip warn';
        }
        if (submitBtn) submitBtn.disabled = true;
      } else {
        if (tipEl) {
          tipEl.textContent = '';
          tipEl.className = 'sensitive-tip';
        }
        if (submitBtn) submitBtn.disabled = false;
      }
    } catch (e) {
      // 网络错误时不阻塞用户操作
      if (tipEl) {
        tipEl.textContent = '';
        tipEl.className = 'sensitive-tip';
      }
      if (submitBtn) submitBtn.disabled = false;
    }
  }, delay);
}

// ---------- 骨架屏 HTML ----------
function dzhSkeletonHTML() {
  return '<div class="skeleton-card">' +
    '<div class="skel-circle"></div>' +
    '<div class="skel-lines">' +
      '<div class="skel-line w40"></div>' +
      '<div class="skel-line w60"></div>' +
      '<div class="skel-line w80"></div>' +
    '</div>' +
  '</div>';
}