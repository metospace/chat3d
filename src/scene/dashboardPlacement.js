/* Trusted layout measurement. No host commands, network access, or message listener. */
function createDashboardPlacement({sceneHtml, region: manualRegion, inspect, report, fail}) {
    const explicit = '[data-scenivo-scene],[data-scene-slot]';
    const semantic = '.lg-scene,.scene,.wm-warehouse-viewport,.wm-warehouse-map,.warehouse-map,[data-dashboard-scene-visual]';
    const protectedName = /(?:^|[\s_-])(?:panel|chart|kpi|metric|stat|header|footer|nav|tabs|toolbar|tools|table|rank|legend|orders|inbound)(?:$|[\s_-])/i;
    let frame, visual, host, observer, scheduled = 0, disposed = false;
    let restoreVisual = () => {};
    let restoreLayers = () => {};
    const raf = globalThis.requestAnimationFrame.bind(globalThis);
    const delay = ms => { const {promise, resolve} = Promise.withResolvers(); setTimeout(resolve, ms); return promise; };
    const bounds = element => {
        const rect = element.getBoundingClientRect();
        return {left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom};
    };
    const width = rect => rect.right - rect.left;
    const height = rect => rect.bottom - rect.top;
    const area = rect => Math.max(0, width(rect)) * Math.max(0, height(rect));
    const validRegion = region => region && typeof region === 'object' && [region.x, region.y, region.width, region.height].every(Number.isFinite) && region.x >= 0 && region.y >= 0 && region.width >= 5 && region.height >= 5 && region.x + region.width <= 100 && region.y + region.height <= 100;
    const normalized = rect => {
        const x = Math.max(0, rect.left / innerWidth * 100), y = Math.max(0, rect.top / innerHeight * 100);
        return {x, y, width: Math.min(width(rect) / innerWidth * 100, 100 - x), height: Math.min(height(rect) / innerHeight * 100, 100 - y)};
    };
    function visible(element) {
        const style = getComputedStyle(element);
        return style.display !== 'none' && (element === visual || style.visibility !== 'hidden') && Number(style.opacity) !== 0 && area(bounds(element)) > 1;
    }
    function intersect(a, b) {
        return {left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom)};
    }
    function candidate() {
        for (const selector of [explicit, semantic]) {
            for (const element of document.querySelectorAll(selector)) {
                if (!visible(element)) continue;
                const media = element.matches('img,iframe,canvas,[data-dashboard-scene-visual]') ? element : [...element.querySelectorAll('[data-dashboard-scene-visual],img,iframe,canvas')].find(node => visible(node) && !node.closest('header,nav,button,[class*="panel"],[class*="chart"],[class*="kpi"]'));
                if (!media && selector === semantic && !element.matches('.lg-scene,.wm-warehouse-viewport,.wm-warehouse-map,.warehouse-map')) continue;
                return {element: media ?? element};
            }
        }
        return null;
    }
    function obstacles(target) {
        const result = [], selected = new Set();
        const excluded = element => element === frame || element === target || (target?.matches('img,iframe,canvas,[data-dashboard-scene-visual]') && target.contains(element)) || element.closest('[data-scenivo-composed-scene]');
        for (const element of document.body.querySelectorAll('*')) {
            if (excluded(element) || !visible(element)) continue;
            const identity = `${element.id} ${typeof element.className === 'string' ? element.className : ''}`;
            const named = element.matches('header,footer,nav,table,button,input,select,textarea,[role="navigation"],[role="tablist"]') || protectedName.test(identity);
            if (!named || (target && element.contains(target))) continue;
            // Full-canvas navigation wrappers are deliberately pointer-transparent;
            // only their visible buttons occupy space, not their bounding box.
            if (getComputedStyle(element).pointerEvents === 'none' && element.querySelector('button,a,[role="tab"]')) continue;
            if ([...selected].some(parent => parent.contains(element))) continue;
            selected.add(element);
            result.push(bounds(element));
        }
        for (const element of document.body.querySelectorAll('*')) {
            if (excluded(element) || !visible(element) || [...selected].some(parent => parent.contains(element))) continue;
            if (target && element.contains(target)) continue;
            if (element.matches('img,svg,canvas,video,iframe')) { result.push(bounds(element)); continue; }
            for (const node of element.childNodes) {
                if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                const rect = range.getBoundingClientRect();
                if (rect.width && rect.height) result.push({left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom});
            }
        }
        return result;
    }
    function freeRectangle(region, occupied) {
        let regions = [region];
        for (const obstacle of occupied) {
            const next = [];
            const padded = {left: obstacle.left - 6, top: obstacle.top - 6, right: obstacle.right + 6, bottom: obstacle.bottom + 6};
            for (const rect of regions) {
                const overlap = intersect(rect, padded);
                if (area(overlap) === 0) { next.push(rect); continue; }
                next.push({ ...rect, right: overlap.left }, { ...rect, left: overlap.right }, { ...rect, bottom: overlap.top }, { ...rect, top: overlap.bottom });
            }
            regions = next.filter(rect => width(rect) > 40 && height(rect) > 40);
            // Keep maximal rectangles only; overlapping alternatives are intentional.
            regions = regions.filter((rect, index) => !regions.some((other, otherIndex) => otherIndex !== index && other.left <= rect.left && other.top <= rect.top && other.right >= rect.right && other.bottom >= rect.bottom && (area(other) > area(rect) || otherIndex < index)));
        }
        const cx = innerWidth / 2, cy = innerHeight / 2;
        return regions.sort((a, b) => {
            const score = rect => area(rect) / (1 + Math.hypot((rect.left + rect.right) / 2 - cx, (rect.top + rect.bottom) / 2 - cy) / Math.max(innerWidth, innerHeight));
            return score(b) - score(a);
        })[0];
    }
    function measure() {
        const target = candidate();
        if (manualRegion !== undefined) {
            if (!validRegion(manualRegion)) throw new Error('三维区域必须位于看板 0–100% 范围内，宽高至少为 5%');
            const {x, y, width, height} = manualRegion;
            return {target: target?.element, rect: {left: innerWidth * x / 100, top: innerHeight * y / 100, right: innerWidth * (x + width) / 100, bottom: innerHeight * (y + height) / 100}, description: '使用已保存的三维区域，可与看板面板重叠'};
        }
        const viewport = {left: 0, top: 0, right: innerWidth, bottom: innerHeight};
        const region = target ? intersect(bounds(target.element), viewport) : {left: innerWidth * .08, right: innerWidth * .92, top: innerHeight * .12, bottom: innerHeight * .94};
        const rect = freeRectangle(region, obstacles(target?.element));
        const minArea = target ? .045 : .12;
        if (!rect || area(rect) < innerWidth * innerHeight * minArea || width(rect) < innerWidth * (target ? .16 : .28) || height(rect) < innerHeight * (target ? .20 : .30) || (!target && (rect.left > innerWidth * .6 || rect.right < innerWidth * .4))) {
            throw new Error('这个看板已被图表和指标占满，没有足够空间放置三维模型。本次未接入，原场景和已选看板已保留。请换一个带三维区域的看板，或输入 /看板 叠加 将它作为面板显示。');
        }
        return {target: target?.element, rect, description: target ? '接入模板场景区域，保留图表、指标及导航' : '接入看板中央空闲区域，保留全部信息面板'};
    }
    function position() {
        const placement = measure();
        const origin = bounds(host);
        const sx = origin.right > origin.left && host.offsetWidth ? width(origin) / host.offsetWidth : 1;
        const sy = origin.bottom > origin.top && host.offsetHeight ? height(origin) / host.offsetHeight : 1;
        const rect = placement.rect;
        frame.style.left = `${(rect.left - origin.left) / sx - host.clientLeft + host.scrollLeft}px`;
        frame.style.top = `${(rect.top - origin.top) / sy - host.clientTop + host.scrollTop}px`;
        frame.style.width = `${width(rect) / sx}px`;
        frame.style.height = `${height(rect) / sy}px`;
    }
    async function afterRender() {
        if (!sceneHtml && !inspect) return;
        await delay(350);
        const deadline = performance.now() + 10000;
        while (!disposed && (globalThis.__BOARD_READY === false || globalThis.__DASHBOARD_READY === false || [...document.images].some(image => !image.complete) || [...document.querySelectorAll('link[rel="stylesheet"]')].some(link => !link.sheet))) {
            if (performance.now() > deadline) throw new Error('看板尚未完成渲染，无法安全确认三维接入区域');
            await delay(50);
        }
        if (document.fonts) await Promise.race([document.fonts.ready, delay(1500)]);
        const {promise: painted, resolve: paint} = Promise.withResolvers();
        raf(() => raf(paint));
        await painted;
        if (disposed) return;
        const placement = measure();
        if (inspect) {
            const region = normalized(placement.rect);
            if (!validRegion(region)) throw new Error('看板场景区域超出设计画布范围');
            report({ok: true, description: placement.description, region});
            return;
        }
        visual = placement.target;
        const media = visual?.matches('img,iframe,canvas,[data-dashboard-scene-visual]');
        // Share the board's stacking context: the model is a base layer, not a root overlay.
        host = media ? visual.parentElement : visual ?? document.querySelector('#board,.wm-board,main') ?? document.body;
        if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
        if (visual) {
            const changed = [];
            const visibility = (element, value) => {
                changed.push([element, element.style.getPropertyValue('visibility'), element.style.getPropertyPriority('visibility')]);
                element.style.setProperty('visibility', value, 'important');
            };
            visibility(visual, 'hidden');
            if (!media) {
                // A semantic scene container may also own labels, controls and panels.
                // Hide its original visual without hiding those information layers.
                for (const element of visual.querySelectorAll('*')) {
                    const identity = `${element.id} ${typeof element.className === 'string' ? element.className : ''}`;
                    if (element.matches('header,footer,nav,table,button,input,select,textarea,a,[role="navigation"],[role="tablist"]') || protectedName.test(identity) || [...element.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim())) visibility(element, 'visible');
                }
            }
            restoreVisual = () => { for (const [element, value, priority] of changed) { if (value) element.style.setProperty('visibility', value, priority); else element.style.removeProperty('visibility'); } };
        }
        const layerChanges = [];
        const remember = (element, key, value) => { layerChanges.push([element, key, element.style.getPropertyValue(key), element.style.getPropertyPriority(key)]); element.style.setProperty(key, value); };
        for (const element of host.querySelectorAll('*')) {
            if (element === visual || element.closest('[data-scenivo-composed-scene]')) continue;
            const identity = `${element.id} ${typeof element.className === 'string' ? element.className : ''}`;
            if (!element.matches('header,footer,nav,button,table,[role="navigation"],[role="tablist"]') && !protectedName.test(identity)) continue;
            let layer = element;
            while (layer.parentElement && layer.parentElement !== host && !layer.parentElement.contains(visual)) layer = layer.parentElement;
            if (layer === host || layer === visual || layer.contains(visual)) continue;
            const computed = getComputedStyle(layer);
            if (computed.position === 'static') remember(layer, 'position', 'relative');
            if (!Number.isFinite(Number.parseInt(computed.zIndex, 10)) || Number.parseInt(computed.zIndex, 10) < 2) remember(layer, 'z-index', '2');
        }
        restoreLayers = () => { for (const [element,key,value,priority] of layerChanges.reverse()) { if (value) element.style.setProperty(key,value,priority); else element.style.removeProperty(key); } };
        frame = document.createElement('iframe');
        frame.dataset.scenivoComposedScene = '';
        frame.title = '三维场景（拖动旋转，Shift 拖动平移，滚轮缩放）';
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.setAttribute('referrerpolicy', 'no-referrer');
        frame.style.cssText = 'position:absolute;display:block;visibility:visible!important;border:0;margin:0;padding:0;max-width:none;max-height:none;background:transparent;pointer-events:auto;z-index:1;mask-image:linear-gradient(90deg,transparent,#000 3%,#000 97%,transparent),linear-gradient(0deg,transparent,#000 4%,#000 96%,transparent);mask-composite:intersect';
        frame.srcdoc = sceneHtml;
        host.append(frame);
        position();
        const schedule = () => {
            if (scheduled || disposed) return;
            scheduled = raf(() => { scheduled = 0; try { position(); frame.hidden = false; } catch (error) { frame.hidden = true; fail(error); } });
        };
        globalThis.addEventListener('resize', schedule);
        if (typeof ResizeObserver !== 'undefined') { observer = new ResizeObserver(schedule); observer.observe(host); if (visual && visual !== host) observer.observe(visual); }
        return () => globalThis.removeEventListener('resize', schedule);
    }
    let removeResize;
    return {
        afterRender: async () => { removeResize?.(); observer?.disconnect(); frame?.remove(); frame = undefined; restoreLayers(); restoreLayers = () => {}; restoreVisual(); restoreVisual = () => {}; visual = undefined; removeResize = await afterRender(); },
        dispose: () => { disposed = true; observer?.disconnect(); removeResize?.(); restoreLayers(); restoreVisual(); if (scheduled) cancelAnimationFrame(scheduled); }
    };
}
