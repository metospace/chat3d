// chat3d 解析层单测：parseModelResponse 纯函数 + applyBatch tempId 映射
// 不需要真实 API Key：直接在浏览器里 import 源码模块，喂模拟的模型回包
// 用法：先启动 vite，再 `node e2e/smoke3.mjs`
import { chromium } from 'playwright-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const BASE = 'http://localhost:1420';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const ok = (name, cond, extra) => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : ` ← ${extra ?? ''}`}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('  pageerror:', e.message));

// 同源页面：about:blank 的 origin 是 null，跨源 dynamic import 会被 CORS 挡住
// 根页面会加载 App（含 WebGL），但断言不依赖它完成；evaluate 里直接 import 源码模块
await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await sleep(300);

const out = await page.evaluate(async (baseUrl) => {
  const provider = await import(baseUrl + '/src/ai/provider.ts');
  const commands = await import(baseUrl + '/src/domain/commands.ts');
  const parse = provider.parseModelResponse;
  const out = [];
  const t = (name, fn) => {
    try {
      fn();
      out.push({ name, pass: true });
    } catch (e) {
      out.push({ name, pass: false, err: String((e && e.message) || e) });
    }
  };
  const eq = (a, b, msg) => {
    if (JSON.stringify(a) !== JSON.stringify(b))
      throw new Error(`${msg ?? '不一致'}: got=${JSON.stringify(a)} want=${JSON.stringify(b)}`);
  };
  const throwsWith = (fn, needle, msg) => {
    try {
      fn();
    } catch (e) {
      if (String((e && e.message) || e).includes(needle)) return;
      throw new Error(`抛错但信息不符：${e && e.message}`);
    }
    throw new Error('没有抛错');
  };

  const makeDoc = () => ({
    schemaVersion: 1,
    projectId: 'p1',
    revision: 0,
    unit: 'm',
    upAxis: 'Y',
    materials: [
      { id: 'mat_gray', baseColor: '#9099A4', roughness: 0.6, metalness: 0.2 },
      { id: 'mat_blue', baseColor: '#3B6EA5', roughness: 0.5, metalness: 0.3 },
    ],
    assets: [],
    nodes: [],
  });

  // 1. 标准输出：summary / op / name / tempId / transform 全保留
  t('标准 JSON：完整解析', () => {
    const r = parse(
      '{"summary":"创建工作台","operations":[{"op":"createPrimitive","tempId":"t1","name":"桌面","parentId":null,"geometry":{"type":"box","params":{"width":2,"height":0.05,"depth":0.8}},"materialId":"mat_gray","transform":{"position":[0,0.725,0],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}}]}',
    );
    eq(r.summary, '创建工作台');
    eq(r.operations.length, 1);
    eq(r.operations[0].op, 'createPrimitive');
    eq(r.operations[0].name, '桌面');
    eq(r.operations[0].tempId, 't1');
    eq(r.operations[0].geometry.params.width, 2);
    eq(r.operations[0].transform.position, [0, 0.725, 0]);
  });

  // 2. ```json 代码块包裹
  t('markdown 代码块包裹：去壳解析', () => {
    const r = parse('```json\n{"summary":"ok","operations":[{"op":"rename","targetId":"n1","name":"A"}]}\n```');
    eq(r.operations.length, 1);
    eq(r.operations[0].name, 'A');
  });

  // 3. JSON 前后带废话
  t('JSON 前后带解释文字：提取中间 JSON', () => {
    const r = parse('好的，这是结果：\n{"summary":"done","operations":[{"op":"rename","targetId":"n1","name":"B"}]}\n希望对你有帮助！');
    eq(r.operations.length, 1);
    eq(r.operations[0].name, 'B');
  });


  // 6. 空返回
  t('空字符串：抛错', () => throwsWith(() => parse('   '), '为空'));
  // 7. operations 非数组
  t('operations 非数组：抛错', () =>
    throwsWith(() => parse('{"summary":"x","operations":{}}'), '不是数组'));
  // 8. 完全没有 JSON
  t('纯文字无 JSON：抛错', () => throwsWith(() => parse('我无法理解'), '找不到 JSON'));


  // 10. createPrimitive 缺 transform → 默认（原点 + 单位四元数 + 缩放 1）
  t('缺 transform：填默认值', () => {
    const r = parse(
      '{"summary":"s","operations":[{"op":"createPrimitive","tempId":"t1","name":"盒","parentId":null,"geometry":{"type":"box","params":{"width":1,"height":1,"depth":1}},"materialId":"mat_gray"}]}',
    );
    eq(r.operations[0].transform.position, [0, 0, 0]);
    eq(r.operations[0].transform.rotationQuaternion, [0, 0, 0, 1]);
    eq(r.operations[0].transform.scale, [1, 1, 1]);
  });


  // 15. summary 缺失 → 默认文本
  t('summary 缺失：默认摘要', () => {
    const r = parse('{"operations":[{"op":"rename","targetId":"n1","name":"D"}]}');
    if (!r.summary) throw new Error('摘要为空');
  });


  // 17. applyBatch：同批次 tempId 引用映射（第二条命令引用第一条创建的节点）
  t('applyBatch：tempId 引用前序创建节点', () => {
    const doc = makeDoc();
    const ops = [
      {
        op: 'createPrimitive',
        tempId: 't1',
        name: '桶',
        parentId: null,
        geometry: { type: 'cylinder', params: { radiusTop: 0.3, radiusBottom: 0.3, height: 0.8, radialSegments: 16 } },
        materialId: 'mat_blue',
        transform: { position: [0, 0.4, 0], rotationQuaternion: [0, 0, 0, 1], scale: [1, 1, 1] },
      },
      { op: 'translate', targetId: 't1', space: 'world', mode: 'delta', value: [1, 0, 0] },
    ];
    const r = commands.applyBatch(doc, { operations: ops });
    if (r.errors.length) throw new Error('意外错误: ' + r.errors.map((e) => e.message).join(';'));
    eq(r.doc.nodes.length, 1);
    eq(r.doc.nodes[0].name, '桶');
    // t1 被映射成真实 ID：平移落到同一节点
    eq(r.doc.nodes[0].transform.position, [1, 0.4, 0]);
  });

  // 18. 真实模型常见的多对象批：工作台（桌面 + 4 腿），全部带 tempId
  t('多条 createPrimitive + tempId 全保留', () => {
    const r = parse(
      '{"summary":"工作台","operations":[' +
        '{"op":"createPrimitive","tempId":"t1","name":"桌面","parentId":null,"geometry":{"type":"box","params":{"width":2,"height":0.05,"depth":0.8}},"materialId":"mat_gray","transform":{"position":[0,0.725,0],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}},' +
        '{"op":"createPrimitive","tempId":"t2","name":"桌腿1","parentId":null,"geometry":{"type":"cylinder","params":{"radiusTop":0.03,"radiusBottom":0.03,"height":0.7,"radialSegments":16}},"materialId":"mat_gray","transform":{"position":[-0.9,0.35,-0.35],"rotationQuaternion":[0,0,0,1],"scale":[1,1,1]}}' +
      ']}',
    );
    eq(r.operations.length, 2);
    eq(r.operations[0].tempId, 't1');
    eq(r.operations[1].tempId, 't2');
    const res = commands.applyBatch(makeDoc(), { operations: r.operations });
    if (res.errors.length) throw new Error('应用失败: ' + res.errors.map((e) => e.message).join(';'));
    eq(res.doc.nodes.length, 2);
  });

  return out;
}, BASE);

for (const r of out) ok(r.name, r.pass, r.err);

const failed = results.filter((r) => !r.pass).length;
console.log(`\nsmoke3: ${results.length - failed}/${results.length} passed`);
await browser.close();
process.exit(failed > 0 ? 1 : 0);
