// 多項式戰機 — 題目生成器
// 對應課題：正整數指數定律、多項式加減、多項式乘法（展開）、因式分解。
// 每題回傳 { topic, q, answer, choices[3] }，choices 已洗牌，answer 為正確答案字串。

const ri = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const nz = (a, b) => { let v; do { v = ri(a, b); } while (v === 0); return v; };
const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const SUP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '-': '⁻' };
const sup = (n) => String(n).split('').map((d) => SUP[d]).join('');

// ---- 多項式字串格式 -------------------------------------------------------
// coefs: { 次數: 係數 }，變數固定為 x
function termStr(c, e, first) {
  const neg = c < 0, a = Math.abs(c);
  const coef = (e > 0 && a === 1) ? '' : String(a);
  const vp = e === 0 ? '' : e === 1 ? 'x' : 'x' + sup(e);
  const core = e === 0 ? String(a) : coef + vp;
  if (first) return neg ? '−' + core : core;
  return (neg ? ' − ' : ' + ') + core;
}
function poly(coefs) {
  const exps = Object.keys(coefs).map(Number).filter((e) => coefs[e] !== 0).sort((a, b) => b - a);
  if (!exps.length) return '0';
  return exps.map((e, i) => termStr(coefs[e], e, i === 0)).join('');
}
// 一次因式 (ax + b)
function lin(a, b) {
  const c = a === 1 ? 'x' : a === -1 ? '−x' : `${a}x`;
  if (b === 0) return `(${c})`;
  return `(${c}${b > 0 ? ' + ' : ' − '}${Math.abs(b)})`;
}

// ---- 組裝一題：確保三個選項互不相同 --------------------------------------
function build(topic, q, answer, distractors) {
  const set = [];
  for (const d of distractors) {
    if (d && d !== answer && !set.includes(d)) set.push(d);
    if (set.length === 2) break;
  }
  if (set.length < 2) return null; // 誘答不足，上層會重抽
  return { topic, q, answer, choices: shuffle([answer, ...set]) };
}

// ===========================================================================
// 1. 正整數指數定律
// ===========================================================================
function genExp() {
  const v = pick(['x', 'a', 'y']);
  const P = (m) => (m === 1 ? v : v + sup(m));
  const kind = ri(1, 4);
  if (kind === 1) { // v^m × v^n
    const m = ri(2, 9), n = ri(2, 9);
    return build('指數定律', `${P(m)} × ${P(n)} = ?`, P(m + n),
      [P(m * n), P(Math.abs(m - n)), P(m + n + 1), P(m + n - 1), '2' + P(m + n)]);
  }
  if (kind === 2) { // v^m ÷ v^n (m > n)
    const n = ri(2, 7), m = n + ri(2, 8);
    return build('指數定律', `${P(m)} ÷ ${P(n)} = ?`, P(m - n),
      [P(m + n), P(m - n + 1), P(m - n - 1), '1', P(m)]);
  }
  if (kind === 3) { // (v^m)^n
    const m = ri(2, 6), n = ri(2, 5);
    return build('指數定律', `(${P(m)})${sup(n)} = ?`, P(m * n),
      [P(m + n), P(m * n + 1), P(Math.abs(m - n)), P(m ** n > 40 ? m * n - 1 : m ** n)]);
  }
  // (k v^m)^n
  const k = pick([2, 3]), m = ri(1, 3), n = pick([2, 3]);
  const kn = k ** n;
  return build('指數定律', `(${k}${P(m)})${sup(n)} = ?`, `${kn}${P(m * n)}`,
    [`${k * n}${P(m * n)}`, `${kn}${P(m + n)}`, `${k}${P(m * n)}`, `${kn}${P(m * n + 1)}`]);
}

// ===========================================================================
// 2. 多項式加減
// ===========================================================================
function genAddSub() {
  const quad = Math.random() < 0.6;
  const sub = Math.random() < 0.5;
  const op = sub ? '−' : '+';
  if (!quad) {
    const a = nz(-6, 6), b = nz(-9, 9), c = nz(-6, 6), d = nz(-9, 9);
    const q = `(${poly({ 1: a, 0: b })}) ${op} (${poly({ 1: c, 0: d })})`;
    const ans = poly({ 1: sub ? a - c : a + c, 0: sub ? b - d : b + d });
    return build('多項式加減', `化簡：${q}`, ans, [
      poly({ 1: sub ? a - c : a + c, 0: sub ? b + d : b - d }),           // 符號錯
      poly({ 1: sub ? a + c : a - c, 0: sub ? b - d : b + d }),           // 一次項符號錯
      poly({ 1: sub ? a - c : a + c, 0: (sub ? b - d : b + d) + pick([-2, -1, 1, 2]) }),
    ]);
  }
  const a = nz(-4, 4), b = nz(-8, 8), c = nz(-8, 8);
  const d = nz(-4, 4), e = nz(-8, 8), f = nz(-8, 8);
  const s = sub ? -1 : 1;
  const q = `(${poly({ 2: a, 1: b, 0: c })}) ${op} (${poly({ 2: d, 1: e, 0: f })})`;
  const ans = poly({ 2: a + s * d, 1: b + s * e, 0: c + s * f });
  return build('多項式加減', `化簡：${q}`, ans, [
    poly({ 2: a + s * d, 1: b + s * e, 0: c - s * f }),                   // 常數項忘記變號
    poly({ 2: a + s * d, 1: b - s * e, 0: c + s * f }),                   // 一次項錯
    poly({ 2: a - s * d, 1: b + s * e, 0: c + s * f }),                   // 二次項錯
    poly({ 2: a + s * d, 1: b + s * e + pick([-1, 1]), 0: c + s * f }),
  ]);
}

// ===========================================================================
// 3. 多項式乘法（展開）
// ===========================================================================
function genExpand() {
  const kind = ri(1, 3);
  if (kind === 1) { // k(ax + b) 或 kx(ax + b)
    const withX = Math.random() < 0.5;
    const k = nz(2, 6), a = nz(1, 5), b = nz(-8, 8);
    const head = withX ? `${k}x` : `${k}`;
    const q = `展開：${head}${lin(a, b)}`;
    const e1 = withX ? 2 : 1, e0 = withX ? 1 : 0;
    const ans = poly({ [e1]: k * a, [e0]: k * b });
    return build('多項式乘法', q, ans, [
      poly({ [e1]: k * a, [e0]: b }),                                     // 只乘第一項
      poly({ [e1]: k * a, [e0]: k * b + pick([-k, k]) }),
      poly({ [e1]: k + a, [e0]: k * b }),
    ]);
  }
  if (kind === 2) { // (ax + b)(cx + d)
    const a = pick([1, 1, 2, 3]), c = pick([1, 1, 2]);
    const b = nz(-6, 6), d = nz(-6, 6);
    const q = `展開：${lin(a, b)}${lin(c, d)}`;
    const ans = poly({ 2: a * c, 1: a * d + b * c, 0: b * d });
    return build('多項式乘法', q, ans, [
      poly({ 2: a * c, 1: a * d - b * c, 0: b * d }),                     // 中項符號
      poly({ 2: a * c, 1: a * d + b * c + pick([-2, -1, 1, 2]), 0: b * d }),
      poly({ 2: a * c, 1: a * c + b * d, 0: b * d }),                     // 交叉相乘錯
      poly({ 2: a + c, 1: a * d + b * c, 0: b * d }),
    ]);
  }
  // (ax + b)^2
  const a = pick([1, 1, 2]), b = nz(1, 7);
  const q = `展開：${lin(a, b)}²`;
  const ans = poly({ 2: a * a, 1: 2 * a * b, 0: b * b });
  return build('多項式乘法', q, ans, [
    poly({ 2: a * a, 0: b * b }),                                         // 漏中項（經典錯誤）
    poly({ 2: a * a, 1: a * b, 0: b * b }),
    poly({ 2: a * a, 1: 2 * a * b, 0: -b * b }),
  ]);
}

// ===========================================================================
// 4. 因式分解
// ===========================================================================
function genFactor() {
  const kind = ri(1, 4);
  if (kind === 1) { // 提取公因式：g x (ax + b)（gcd(a,b)=1 保證提取完整）
    const g = pick([2, 3, 4, 5, 6]);
    const gcd = (x, y) => (y ? gcd(y, x % y) : x);
    let a, b;
    do { a = nz(1, 4); b = nz(1, 8); } while (gcd(Math.abs(a), Math.abs(b)) !== 1);
    const g2 = g * pick([1, 1, 2]);
    const q = `因式分解：${poly({ 2: g2 * a, 1: g2 * b })}`;
    const ans = `${g2}x${lin(a, b)}`;
    const ds = [
      `x${lin(g2 * a, g2 * b)}`,                                          // 只提 x
      `${g2}${lin(a, b)}`,                                                // 忘記 x
      `${g2}x${lin(a, -b)}`,
    ];
    if (g2 % 2 === 0 && (g2 / 2) * a !== g2 * a) ds.push(`2x${lin((g2 / 2) * a, (g2 / 2) * b)}`); // 未提盡
    return build('因式分解', q, ans, ds);
  }
  if (kind === 2) { // 平方差：a²x² − b²（gcd(a,b)=1 保證答案已分解完整）
    const a = pick([1, 1, 1, 2, 3]);
    const g = (x, y) => (y ? g(y, x % y) : x);
    const bs = [];
    for (let v = 2; v <= 9; v++) if (g(a, v) === 1) bs.push(v);
    const b = pick(bs);
    const q = `因式分解：${poly({ 2: a * a, 0: -b * b })}`;
    const ans = `${lin(a, b)}${lin(a, -b)}`;
    return build('因式分解', q, ans, [
      `${lin(a, -b)}²`,
      `${lin(a, b)}²`,
      `${a === 1 ? 'x' : a + 'x'}${lin(a, -b * b)}`,
      `${lin(a * a, -b * b)}x`,
    ]);
  }
  if (kind === 3) { // 完全平方：x² ± 2kx + k²
    const k = ri(1, 7), neg = Math.random() < 0.5, a = pick([1, 1, 2]);
    const mid = 2 * a * k;
    const q = `因式分解：${poly({ 2: a * a, 1: neg ? -mid : mid, 0: k * k })}`;
    const ans = `${lin(a, neg ? -k : k)}²`;
    return build('因式分解', q, ans, [
      `${lin(a, neg ? k : -k)}²`,                                         // 符號調轉
      `${lin(a, k)}${lin(a, -k)}`,                                        // 誤當平方差
      `${lin(a, neg ? -k : k)}${lin(a, neg ? -2 * k : 2 * k)}`,
    ]);
  }
  // 十字相乘：x² + bx + c = (x + p)(x + q)
  const p = nz(-7, 7), qv = nz(-7, 7);
  const lo = Math.min(p, qv), hi = Math.max(p, qv);
  const q = `因式分解：${poly({ 2: 1, 1: p + qv, 0: p * qv })}`;
  const ans = `${lin(1, lo)}${lin(1, hi)}`;
  return build('因式分解', q, ans, [
    `${lin(1, -lo)}${lin(1, -hi)}`,
    `${lin(1, lo)}${lin(1, -hi)}`,
    `${lin(1, -lo)}${lin(1, hi)}`,
    `${lin(1, p * qv)}${lin(1, 1)}`,
  ]);
}

// ===========================================================================
const GENS = { exp: genExp, addsub: genAddSub, expand: genExpand, factor: genFactor };

export const MODES = [
  { key: 'mix', label: '混合特訓' },
  { key: 'expand', label: '多項式乘法' },
  { key: 'factor', label: '因式分解' },
  { key: 'addsub', label: '多項式加減' },
  { key: 'exp', label: '指數定律' },
];

export function genQuestion(modeKey) {
  for (let i = 0; i < 60; i++) {
    const key = modeKey === 'mix' ? pick(Object.keys(GENS)) : modeKey;
    const g = GENS[key]();
    if (g) return g;
  }
  // 理論上不會到這裡；保底題
  return build('多項式乘法', '展開：(x + 1)(x + 2)', poly({ 2: 1, 1: 3, 0: 2 }),
    [poly({ 2: 1, 1: 2, 0: 2 }), poly({ 2: 1, 1: 3, 0: 1 })]);
}
