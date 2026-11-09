"use strict";
function mountDashboard(prepared, policy, composition = {}) {
    const root = 'https://dashboard.invalid/';
    const urls = Object.create(null), building = new Set();
    let currentPage = prepared.entry;
    const sendPlacement = parent.postMessage.bind(parent);
    let reported = false;
    function reportPlacement(result) {
        if (!composition.inspect || reported) return;
        const region = result.region;
        if (result.ok && (!region || typeof region !== 'object' || ![region.x, region.y, region.width, region.height].every(Number.isFinite) || region.x < 0 || region.y < 0 || region.width < 5 || region.height < 5 || region.x + region.width > 100 || region.y + region.height > 100)) return;
        reported = true;
        sendPlacement({kind: 'scenivo-placement', nonce: composition.nonce, ok: result.ok, ...(result.ok ? {description: result.description, region: {x: region.x, y: region.y, width: region.width, height: region.height}} : {error: result.error})}, '*');
    }
    const placement = createDashboardPlacement({sceneHtml: composition.sceneHtml, region: composition.region, inspect: composition.inspect, report: reportPlacement, fail: showError});
    function resource(path) {
        if (urls[path])
            return urls[path];
        const item = prepared.resources[path];
        if (!item)
            throw new Error(`看板缺少资源：${path}`);
        if (building.has(path))
            throw new Error(`不支持循环样式资源引用：${path}`);
        building.add(path);
        const bytes = item.base64 === undefined ? replace(item.text ?? '') : Uint8Array.from(atob(item.base64), char => char.charCodeAt(0));
        urls[path] = URL.createObjectURL(new Blob([bytes], { type: item.mime }));
        building.delete(path);
        return urls[path];
    }
    function replace(value) {
        return value.replace(new RegExp(prepared.marker + '([^\\s"\'<>]*?)__', 'g'), (_all, path) => resource(decodeURIComponent(path)));
    }
    function local(reference, base = currentPage) {
        const url = new URL(reference, new URL(base, root));
        if (url.origin !== new URL(root).origin || url.username || url.password)
            throw new Error(`已阻止外部资源：${reference}`);
        const path = decodeURIComponent(url.pathname.slice(1));
        if (!Object.prototype.hasOwnProperty.call(prepared.resources, path) && !Object.prototype.hasOwnProperty.call(prepared.documents, path))
            throw new Error(`看板缺少资源：${path}（引用自 ${base}）`);
        return { path, hash: url.hash, url: url.href };
    }
    function resourceUrl(reference, base = currentPage) {
        if (reference.startsWith('data:') || reference.startsWith('#'))
            return reference;
        if (reference.startsWith('blob:')) {
            if (!Object.values(urls).some(url => reference === url || reference.startsWith(url + '#')))
                throw new Error('不支持非包内 Blob 资源');
            return reference;
        }
        const target = local(reference, base);
        return resource(target.path) + target.hash;
    }
    const nativeFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = async (input, init) => {
        const request = input instanceof Request ? input : undefined;
        if ((init?.method ?? request?.method ?? 'GET').toUpperCase() !== 'GET')
            throw new Error('静态看板只支持 GET 资源请求');
        const target = local(request?.url ?? String(input));
        const response = await nativeFetch(resource(target.path), { signal: init?.signal ?? request?.signal, credentials: 'omit' });
        Object.defineProperty(response, 'url', { value: target.url });
        return response;
    };
    const nativeOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (method, url, async = true, username, password) {
        if (method.toUpperCase() !== 'GET' || username || password)
            throw new Error('静态看板只支持无凭据 GET 请求');
        nativeOpen.call(this, method, resourceUrl(String(url)), async, null, null);
    };
    Object.defineProperty(globalThis, '__dashboardLocal', { value: Object.freeze({ module: (base, value) => {
                const target = local(String(value), base);
                return resource(target.path) + target.hash;
            } }), writable: false, configurable: false });
    const nativeSetAttribute = Element.prototype.setAttribute;
    function dynamicAttribute(element, name, value) {
        const key = name.toLowerCase();
        if (['src', 'poster', 'background', 'xlink:href'].includes(key) || (key === 'href' && element.tagName === 'LINK'))
            return resourceUrl(value);
        if (key === 'srcset')
            return value.split(',').map(part => { const match = part.trim().match(/^(\S+)(.*)$/); return match ? resourceUrl(match[1]) + match[2] : ''; }).join(',');
        return value;
    }
    Element.prototype.setAttribute = function (name, value) { nativeSetAttribute.call(this, name, dynamicAttribute(this, name, String(value))); };
    for (const [constructor, properties] of [[HTMLImageElement, ['src', 'srcset']], [HTMLScriptElement, ['src']], [HTMLLinkElement, ['href']], [HTMLMediaElement, ['src', 'poster']], [HTMLSourceElement, ['src', 'srcset']], [HTMLInputElement, ['src']]]) {
        for (const name of properties) {
            const descriptor = Object.getOwnPropertyDescriptor(constructor.prototype, name);
            if (descriptor?.set)
                Object.defineProperty(constructor.prototype, name, { ...descriptor, set(value) { descriptor.set.call(this, dynamicAttribute(this, name, String(value))); } });
        }
    }
    // HTML string insertion bypasses setAttribute/src setters. Resolve inside an inert
    // template before nodes enter the live document, so local images never hit the network.
    const nativeInnerHtml = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    function localFragment(value) {
        const template = document.createElement('template');
        nativeInnerHtml.set.call(template, String(value));
        for (const element of template.content.querySelectorAll('*')) {
            for (const name of ['src', 'poster', 'background', 'xlink:href', 'srcset']) {
                const original = element.getAttribute(name);
                if (original !== null) nativeSetAttribute.call(element, name, dynamicAttribute(element, name, original));
            }
            if (element.tagName === 'LINK' && element.hasAttribute('href')) nativeSetAttribute.call(element, 'href', resourceUrl(element.getAttribute('href')));
        }
        return template;
    }
    if (nativeInnerHtml?.set) Object.defineProperty(Element.prototype, 'innerHTML', {
        ...nativeInnerHtml,
        set(value) {
            const rewritten = localFragment(value);
            // Native parsing preserves template.content and SVG/table context semantics.
            nativeInnerHtml.set.call(this, nativeInnerHtml.get.call(rewritten));
        }
    });
    const nativeInsertAdjacentHtml = Element.prototype.insertAdjacentHTML;
    Element.prototype.insertAdjacentHTML = function(position, value) {
        const where = String(position).toLowerCase();
        if (!['beforebegin', 'afterbegin', 'beforeend', 'afterend'].includes(where)) return nativeInsertAdjacentHtml.call(this, position, value);
        const fragment = localFragment(value).content;
        if (where === 'beforebegin') { if (!this.parentElement) return nativeInsertAdjacentHtml.call(this, position, value); this.before(fragment); }
        else if (where === 'afterend') { if (!this.parentElement) return nativeInsertAdjacentHtml.call(this, position, value); this.after(fragment); }
        else if (where === 'afterbegin') this.prepend(fragment);
        else this.append(fragment);
    };
    function showError(error) {
        reportPlacement({ok: false, error: (error instanceof Error ? error.message : String(error)).slice(0, 1000)});
        const message = document.createElement('pre');
        message.setAttribute('role', 'alert');
        message.style.cssText = 'position:fixed;inset:0;z-index:2147483647;margin:0;padding:24px;background:#1c2028;color:#fff;white-space:pre-wrap;font:14px/1.6 system-ui';
        message.textContent = `看板载入失败：${error instanceof Error ? error.message : String(error)}`;
        document.body.append(message);
    }
    async function loadPage(path, hash = '') {
        currentPage = path;
        const source = prepared.documents[path];
        if (source === undefined)
            throw new Error(`看板缺少 HTML 页面：${path}`);
        const parsed = new DOMParser().parseFromString(replace(source), 'text/html');
        const scripts = Array.from(parsed.querySelectorAll('script'));
        const executable = scripts.filter(script => !script.type || script.type === 'module' || /^(?:text|application)\/(?:java|ecma)script$/i.test(script.type));
        const placeholders = executable.map(script => { const placeholder = parsed.createComment('dashboard-script'); script.replaceWith(placeholder); return placeholder; });
        for (const attribute of Array.from(document.documentElement.attributes))
            document.documentElement.removeAttribute(attribute.name);
        for (const attribute of parsed.documentElement.attributes)
            nativeSetAttribute.call(document.documentElement, attribute.name, attribute.value);
        for (const attribute of Array.from(document.body.attributes))
            document.body.removeAttribute(attribute.name);
        for (const attribute of parsed.body.attributes)
            nativeSetAttribute.call(document.body, attribute.name, attribute.value);
        document.head.replaceChildren();
        const csp = document.createElement('meta');
        csp.httpEquiv = 'Content-Security-Policy';
        csp.content = policy;
        document.head.append(csp);
        const base = document.createElement('base');
        base.href = new URL(path, root).href;
        document.head.append(base);
        const map = Object.create(null);
        for (const [specifier, resourcePath] of Object.entries(prepared.modules))
            map[specifier] = resource(resourcePath);
        const importMap = document.createElement('script');
        importMap.type = 'importmap';
        importMap.textContent = JSON.stringify({ imports: map });
        document.head.append(importMap);
        document.head.append(...Array.from(parsed.head.childNodes));
        document.body.replaceChildren(...Array.from(parsed.body.childNodes));
        for (let index = 0; index < executable.length; index++) {
            const original = executable[index], script = document.createElement('script');
            for (const attribute of original.attributes)
                nativeSetAttribute.call(script, attribute.name, attribute.value);
            script.textContent = original.textContent;
            script.async = false;
            const completion = Promise.withResolvers();
            const waitsForLoad = !!script.src || script.type === 'module';
            if (waitsForLoad) {
                script.onload = () => completion.resolve();
                script.onerror = () => completion.reject(new Error(`脚本执行失败：${original.getAttribute('src') ?? path}`));
            }
            placeholders[index].replaceWith(script);
            if (waitsForLoad)
                await completion.promise;
        }
        document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true }));
        globalThis.dispatchEvent(new Event('load'));
        if (hash) {
            const id = decodeURIComponent(hash.slice(1));
            document.getElementById(id)?.scrollIntoView();
        }
        await placement.afterRender();
    }
    document.addEventListener('click', event => {
        const anchor = (event.target instanceof Element ? event.target.closest('a,area') : null);
        if (!anchor)
            return;
        const page = anchor.getAttribute('data-dashboard-page');
        if (page) {
            event.preventDefault();
            const split = page.indexOf('#');
            void loadPage(split < 0 ? page : page.slice(0, split), split < 0 ? '' : page.slice(split)).catch(showError);
        }
        else {
            const href = anchor.getAttribute('href');
            if (href && !href.startsWith('#'))
                event.preventDefault();
        }
    }, true);
    document.addEventListener('submit', event => event.preventDefault(), true);
    globalThis.addEventListener('error', (event) => { if (event instanceof ErrorEvent) {
        event.preventDefault();
        showError(event.error ?? event.message);
    }
    else {
        const target = event.target;
        if (target instanceof Element)
            showError(new Error(`资源载入失败：${target.getAttribute('src') ?? target.getAttribute('href') ?? target.tagName}`));
    } }, true);
    document.addEventListener('securitypolicyviolation', event => showError(new Error(`看板资源被隔离策略阻止：${event.blockedURI}（${event.violatedDirective}）`)));
    globalThis.addEventListener('unhandledrejection', event => { event.preventDefault(); showError(event.reason); });
    globalThis.addEventListener('pagehide', () => placement.dispose(), {once: true});
    globalThis.addEventListener('pagehide', () => Object.values(urls).forEach(url => URL.revokeObjectURL(url)), { once: true });
    void loadPage(prepared.entry).catch(showError);
}
