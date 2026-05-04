/**
 * 敏感词过滤模块
 * 基于 Sensitive-lexicon 词库，使用 DFA（确定有限自动机）算法实现高效敏感词检测
 */

const fs = require('fs');
const path = require('path');

// 词库目录
const VOCABULARY_DIR = path.join(__dirname, '..', 'Sensitive-lexicon', 'Vocabulary');

// DFA 节点
class SensitiveFilter {
  constructor() {
    this.root = new Map();
    this.loaded = false;
  }

  /**
   * 加载所有词库文件
   */
  load() {
    if (!fs.existsSync(VOCABULARY_DIR)) {
      console.warn('[敏感词] 词库目录不存在:', VOCABULARY_DIR);
      return;
    }

    const files = fs.readdirSync(VOCABULARY_DIR).filter(f => f.endsWith('.txt'));
    let totalWords = 0;

    for (const file of files) {
      const filePath = path.join(VOCABULARY_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const words = content.split('\n')
        .map(w => w.trim())
        .filter(w => w.length > 0);

      for (const word of words) {
        this._addWord(word);
      }
      totalWords += words.length;
      console.log(`[敏感词] 已加载词库: ${file} (${words.length} 个词)`);
    }

    this.loaded = true;
    console.log(`[敏感词] 所有词库加载完成，共 ${totalWords} 个敏感词`);
  }

  /**
   * 向 DFA 树中添加一个敏感词
   */
  _addWord(word) {
    let node = this.root;
    for (let i = 0; i < word.length; i++) {
      const char = word[i];
      if (!node.has(char)) {
        node.set(char, new Map());
      }
      node = node.get(char);
    }
    node.set('_end', true); // 标记词尾
  }

  /**
   * 检测文本中是否包含敏感词
   * @param {string} text - 待检测文本
   * @returns {object} { hasSensitive: boolean, words: string[], cleanText: string }
   */
  detect(text) {
    if (!this.loaded || !text) {
      return { hasSensitive: false, words: [], cleanText: text || '' };
    }

    const foundWords = new Set();
    const lowerText = text.toLowerCase();

    for (let i = 0; i < lowerText.length; i++) {
      let node = this.root;
      let j = i;
      let lastMatchEnd = -1;

      while (j < lowerText.length && node.has(lowerText[j])) {
        node = node.get(lowerText[j]);
        j++;
        if (node.has('_end')) {
          lastMatchEnd = j;
        }
      }

      if (lastMatchEnd > 0) {
        const word = text.substring(i, lastMatchEnd);
        foundWords.add(word);
      }
    }

    const wordsArray = Array.from(foundWords);
    const hasSensitive = wordsArray.length > 0;

    // 生成替换后的文本（用 * 替换敏感词）
    let cleanText = text;
    if (hasSensitive) {
      // 按长度降序排列，避免短词先替换导致长词无法匹配
      const sorted = wordsArray.sort((a, b) => b.length - a.length);
      for (const word of sorted) {
        const regex = new RegExp(this._escapeRegex(word), 'gi');
        cleanText = cleanText.replace(regex, '*'.repeat(word.length));
      }
    }

    return {
      hasSensitive,
      words: wordsArray,
      cleanText
    };
  }

  /**
   * 检测文本是否包含敏感词（仅返回布尔值）
   */
  hasSensitive(text) {
    return this.detect(text).hasSensitive;
  }

  /**
   * 转义正则特殊字符
   */
  _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

// 创建单例
const sensitiveFilter = new SensitiveFilter();

module.exports = sensitiveFilter;